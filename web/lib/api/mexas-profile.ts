import { APIError } from 'common/api/utils'
import type {
  AnyBalanceChangeType,
  BetBalanceChange,
  MexasTreasuryBalanceChange,
  MexasWalletBalanceChange,
} from 'common/balance-change'
import type { LimitBet } from 'common/bet'
import { calculateUpdatedMetricsForContracts } from 'common/calculate-metrics'
import type { MarketContract } from 'common/contract'
import type { ContractMetric } from 'common/contract-metric'
import {
  hasInactiveMexasOrderDataFlags,
  isMexasTestUnwound,
  isMexasOrderBookOnlyContract,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import type { LivePortfolioMetrics } from 'common/portfolio-metrics'
import { convertBet } from 'common/supabase/bets'
import { convertContract, contractFields } from 'common/supabase/contracts'
import { convertContractMetricRows } from 'common/supabase/contract-metrics'
import {
  createClient,
  millisToTs,
  tsToMillis,
  type Row,
  type SupabaseClient,
} from 'common/supabase/utils'
import { chunk, groupBy, mapValues, orderBy, pick, sumBy, uniq } from 'lodash'
import type { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'

type ErrorResponse = { message: string; details?: unknown }

const MAX_PROFILE_ROWS = 10_000
const CONTRACT_CHUNK_SIZE = 200

export function getSupabaseAdminClient() {
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

export function normalizeQuery(query: NextApiRequest['query']) {
  const normalized = { ...query }
  for (const key of Object.keys(normalized)) {
    if (!key.endsWith('[]')) continue
    normalized[key.slice(0, -2)] = normalized[key]
    delete normalized[key]
  }
  return normalized
}

export function sendMexasApiError(
  res: NextApiResponse<ErrorResponse>,
  error: unknown,
  fallback: string
) {
  console.error('MEXAS profile API failed', error)

  if (error instanceof APIError) {
    return res.status(error.code).json({ message: error.message })
  }
  if (error instanceof z.ZodError) {
    return res
      .status(400)
      .json({ message: 'Invalid request.', details: error.flatten() })
  }

  return res.status(500).json({
    message: error instanceof Error ? error.message : fallback,
  })
}

function getData(row: { data: unknown } | null | undefined) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function applyMexasContractFilters(query: any) {
  return query
    .eq('visibility', 'public')
    .eq('data->>token', 'MEX')
    .eq('mechanism', 'cpmm-1')
    .eq('outcome_type', 'BINARY')
    .or('deleted.is.null,deleted.eq.false')
}

function convertMexasContracts(rows: Row<'contracts'>[]) {
  return rows
    .map((row) => convertContract<MarketContract>(row))
    .filter(isMexasOrderBookOnlyContract)
}

export async function loadMexasContractsByIds(
  db: SupabaseClient,
  contractIds: string[]
) {
  const ids = uniq(contractIds)
  if (ids.length === 0) return [] as MarketContract[]

  const contracts: MarketContract[] = []
  for (const idsChunk of chunk(ids, CONTRACT_CHUNK_SIZE)) {
    const { data, error } = await applyMexasContractFilters(
      db.from('contracts').select(contractFields).in('id', idsChunk)
    )
    if (error) throw error
    contracts.push(...convertMexasContracts((data ?? []) as Row<'contracts'>[]))
  }

  return contracts
}

function applySearchFilter(query: any, filter: string) {
  const now = new Date().toISOString()
  switch (filter) {
    case 'open':
      return query
        .is('resolution_time', null)
        .or(`close_time.is.null,close_time.gt.${now}`)
    case 'closed':
      return query.is('resolution_time', null).lt('close_time', now)
    case 'resolved':
      return query.not('resolution_time', 'is', null)
    case 'closing-week':
      return query
        .is('resolution_time', null)
        .gt('close_time', now)
        .lte(
          'close_time',
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        )
    case 'closing-month':
      return query
        .is('resolution_time', null)
        .gt('close_time', now)
        .lte(
          'close_time',
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        )
    case 'closing-90-days':
      return query
        .is('resolution_time', null)
        .gt('close_time', now)
        .lte(
          'close_time',
          new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
        )
    default:
      return query
  }
}

function applySearchSort(query: any, sort: string) {
  switch (sort) {
    case 'close-date':
      return query.order('close_time', {
        ascending: true,
        nullsFirst: false,
      })
    case 'resolve-date':
      return query.order('resolution_time', {
        ascending: false,
        nullsFirst: false,
      })
    case 'freshness-score':
    case 'hot':
      return query.order('freshness_score', {
        ascending: false,
        nullsFirst: false,
      })
    case 'daily-score':
      return query.order('daily_score', {
        ascending: false,
        nullsFirst: false,
      })
    case 'most-popular':
      return query.order('unique_bettor_count', {
        ascending: false,
        nullsFirst: false,
      })
    case 'score':
      return query.order('importance_score', {
        ascending: false,
        nullsFirst: false,
      })
    case 'last-updated':
      return query.order('last_updated_time', {
        ascending: false,
        nullsFirst: false,
      })
    default:
      return query.order('created_time', {
        ascending: false,
        nullsFirst: false,
      })
  }
}

export async function searchMexasContracts(
  db: SupabaseClient,
  props: {
    term?: string
    filter: string
    sort: string
    contractType: string
    limit: number
    offset?: number
    creatorId?: string
    beforeTime?: number
  }
) {
  if (props.contractType !== 'ALL' && props.contractType !== 'BINARY') {
    return [] as MarketContract[]
  }

  let query = applyMexasContractFilters(
    db.from('contracts').select(contractFields)
  )
  if (props.creatorId) query = query.eq('creator_id', props.creatorId)
  if (props.term?.trim()) {
    query = query.ilike('question', `%${props.term.trim()}%`)
  }
  if (props.beforeTime)
    query = query.lt('created_time', millisToTs(props.beforeTime))
  query = applySearchFilter(query, props.filter)
  query = applySearchSort(query, props.sort)

  const offset = props.offset ?? 0
  const { data, error } = await query.range(offset, offset + props.limit - 1)
  if (error) throw error

  const contracts = convertMexasContracts((data ?? []) as Row<'contracts'>[])
  if (props.sort === 'prob-descending')
    return orderBy(contracts, 'prob', 'desc')
  if (props.sort === 'prob-ascending') return orderBy(contracts, 'prob', 'asc')
  return contracts
}

function profileContract(contract: MarketContract) {
  return pick(contract, [
    'id',
    'question',
    'creatorName',
    'creatorUsername',
    'creatorId',
    'slug',
    'resolutionTime',
    'closeTime',
    'token',
    'mechanism',
    'outcomeType',
    'isResolved',
    'resolution',
    'resolutions',
    'answers',
    'volume24Hours',
    'totalLiquidity',
    'probChanges',
    'prob',
    'pool',
    'p',
    'min',
    'max',
    'isLogScale',
    'unit',
  ]) as MarketContract
}

export async function getMexasUserContractMetricsWithContracts(
  db: SupabaseClient,
  props: {
    userId: string
    limit: number
    offset?: number
    perAnswer?: boolean
    order?: 'lastBetTime' | 'profit'
  }
) {
  const { data, error } = await db
    .from('user_contract_metrics')
    .select('*')
    .eq('user_id', props.userId)
    .is('answer_id', null)
    .limit(MAX_PROFILE_ROWS)

  if (error) throw error

  const metrics = convertContractMetricRows(
    (data ?? []) as Row<'user_contract_metrics'>[]
  )
  const contracts = await loadMexasContractsByIds(
    db,
    metrics.map((metric) => metric.contractId)
  )
  const contractsById = Object.fromEntries(
    contracts.map((contract) => [contract.id, contract])
  )
  const mexasMetrics = metrics.filter(
    (metric) => contractsById[metric.contractId]
  )
  const grouped = groupBy(mexasMetrics, 'contractId')
  const metricResults = Object.entries(grouped).map(
    ([contractId, metrics]) => ({
      contract: contractsById[contractId],
      metrics,
    })
  )
  const { metricsByContract: updatedMetrics } =
    calculateUpdatedMetricsForContracts(metricResults)

  const summaryMetricsByContract = mapValues(updatedMetrics, (metrics) =>
    props.perAnswer
      ? metrics
      : metrics.filter((metric) => metric.answerId === null)
  )

  const sortedContracts = orderBy(
    contracts.filter(
      (contract) => summaryMetricsByContract[contract.id]?.length
    ),
    (contract) => {
      const metric = summaryMetricsByContract[contract.id]?.[0]
      return props.order === 'profit'
        ? metric?.profit ?? 0
        : metric?.lastBetTime ?? 0
    },
    'desc'
  )
  const offset = props.offset ?? 0
  const selectedContracts = sortedContracts.slice(offset, offset + props.limit)
  const selectedIds = new Set(selectedContracts.map((contract) => contract.id))

  return {
    metricsByContract: Object.fromEntries(
      Object.entries(summaryMetricsByContract).filter(([contractId]) =>
        selectedIds.has(contractId)
      )
    ),
    contracts: selectedContracts.map(profileContract),
  }
}

export async function getMexasPortfolio(
  db: SupabaseClient,
  userId: string
): Promise<LivePortfolioMetrics> {
  const [{ data: userRow, error: userError }, metricsResult] =
    await Promise.all([
      db.from('users').select('*').eq('id', userId).maybeSingle(),
      getMexasUserContractMetricsWithContracts(db, {
        userId,
        limit: MAX_PROFILE_ROWS,
        offset: 0,
      }),
    ])

  if (userError) throw userError
  if (!userRow) throw new APIError(404, 'User not found.')

  const metrics = Object.values(metricsResult.metricsByContract)
    .flat()
    .filter((metric): metric is ContractMetric => metric != null)

  const investmentValue = sumBy(metrics, (metric) => metric.payout ?? 0)
  const balance = Number(userRow.balance ?? 0)

  return {
    userId,
    investmentValue,
    cashInvestmentValue: 0,
    balance,
    cashBalance: 0,
    spiceBalance: 0,
    totalDeposits: 0,
    totalCashDeposits: 0,
    loanTotal: 0,
    dailyProfit: 0,
    timestamp: Date.now(),
  }
}

function isVisibleMexasBetRow(row: Row<'contract_bets'>) {
  return !hasInactiveMexasOrderDataFlags(getData(row))
}

function isInBalanceChangeWindow(
  time: number | undefined,
  props: { before?: number; after: number }
) {
  return (
    time !== undefined &&
    time >= props.after &&
    (props.before === undefined || time < props.before)
  )
}

function getProfileContractForBalanceChange(contract: MarketContract) {
  return {
    question: contract.question,
    slug: contract.slug,
    visibility: contract.visibility,
    creatorUsername: contract.creatorUsername,
    token: 'MEX' as const,
  }
}

export async function getMexasUserLimitOrdersWithContracts(
  db: SupabaseClient,
  props: {
    userId: string
    count: number
    includeExpired: boolean
    includeCancelled: boolean
    includeFilled: boolean
  }
) {
  const now = new Date().toISOString()
  let query = db
    .from('contract_bets')
    .select('*')
    .eq('user_id', props.userId)
    .not('data->>limitProb', 'is', null)
    .or('is_redemption.is.null,is_redemption.eq.false')
    .order('created_time', { ascending: false })
    .limit(Math.min(props.count, MAX_PROFILE_ROWS))

  query = props.includeExpired
    ? query.lt('expires_at', now)
    : query.or(`expires_at.is.null,expires_at.gt.${now}`)
  query = query.eq('is_filled', props.includeFilled)
  query = query.eq('is_cancelled', props.includeCancelled)

  const { data, error } = await query
  if (error) throw error

  const rows = ((data ?? []) as Row<'contract_bets'>[]).filter(
    isVisibleMexasBetRow
  )
  const contracts = await loadMexasContractsByIds(
    db,
    rows.map((row) => row.contract_id)
  )
  const contractIds = new Set(contracts.map((contract) => contract.id))
  const bets = rows
    .filter((row) => contractIds.has(row.contract_id))
    .map((row) => convertBet(row) as LimitBet)
    .filter(
      (bet) => bet.limitProb !== undefined && bet.orderAmount !== undefined
    )

  return { bets, contracts }
}

export async function getMexasBalanceChanges(
  db: SupabaseClient,
  props: {
    userId: string
    before?: number
    after: number
  }
) {
  const afterTs = millisToTs(props.after)
  let betQuery = db
    .from('contract_bets')
    .select('*')
    .eq('user_id', props.userId)
    .or(`created_time.gte.${afterTs},updated_time.gte.${afterTs}`)
    .order('updated_time', { ascending: false })
    .limit(500)

  if (props.before) {
    const beforeTs = millisToTs(props.before)
    betQuery = betQuery.lt('created_time', beforeTs)
  }

  let transferQuery = db
    .from('mexas_treasury_transfers')
    .select('*')
    .eq('user_id', props.userId)
    .in('status', ['submitted', 'confirmed'])
    .gte('updated_time', afterTs)
    .order('updated_time', { ascending: false })
    .limit(500)

  if (props.before) {
    transferQuery = transferQuery.lt('updated_time', millisToTs(props.before))
  }

  let walletMovementQuery = db
    .from('mexas_wallet_movements')
    .select('*')
    .eq('user_id', props.userId)
    .gte('observed_time', afterTs)
    .order('observed_time', { ascending: false })
    .limit(500)

  if (props.before) {
    walletMovementQuery = walletMovementQuery.lt(
      'observed_time',
      millisToTs(props.before)
    )
  }

  const [
    { data: betRowsData, error: betRowsError },
    { data: transferRowsData, error: transferRowsError },
    { data: walletMovementRowsData, error: walletMovementRowsError },
  ] = await Promise.all([betQuery, transferQuery, walletMovementQuery])
  if (betRowsError) throw betRowsError
  if (transferRowsError) throw transferRowsError
  if (walletMovementRowsError) throw walletMovementRowsError

  const rows = (betRowsData ?? []) as Row<'contract_bets'>[]
  const transferRows = (transferRowsData ?? []) as Row<
    'mexas_treasury_transfers'
  >[]
  const walletMovementRows = (walletMovementRowsData ?? []) as Row<
    'mexas_wallet_movements'
  >[]
  const contracts = await loadMexasContractsByIds(
    db,
    [
      ...rows.map((row) => row.contract_id),
      ...transferRows
        .map((row) => row.contract_id)
        .filter((id): id is string => typeof id === 'string'),
    ]
  )
  const contractsById = Object.fromEntries(
    contracts.map((contract) => [contract.id, contract])
  )

  const betChanges = rows.flatMap((row) => {
    const contract = contractsById[row.contract_id]
    if (!contract) return []

    const bet = convertBet(row) as LimitBet & MexasReservedOrderData
    if (isMexasTestUnwound(bet)) return []
    if (bet.limitProb === undefined || bet.orderAmount === undefined) return []
    if (!isInBalanceChangeWindow(bet.createdTime, props)) return []

    const amount = Math.abs(bet.orderAmount)
    if (amount <= 0) return []

    return [
      {
        key: `${bet.id}-open`,
        type: 'create_bet',
        amount: -amount,
        createdTime: bet.createdTime,
        bet: {
          outcome: bet.outcome,
          shares: bet.shares,
        },
        answer: undefined,
        contract: getProfileContractForBalanceChange(contract),
      } satisfies BetBalanceChange,
    ]
  })

  const treasuryChanges = transferRows
    .flatMap((row): MexasTreasuryBalanceChange[] => {
      const amount = Number(row.amount)
      if (!Number.isFinite(amount) || amount <= 0) return []

      const contract =
        typeof row.contract_id === 'string'
          ? contractsById[row.contract_id]
          : undefined
      const createdTime = tsToMillis(
        row.confirmed_time ?? row.submitted_time ?? row.updated_time
      )
      if (!isInBalanceChangeWindow(createdTime, props)) return []

      const transferType = row.transfer_type as
        | 'order-release'
        | 'resolution-payout'
        | 'resolution-cancel'
        | 'withdrawal'

      return [
        {
          key: `mexas-treasury-${row.id}`,
          type: 'mexas_treasury_transfer',
          amount: transferType === 'withdrawal' ? -amount : amount,
          createdTime,
          token: 'MEX',
          transferType,
          status: row.status as MexasTreasuryBalanceChange['status'],
          ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
          ...(contract
            ? { contract: getProfileContractForBalanceChange(contract) }
            : {}),
        } satisfies MexasTreasuryBalanceChange,
      ]
    })

  const walletChanges = walletMovementRows.flatMap(
    (row): MexasWalletBalanceChange[] => {
      const amount = Number(row.amount)
      if (!Number.isFinite(amount) || amount <= 0) return []

      const createdTime = tsToMillis(row.observed_time ?? row.created_time)
      if (!isInBalanceChangeWindow(createdTime, props)) return []

      const movementType = row.movement_type as 'deposit' | 'withdrawal'
      return [
        {
          key: `mexas-wallet-${row.id}`,
          type: 'mexas_wallet_movement',
          amount: movementType === 'withdrawal' ? -amount : amount,
          createdTime,
          token: 'MEX',
          movementType,
          walletAddress: row.wallet_address,
          previousWalletAmount: Number(row.previous_wallet_amount),
          newWalletAmount: Number(row.new_wallet_amount),
          openReservedAmount: Number(row.open_reserved_amount),
        } satisfies MexasWalletBalanceChange,
      ]
    }
  )

  return orderBy(
    [
      ...betChanges,
      ...treasuryChanges,
      ...walletChanges,
    ] satisfies AnyBalanceChangeType[],
    (change) => change.createdTime,
    'desc'
  )
}
