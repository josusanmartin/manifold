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
import { bulkIncrementBalancesQuery } from './supabase/users'

export async function expireLimitOrders() {
  const pg = createSupabaseDirectClient()
  const unfilteredBets = await pg.map(
    `
    update contract_bets
    set data = data || '{"isCancelled": true}'
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
        ? { betId: bet.id, userId: bet.userId, refundAmount }
        : undefined
    })
    .filter((refund) => refund !== undefined)

  if (mexasRefunds.length > 0) {
    await pg.tx(async (tx) => {
      await tx.none(
        bulkIncrementBalancesQuery(
          mexasRefunds.map((refund) => ({
            id: refund.userId,
            balance: refund.refundAmount,
          }))
        )
      )
      await tx.none(
        `
        update contract_bets
        set data = data || '{"mexasFundsReleased": true}'::jsonb
        where bet_id in ($1:list)
      `,
        [mexasRefunds.map((refund) => refund.betId)]
      )
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
