import { API } from 'common/api/schema'
import { APIError } from 'common/api/utils'
import type { Bet } from 'common/bet'
import {
  hasInactiveMexasOrderDataFlags,
  isMexasOrderBookOnlyContract,
} from 'common/mexas-market'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import {
  createClient,
  millisToTs,
  type Row,
  type SupabaseClient,
} from 'common/supabase/utils'
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  releaseClosedMexasMarketOrders,
  releaseExpiredMexasOrders,
  releaseUnbackedMexasOrders,
} from 'web/lib/api/mexas-orders'
import { z } from 'zod'

type ErrorResponse = { message: string; details?: unknown }
const CONTRACT_PAGE_SIZE = 1000

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

function getBetData(row: Row<'contract_bets'> | null) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

async function getContractIdFromSlug(db: SupabaseClient, slug: string) {
  const { data, error } = await db
    .from('contracts')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  return data?.id
}

async function getMexasContractIds(
  db: SupabaseClient,
  contractId?: string | string[]
) {
  const rows: Row<'contracts'>[] = []

  for (let from = 0; ; from += CONTRACT_PAGE_SIZE) {
    let query = db
      .from('contracts')
      .select('*')
      .contains('data', { token: 'MEX' } as any)

    if (contractId) {
      query = Array.isArray(contractId)
        ? query.in('id', contractId)
        : query.eq('id', contractId)
    }

    const { data, error } = await query.range(
      from,
      from + CONTRACT_PAGE_SIZE - 1
    )
    if (error) throw error

    rows.push(...((data ?? []) as Row<'contracts'>[]))
    if ((data ?? []).length < CONTRACT_PAGE_SIZE) break
  }

  return rows
    .filter((row) => isMexasOrderBookOnlyContract(convertContract(row)))
    .map((row) => row.id)
}

async function getUserIdFromUsername(db: SupabaseClient, username: string) {
  const { data, error } = await db
    .from('users')
    .select('id')
    .ilike('username', username)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new APIError(404, 'User not found.')
  return data.id
}

async function runOpenLimitMaintenance(
  db: SupabaseClient,
  options: {
    contractId?: string
    userId?: string
  }
) {
  try {
    await releaseClosedMexasMarketOrders(db, options)
    await releaseExpiredMexasOrders(db, options)
    await releaseUnbackedMexasOrders(db, options)
  } catch (error) {
    console.warn('MEXAS open-limit read maintenance skipped', error)
  }
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
    if (params.kinds !== 'open-limit') {
      throw new APIError(404, 'Bets history is not available on MEXAS.')
    }

    const db = getSupabaseAdminClient()
    const contractId = params.contractSlug
      ? await getContractIdFromSlug(db, params.contractSlug)
      : params.contractId
    const userId = params.username
      ? await getUserIdFromUsername(db, params.username)
      : params.userId

    if (params.contractSlug && !contractId) {
      throw new APIError(404, 'Contract not found.')
    }
    const mexasContractIds = await getMexasContractIds(db, contractId)

    if (contractId && mexasContractIds.length === 0) {
      throw new APIError(404, 'Contract not found.')
    }
    if (mexasContractIds.length === 0) {
      return res.status(200).json([])
    }

    const singleContractId =
      mexasContractIds.length === 1 ? mexasContractIds[0] : undefined
    if (params.kinds === 'open-limit' && (singleContractId || userId)) {
      await runOpenLimitMaintenance(db, {
        contractId: singleContractId,
        userId,
      })
    }

    let query = db.from('contract_bets').select('*')

    if (params.id) query = query.eq('bet_id', params.id)
    query = query.in('contract_id', mexasContractIds)
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
      .json(
        ((data ?? []) as Row<'contract_bets'>[])
          .filter((row) => !hasInactiveMexasOrderDataFlags(getBetData(row)))
          .map((row) => convertBet(row))
      )
  } catch (error) {
    console.error('MEXAS bets fetch failed', error)

    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ message: 'Invalid bets request.', details: error.flatten() })
    }
    if (error instanceof APIError) {
      return res.status(error.code).json({ message: error.message })
    }

    const message =
      error instanceof Error ? error.message : 'Could not load bets.'
    return res.status(500).json({ message })
  }
}
