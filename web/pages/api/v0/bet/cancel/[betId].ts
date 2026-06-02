import { PrivyClient } from '@privy-io/node'
import { APIError } from 'common/api/utils'
import { LimitBet } from 'common/bet'
import { MarketContract } from 'common/contract'
import {
  isMexasOrderBookOnlyContract,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import { createClient, type Row } from 'common/supabase/utils'
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  acquireMexasUserBalanceLock,
  releaseMexasUserBalanceLock,
} from 'web/lib/api/mexas-balance'
import {
  releaseCancelledMexasOrder,
  releaseUnbackedMexasOrders,
} from 'web/lib/api/mexas-orders'

type ErrorResponse = { message: string }
const RESOLUTION_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const ORDER_LOCK_TIMEOUT_MS = 2 * 60 * 1000

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

function getSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getBetData(row: Row<'contract_bets'>) {
  const data = row.data
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

function getContractData(row: Row<'contracts'>) {
  const data = row.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function hasFreshMexasResolutionLock(data: Record<string, unknown>) {
  const locked = data.mexasResolving === true
  const since =
    typeof data.mexasResolvingSince === 'number' ? data.mexasResolvingSince : 0

  return locked && Date.now() - since < RESOLUTION_LOCK_TIMEOUT_MS
}

function hasFreshMexasOrderLock(data: Record<string, unknown>) {
  const locked = data.mexasOrderLock === true
  const since =
    typeof data.mexasOrderLockSince === 'number' ? data.mexasOrderLockSince : 0

  return locked && Date.now() - since < ORDER_LOCK_TIMEOUT_MS
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LimitBet | ErrorResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    const userId = await getPrivyUserId(req)
    const betId = getSingleQueryValue(req.query.betId)
    if (!betId) throw new APIError(400, 'Missing betId.')

    const db = getSupabaseAdminClient()
    const balanceLockOwner = await acquireMexasUserBalanceLock(db, userId)
    try {
      await releaseUnbackedMexasOrders(db, {
        userId,
        requireBalanceRead: true,
        skipUserBalanceLock: true,
      })
      const { data: betRow, error: readError } = await db
        .from('contract_bets')
        .select('*')
        .eq('bet_id', betId)
        .single()

      if (readError) throw readError
      if (!betRow) throw new APIError(404, 'Bet not found.')

      const typedBetRow = betRow as Row<'contract_bets'>
      const bet = convertBet(typedBetRow)
      if (bet.userId !== userId) {
        throw new APIError(403, 'You can only cancel your own orders.')
      }
      if (bet.limitProb === undefined) {
        throw new APIError(403, 'Not a limit order. Cannot cancel.')
      }
      const limitBet = bet as LimitBet

      const { data: contractRow, error: contractError } = await db
        .from('contracts')
        .select('*')
        .eq('id', bet.contractId)
        .single()

      if (contractError) throw contractError
      if (!contractRow) throw new APIError(404, 'Contract not found.')

      const typedContractRow = contractRow as Row<'contracts'>
      const contract = convertContract(typedContractRow) as MarketContract
      if (!isMexasOrderBookOnlyContract(contract)) {
        throw new APIError(404, 'Order is not available on MEXAS.')
      }
      if (contract.isResolved) {
        throw new APIError(403, 'Market is resolved.')
      }
      if (hasFreshMexasResolutionLock(getContractData(typedContractRow))) {
        throw new APIError(503, 'Market resolution is in progress.')
      }
      if (hasFreshMexasOrderLock(getContractData(typedContractRow))) {
        throw new APIError(503, 'Order placement is in progress. Please retry.')
      }
      const betData = getBetData(typedBetRow) as MexasReservedOrderData &
        Record<string, unknown>
      const shouldReleaseMexasFunds =
        isMexasOrderBookOnlyContract(contract) &&
        betData.mexasFundsReserved === true &&
        betData.mexasFundsReleased !== true

      if (bet.isCancelled) {
        if (shouldReleaseMexasFunds) {
          const releasedBetRow = await releaseCancelledMexasOrder(
            db,
            typedBetRow,
            {
              skipUserBalanceLock: true,
            }
          )
          if (!releasedBetRow) {
            throw new APIError(
              503,
              'Order changed. Please refresh and try again.'
            )
          }
          return res.status(200).json(convertBet(releasedBetRow) as LimitBet)
        }
        throw new APIError(403, 'Order already cancelled.')
      }
      if (limitBet.isFilled || limitBet.amount >= limitBet.orderAmount) {
        throw new APIError(403, 'Order already filled.')
      }

      const releasedBetRow = shouldReleaseMexasFunds
        ? await releaseCancelledMexasOrder(db, typedBetRow, {
            skipUserBalanceLock: true,
          })
        : await cancelNonReservedMexasOrder(db, typedBetRow, betData)

      if (!releasedBetRow) {
        throw new APIError(503, 'Order changed. Please refresh and try again.')
      }

      return res
        .status(200)
        .json(convertBet(releasedBetRow as Row<'contract_bets'>) as LimitBet)
    } finally {
      await releaseMexasUserBalanceLock(db, userId, balanceLockOwner)
    }
  } catch (error) {
    console.error('MEXAS cancel order failed', error)

    if (error instanceof APIError) {
      return res.status(error.code).json({ message: error.message })
    }

    const message =
      error instanceof Error ? error.message : 'Could not cancel order.'
    return res.status(500).json({ message })
  }
}

async function cancelNonReservedMexasOrder(
  db: ReturnType<typeof getSupabaseAdminClient>,
  betRow: Row<'contract_bets'>,
  betData: MexasReservedOrderData & Record<string, unknown>
) {
  const { data: updatedBetRow, error: updateError } = await db
    .from('contract_bets')
    .update({
      is_cancelled: true,
      data: {
        ...betData,
        isCancelled: true,
        mexasFundsReleased: betData.mexasFundsReleased,
      },
    })
    .eq('bet_id', betRow.bet_id)
    .eq('updated_time', betRow.updated_time)
    .eq('is_cancelled', false)
    .eq('is_filled', false)
    .select()
    .maybeSingle()

  if (updateError) throw updateError
  return updatedBetRow as Row<'contract_bets'> | undefined
}
