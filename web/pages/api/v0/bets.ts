import { API } from 'common/api/schema'
import type { Bet } from 'common/bet'
import { convertBet } from 'common/supabase/bets'
import {
  createClient,
  millisToTs,
  type Row,
  type SupabaseClient,
} from 'common/supabase/utils'
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  releaseExpiredMexasOrders,
  releaseUnbackedMexasOrders,
} from 'web/lib/api/mexas-orders'
import { z } from 'zod'

type ErrorResponse = { message: string; details?: unknown }

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

function normalizeQuery(query: NextApiRequest['query']) {
  const normalized = { ...query }
  if (normalized['contractId[]']) {
    normalized.contractId = normalized['contractId[]']
    delete normalized['contractId[]']
  }
  return normalized
}

async function getContractIdFromSlug(db: SupabaseClient, slug: string) {
  const { data, error } = await db
    .from('contracts')
    .select('id')
    .eq('slug', slug)
    .single()

  if (error) throw error
  return data?.id
}

async function getUserIdFromUsername(db: SupabaseClient, username: string) {
  const { data, error } = await db
    .from('users')
    .select('id')
    .ilike('username', username)
    .single()

  if (error) throw error
  return data?.id
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Bet[] | ErrorResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    const params = API.bets.props.parse(normalizeQuery(req.query))
    const db = getSupabaseAdminClient()
    const contractId = params.contractSlug
      ? await getContractIdFromSlug(db, params.contractSlug)
      : params.contractId
    const userId = params.username
      ? await getUserIdFromUsername(db, params.username)
      : params.userId

    const singleContractId = Array.isArray(contractId) ? undefined : contractId
    if (params.kinds === 'open-limit' && (singleContractId || userId)) {
      await releaseExpiredMexasOrders(db, {
        contractId: singleContractId,
        userId,
      })
      await releaseUnbackedMexasOrders(db, {
        contractId: singleContractId,
        userId,
      })
    }

    let query = db.from('contract_bets').select('*')

    if (params.id) query = query.eq('bet_id', params.id)
    if (contractId) {
      query = Array.isArray(contractId)
        ? query.in('contract_id', contractId)
        : query.eq('contract_id', contractId)
    }
    if (userId) query = query.eq('user_id', userId)
    if (params.answerId) query = query.eq('answer_id', params.answerId)
    if (params.afterTime !== undefined) {
      query = query.gt('created_time', millisToTs(params.afterTime))
    }
    if (params.beforeTime !== undefined) {
      query = query.lt('created_time', millisToTs(params.beforeTime))
    }
    if (params.filterRedemptions) {
      query = query.or('is_redemption.is.null,is_redemption.eq.false')
    }
    if (params.kinds === 'open-limit') {
      query = query
        .eq('is_filled', false)
        .eq('is_cancelled', false)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    }
    if (params.minAmount !== undefined) {
      query = query.gte('amount', params.minAmount)
    }

    const { data, error } = await query
      .order('created_time', { ascending: params.order === 'asc' })
      .limit(params.limit)

    if (error) throw error

    return res
      .status(200)
      .json((data ?? []).map((row) => convertBet(row as Row<'contract_bets'>)))
  } catch (error) {
    console.error('MEXAS bets fetch failed', error)

    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ message: 'Invalid bets request.', details: error.flatten() })
    }

    const message =
      error instanceof Error ? error.message : 'Could not load bets.'
    return res.status(500).json({ message })
  }
}
