import { createSupabaseDirectClient } from 'shared/supabase/init'
import { uniq } from 'lodash'
import { convertBet } from 'common/supabase/bets'
import { createLimitBetExpiredNotification } from 'shared/create-notification'
import { getContractsDirect } from 'shared/supabase/contracts'
import { LimitBet } from 'common/bet'
import { MEXAS_PUBLIC_RPC_URL, MEXAS_TOKEN } from 'common/crypto/mexas'
import { type SupabaseDirectClient } from 'shared/supabase/init'

const BALANCE_OF_SELECTOR = '0x70a08231'
const MEXAS_BALANCE_LOCK_TIMEOUT_MS = 2 * 60 * 1000
const EPSILON = 0.00000001

export async function expireLimitOrders() {
  const pg = createSupabaseDirectClient()
  const releasedMexasOrders = await releaseExpiredMexasReservedOrders(pg)
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
  user_balance: number
  wallet_address: string | null
}

type MexasPreparedRelease = MexasReleaseCandidate & {
  credit_amount: number
  max_backed_available_amount: number
}

type MexasReleasedOrder = {
  bet_id: string
  credit_key: string
  credit_amount: number
  max_backed_available_amount: number
  released_at: number
  release_reason: string
  user_id: string
}

function roundMexasAmount(amount: number) {
  return Math.round(amount * 1e8) / 1e8
}

function isEvmAddress(address: string | null | undefined): address is string {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address)
}

function encodeBalanceOfCall(address: string) {
  return `${BALANCE_OF_SELECTOR}${address
    .toLowerCase()
    .slice(2)
    .padStart(64, '0')}`
}

function hexUnitsToMexasAmount(hex: string) {
  if (!/^0x[a-fA-F0-9]+$/.test(hex)) {
    throw new Error('Invalid MEXAS balance response.')
  }

  const units = BigInt(hex)
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('MEXAS balance is too large to compare safely.')
  }

  return Number(units) / 10 ** MEXAS_TOKEN.decimals
}

async function readMexasWalletAmount(walletAddress: string) {
  const response = await fetch(
    process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || MEXAS_PUBLIC_RPC_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to: MEXAS_TOKEN.address,
            data: encodeBalanceOfCall(walletAddress),
          },
          'latest',
        ],
      }),
    }
  )
  if (!response.ok) {
    throw new Error(`MEXAS balance RPC failed with ${response.status}.`)
  }

  const payload = (await response.json()) as {
    error?: { message?: string }
    result?: string
  }
  if (payload.error) {
    throw new Error(
      payload.error.message ?? 'MEXAS balance RPC returned error.'
    )
  }
  if (!payload.result) {
    throw new Error('MEXAS balance RPC returned no result.')
  }

  return hexUnitsToMexasAmount(payload.result)
}

async function loadExpiredMexasReleaseCandidates(
  pg: SupabaseDirectClient,
  releasedAt: number
) {
  return await pg.manyOrNone<MexasReleaseCandidate>(
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
      b.user_id,
      u.balance as user_balance,
      u.data->>'privyWalletAddress' as wallet_address
    from contract_bets b
    join contracts c on c.id = b.contract_id
    join users u on u.id = b.user_id
    where coalesce(b.is_filled, false) = false
      and coalesce((b.data->>'mexasFundsReserved')::boolean, false) = true
      and coalesce((b.data->>'mexasFundsReleased')::boolean, false) = false
      and coalesce((b.data->>'mexasStakeEscrowed')::boolean, false) = false
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
    `,
    [releasedAt]
  )
}

async function loadActiveReservedAmountsAfterRelease(
  pg: SupabaseDirectClient,
  userIds: string[],
  releasedBetIds: string[]
) {
  if (!userIds.length) return new Map<string, number>()

  const rows = await pg.manyOrNone<{ user_id: string; amount: number }>(
    `
    with affected_users as (
      select unnest($1::text[]) as user_id
    )
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
      and b.bet_id <> all($2::text[])
      and coalesce(b.is_cancelled, false) = false
      and coalesce(b.is_filled, false) = false
      and (b.expires_at is null or b.expires_at > now())
      and coalesce((b.data->>'mexasFundsReserved')::boolean, false) = true
      and coalesce((b.data->>'mexasFundsReleased')::boolean, false) = false
    group by au.user_id
    `,
    [userIds, releasedBetIds]
  )

  return new Map(rows.map((row) => [row.user_id, row.amount]))
}

async function prepareBackedMexasReleases(
  pg: SupabaseDirectClient,
  candidates: MexasReleaseCandidate[]
) {
  const userIds = [...new Set(candidates.map((candidate) => candidate.user_id))]
  const releasedBetIds = candidates.map((candidate) => candidate.bet_id)
  const reservedAfterRelease = await loadActiveReservedAmountsAfterRelease(
    pg,
    userIds,
    releasedBetIds
  )
  const candidatesByUser = candidates.reduce((map, candidate) => {
    const userCandidates = map.get(candidate.user_id) ?? []
    userCandidates.push(candidate)
    map.set(candidate.user_id, userCandidates)
    return map
  }, new Map<string, MexasReleaseCandidate[]>())
  const prepared: MexasPreparedRelease[] = []

  for (const [userId, userCandidates] of candidatesByUser) {
    const walletAddress = userCandidates[0].wallet_address
    if (!isEvmAddress(walletAddress)) {
      console.warn('Skipping MEXAS release without valid Privy wallet', {
        userId,
      })
      continue
    }

    let walletAmount: number
    try {
      walletAmount = await readMexasWalletAmount(walletAddress)
    } catch (error) {
      console.warn('Skipping MEXAS release without on-chain backing read', {
        userId,
        error,
      })
      continue
    }

    const maxBackedAvailableAmount = roundMexasAmount(
      Math.max(0, walletAmount - (reservedAfterRelease.get(userId) ?? 0))
    )
    let remainingCreditAmount = roundMexasAmount(
      Math.max(0, maxBackedAvailableAmount - userCandidates[0].user_balance)
    )

    for (const candidate of userCandidates) {
      const creditAmount = Math.min(
        candidate.refund_amount,
        Math.max(0, remainingCreditAmount)
      )
      remainingCreditAmount = roundMexasAmount(
        remainingCreditAmount - creditAmount
      )

      prepared.push({
        ...candidate,
        credit_amount: creditAmount,
        max_backed_available_amount: maxBackedAvailableAmount,
        release_reason:
          creditAmount >= candidate.refund_amount - EPSILON
            ? candidate.release_reason
            : `${candidate.release_reason}-unbacked-onchain-balance`,
      })
    }
  }

  return prepared
}

async function applyPreparedMexasReleases(
  pg: SupabaseDirectClient,
  releases: MexasPreparedRelease[]
) {
  if (releases.length === 0) return []

  const released = await pg.manyOrNone<MexasReleasedOrder>(
    `
    with release_events as (
      select *
      from jsonb_to_recordset($1::jsonb) as e(
        bet_id text,
        credit_key text,
        credit_amount numeric,
        release_reason text,
        released_at bigint,
        max_backed_available_amount numeric,
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
        'mexasReleaseCreditAmount', e.credit_amount,
        'mexasReleaseReason', e.release_reason,
        'mexasReleasedAt', e.released_at
      )
    from release_events e
    join users u on u.id = e.user_id
    where b.bet_id = e.bet_id
      and b.updated_time = e.updated_time
      and coalesce(b.is_filled, false) = false
      and coalesce((b.data->>'mexasFundsReserved')::boolean, false) = true
      and coalesce((b.data->>'mexasFundsReleased')::boolean, false) = false
      and not (
        coalesce((u.data->>'mexasBalanceLock')::boolean, false) = true
        and coalesce((u.data->>'mexasBalanceLockSince')::bigint, 0) > e.released_at - 120000
      )
    returning
      b.bet_id,
      e.credit_key,
      e.credit_amount,
      e.max_backed_available_amount,
      e.released_at,
      e.release_reason,
      b.user_id
    `,
    [JSON.stringify(releases)]
  )
  if (released.length === 0) return []

  await pg.none(
    `
    with release_events as (
      select *
      from jsonb_to_recordset($1::jsonb) as e(
        bet_id text,
        credit_key text,
        credit_amount numeric,
        max_backed_available_amount numeric,
        released_at bigint,
        release_reason text,
        user_id text
      )
    ),
    user_credit_events as (
      select
        e.user_id,
        e.credit_key,
        e.credit_amount,
        e.max_backed_available_amount,
        e.released_at
      from release_events e
      join users u on u.id = e.user_id
      where e.credit_amount > 0
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
        round(sum(credit_amount), 8) as credit_amount,
        min(max_backed_available_amount) as max_backed_available_amount,
        min(released_at) as released_at,
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
      and not (
        coalesce((u.data->>'mexasBalanceLock')::boolean, false) = true
        and coalesce((u.data->>'mexasBalanceLockSince')::bigint, 0) > cu.released_at - 120000
      )
      and round(u.balance + cu.credit_amount, 8) <= cu.max_backed_available_amount + 0.00000001
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

async function releaseExpiredMexasReservedOrders(pg: SupabaseDirectClient) {
  const releasedAt = Date.now()
  const candidates = await loadExpiredMexasReleaseCandidates(pg, releasedAt)
  if (candidates.length === 0) return []

  const releases = await prepareBackedMexasReleases(pg, candidates)
  return await pg.tx(async (tx) => applyPreparedMexasReleases(tx, releases))
}
