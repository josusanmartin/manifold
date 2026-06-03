import { LimitBet, type Bet } from 'common/bet'
import {
  hasMexasEscrowedStake,
  isMexasOrderBookOnlyContract,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import { getMexasOpenOrderAmount } from 'common/mexas-order-book'
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
const ORDER_BOOK_PAGE_SIZE = 1000
const MAX_ORDER_BOOK_ROWS = 5000
const ORDER_BOOK_MAINTENANCE_TIMEOUT_MS = 750

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

function isVisibleMexasLimitOrder(bet: Bet): bet is LimitBet {
  return (
    bet.limitProb !== undefined &&
    bet.orderAmount !== undefined &&
    !bet.answerId &&
    !bet.isFilled &&
    !bet.isCancelled &&
    (bet.outcome === 'YES' || bet.outcome === 'NO') &&
    !hasMexasEscrowedStake(bet as LimitBet & MexasReservedOrderData) &&
    getMexasOpenOrderAmount(bet as LimitBet) > 0
  )
}

function sortMexasSidePriceTime(orders: LimitBet[], side: 'YES' | 'NO') {
  return [...orders].sort((a, b) => {
    const priceDiff =
      side === 'YES'
        ? (b.limitProb ?? 0) - (a.limitProb ?? 0)
        : (a.limitProb ?? 0) - (b.limitProb ?? 0)
    if (Math.abs(priceDiff) > 1e-9) return priceDiff

    const timeDiff = (a.createdTime ?? 0) - (b.createdTime ?? 0)
    if (timeDiff !== 0) return timeDiff
    return a.id.localeCompare(b.id)
  })
}

function getBestOpenMexasOrders(orders: LimitBet[], sideLimit: number) {
  const bids = sortMexasSidePriceTime(
    orders.filter((order) => order.outcome === 'YES'),
    'YES'
  ).slice(0, sideLimit)
  const asks = sortMexasSidePriceTime(
    orders.filter((order) => order.outcome === 'NO'),
    'NO'
  ).slice(0, sideLimit)

  return [...bids, ...asks]
}

async function runOrderBookMaintenance(
  db: ReturnType<typeof getSupabaseAdminClient>,
  contractId: string
) {
  const maintenancePromise = (async () => {
    await releaseClosedMexasMarketOrders(db, { contractId })
    await releaseExpiredMexasOrders(db, { contractId })
    await releaseUnbackedMexasOrders(db, { contractId })
  })().catch((error) => {
    console.warn('Failed to maintain Mexas order book:', error)
  })

  const timedOut = await Promise.race([
    maintenancePromise.then(() => false),
    new Promise<true>((resolve) =>
      setTimeout(() => resolve(true), ORDER_BOOK_MAINTENANCE_TIMEOUT_MS)
    ),
  ])

  if (timedOut) {
    console.warn(
      `Mexas order book maintenance exceeded ${ORDER_BOOK_MAINTENANCE_TIMEOUT_MS}ms for ${contractId}.`
    )
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

    await runOrderBookMaintenance(db, contractId)

    const rows: Row<'contract_bets'>[] = []
    for (
      let from = 0;
      rows.length < MAX_ORDER_BOOK_ROWS;
      from += ORDER_BOOK_PAGE_SIZE
    ) {
      const { data, error } = await db
        .from('contract_bets')
        .select('*')
        .eq('contract_id', contractId)
        .eq('is_filled', false)
        .eq('is_cancelled', false)
        .eq('data->>mexasFundsReserved', 'true')
        .eq('data->>mexasFundsReleased', 'false')
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order('created_time', { ascending: true })
        .order('bet_id', { ascending: true })
        .range(from, from + ORDER_BOOK_PAGE_SIZE - 1)

      if (error) throw error
      rows.push(...((data ?? []) as Row<'contract_bets'>[]))
      if ((data ?? []).length < ORDER_BOOK_PAGE_SIZE) break
    }

    const bets = getBestOpenMexasOrders(
      rows.map((row) => convertBet(row)).filter(isVisibleMexasLimitOrder),
      limit
    )
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=30')
    return res.status(200).json(bets)
  } catch (error) {
    console.error('Failed to load Mexas order book:', error)
    return res.status(500).json({ message: 'Failed to load order book.' })
  }
}
