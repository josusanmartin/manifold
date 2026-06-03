import { APIError } from 'common/api/utils'
import { Bet } from 'common/bet'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import {
  canMexasResolveFilledPositions,
  getMexasSettlementAudit,
  type MexasSettlementSettings,
} from 'common/mexas-settlement'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import {
  createClient,
  type Row,
  type SupabaseClient,
} from 'common/supabase/utils'
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  releaseClosedMexasMarketOrders,
  releaseExpiredMexasOrders,
  releaseUnbackedMexasOrders,
} from 'web/lib/api/mexas-orders'

type ErrorResponse = { message: string; details?: unknown }

type MexasResolutionReadinessResponse = {
  canResolve: boolean
  requiresEscrow: boolean
  filledBetCount: number
  filledStake: number
  openReservationRefund: number
  yesPayout: number
  noPayout: number
  cancelPayout: number
  message?: string
}

const CONTRACT_BETS_PAGE_SIZE = 1000

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

function getSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getMexasSettlementSettings(): MexasSettlementSettings {
  return {
    allowUnescrowedResolution: process.env.MEXAS_ALLOW_UNESCROWED_RESOLUTION,
    escrowImplementation: process.env.MEXAS_ESCROW_IMPLEMENTATION,
    settlementMode: process.env.MEXAS_SETTLEMENT_MODE,
  }
}

async function loadContractRow(db: SupabaseClient, contractId: string) {
  const { data, error } = await db
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new APIError(404, 'Contract not found.')
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

  return rows.map((row) => convertBet(row) as Bet)
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MexasResolutionReadinessResponse | ErrorResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    const contractId = getSingleQueryValue(req.query.contractId)
    if (!contractId) throw new APIError(400, 'Missing contractId.')

    const db = getSupabaseAdminClient()
    const row = await loadContractRow(db, contractId)
    const contract = convertContract(row)
    if (!isMexasOrderBookOnlyContract(contract)) {
      throw new APIError(404, 'Market is not available on MEXAS.')
    }

    await releaseClosedMexasMarketOrders(db, { contractId })
    await releaseExpiredMexasOrders(db, { contractId })
    await releaseUnbackedMexasOrders(db, {
      contractId,
      requireBalanceRead: true,
    })
    const audit = getMexasSettlementAudit(
      await loadContractBets(db, contractId)
    )
    const canResolve =
      audit.filledBetCount === 0 ||
      canMexasResolveFilledPositions(getMexasSettlementSettings())
    const requiresEscrow = !canResolve && audit.filledBetCount > 0

    return res.status(200).json({
      canResolve,
      requiresEscrow,
      filledBetCount: audit.filledBetCount,
      filledStake: audit.filledStake,
      openReservationRefund: audit.openReservationRefund,
      yesPayout: audit.yesPayout,
      noPayout: audit.noPayout,
      cancelPayout: audit.cancelPayout,
      message: requiresEscrow
        ? `La resolución MEXAS tiene ${audit.filledBetCount} posiciones llenadas y queda pausada hasta completar la liquidación segura.`
        : undefined,
    })
  } catch (error) {
    console.error('MEXAS resolution readiness failed', error)

    if (error instanceof APIError) {
      return res.status(error.code).json({ message: error.message })
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Could not check MEXAS resolution readiness.'
    return res.status(500).json({ message })
  }
}
