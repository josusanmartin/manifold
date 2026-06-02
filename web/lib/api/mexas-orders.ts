import { LimitBet } from 'common/bet'
import {
  getMexasRemainingReservedAmount,
  getMexasSyncedAvailableBalance,
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
  acquireMexasUserBalanceLock,
  releaseMexasUserBalanceLock,
  setMexasUserBalanceCas,
  updateMexasUserBalanceCas,
} from './mexas-balance'

const EXPIRED_ORDER_PAGE_SIZE = 1000
const OPEN_RESERVED_ORDER_PAGE_SIZE = 1000
const MEXAS_WALLET_SYNC_UNITS_KEY = 'mexasWalletBalanceUnitsSynced'
const MEXAS_WALLET_SYNC_TIME_KEY = 'mexasWalletBalanceSyncedTime'
const MEXAS_RELEASE_REASON_EXPIRED = 'expired'
const MEXAS_RELEASE_REASON_MARKET_CLOSED = 'market-closed'

type MexasOrderReleaseOptions = {
  skipUserBalanceLock?: boolean
}

const PENDING_RELEASE_PAGE_SIZE = 1000

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
  currentBalance: number
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
    getMexasSyncedAvailableBalance({
      currentBalance: params.currentBalance,
      onChainAmount: params.onChainAmount,
      onChainDeltaAmount: 0,
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

async function releaseOpenMexasOrder(
  db: SupabaseClient,
  row: Row<'contract_bets'>,
  releaseReason: string,
  options: MexasOrderReleaseOptions = {}
) {
  const bet = convertBet(row) as LimitBet & MexasReservedOrderData
  if (bet.limitProb === undefined || bet.orderAmount === undefined) return 0

  const release = async () => {
    const data = getBetData(row)
    const now = Date.now()
    const shouldRefund =
      bet.mexasFundsReserved === true && bet.mexasFundsReleased !== true
    const refundAmount = shouldRefund ? getMexasRemainingReservedAmount(bet) : 0
    const creditKey = getMexasOrderReleaseCreditKey(bet.id)

    const { data: preparedRow, error } = await db
      .from('contract_bets')
      .update({
        is_cancelled: true,
        data: {
          ...data,
          isCancelled: true,
          mexasFundsReleased:
            refundAmount > 0
              ? false
              : shouldRefund
              ? true
              : bet.mexasFundsReleased,
          mexasReleaseCreditKey: refundAmount > 0 ? creditKey : undefined,
          mexasReleaseReason: releaseReason,
          mexasReleasedAt: now,
        } as any,
      })
      .eq('bet_id', bet.id)
      .eq('is_cancelled', false)
      .eq('is_filled', false)
      .eq('updated_time', row.updated_time)
      .select()
      .maybeSingle()

    if (error) throw error
    if (!preparedRow) return 0

    if (refundAmount > 0) {
      await completePreparedMexasOrderRelease(
        db,
        preparedRow as Row<'contract_bets'>,
        {
          skipUserBalanceLock: true,
        }
      )
    }

    return 1
  }

  if (options.skipUserBalanceLock) return await release()

  const balanceLockOwner = await acquireMexasUserBalanceLock(db, bet.userId)
  try {
    return await release()
  } finally {
    await releaseMexasUserBalanceLock(db, bet.userId, balanceLockOwner)
  }
}

async function releaseExpiredMexasOrder(
  db: SupabaseClient,
  row: Row<'contract_bets'>,
  options: MexasOrderReleaseOptions = {}
) {
  return releaseOpenMexasOrder(db, row, MEXAS_RELEASE_REASON_EXPIRED, options)
}

async function completePreparedMexasOrderRelease(
  db: SupabaseClient,
  row: Row<'contract_bets'>,
  options: MexasOrderReleaseOptions = {}
) {
  const complete = async () => {
    const bet = convertBet(row) as LimitBet & MexasReservedOrderData
    const data = getBetData(row)
    const creditKey =
      typeof data.mexasReleaseCreditKey === 'string'
        ? data.mexasReleaseCreditKey
        : getMexasOrderReleaseCreditKey(bet.id)

    const shouldRefund =
      bet.mexasFundsReserved === true && bet.mexasFundsReleased !== true
    const refundAmount = shouldRefund ? getMexasRemainingReservedAmount(bet) : 0
    if (refundAmount > 0) {
      await updateMexasUserBalanceCas(db, bet.userId, refundAmount, {
        creditKey,
      })
    }

    const { data: updatedRow, error } = await db
      .from('contract_bets')
      .update({
        data: {
          ...data,
          isCancelled: true,
          mexasFundsReleased: true,
          mexasReleaseCreditKey: creditKey,
          mexasReleasedAt:
            typeof data.mexasReleasedAt === 'number'
              ? data.mexasReleasedAt
              : Date.now(),
        } as any,
      })
      .eq('bet_id', bet.id)
      .eq('updated_time', row.updated_time)
      .select()
      .maybeSingle()

    if (error) throw error
    return updatedRow ? 1 : 0
  }

  if (options.skipUserBalanceLock) return await complete()

  const bet = convertBet(row) as LimitBet
  const balanceLockOwner = await acquireMexasUserBalanceLock(db, bet.userId)
  try {
    return await complete()
  } finally {
    await releaseMexasUserBalanceLock(db, bet.userId, balanceLockOwner)
  }
}

async function loadPendingMexasReleaseRows(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
  } = {}
) {
  const rows: Row<'contract_bets'>[] = []

  for (let from = 0; ; from += PENDING_RELEASE_PAGE_SIZE) {
    let query = db
      .from('contract_bets')
      .select('*')
      .eq('is_cancelled', true)
      .eq('data->>mexasFundsReserved', 'true')
      .range(from, from + PENDING_RELEASE_PAGE_SIZE - 1)

    if (options.contractId) query = query.eq('contract_id', options.contractId)
    if (options.userId) query = query.eq('user_id', options.userId)

    const { data, error } = await query
    if (error) throw error

    rows.push(
      ...((data ?? []) as Row<'contract_bets'>[]).filter((row) => {
        const data = getBetData(row)
        return (
          data.mexasFundsReleased !== true &&
          typeof data.mexasReleaseCreditKey === 'string'
        )
      })
    )
    if ((data ?? []).length < PENDING_RELEASE_PAGE_SIZE) break
  }

  return rows
}

export async function releasePendingMexasOrderReleases(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
    skipUserBalanceLock?: boolean
  } = {}
) {
  const rows = await loadPendingMexasReleaseRows(db, options)
  let released = 0

  for (const row of rows) {
    released += await completePreparedMexasOrderRelease(db, row, {
      skipUserBalanceLock: options.skipUserBalanceLock,
    })
  }

  return released
}

export async function releaseExpiredMexasOrders(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
    skipUserBalanceLock?: boolean
  } = {}
) {
  const now = new Date().toISOString()
  let released = 0

  released += await releasePendingMexasOrderReleases(db, options)

  for (;;) {
    let query = db
      .from('contract_bets')
      .select('*')
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .lte('expires_at', now)
      .eq('data->>mexasFundsReserved', 'true')
      .range(0, EXPIRED_ORDER_PAGE_SIZE - 1)

    if (options.contractId) query = query.eq('contract_id', options.contractId)
    if (options.userId) query = query.eq('user_id', options.userId)

    const { data, error } = await query
    if (error) throw error

    const rows = (data ?? []) as Row<'contract_bets'>[]
    for (const row of rows) {
      released += await releaseExpiredMexasOrder(db, row, {
        skipUserBalanceLock: options.skipUserBalanceLock,
      })
    }
    if (rows.length < EXPIRED_ORDER_PAGE_SIZE) break
  }

  return released
}

export async function releaseClosedMexasMarketOrders(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
    skipUserBalanceLock?: boolean
  } = {}
) {
  let released = await releasePendingMexasOrderReleases(db, options)
  const openRows = await loadOpenReservedMexasOrderRows(db, options)
  if (!openRows.length) return released

  const contractIds = Array.from(
    new Set(openRows.map((row) => row.contract_id).filter(Boolean))
  )
  if (!contractIds.length) return released

  const now = new Date().toISOString()
  const { data, error } = await db
    .from('contracts')
    .select('id')
    .in('id', contractIds)
    .lte('close_time', now)

  if (error) throw error

  const closedContractIds = new Set((data ?? []).map((row) => row.id))
  if (!closedContractIds.size) return released

  for (const row of openRows) {
    if (closedContractIds.has(row.contract_id)) {
      released += await releaseOpenMexasOrder(
        db,
        row,
        MEXAS_RELEASE_REASON_MARKET_CLOSED,
        {
          skipUserBalanceLock: options.skipUserBalanceLock,
        }
      )
    }
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
    .eq('updated_time', row.updated_time)
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
    skipUserBalanceLock?: boolean
  } = {}
) {
  let released = await releasePendingMexasOrderReleases(db, options)
  const rows = await loadOpenReservedMexasOrderRows(db, options)
  if (!rows.length) return released

  const rowsByUserId = new Map<string, Row<'contract_bets'>[]>()
  for (const row of rows) {
    const userRows = rowsByUserId.get(row.user_id) ?? []
    userRows.push(row)
    rowsByUserId.set(row.user_id, userRows)
  }

  const userIds = [...rowsByUserId.keys()]
  const { data: userRows, error: userError } = await db
    .from('users')
    .select('id,balance,data')
    .in('id', userIds)

  if (userError) throw userError

  const userRowById = new Map(
    ((userRows ?? []) as Row<'users'>[]).map((row) => [row.id, row])
  )
  for (const [userId, userOrderRows] of rowsByUserId) {
    const releaseUserOrders = async () => {
      const onChainAmount = await getUserOnChainMexasAmount(
        userRowById.get(userId),
        options.requireBalanceRead ?? false
      )
      if (onChainAmount === undefined) return

      const bets = userOrderRows.map(
        (row) => convertBet(row) as LimitBet & MexasReservedOrderData
      )
      const backedAmount =
        typeof onChainAmount === 'number' ? onChainAmount : onChainAmount.amount
      const unbackedIds = new Set(getUnbackedMexasOrderIds(bets, backedAmount))
      if (!unbackedIds.size) return

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
          currentBalance: userRowById.get(userId)?.balance ?? 0,
          userId,
          onChainAmount: onChainAmount.amount,
          onChainUnits: onChainAmount.units,
        })
      }
    }

    if (options.skipUserBalanceLock) {
      await releaseUserOrders()
    } else {
      const balanceLockOwner = await acquireMexasUserBalanceLock(db, userId)
      try {
        await releaseUserOrders()
      } finally {
        await releaseMexasUserBalanceLock(db, userId, balanceLockOwner)
      }
    }
  }

  return released
}
