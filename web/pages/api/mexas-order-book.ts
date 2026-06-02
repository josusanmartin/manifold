import type { Bet } from 'common/bet'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import { createClient, type Row } from 'common/supabase/utils'
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  releaseClosedMexasMarketOrders,
  releaseExpiredMexasOrders,
  releaseUnbackedMexasOrders,
} from 'web/lib/api/mexas-orders'

type ErrorResponse = { message: string }

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
    throw new Error('Supabase admin credentials are not configured.')
  }

  return createClient(urlOrInstanceId, key)
}

function getSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Bet[] | ErrorResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  const contractId = getSingleQueryValue(req.query.contractId)
  if (!contractId) {
    return res.status(400).json({ message: 'Missing contractId.' })
  }

  const parsedLimit = Number(getSingleQueryValue(req.query.limit))
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 500)
    : 500

  try {
    const db = getSupabaseAdminClient()
    const now = new Date().toISOString()
    const { data: contractRow, error: contractError } = await db
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .maybeSingle()

    if (contractError) throw contractError
    if (!contractRow) {
      return res.status(404).json({ message: 'Contract not found.' })
    }
    if (!isMexasOrderBookOnlyContract(convertContract(contractRow))) {
      return res.status(404).json({ message: 'Order book not found.' })
    }

    await releaseClosedMexasMarketOrders(db, { contractId })
    await releaseExpiredMexasOrders(db, { contractId })
    await releaseUnbackedMexasOrders(db, { contractId })

    const { data, error } = await db
      .from('contract_bets')
      .select('*')
      .eq('contract_id', contractId)
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_time', { ascending: false })
      .limit(limit)

    if (error) throw error

    const bets = (data ?? []).map((row) =>
      convertBet(row as Row<'contract_bets'>)
    )
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=30')
    return res.status(200).json(bets)
  } catch (error) {
    console.error('Failed to load Mexas order book:', error)
    return res.status(500).json({ message: 'Failed to load order book.' })
  }
}
