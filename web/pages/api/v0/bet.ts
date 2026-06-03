import { PrivyClient } from '@privy-io/node'
import { API } from 'common/api/schema'
import { APIError } from 'common/api/utils'
import { getNewBetId, LimitBet, type Bet } from 'common/bet'
import { MarketContract } from 'common/contract'
import {
  getMexasRemainingReservedAmount,
  getMexasSyncedAvailableBalance,
  isMexasOrderBookOnlyContract,
} from 'common/mexas-market'
import {
  getMexasOpenOrderAmount,
  getMexasLimitOrderExpiresAt,
  hasValidMexasLimitOrderExpiration,
  isMexasCrossingOrder,
  matchMexasLimitOrder,
  sortMexasMakersForTaker,
  type MexasOutcome,
} from 'common/mexas-order-book'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import {
  createClient,
  millisToTs,
  type Row,
  type SupabaseClient,
  type Tables,
} from 'common/supabase/utils'
import { removeUndefinedProps } from 'common/util/object'
import type { NextApiRequest, NextApiResponse } from 'next'
import { isAddress, type Address } from 'viem'
import {
  acquireMexasUserBalanceLock,
  releaseMexasUserBalanceLock,
  updateMexasUserBalanceCas,
} from 'web/lib/api/mexas-balance'
import {
  releaseClosedMexasMarketOrders,
  releaseExpiredMexasOrders,
  releaseUnbackedMexasOrders,
  getOpenReservedMexasAmount,
} from 'web/lib/api/mexas-orders'
import {
  assertMexasCanAcceptLimitOrders,
  assertMexasCanMatchCrossingOrders,
} from 'web/lib/api/mexas-settlement'
import { matchMexasOrderbookLimitOrderRpc } from 'web/lib/api/mexas-rpc-matching'
import { formatMexasUnits, getMexasBalanceUnits } from 'web/lib/crypto/mexas'
import { z } from 'zod'

type ErrorResponse = { message: string; details?: unknown }

const MEXAS_WALLET_SYNC_UNITS_KEY = 'mexasWalletBalanceUnitsSynced'
const MEXAS_WALLET_SYNC_TIME_KEY = 'mexasWalletBalanceSyncedTime'
const MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY = 'mexasWalletOpenReservedAmount'
const BALANCE_UPDATE_ATTEMPTS = 5
const ORDER_PAGE_SIZE = 1000
const ORDER_LOCK_ATTEMPTS = 20
const ORDER_LOCK_RETRY_MS = 100
const ORDER_LOCK_TIMEOUT_MS = 2 * 60 * 1000
const RESOLUTION_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const EPSILON = 1e-9

let privyClient: PrivyClient | undefined

function getPrivyClient() {
  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) {
    throw new APIError(500, 'Privy server credentials are not configured.')
  }

  privyClient ??= new PrivyClient({ appId, appSecret })
  return privyClient
}

function getSupabaseAdminClient() {
  const key =
    process.env.PROD_ADMIN_SUPABASE_KEY ||
    process.env.DEV_ADMIN_SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  const urlOrInstanceId =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_INSTANCE_ID ||
    process.env.NEXT_PUBLIC_SUPABASE_INSTANCE_ID

  if (!key || !urlOrInstanceId) {
    throw new APIError(500, 'Supabase admin credentials are not configured.')
  }

  return createClient(urlOrInstanceId, key)
}

function getBearerToken(req: NextApiRequest) {
  const header = req.headers.authorization
  if (!header) return undefined

  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return undefined
  return token
}

async function getPrivyUserId(req: NextApiRequest) {
  const token = getBearerToken(req)
  if (!token) throw new APIError(401, 'Missing Privy token.')

  const verified = await getPrivyClient()
    .utils()
    .auth()
    .verifyAccessToken(token)
  return verified.user_id
}

function getUserData(row: Row<'users'> | null) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

function getContractData(row: Row<'contracts'> | null) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

function hasFreshMexasOrderLock(data: Record<string, unknown>) {
  const locked = data.mexasOrderLock === true
  const since =
    typeof data.mexasOrderLockSince === 'number' ? data.mexasOrderLockSince : 0

  return locked && Date.now() - since < ORDER_LOCK_TIMEOUT_MS
}

function hasFreshMexasResolutionLock(data: Record<string, unknown>) {
  const locked = data.mexasResolving === true
  const since =
    typeof data.mexasResolvingSince === 'number' ? data.mexasResolvingSince : 0

  return locked && Date.now() - since < RESOLUTION_LOCK_TIMEOUT_MS
}

function getMexasOrderLockPredicates(data: Record<string, unknown>) {
  if (data.mexasOrderLock === true) {
    const owner = data.mexasOrderLockOwner
    if (typeof owner === 'string') {
      return [`data->>mexasOrderLockOwner.eq.${owner}`]
    }

    const since = data.mexasOrderLockSince
    if (typeof since === 'number') {
      return [`data->>mexasOrderLockSince.eq.${since}`]
    }
  }

  return ['data->>mexasOrderLock.is.null', 'data->>mexasOrderLock.eq.false']
}

function getNoMexasResolutionLockPredicates() {
  return ['data->>mexasResolving.is.null', 'data->>mexasResolving.eq.false']
}

function combinePostgrestAndPredicates(predicateGroups: string[][]) {
  return predicateGroups
    .reduce<string[]>(
      (combinations, group) => {
        return combinations.flatMap((combination) =>
          group.map((predicate) =>
            combination ? `${combination},${predicate}` : predicate
          )
        )
      },
      ['']
    )
    .map((predicate) => `and(${predicate})`)
    .join(',')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseSyncedMexasUnits(data: Record<string, unknown>) {
  const raw = data[MEXAS_WALLET_SYNC_UNITS_KEY]
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw)
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
    return BigInt(raw)
  }
  return 0n
}

function mexasUnitsToAmount(units: bigint) {
  return Number(formatMexasUnits(units))
}

function mexasUnitsDeltaToAmount(deltaUnits: bigint) {
  if (deltaUnits === 0n) return 0
  const sign = deltaUnits < 0n ? -1 : 1
  const absUnits = deltaUnits < 0n ? -deltaUnits : deltaUnits
  return sign * mexasUnitsToAmount(absUnits)
}

async function syncMexasWalletBalance(
  db: SupabaseClient,
  userRow: Row<'users'>
) {
  const { data: freshUserRow, error: freshUserError } = await db
    .from('users')
    .select('*')
    .eq('id', userRow.id)
    .single()

  if (freshUserError) throw freshUserError
  if (!freshUserRow) throw new APIError(404, 'User not found.')

  const data = getUserData(freshUserRow) as Record<string, unknown>
  const walletAddress =
    typeof data.privyWalletAddress === 'string'
      ? data.privyWalletAddress
      : undefined

  if (!walletAddress || !isAddress(walletAddress)) {
    return freshUserRow as Row<'users'>
  }

  const currentUnits = await getMexasBalanceUnits(walletAddress as Address)
  let latestUserRow = freshUserRow as Row<'users'>

  for (let attempt = 0; attempt < BALANCE_UPDATE_ATTEMPTS; attempt++) {
    const latestData = getUserData(latestUserRow) as Record<string, unknown>
    const previousUnits = parseSyncedMexasUnits(latestData)
    const deltaAmount = mexasUnitsDeltaToAmount(currentUnits - previousUnits)
    const onChainAmount = mexasUnitsToAmount(currentUnits)
    const openReservedAmount = await getOpenReservedMexasAmount(db, {
      userId: latestUserRow.id,
    })
    const balance = getMexasSyncedAvailableBalance({
      currentBalance: latestUserRow.balance,
      onChainAmount,
      onChainDeltaAmount: deltaAmount,
      openReservedAmount,
    })
    const totalDeposits =
      deltaAmount > 0
        ? latestUserRow.total_deposits + deltaAmount
        : latestUserRow.total_deposits
    const syncedData = {
      ...latestData,
      [MEXAS_WALLET_SYNC_UNITS_KEY]: currentUnits.toString(),
      [MEXAS_WALLET_SYNC_TIME_KEY]: Date.now(),
      [MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]: openReservedAmount,
    }

    const { data: updatedUserRow, error } = await db
      .from('users')
      .update({
        balance,
        total_deposits: totalDeposits,
        data: syncedData as any,
      })
      .eq('id', latestUserRow.id)
      .eq('balance', latestUserRow.balance)
      .filter('data', 'eq', JSON.stringify(latestUserRow.data))
      .select()
      .maybeSingle()

    if (error) throw error
    if (updatedUserRow) return updatedUserRow

    const { data: refetchedUserRow, error: refetchError } = await db
      .from('users')
      .select('*')
      .eq('id', latestUserRow.id)
      .single()

    if (refetchError) throw refetchError
    if (!refetchedUserRow) throw new APIError(404, 'User not found.')
    latestUserRow = refetchedUserRow
  }

  throw new APIError(503, 'Balance changed. Please try again.')
}

function betToRow(bet: Bet): Tables['contract_bets']['Insert'] {
  return removeUndefinedProps({
    bet_id: bet.id,
    contract_id: bet.contractId,
    user_id: bet.userId,
    created_time: millisToTs(bet.createdTime),
    expires_at: bet.expiresAt ? millisToTs(bet.expiresAt) : null,
    amount: bet.amount,
    answer_id: bet.answerId ?? null,
    is_api: bet.isApi ?? false,
    is_cancelled: bet.isCancelled ?? null,
    is_filled: bet.isFilled ?? null,
    is_redemption: bet.isRedemption,
    loan_amount: bet.loanAmount ?? 0,
    outcome: bet.outcome,
    prob_after: bet.probAfter,
    prob_before: bet.probBefore,
    shares: bet.shares,
    data: bet as any,
  })
}

function createMexasOpenLimitBet(
  contract: MarketContract & { prob: number },
  params: {
    amount: number
    contractId: string
    expiresAt?: number
    expiresMillisAfter?: number
    limitProb?: number
    outcome: 'YES' | 'NO'
    silent?: boolean
  },
  userId: string
) {
  if (params.limitProb === undefined) {
    throw new APIError(400, 'Los mercados MEXAS solo aceptan órdenes límite.')
  }

  const now = Date.now()
  const expiresAt = getMexasLimitOrderExpiresAt(now, params)
  if (!hasValidMexasLimitOrderExpiration(now, expiresAt)) {
    throw new APIError(
      400,
      'La expiración de la orden debe estar en el futuro.'
    )
  }

  return removeUndefinedProps({
    id: getNewBetId(),
    userId,
    contractId: params.contractId,
    createdTime: now,
    amount: 0,
    loanAmount: 0,
    outcome: params.outcome,
    shares: 0,
    probBefore: contract.prob,
    probAfter: contract.prob,
    fees: {
      creatorFee: 0,
      platformFee: 0,
      liquidityFee: 0,
    },
    isApi: false,
    isRedemption: false,
    orderAmount: params.amount,
    limitProb: params.limitProb,
    isFilled: false,
    isCancelled: false,
    fills: [],
    mexasFundsReserved: true,
    mexasFundsReleased: false,
    mexasReservedAmount: params.amount,
    expiresAt,
    silent: params.silent,
  }) as LimitBet
}

async function refundMexasReservation(
  db: SupabaseClient,
  userId: string,
  amount: number,
  creditKey: string
) {
  if (amount <= 0) return

  await updateMexasUserBalanceCas(db, userId, amount, {
    creditKey,
    dataPatch: await getOpenReservedMexasDataPatch(db, userId),
  })
}

async function getOpenReservedMexasDataPatch(
  db: SupabaseClient,
  userId: string
) {
  return {
    [MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]: await getOpenReservedMexasAmount(
      db,
      { userId }
    ),
  }
}

async function refreshMexasOpenReservedAmount(
  db: SupabaseClient,
  userId: string
) {
  await updateUserBalanceCas(
    db,
    userId,
    0,
    await getOpenReservedMexasDataPatch(db, userId)
  )
}

async function cancelInsertedMexasOrderAndRefund(
  db: SupabaseClient,
  bet: LimitBet,
  userId: string,
  reservedAmount: number
) {
  if (reservedAmount <= 0) return

  const { data: currentRow, error: readError } = await db
    .from('contract_bets')
    .select('*')
    .eq('bet_id', bet.id)
    .eq('user_id', userId)
    .maybeSingle()

  if (readError) throw readError
  if (!currentRow) return

  const currentBet = convertBet(currentRow as Row<'contract_bets'>) as LimitBet
  const refundAmount = getMexasRemainingReservedAmount(currentBet)
  if (refundAmount <= 0) return

  const currentData =
    currentRow.data &&
    typeof currentRow.data === 'object' &&
    !Array.isArray(currentRow.data)
      ? currentRow.data
      : currentBet
  const now = Date.now()
  const { data: cancelledRow, error } = await db
    .from('contract_bets')
    .update({
      is_cancelled: true,
      data: {
        ...currentData,
        isCancelled: true,
        mexasFundsReleased: true,
        mexasReleaseCreditKey: `mexas-placement-refund:${bet.id}`,
        mexasReleaseReason: 'placement-error',
        mexasReleasedAt: now,
      } as any,
    })
    .eq('bet_id', bet.id)
    .eq('user_id', userId)
    .eq('is_cancelled', false)
    .eq('is_filled', false)
    .eq('updated_time', currentRow.updated_time)
    .select()
    .maybeSingle()

  if (error) throw error
  if (!cancelledRow) return

  await refundMexasReservation(
    db,
    userId,
    refundAmount,
    `mexas-placement-refund:${bet.id}`
  )
}

async function updateUserBalanceCas(
  db: SupabaseClient,
  userId: string,
  delta: number,
  dataPatch?: Record<string, unknown>
) {
  for (let attempt = 0; attempt < BALANCE_UPDATE_ATTEMPTS; attempt++) {
    const { data: userRow, error: readError } = await db
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (readError) throw readError
    if (!userRow) throw new APIError(404, 'User not found.')

    const nextBalance = userRow.balance + delta
    if (nextBalance < -EPSILON) {
      throw new APIError(403, 'Insufficient balance.')
    }

    const { data: updatedUserRow, error: updateError } = await db
      .from('users')
      .update({
        balance: Math.max(0, nextBalance),
        data: (dataPatch
          ? {
              ...getUserData(userRow),
              ...dataPatch,
            }
          : getUserData(userRow)) as any,
      })
      .eq('id', userId)
      .eq('balance', userRow.balance)
      .filter('data', 'eq', JSON.stringify(userRow.data))
      .select()
      .maybeSingle()

    if (updateError) throw updateError
    if (updatedUserRow) return updatedUserRow
  }

  throw new APIError(503, 'Balance changed. Please try again.')
}

async function acquireMexasOrderLock(db: SupabaseClient, contractId: string) {
  const lockOwner = getNewBetId()

  for (let attempt = 0; attempt < ORDER_LOCK_ATTEMPTS; attempt++) {
    const { data: contractRow, error: readError } = await db
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .single()

    if (readError) throw readError
    if (!contractRow) throw new APIError(404, 'Contract not found.')

    const typedContractRow = contractRow as Row<'contracts'>
    const contract = convertContract(typedContractRow) as MarketContract
    const contractData = getContractData(typedContractRow)

    if (contract.closeTime && Date.now() >= contract.closeTime) {
      throw new APIError(403, 'Trading is closed.')
    }
    if (contract.isResolved) throw new APIError(403, 'Market is resolved.')
    if (hasFreshMexasResolutionLock(contractData)) {
      throw new APIError(503, 'Market resolution is in progress.')
    }
    if (hasFreshMexasOrderLock(contractData)) {
      await sleep(ORDER_LOCK_RETRY_MS)
      continue
    }

    const now = Date.now()
    let query = db
      .from('contracts')
      .update({
        data: {
          ...contractData,
          mexasOrderLock: true,
          mexasOrderLockOwner: lockOwner,
          mexasOrderLockSince: now,
          lastUpdatedTime: now,
        } as any,
        last_updated_time: millisToTs(now),
      })
      .eq('id', contractId)
      .or(
        combinePostgrestAndPredicates([
          getMexasOrderLockPredicates(contractData),
          getNoMexasResolutionLockPredicates(),
        ])
      )

    query = typedContractRow.last_updated_time
      ? query.eq('last_updated_time', typedContractRow.last_updated_time)
      : query.is('last_updated_time', null)

    const { data: lockedRow, error: updateError } = await query
      .select()
      .maybeSingle()

    if (updateError) throw updateError
    if (lockedRow) {
      return {
        contract: convertContract(
          lockedRow as Row<'contracts'>
        ) as MarketContract,
        contractRow: lockedRow as Row<'contracts'>,
        lockOwner,
      }
    }

    await sleep(ORDER_LOCK_RETRY_MS)
  }

  throw new APIError(503, 'Order book is busy. Please try again.')
}

async function releaseMexasOrderLock(
  db: SupabaseClient,
  contractId: string,
  lockOwner: string
) {
  const { data: contractRow, error: readError } = await db
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single()

  if (readError || !contractRow) return

  const data = getContractData(contractRow as Row<'contracts'>)
  if (data.mexasOrderLockOwner !== lockOwner) return

  const now = Date.now()
  await db
    .from('contracts')
    .update({
      data: {
        ...data,
        mexasOrderLock: false,
        mexasOrderLockOwner: null,
        mexasOrderLockSince: null,
        lastUpdatedTime: now,
      } as any,
      last_updated_time: millisToTs(now),
    })
    .eq('id', contractId)
    .eq('data->>mexasOrderLockOwner', lockOwner)
}

type LimitBetRow = {
  bet: LimitBet
  row: Row<'contract_bets'>
}

async function loadMexasCrossingOrderRows(
  db: SupabaseClient,
  contractId: string,
  outcome: MexasOutcome,
  limitProb: number,
  takerUserId: string
) {
  const data: Row<'contract_bets'>[] = []
  const now = new Date().toISOString()

  for (let from = 0; ; from += ORDER_PAGE_SIZE) {
    const { data: page, error } = await db
      .from('contract_bets')
      .select('*')
      .eq('contract_id', contractId)
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .eq('data->>mexasFundsReserved', 'true')
      .eq('data->>mexasFundsReleased', 'false')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .range(from, from + ORDER_PAGE_SIZE - 1)

    if (error) throw error
    data.push(...((page ?? []) as Row<'contract_bets'>[]))
    if ((page ?? []).length < ORDER_PAGE_SIZE) break
  }

  const rows = data
    .map((row) => ({
      row: row as Row<'contract_bets'>,
      bet: convertBet(row as Row<'contract_bets'>),
    }))
    .filter((entry): entry is LimitBetRow => {
      const bet = entry.bet
      return (
        !bet.answerId &&
        bet.userId !== takerUserId &&
        bet.limitProb !== undefined &&
        bet.orderAmount !== undefined &&
        !bet.isFilled &&
        !bet.isCancelled &&
        getMexasOpenOrderAmount(bet as LimitBet) > EPSILON &&
        isMexasCrossingOrder(outcome, limitProb, bet as LimitBet)
      )
    })

  const sorted = sortMexasMakersForTaker(
    outcome,
    rows.map((entry) => entry.bet)
  )

  return sorted
    .map((bet) => rows.find((entry) => entry.bet.id === bet.id))
    .filter((entry): entry is LimitBetRow => entry !== undefined)
}

async function updateMexasContractAfterOrder(
  db: SupabaseClient,
  contractRow: Row<'contracts'>,
  contract: MarketContract,
  bet: LimitBet
) {
  const now = Date.now()
  const data = getContractData(contractRow)
  const volume = contract.volume + Math.abs(bet.amount)
  const update = {
    data: {
      ...data,
      volume,
      lastBetTime: bet.amount > 0 ? now : contract.lastBetTime,
      lastUpdatedTime: now,
    },
    last_bet_time: bet.amount > 0 ? millisToTs(now) : contractRow.last_bet_time,
    last_updated_time: millisToTs(now),
  }

  const { error } = await db
    .from('contracts')
    .update(update)
    .eq('id', contract.id)
  if (error) {
    console.warn('Failed to update MEXAS contract after order', error)
  }
}

async function placeBinaryBet(
  req: NextApiRequest,
  res: NextApiResponse<any | ErrorResponse>
) {
  const userId = await getPrivyUserId(req)
  const params = API.bet.props.parse(req.body)
  const db = getSupabaseAdminClient()

  const [
    { data: userRow, error: userError },
    { data: contractRow, error: contractError },
  ] = await Promise.all([
    db.from('users').select('*').eq('id', userId).single(),
    db.from('contracts').select('*').eq('id', params.contractId).single(),
  ])

  if (userError) throw userError
  if (contractError) throw contractError
  if (!userRow) throw new APIError(404, 'User not found.')
  if (!contractRow) throw new APIError(404, 'Contract not found.')

  const contract = convertContract(contractRow) as MarketContract
  if (contract.mechanism !== 'cpmm-1' || contract.outcomeType !== 'BINARY') {
    throw new APIError(
      400,
      'This MEXAS bet route supports binary CPMM markets.'
    )
  }
  if (!isMexasOrderBookOnlyContract(contract)) {
    throw new APIError(404, 'Market is not available on MEXAS.')
  }
  if (contract.closeTime && Date.now() >= contract.closeTime) {
    throw new APIError(403, 'Trading is closed.')
  }
  if (contract.isResolved) throw new APIError(403, 'Market is resolved.')
  if (params.limitProb === undefined) {
    throw new APIError(400, 'Los mercados MEXAS solo aceptan órdenes límite.')
  }

  {
    const balanceLockOwner = await acquireMexasUserBalanceLock(db, userId)
    try {
      await releaseClosedMexasMarketOrders(db, {
        userId,
        skipUserBalanceLock: true,
      })
      await releaseExpiredMexasOrders(db, {
        userId,
        skipUserBalanceLock: true,
      })
      await releaseUnbackedMexasOrders(db, {
        userId,
        requireBalanceRead: true,
        skipUserBalanceLock: true,
      })
      const syncedUserRow = await syncMexasWalletBalance(db, userRow)
      if (syncedUserRow.balance < params.amount) {
        throw new APIError(403, 'Insufficient balance.')
      }

      const lock = await acquireMexasOrderLock(db, params.contractId)
      let bet: (LimitBet & { outcome: MexasOutcome }) | undefined
      let reservedAmount = 0
      let debited = false
      let inserted = false

      try {
        const lockedContract = lock.contract
        await releaseClosedMexasMarketOrders(db, {
          userId,
          skipUserBalanceLock: true,
        })
        await releaseExpiredMexasOrders(db, {
          userId,
          skipUserBalanceLock: true,
        })
        await releaseUnbackedMexasOrders(db, {
          userId,
          requireBalanceRead: true,
          skipUserBalanceLock: true,
        })
        const latestSyncedUserRow = await syncMexasWalletBalance(
          db,
          syncedUserRow as Row<'users'>
        )
        if (
          lockedContract.closeTime &&
          Date.now() >= lockedContract.closeTime
        ) {
          throw new APIError(403, 'Trading is closed.')
        }
        if (lockedContract.isResolved) {
          throw new APIError(403, 'Market is resolved.')
        }
        if (latestSyncedUserRow.balance < params.amount) {
          throw new APIError(403, 'Insufficient balance.')
        }
        bet = createMexasOpenLimitBet(
          lockedContract as MarketContract & { prob: number },
          params,
          userId
        ) as LimitBet & { outcome: MexasOutcome }

        const crossingOrderRows = await loadMexasCrossingOrderRows(
          db,
          params.contractId,
          bet.outcome,
          bet.limitProb,
          userId
        )
        const hasCrossingOrders = crossingOrderRows.length > 0
        await assertMexasCanMatchCrossingOrders(db, hasCrossingOrders)

        if (params.dryRun) {
          const simulated = matchMexasLimitOrder({
            amount: bet.orderAmount,
            limitProb: bet.limitProb,
            makers: crossingOrderRows.map((entry) => entry.bet),
            outcome: bet.outcome,
            takerBetId: 'dry-run',
            takerUserId: userId,
            timestamp: Date.now(),
          })
          return res.status(200).json({
            ...bet,
            amount: simulated.takerAmount,
            shares: simulated.takerShares,
            fills: simulated.takerFills,
            isFilled: simulated.remainingAmount <= EPSILON,
            betId: 'dry-run',
          })
        }

        await assertMexasCanAcceptLimitOrders(db)
        reservedAmount = getMexasRemainingReservedAmount(bet)
        await updateUserBalanceCas(db, userId, -reservedAmount, {
          lastBetTime: bet.createdTime,
        })
        debited = true

        const { error: betError } = await db
          .from('contract_bets')
          .insert(betToRow(bet))
        if (betError) throw betError
        inserted = true
        if (!hasCrossingOrders) {
          await refreshMexasOpenReservedAmount(db, userId)
        }

        const matchedBet = hasCrossingOrders
          ? await matchMexasOrderbookLimitOrderRpc(db, bet.id)
          : bet
        await updateMexasContractAfterOrder(
          db,
          lock.contractRow,
          lockedContract,
          matchedBet
        )

        return res.status(200).json({
          ...matchedBet,
          betId: matchedBet.id,
        } as LimitBet)
      } catch (error) {
        if (debited && !inserted && bet) {
          await refundMexasReservation(
            db,
            userId,
            reservedAmount,
            `mexas-insert-refund:${bet.id}`
          )
        }
        if (debited && inserted && bet) {
          await cancelInsertedMexasOrderAndRefund(
            db,
            bet,
            userId,
            reservedAmount
          )
        }
        throw error
      } finally {
        await releaseMexasOrderLock(db, params.contractId, lock.lockOwner)
      }
    } finally {
      await releaseMexasUserBalanceLock(db, userId, balanceLockOwner)
    }
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any | ErrorResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    return await placeBinaryBet(req, res)
  } catch (error) {
    console.error('MEXAS bet failed', error)

    if (error instanceof APIError) {
      return res.status(error.code).json({ message: error.message })
    }
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ message: 'Invalid bet request.', details: error.flatten() })
    }

    const message =
      error instanceof Error ? error.message : 'Could not place bet.'
    return res.status(500).json({ message })
  }
}
