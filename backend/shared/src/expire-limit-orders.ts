import { createSupabaseDirectClient } from 'shared/supabase/init'
import { uniq } from 'lodash'
import { convertBet } from 'common/supabase/bets'
import { createLimitBetExpiredNotification } from 'shared/create-notification'
import { getContractsDirect } from 'shared/supabase/contracts'
import { LimitBet } from 'common/bet'
import {
  getMexasRemainingReservedAmount,
  isMexasOrderBookOnlyContract,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import { getMexasOrderReleaseCreditKey } from 'common/mexas-resolution'

export async function expireLimitOrders() {
  const pg = createSupabaseDirectClient()
  const unfilteredBets = await pg.map(
    `
    update contract_bets
    set
      is_cancelled = true,
      data = coalesce(data, '{}'::jsonb) || '{"isCancelled": true}'::jsonb
    where is_filled = false
    and is_cancelled = false
    and expires_at < now()
    returning *
  `,
    [],
    convertBet
  )
  const bets = unfilteredBets.filter((bet) => !bet.silent)
  const uniqueContractIds = uniq(unfilteredBets.map((bet) => bet.contractId))
  const contracts = await getContractsDirect(uniqueContractIds, pg)

  const mexasRefunds = unfilteredBets
    .map((bet) => {
      const contract = contracts.find((c) => c.id === bet.contractId)
      const order = bet as LimitBet & MexasReservedOrderData
      const refundAmount =
        contract &&
        isMexasOrderBookOnlyContract(contract) &&
        order.mexasFundsReserved === true &&
        order.mexasFundsReleased !== true
          ? getMexasRemainingReservedAmount(order)
          : 0

      return refundAmount > 0
        ? {
            betId: bet.id,
            userId: bet.userId,
            refundAmount,
            creditKey: getMexasOrderReleaseCreditKey(bet.id),
          }
        : undefined
    })
    .filter((refund) => refund !== undefined)

  if (mexasRefunds.length > 0) {
    await pg.tx(async (tx) => {
      for (const refund of mexasRefunds) {
        await tx.none(
          `
          update users
          set
            balance = balance + $2,
            data = jsonb_set(
              coalesce(data, '{}'::jsonb),
              '{mexasBalanceCreditKeys}',
              coalesce(
                coalesce(data, '{}'::jsonb)->'mexasBalanceCreditKeys',
                '[]'::jsonb
              ) || to_jsonb($3::text),
              true
            )
          where id = $1
            and not (
              coalesce(
                coalesce(data, '{}'::jsonb)->'mexasBalanceCreditKeys',
                '[]'::jsonb
              ) ? $3
            )
        `,
          [refund.userId, refund.refundAmount, refund.creditKey]
        )
        await tx.none(
          `
          update contract_bets
          set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
            'mexasFundsReleased', true,
            'mexasReleaseCreditKey', $2
          )
          where bet_id = $1
        `,
          [refund.betId, refund.creditKey]
        )
      }
    })
  }

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
}
