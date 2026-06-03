import { PrivyClient } from '@privy-io/node'
import { API } from 'common/api/schema'
import { APIError } from 'common/api/utils'
import { LimitBet, type Bet } from 'common/bet'
import { type resolution } from 'common/contract'
import {
  isMexasOrderBookOnlyContract,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import {
  getMexasOrderReleaseCreditKey,
  getMexasResolutionCreditEvents,
} from 'common/mexas-resolution'
import { getMexasSettlementAudit } from 'common/mexas-settlement'
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
  acquireMexasUserBalanceLock,
  releaseMexasUserBalanceLock,
  updateMexasUserBalanceCas,
} from 'web/lib/api/mexas-balance'
import {
  getOpenReservedMexasAmount,
  releaseClosedMexasMarketOrders,
  releaseExpiredMexasOrders,
  releaseUnbackedMexasOrders,
} from 'web/lib/api/mexas-orders'
import { assertMexasCanResolveFilledPositions } from 'web/lib/api/mexas-settlement'
import { z } from 'zod'

type ErrorResponse = { message: string; details?: unknown }

const RESOLUTION_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const CONTRACT_BETS_PAGE_SIZE = 1000
const ORDER_LOCK_TIMEOUT_MS = 2 * 60 * 1000
const MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY =
  'mexasWalletOpenReservedAmount'

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

function getRowData(row: { data: unknown } | null): Record<string, unknown> {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function hasFreshResolutionLock(data: Record<string, unknown>) {
  const resolving = data.mexasResolving === true
  const since =
    typeof data.mexasResolvingSince === 'number' ? data.mexasResolvingSince : 0

  return resolving && Date.now() - since < RESOLUTION_LOCK_TIMEOUT_MS
}

function hasFreshOrderLock(data: Record<string, unknown>) {
  const locked = data.mexasOrderLock === true
  const since =
    typeof data.mexasOrderLockSince === 'number' ? data.mexasOrderLockSince : 0

  return locked && Date.now() - since < ORDER_LOCK_TIMEOUT_MS
}

function getResolutionLockOutcome(data: Record<string, unknown>) {
  const outcome = data.mexasResolvingOutcome
  return outcome === 'YES' || outcome === 'NO' || outcome === 'CANCEL'
    ? outcome
    : undefined
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

function getMexasResolutionLockPredicates(data: Record<string, unknown>) {
  if (data.mexasResolving === true) {
    const since = data.mexasResolvingSince
    if (typeof since === 'number') {
      return [`data->>mexasResolvingSince.eq.${since}`]
    }

    const outcome = getResolutionLockOutcome(data)
    if (outcome) {
      return [`data->>mexasResolvingOutcome.eq.${outcome}`]
    }
  }

  return ['data->>mexasResolving.is.null', 'data->>mexasResolving.eq.false']
}

function combinePostgrestAndPredicates(predicateGroups: string[][]) {
  return predicateGroups
    .reduce<string[]>((combinations, group) => {
      return combinations.flatMap((combination) =>
        group.map((predicate) =>
          combination ? `${combination},${predicate}` : predicate
        )
      )
    }, [''])
    .map((predicate) => `and(${predicate})`)
    .join(',')
}

async function loadContractRows(db: SupabaseClient, contractId: string) {
  const { data, error } = await db
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single()

  if (error) throw error
  if (!data) throw new APIError(404, 'Contract not found.')
  return data as Row<'contracts'>
}

async function closeContractForResolution(
  db: SupabaseClient,
  contractRow: Row<'contracts'>,
  outcome: resolution
) {
  const contractData = getRowData(contractRow)
  const now = Date.now()
  let query = db
    .from('contracts')
    .update({
      close_time: millisToTs(now),
      data: {
        ...contractData,
        closeTime: now,
        lastUpdatedTime: now,
        mexasResolving: true,
        mexasResolvingSince: now,
        mexasResolvingOutcome: outcome,
      } as any,
      last_updated_time: millisToTs(now),
    })
    .eq('id', contractRow.id)
    .is('resolution_time', null)
    .or(
      combinePostgrestAndPredicates([
        getMexasOrderLockPredicates(contractData),
        getMexasResolutionLockPredicates(contractData),
      ])
    )

  query = contractRow.last_updated_time
    ? query.eq('last_updated_time', contractRow.last_updated_time)
    : query.is('last_updated_time', null)

  const { data, error } = await query.select().maybeSingle()

  if (error) throw error
  if (!data) {
    throw new APIError(503, 'Resolution already in progress. Please retry.')
  }
  return data as Row<'contracts'>
}

async function loadContractBets(db: SupabaseClient, contractId: string) {
  const rows: Row<'contract_bets'>[] = []

  for (let from = 0; ; from += CONTRACT_BETS_PAGE_SIZE) {
    const { data, error } = await db
      .from('contract_bets')
      .select('*')
      .eq('contract_id', contractId)
      .order('created_time', { ascending: true })
      .range(from, from + CONTRACT_BETS_PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...((data ?? []) as Row<'contract_bets'>[]))
    if ((data ?? []).length < CONTRACT_BETS_PAGE_SIZE) break
  }

  return rows.map((row) => ({
    row,
    bet: convertBet(row),
  }))
}

async function releaseOpenOrder(
  db: SupabaseClient,
  entry: { row: Row<'contract_bets'>; bet: Bet }
) {
  const entryBet = entry.bet as LimitBet & MexasReservedOrderData
  if (entryBet.limitProb === undefined || entryBet.orderAmount === undefined) {
    return
  }

  const { data: currentRow, error: readError } = await db
    .from('contract_bets')
    .select('*')
    .eq('bet_id', entryBet.id)
    .maybeSingle()

  if (readError) throw readError
  if (!currentRow) return

  const typedCurrentRow = currentRow as Row<'contract_bets'>
  const currentBet = convertBet(typedCurrentRow) as LimitBet &
    MexasReservedOrderData
  if (
    currentBet.limitProb === undefined ||
    currentBet.orderAmount === undefined
  ) {
    return
  }
  if (currentBet.isCancelled && currentBet.mexasFundsReleased === true) return

  const data = getRowData(typedCurrentRow)
  const now = Date.now()
  const { data: updatedRow, error } = await db
    .from('contract_bets')
    .update({
      is_cancelled: currentBet.isFilled ? currentBet.isCancelled : true,
      data: {
        ...data,
        isCancelled: currentBet.isFilled ? currentBet.isCancelled : true,
        mexasFundsReleased: true,
        mexasReleaseCreditKey: getMexasOrderReleaseCreditKey(currentBet.id),
        mexasReleaseReason: 'resolution',
        mexasReleasedAt: now,
      } as any,
    })
    .eq('bet_id', currentBet.id)
    .eq('updated_time', typedCurrentRow.updated_time)
    .select('bet_id')
    .maybeSingle()

  if (error) throw error
  if (!updatedRow) {
    throw new APIError(
      503,
      'Order changed during resolution. Please retry resolution.'
    )
  }
}

async function refreshMexasOpenReservedAmount(
  db: SupabaseClient,
  userId: string
) {
  await updateMexasUserBalanceCas(db, userId, 0, {
    dataPatch: {
      [MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]:
        await getOpenReservedMexasAmount(db, { userId }),
    },
  })
}

async function applyMexasResolutionCreditsAndReleases(
  db: SupabaseClient,
  entries: { row: Row<'contract_bets'>; bet: Bet }[],
  creditEvents: { userId: string; amount: number; creditKey: string }[]
) {
  const entriesByUserId = new Map<
    string,
    { row: Row<'contract_bets'>; bet: Bet }[]
  >()
  const eventsByUserId = new Map<
    string,
    { userId: string; amount: number; creditKey: string }[]
  >()

  for (const entry of entries) {
    const userEntries = entriesByUserId.get(entry.bet.userId) ?? []
    userEntries.push(entry)
    entriesByUserId.set(entry.bet.userId, userEntries)
  }
  for (const event of creditEvents) {
    const userEvents = eventsByUserId.get(event.userId) ?? []
    userEvents.push(event)
    eventsByUserId.set(event.userId, userEvents)
  }

  const userIds = Array.from(
    new Set([...entriesByUserId.keys(), ...eventsByUserId.keys()])
  ).sort()

  for (const eventUserId of userIds) {
    const balanceLockOwner = await acquireMexasUserBalanceLock(db, eventUserId)
    try {
      for (const event of eventsByUserId.get(eventUserId) ?? []) {
        await updateMexasUserBalanceCas(db, event.userId, event.amount, {
          creditKey: event.creditKey,
        })
      }
      for (const entry of entriesByUserId.get(eventUserId) ?? []) {
        await releaseOpenOrder(db, entry)
      }
      if ((entriesByUserId.get(eventUserId) ?? []).length) {
        await refreshMexasOpenReservedAmount(db, eventUserId)
      }
    } finally {
      await releaseMexasUserBalanceLock(db, eventUserId, balanceLockOwner)
    }
  }
}

async function resolveMexasMarket(
  req: NextApiRequest,
  res: NextApiResponse<{ message: string } | ErrorResponse>
) {
  const userId = await getPrivyUserId(req)
  const contractId = getSingleQueryValue(req.query.contractId)
  if (!contractId) throw new APIError(400, 'Missing contractId.')

  const props = API['market/:contractId/resolve'].props.parse({
    ...req.body,
    contractId,
  })
  const outcome = props.outcome
  if (outcome !== 'YES' && outcome !== 'NO' && outcome !== 'CANCEL') {
    throw new APIError(400, 'MEXAS markets resolve to YES, NO, or CANCEL.')
  }

  const db = getSupabaseAdminClient()
  const initialContractRow = await loadContractRows(db, contractId)
  const contract = convertContract(initialContractRow)

  if (!isMexasOrderBookOnlyContract(contract)) {
    throw new APIError(
      400,
      'This route only resolves MEXAS order book markets.'
    )
  }
  if (contract.creatorId !== userId) {
    throw new APIError(403, 'Only the market creator can resolve this market.')
  }
  if (contract.isResolved) {
    throw new APIError(403, 'Contract already resolved.')
  }
  const initialContractData = getRowData(initialContractRow)
  const lockedOutcome = getResolutionLockOutcome(initialContractData)
  if (lockedOutcome && lockedOutcome !== outcome) {
    throw new APIError(
      403,
      `Resolution is already locked for ${lockedOutcome}.`
    )
  }
  if (hasFreshOrderLock(initialContractData)) {
    throw new APIError(503, 'Order placement is in progress. Please retry.')
  }
  if (hasFreshResolutionLock(initialContractData)) {
    throw new APIError(503, 'Resolution already in progress. Please retry.')
  }

  await releaseClosedMexasMarketOrders(db, { contractId })
  await releaseExpiredMexasOrders(db, { contractId })
  await releaseUnbackedMexasOrders(db, {
    contractId,
    requireBalanceRead: true,
  })
  const preflightBets = await loadContractBets(db, contractId)
  assertMexasCanResolveFilledPositions(
    getMexasSettlementAudit(preflightBets.map((entry) => entry.bet))
  )

  const closedContractRow = await closeContractForResolution(
    db,
    initialContractRow,
    outcome
  )
  await releaseClosedMexasMarketOrders(db, { contractId })
  await releaseExpiredMexasOrders(db, { contractId })
  await releaseUnbackedMexasOrders(db, {
    contractId,
    requireBalanceRead: true,
  })
  const bets = await loadContractBets(db, contractId)
  assertMexasCanResolveFilledPositions(
    getMexasSettlementAudit(bets.map((entry) => entry.bet))
  )
  const creditEvents = getMexasResolutionCreditEvents(
    bets.map((entry) => entry.bet),
    outcome
  )

  await applyMexasResolutionCreditsAndReleases(db, bets, creditEvents)

  const resolutionTime = Date.now()
  const contractData = getRowData(closedContractRow)
  const resolutionProbability =
    outcome === 'YES' ? 1 : outcome === 'NO' ? 0 : undefined
  const { data: resolvedContractRow, error: resolveError } = await db
    .from('contracts')
    .update({
      resolution: outcome,
      resolution_time: millisToTs(resolutionTime),
      resolution_probability: resolutionProbability ?? null,
      data: {
        ...contractData,
        isResolved: true,
        resolution: outcome,
        resolutionTime,
        resolverId: userId,
        resolutionProbability,
        lastUpdatedTime: resolutionTime,
        mexasResolving: false,
        mexasResolutionPayoutComplete: true,
      } as any,
      last_updated_time: millisToTs(resolutionTime),
    })
    .eq('id', contractId)
    .is('resolution_time', null)
    .select()
    .maybeSingle()

  if (resolveError) throw resolveError
  if (!resolvedContractRow) {
    throw new APIError(403, 'Contract already resolved.')
  }

  return res.status(200).json({ message: 'success' })
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ message: string } | ErrorResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    return await resolveMexasMarket(req, res)
  } catch (error) {
    console.error('MEXAS resolve failed', error)

    if (error instanceof APIError) {
      return res.status(error.code).json({ message: error.message })
    }
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ message: 'Invalid resolve request.', details: error.flatten() })
    }

    const message =
      error instanceof Error ? error.message : 'Could not resolve market.'
    return res.status(500).json({ message })
  }
}
