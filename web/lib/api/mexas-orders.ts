import { LimitBet } from 'common/bet'
import {
  getMexasAvailableBalance,
  getMexasRemainingReservedAmount,
  getTotalMexasRemainingReservedAmount,
  getUnbackedMexasOrderIds,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import { getMexasOrderReleaseCreditKey } from 'common/mexas-resolution'
import { convertBet } from 'common/supabase/bets'
import type { Row, SupabaseClient } from 'common/supabase/utils'
import { isAddress, type Address } from 'viem'
import { formatMexasUnits, getMexasBalanceUnits } from 'web/lib/crypto/mexas'
import {
  setMexasUserBalanceCas,
  updateMexasUserBalanceCas,
} from './mexas-balance'

const EXPIRED_ORDER_PAGE_SIZE = 1000
const OPEN_RESERVED_ORDER_PAGE_SIZE = 1000
const MEXAS_WALLET_SYNC_UNITS_KEY = 'mexasWalletBalanceUnitsSynced'
const MEXAS_WALLET_SYNC_TIME_KEY = 'mexasWalletBalanceSyncedTime'

function getBetData(row: Row<'contract_bets'>) {
  const data = row.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function getUserData(row: { data: unknown } | null) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function mexasUnitsToAmount(units: bigint) {
  return Number(formatMexasUnits(units))
}

async function syncAvailableBalanceFromBacking(params: {
  db: SupabaseClient
  onChainAmount: number
  onChainUnits: bigint
  userId: string
}) {
  const openReservedAmount = await getOpenReservedMexasAmount(params.db, {
    userId: params.userId,
  })
  return await setMexasUserBalanceCas(
    params.db,
    params.userId,
    getMexasAvailableBalance({
      onChainAmount: params.onChainAmount,
      openReservedAmount,
    }),
    {
      dataPatch: {
        [MEXAS_WALLET_SYNC_UNITS_KEY]: params.onChainUnits.toString(),
        [MEXAS_WALLET_SYNC_TIME_KEY]: Date.now(),
      },
    }
  )
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
  const creditKey = getMexasOrderReleaseCreditKey(bet.id)

  if (refundAmount > 0) {
    await updateMexasUserBalanceCas(db, bet.userId, refundAmount, {
      creditKey,
    })
  }

  const { error } = await db
    .from('contract_bets')
    .update({
      is_cancelled: true,
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

  for (;;) {
    let query = db
      .from('contract_bets')
      .select('*')
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .lt('expires_at', now)
      .eq('data->>mexasFundsReserved', 'true')
      .range(0, EXPIRED_ORDER_PAGE_SIZE - 1)

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

async function loadOpenReservedMexasOrderRows(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
  } = {}
) {
  const now = new Date().toISOString()
  const rows: Row<'contract_bets'>[] = []

  for (let from = 0; ; from += OPEN_RESERVED_ORDER_PAGE_SIZE) {
    let query = db
      .from('contract_bets')
      .select('*')
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .eq('data->>mexasFundsReserved', 'true')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .range(from, from + OPEN_RESERVED_ORDER_PAGE_SIZE - 1)

    if (options.contractId) query = query.eq('contract_id', options.contractId)
    if (options.userId) query = query.eq('user_id', options.userId)

    const { data, error } = await query
    if (error) throw error

    rows.push(...((data ?? []) as Row<'contract_bets'>[]))
    if ((data ?? []).length < OPEN_RESERVED_ORDER_PAGE_SIZE) break
  }

  return rows
}

async function getUserOnChainMexasAmount(
  userRow: Row<'users'> | undefined,
  requireBalanceRead: boolean
) {
  const walletAddress = getUserData(userRow ?? null).privyWalletAddress
  if (typeof walletAddress !== 'string' || !isAddress(walletAddress)) return 0

  try {
    const units = await getMexasBalanceUnits(walletAddress as Address)
    return {
      amount: mexasUnitsToAmount(units),
      units,
    }
  } catch (error) {
    if (requireBalanceRead) throw error
    console.warn('Failed to read MEXAS backing balance', {
      userId: userRow?.id,
      error,
    })
    return undefined
  }
}

export async function getOpenReservedMexasAmount(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
  } = {}
) {
  const rows = await loadOpenReservedMexasOrderRows(db, options)
  return getTotalMexasRemainingReservedAmount(
    rows.map((row) => convertBet(row) as LimitBet & MexasReservedOrderData)
  )
}

async function cancelUnbackedMexasOrder(
  db: SupabaseClient,
  row: Row<'contract_bets'>
) {
  const bet = convertBet(row) as LimitBet
  const data = getBetData(row)
  const now = Date.now()
  const { data: updatedRow, error } = await db
    .from('contract_bets')
    .update({
      is_cancelled: true,
      data: {
        ...data,
        isCancelled: true,
        mexasFundsReleased: true,
        mexasReleaseReason: 'unbacked-onchain-balance',
        mexasUnbackedCancelled: true,
        mexasUnbackedCancelledAt: now,
      } as any,
    })
    .eq('bet_id', bet.id)
    .eq('is_cancelled', false)
    .eq('is_filled', false)
    .select()
    .maybeSingle()

  if (error) throw error
  return updatedRow ? 1 : 0
}

export async function releaseUnbackedMexasOrders(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
    requireBalanceRead?: boolean
  } = {}
) {
  const rows = await loadOpenReservedMexasOrderRows(db, options)
  if (!rows.length) return 0

  const rowsByUserId = new Map<string, Row<'contract_bets'>[]>()
  for (const row of rows) {
    const userRows = rowsByUserId.get(row.user_id) ?? []
    userRows.push(row)
    rowsByUserId.set(row.user_id, userRows)
  }

  const userIds = [...rowsByUserId.keys()]
  const { data: userRows, error: userError } = await db
    .from('users')
    .select('id,data')
    .in('id', userIds)

  if (userError) throw userError

  const userRowById = new Map(
    ((userRows ?? []) as Row<'users'>[]).map((row) => [row.id, row])
  )
  let released = 0

  for (const [userId, userOrderRows] of rowsByUserId) {
    const onChainAmount = await getUserOnChainMexasAmount(
      userRowById.get(userId),
      options.requireBalanceRead ?? false
    )
    if (onChainAmount === undefined) continue

    const bets = userOrderRows.map(
      (row) => convertBet(row) as LimitBet & MexasReservedOrderData
    )
    const backedAmount =
      typeof onChainAmount === 'number' ? onChainAmount : onChainAmount.amount
    const unbackedIds = new Set(getUnbackedMexasOrderIds(bets, backedAmount))
    if (!unbackedIds.size) continue

    let userReleased = 0
    for (const row of userOrderRows) {
      if (unbackedIds.has(row.bet_id)) {
        const rowReleased = await cancelUnbackedMexasOrder(db, row)
        userReleased += rowReleased
        released += rowReleased
      }
    }
    if (userReleased && typeof onChainAmount !== 'number') {
      await syncAvailableBalanceFromBacking({
        db,
        userId,
        onChainAmount: onChainAmount.amount,
        onChainUnits: onChainAmount.units,
      })
    }
  }

  return released
}
