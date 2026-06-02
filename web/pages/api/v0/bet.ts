import { PrivyClient } from '@privy-io/node'
import { API } from 'common/api/schema'
import { APIError } from 'common/api/utils'
import { getNewBetId, LimitBet, type Bet } from 'common/bet'
import { getCpmmProbability } from 'common/calculate-cpmm'
import { MarketContract } from 'common/contract'
import {
  getMexasRemainingReservedAmount,
  isMexasOrderBookOnlyContract,
} from 'common/mexas-market'
import { getBinaryCpmmBetInfo } from 'common/new-bet'
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
import { formatMexasUnits, getMexasBalanceUnits } from 'web/lib/crypto/mexas'
import { z } from 'zod'

type ErrorResponse = { message: string; details?: unknown }

const MEXAS_WALLET_SYNC_UNITS_KEY = 'mexasWalletBalanceUnitsSynced'
const MEXAS_WALLET_SYNC_TIME_KEY = 'mexasWalletBalanceSyncedTime'

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

  const verified = await getPrivyClient().utils().auth().verifyAccessToken(token)
  return verified.user_id
}

function getUserData(row: Row<'users'> | null) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
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
  const data = getUserData(userRow) as Record<string, unknown>
  const walletAddress =
    typeof data.privyWalletAddress === 'string'
      ? data.privyWalletAddress
      : undefined

  if (!walletAddress || !isAddress(walletAddress)) return userRow

  const currentUnits = await getMexasBalanceUnits(walletAddress as Address)
  const previousUnits = parseSyncedMexasUnits(data)
  const deltaAmount = mexasUnitsDeltaToAmount(currentUnits - previousUnits)
  const balance = Math.max(0, userRow.balance + deltaAmount)
  const totalDeposits =
    deltaAmount > 0
      ? userRow.total_deposits + deltaAmount
      : userRow.total_deposits
  const syncedData = {
    ...data,
    [MEXAS_WALLET_SYNC_UNITS_KEY]: currentUnits.toString(),
    [MEXAS_WALLET_SYNC_TIME_KEY]: Date.now(),
  }

  const { data: updatedUserRow, error } = await db
    .from('users')
    .update({
      balance,
      total_deposits: totalDeposits,
      data: syncedData,
    })
    .eq('id', userRow.id)
    .select()
    .single()

  if (error) throw error
  return updatedUserRow ?? userRow
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

function getLimitOrderExpiresAt(params: {
  expiresAt?: number
  expiresMillisAfter?: number
}) {
  if (params.expiresAt) return params.expiresAt
  if (params.expiresMillisAfter) return Date.now() + params.expiresMillisAfter
  return undefined
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
    throw new APIError(
      400,
      'Los mercados MEXAS solo aceptan órdenes límite.'
    )
  }

  const now = Date.now()
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
    expiresAt: getLimitOrderExpiresAt(params),
    silent: params.silent,
  }) as LimitBet
}

async function refundMexasReservation(
  db: SupabaseClient,
  userId: string,
  amount: number
) {
  if (amount <= 0) return

  const { data: userRow, error: readError } = await db
    .from('users')
    .select('id,balance')
    .eq('id', userId)
    .single()

  if (readError) throw readError

  const { error: updateError } = await db
    .from('users')
    .update({ balance: userRow.balance + amount })
    .eq('id', userId)

  if (updateError) throw updateError
}

function getContractUpdate(
  contract: MarketContract & { pool: { [outcome: string]: number }; p: number },
  contractRow: Row<'contracts'>,
  bet: Bet,
  newPool: { [outcome: string]: number } | undefined,
  newP: number | undefined,
  isUniqueBettor: boolean
) {
  const now = bet.createdTime
  const data =
    contractRow.data &&
    typeof contractRow.data === 'object' &&
    !Array.isArray(contractRow.data)
      ? contractRow.data
      : {}
  const prob =
    newPool && newP ? getCpmmProbability(newPool, newP) : bet.probAfter

  return {
    data: {
      ...data,
      pool: newPool ?? contract.pool,
      p: newP ?? contract.p,
      prob,
      volume: contract.volume + Math.abs(bet.amount),
      lastBetTime: now,
      lastUpdatedTime: now,
      uniqueBettorCount:
        contract.uniqueBettorCount + (isUniqueBettor ? 1 : 0),
    },
    last_bet_time: millisToTs(now),
    last_updated_time: millisToTs(now),
    unique_bettor_count:
      contract.uniqueBettorCount + (isUniqueBettor ? 1 : 0),
  }
}

async function loadUnfilledLimitBets(
  db: SupabaseClient,
  contractId: string,
  outcome: 'YES' | 'NO'
) {
  const { data, error } = await db
    .from('contract_bets')
    .select('*')
    .eq('contract_id', contractId)
    .eq('is_filled', false)
    .eq('is_cancelled', false)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

  if (error) throw error

  return (data ?? [])
    .map((row) => convertBet(row as Row<'contract_bets'>))
    .filter((bet): bet is LimitBet => {
      return !bet.answerId && bet.outcome !== outcome && bet.limitProb != null
    })
}

async function getBalanceByUserId(db: SupabaseClient, bets: LimitBet[]) {
  const userIds = Array.from(new Set(bets.map((bet) => bet.userId)))
  if (!userIds.length) return {}

  const { data, error } = await db
    .from('users')
    .select('id,balance')
    .in('id', userIds)

  if (error) throw error
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.balance]))
}

async function hasExistingBet(
  db: SupabaseClient,
  contractId: string,
  userId: string
) {
  const { count, error } = await db
    .from('contract_bets')
    .select('bet_id', { count: 'exact', head: true })
    .eq('contract_id', contractId)
    .eq('user_id', userId)

  if (error) throw error
  return (count ?? 0) > 0
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
    throw new APIError(400, 'This MEXAS bet route supports binary CPMM markets.')
  }
  if (contract.closeTime && Date.now() > contract.closeTime) {
    throw new APIError(403, 'Trading is closed.')
  }
  if (contract.isResolved) throw new APIError(403, 'Market is resolved.')
  if (
    isMexasOrderBookOnlyContract(contract) &&
    params.limitProb === undefined
  ) {
    throw new APIError(
      400,
      'Los mercados MEXAS solo aceptan órdenes límite.'
    )
  }
  const syncedUserRow = await syncMexasWalletBalance(db, userRow)
  if (syncedUserRow.balance < params.amount) {
    throw new APIError(403, 'Insufficient balance.')
  }

  if (isMexasOrderBookOnlyContract(contract)) {
    const bet = createMexasOpenLimitBet(
      contract as MarketContract & { prob: number },
      params,
      userId
    )

    if (params.dryRun) {
      return res.status(200).json({ ...bet, betId: 'dry-run' })
    }

    const contractData =
      contractRow.data &&
      typeof contractRow.data === 'object' &&
      !Array.isArray(contractRow.data)
        ? contractRow.data
        : {}

    const reservedAmount = getMexasRemainingReservedAmount(bet)
    const { error: userUpdateError } = await db
      .from('users')
      .update({
        balance: syncedUserRow.balance - reservedAmount,
        data: {
          ...getUserData(syncedUserRow),
          lastBetTime: bet.createdTime,
        },
      })
      .eq('id', userId)

    if (userUpdateError) throw userUpdateError

    try {
      const { error: contractUpdateError } = await db
        .from('contracts')
        .update({
          data: {
            ...contractData,
            lastUpdatedTime: bet.createdTime,
          },
          last_updated_time: millisToTs(bet.createdTime),
        })
        .eq('id', contract.id)

      if (contractUpdateError) throw contractUpdateError

      const { error: betError } = await db
        .from('contract_bets')
        .insert(betToRow(bet))
      if (betError) throw betError
    } catch (error) {
      await refundMexasReservation(db, userId, reservedAmount)
      throw error
    }

    return res.status(200).json({ ...bet, betId: bet.id } as LimitBet)
  }

  const unfilledBets = await loadUnfilledLimitBets(
    db,
    params.contractId,
    params.outcome
  )
  const balanceByUserId = await getBalanceByUserId(db, unfilledBets)
  const betInfo = getBinaryCpmmBetInfo(
    contract,
    params.outcome,
    params.amount,
    params.limitProb,
    unfilledBets,
    balanceByUserId,
    params.expiresAt,
    params.expiresMillisAfter
  )

  if (betInfo.makers?.length) {
    throw new APIError(
      503,
      'Matching existing limit orders is not available on this MEXAS route yet.'
    )
  }
  if (betInfo.ordersToCancel?.length) {
    throw new APIError(
      503,
      'Cancelling filled limit orders is not available on this MEXAS route yet.'
    )
  }
  if (params.dryRun) {
    return res.status(200).json({ ...betInfo.newBet, betId: 'dry-run' })
  }
  if (syncedUserRow.balance < betInfo.newBet.amount) {
    throw new APIError(403, 'Insufficient balance.')
  }

  const bet = removeUndefinedProps({
    id: getNewBetId(),
    userId,
    isApi: false,
    silent: params.silent,
    ...betInfo.newBet,
  }) as Bet
  const balance = syncedUserRow.balance - bet.amount
  const isUniqueBettor = !(await hasExistingBet(db, params.contractId, userId))
  const contractUpdate = getContractUpdate(
    contract,
    contractRow,
    bet,
    betInfo.newPool,
    betInfo.newP,
    isUniqueBettor
  )

  const [
    { error: balanceError },
    { error: betError },
    { error: contractUpdateError },
  ] = await Promise.all([
    db
      .from('users')
      .update({
        balance,
        data: {
          ...getUserData(syncedUserRow),
          lastBetTime: bet.createdTime,
        },
      })
      .eq('id', userId),
    db.from('contract_bets').insert(betToRow(bet)),
    db.from('contracts').update(contractUpdate).eq('id', contract.id),
  ])

  if (balanceError) throw balanceError
  if (betError) throw betError
  if (contractUpdateError) throw contractUpdateError

  return res.status(200).json({ ...bet, betId: bet.id } as Bet)
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
