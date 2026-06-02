import { PrivyClient } from '@privy-io/node'
import { APIError } from 'common/api/utils'
import { LimitBet } from 'common/bet'
import { MarketContract } from 'common/contract'
import {
  getMexasRemainingReservedAmount,
  isMexasOrderBookOnlyContract,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import { createClient, type Row } from 'common/supabase/utils'
import type { NextApiRequest, NextApiResponse } from 'next'

type ErrorResponse = { message: string }

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

function getSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getBetData(row: Row<'contract_bets'>) {
  const data = row.data
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
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
    const { data: betRow, error: readError } = await db
      .from('contract_bets')
      .select('*')
      .eq('bet_id', betId)
      .single()

    if (readError) throw readError
    if (!betRow) throw new APIError(404, 'Bet not found.')

    const bet = convertBet(betRow as Row<'contract_bets'>)
    if (bet.userId !== userId) {
      throw new APIError(403, 'You can only cancel your own orders.')
    }
    if (bet.limitProb === undefined) {
      throw new APIError(403, 'Not a limit order. Cannot cancel.')
    }
    const limitBet = bet as LimitBet
    if (bet.isCancelled) throw new APIError(403, 'Order already cancelled.')
    if (limitBet.isFilled || limitBet.amount >= limitBet.orderAmount) {
      throw new APIError(403, 'Order already filled.')
    }

    const { data: contractRow, error: contractError } = await db
      .from('contracts')
      .select('*')
      .eq('id', bet.contractId)
      .single()

    if (contractError) throw contractError
    if (!contractRow) throw new APIError(404, 'Contract not found.')

    const contract = convertContract(contractRow) as MarketContract
    const betData = getBetData(
      betRow as Row<'contract_bets'>
    ) as MexasReservedOrderData & Record<string, unknown>
    const shouldReleaseMexasFunds =
      isMexasOrderBookOnlyContract(contract) &&
      betData.mexasFundsReserved === true &&
      betData.mexasFundsReleased !== true
    const refundAmount = shouldReleaseMexasFunds
      ? getMexasRemainingReservedAmount({
          amount: limitBet.amount,
          orderAmount: limitBet.orderAmount,
          mexasReservedAmount: betData.mexasReservedAmount,
        })
      : 0

    const { data: updatedBetRow, error: updateError } = await db
      .from('contract_bets')
      .update({
        is_cancelled: true,
        data: {
          ...betData,
          isCancelled: true,
          mexasFundsReleased: shouldReleaseMexasFunds
            ? true
            : betData.mexasFundsReleased,
        },
      })
      .eq('bet_id', betId)
      .eq('is_cancelled', false)
      .select()
      .single()

    if (updateError) throw updateError

    if (refundAmount > 0) {
      const { data: userRow, error: userReadError } = await db
        .from('users')
        .select('id,balance')
        .eq('id', userId)
        .single()

      if (userReadError) throw userReadError

      const { error: userUpdateError } = await db
        .from('users')
        .update({ balance: userRow.balance + refundAmount })
        .eq('id', userId)

      if (userUpdateError) throw userUpdateError
    }

    return res
      .status(200)
      .json(convertBet(updatedBetRow as Row<'contract_bets'>) as LimitBet)
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
