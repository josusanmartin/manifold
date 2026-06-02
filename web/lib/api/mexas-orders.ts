import { LimitBet } from 'common/bet'
import {
  getMexasRemainingReservedAmount,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import { convertBet } from 'common/supabase/bets'
import type { Row, SupabaseClient } from 'common/supabase/utils'
import { updateMexasUserBalanceCas } from './mexas-balance'

const EXPIRED_ORDER_PAGE_SIZE = 1000

function getBetData(row: Row<'contract_bets'>) {
  const data = row.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

async function releaseExpiredMexasOrder(
  db: SupabaseClient,
  row: Row<'contract_bets'>
) {
  const bet = convertBet(row) as LimitBet & MexasReservedOrderData
  if (bet.limitProb === undefined || bet.orderAmount === undefined) return

  const data = getBetData(row)
  const shouldRefund =
    bet.mexasFundsReserved === true && bet.mexasFundsReleased !== true
  const refundAmount = shouldRefund ? getMexasRemainingReservedAmount(bet) : 0
  const creditKey = `mexas-expire:${bet.id}`

  if (refundAmount > 0) {
    await updateMexasUserBalanceCas(db, bet.userId, refundAmount, {
      creditKey,
    })
  }

  const { error } = await db
    .from('contract_bets')
    .update({
      data: {
        ...data,
        isCancelled: true,
        mexasFundsReleased: shouldRefund ? true : bet.mexasFundsReleased,
        mexasReleaseCreditKey: refundAmount > 0 ? creditKey : undefined,
      } as any,
    })
    .eq('bet_id', bet.id)
    .eq('is_cancelled', false)

  if (error) throw error
}

export async function releaseExpiredMexasOrders(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
  } = {}
) {
  const now = new Date().toISOString()
  let released = 0

  for (let from = 0; ; from += EXPIRED_ORDER_PAGE_SIZE) {
    let query = db
      .from('contract_bets')
      .select('*')
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .lt('expires_at', now)
      .eq('data->>mexasFundsReserved', 'true')
      .range(from, from + EXPIRED_ORDER_PAGE_SIZE - 1)

    if (options.contractId) query = query.eq('contract_id', options.contractId)
    if (options.userId) query = query.eq('user_id', options.userId)

    const { data, error } = await query
    if (error) throw error

    const rows = (data ?? []) as Row<'contract_bets'>[]
    for (const row of rows) {
      await releaseExpiredMexasOrder(db, row)
      released++
    }
    if (rows.length < EXPIRED_ORDER_PAGE_SIZE) break
  }

  return released
}
