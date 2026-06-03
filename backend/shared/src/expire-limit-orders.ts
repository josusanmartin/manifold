import { createSupabaseDirectClient } from 'shared/supabase/init'
import { uniq } from 'lodash'
import { convertBet } from 'common/supabase/bets'
import { createLimitBetExpiredNotification } from 'shared/create-notification'
import { getContractsDirect } from 'shared/supabase/contracts'
import { LimitBet } from 'common/bet'
import { type SupabaseDirectClient } from 'shared/supabase/init'

export async function expireLimitOrders() {
  const pg = createSupabaseDirectClient()
  const releasedMexasOrders = await pg.tx(async (tx) =>
    releaseExpiredMexasReservedOrders(tx)
  )
  const unfilteredBets = await pg.map(
    `
    update contract_bets
    set
      is_cancelled = true,
      data = coalesce(data, '{}'::jsonb) || '{"isCancelled": true}'::jsonb
    where is_filled = false
    and is_cancelled = false
    and expires_at < now()
    and not (
      coalesce(data, '{}'::jsonb)->>'mexasFundsReserved' = 'true'
    )
    returning *
  `,
    [],
    convertBet
  )
  const bets = unfilteredBets.filter((bet) => !bet.silent)
  const uniqueContractIds = uniq(unfilteredBets.map((bet) => bet.contractId))
  const contracts = await getContractsDirect(uniqueContractIds, pg)

  await Promise.all(
    bets.map(async (bet) => {
      const contract = contracts.find((c) => c.id === bet.contractId)
      if (!contract) {
        console.error(`Contract not found for bet ${bet.id}`)
        return
      }
      if (contract.closeTime && contract.closeTime < Date.now()) {
        return
      }
      await createLimitBetExpiredNotification(bet as LimitBet, contract)
    })
  )

  console.log(`Expired ${bets.length} limit orders`)
  if (releasedMexasOrders.length > 0) {
    console.log(
      `Released ${releasedMexasOrders.length} expired or closed MEXAS reserved orders`
    )
  }
}

type MexasReleaseCandidate = {
  bet_id: string
  credit_key: string
  refund_amount: number
  release_reason: string
  released_at: number
  updated_time: string
  user_id: string
}

type MexasReleasedOrder = {
  bet_id: string
  credit_key: string
  refund_amount: number
  release_reason: string
  user_id: string
}

async function releaseExpiredMexasReservedOrders(pg: SupabaseDirectClient) {
  const releasedAt = Date.now()
  const candidates = await pg.manyOrNone<MexasReleaseCandidate>(
    `
    select
      b.bet_id,
      coalesce(
        b.data->>'mexasReleaseCreditKey',
        'mexas-order-release:' || b.bet_id
      ) as credit_key,
      greatest(
        0,
        round(
          coalesce(
            (b.data->>'mexasReservedAmount')::numeric,
            (b.data->>'orderAmount')::numeric,
            0
          ) - coalesce(b.amount, 0),
          8
        )
      ) as refund_amount,
      case
        when coalesce(b.is_cancelled, false)
          then coalesce(b.data->>'mexasReleaseReason', 'cancelled')
        when c.close_time is not null and c.close_time <= now()
          then 'market-closed'
        else 'expired'
      end as release_reason,
      $1::bigint as released_at,
      b.updated_time,
      b.user_id
    from contract_bets b
    join contracts c on c.id = b.contract_id
    join users u on u.id = b.user_id
    where coalesce(b.is_filled, false) = false
      and coalesce((b.data->>'mexasFundsReserved')::boolean, false) = true
      and coalesce((b.data->>'mexasFundsReleased')::boolean, false) = false
      and not (
        coalesce((u.data->>'mexasBalanceLock')::boolean, false) = true
        and coalesce((u.data->>'mexasBalanceLockSince')::bigint, 0) > $1::bigint - 120000
      )
      and (c.token = 'MEX' or c.data->>'token' = 'MEX')
      and c.data->>'mechanism' = 'cpmm-1'
      and c.data->>'outcomeType' = 'BINARY'
      and (
        coalesce(b.is_cancelled, false) = true
        or b.expires_at < now()
        or (c.close_time is not null and c.close_time <= now())
      )
    order by b.created_time asc, b.bet_id asc
    for update of b, u skip locked
    `,
    [releasedAt]
  )
  if (candidates.length === 0) return []

  const released = await pg.manyOrNone<MexasReleasedOrder>(
    `
    with release_events as (
      select *
      from jsonb_to_recordset($1::jsonb) as e(
        bet_id text,
        credit_key text,
        refund_amount numeric,
        release_reason text,
        released_at bigint,
        updated_time timestamptz,
        user_id text
      )
    )
    update contract_bets b
    set
      is_cancelled = true,
      data = coalesce(b.data, '{}'::jsonb) || jsonb_build_object(
        'isCancelled', true,
        'mexasFundsReleased', true,
        'mexasReleaseCreditKey', e.credit_key,
        'mexasReleaseReason', e.release_reason,
        'mexasReleasedAt', e.released_at
      )
    from release_events e
    where b.bet_id = e.bet_id
      and b.updated_time = e.updated_time
      and coalesce(b.is_filled, false) = false
      and coalesce((b.data->>'mexasFundsReserved')::boolean, false) = true
      and coalesce((b.data->>'mexasFundsReleased')::boolean, false) = false
    returning
      b.bet_id,
      e.credit_key,
      e.refund_amount,
      e.release_reason,
      b.user_id
    `,
    [JSON.stringify(candidates)]
  )
  if (released.length === 0) return []

  await pg.none(
    `
    with release_events as (
      select *
      from jsonb_to_recordset($1::jsonb) as e(
        bet_id text,
        credit_key text,
        refund_amount numeric,
        release_reason text,
        user_id text
      )
    ),
    user_credit_events as (
      select
        e.user_id,
        e.credit_key,
        e.refund_amount
      from release_events e
      join users u on u.id = e.user_id
      where e.refund_amount > 0
        and not (
          case
            when jsonb_typeof(coalesce(u.data, '{}'::jsonb)->'mexasBalanceCreditKeys') = 'array'
              then coalesce(u.data, '{}'::jsonb)->'mexasBalanceCreditKeys'
            else '[]'::jsonb
          end ? e.credit_key
        )
    ),
    credit_updates as (
      select
        user_id,
        round(sum(refund_amount), 8) as credit_amount,
        jsonb_agg(credit_key order by credit_key) as credit_keys
      from user_credit_events
      group by user_id
    )
    update users u
    set
      balance = round(u.balance + cu.credit_amount, 8),
      data = jsonb_set(
        coalesce(u.data, '{}'::jsonb),
        '{mexasBalanceCreditKeys}',
        (
          case
            when jsonb_typeof(coalesce(u.data, '{}'::jsonb)->'mexasBalanceCreditKeys') = 'array'
              then coalesce(u.data, '{}'::jsonb)->'mexasBalanceCreditKeys'
            else '[]'::jsonb
          end
        ) || cu.credit_keys,
        true
      )
    from credit_updates cu
    where u.id = cu.user_id
    `,
    [JSON.stringify(released)]
  )

  await pg.none(
    `
    with affected_users as (
      select distinct user_id
      from jsonb_to_recordset($1::jsonb) as e(user_id text)
    ),
    open_reserved as (
      select
        au.user_id,
        coalesce(
          round(
            sum(
              greatest(
                0,
                coalesce(
                  (b.data->>'mexasReservedAmount')::numeric,
                  (b.data->>'orderAmount')::numeric,
                  0
                ) - coalesce(b.amount, 0)
              )
            ),
            8
          ),
          0
        ) as amount
      from affected_users au
      left join contract_bets b
        on b.user_id = au.user_id
        and coalesce(b.is_cancelled, false) = false
        and coalesce(b.is_filled, false) = false
        and (b.expires_at is null or b.expires_at > now())
        and coalesce((b.data->>'mexasFundsReserved')::boolean, false) = true
        and coalesce((b.data->>'mexasFundsReleased')::boolean, false) = false
      group by au.user_id
    )
    update users u
    set data = jsonb_set(
      coalesce(u.data, '{}'::jsonb),
      '{mexasWalletOpenReservedAmount}',
      to_jsonb(open_reserved.amount),
      true
    )
    from open_reserved
    where u.id = open_reserved.user_id
    `,
    [JSON.stringify(released)]
  )

  return released
}
