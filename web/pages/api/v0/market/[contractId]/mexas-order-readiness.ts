import { APIError } from 'common/api/utils'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import {
  canMexasAcceptLimitOrders,
  type MexasSettlementSettings,
} from 'common/mexas-settlement'
import { convertContract } from 'common/supabase/contracts'
import {
  createClient,
  type Row,
  type SupabaseClient,
} from 'common/supabase/utils'
import type { NextApiRequest, NextApiResponse } from 'next'
import { assertMexasOrderbookMatchingEngineReady } from 'web/lib/api/mexas-rpc-matching'

type ErrorResponse = { message: string; details?: unknown }

type MexasOrderReadinessResponse = {
  canPlaceOrders: boolean
  matchingEngineReady: boolean
  message?: string
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

function getSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getMexasSettlementSettings(): MexasSettlementSettings {
  return {
    escrowImplementation: process.env.MEXAS_ESCROW_IMPLEMENTATION,
    matchingEngineMode: process.env.MEXAS_MATCHING_ENGINE_MODE,
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MexasOrderReadinessResponse | ErrorResponse>
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

    if (contract.closeTime && Date.now() >= contract.closeTime) {
      return res.status(200).json({
        canPlaceOrders: false,
        matchingEngineReady: false,
        message: 'El mercado esta cerrado.',
      })
    }
    if (contract.isResolved) {
      return res.status(200).json({
        canPlaceOrders: false,
        matchingEngineReady: false,
        message: 'El mercado ya esta resuelto.',
      })
    }

    if (!canMexasAcceptLimitOrders(getMexasSettlementSettings())) {
      return res.status(200).json({
        canPlaceOrders: false,
        matchingEngineReady: false,
        message:
          'Las ordenes MEXAS requieren escrow on-chain y el motor transaccional de libro de ordenes antes de reservar MEX.',
      })
    }

    try {
      await assertMexasOrderbookMatchingEngineReady(db)
    } catch (error) {
      return res.status(200).json({
        canPlaceOrders: false,
        matchingEngineReady: false,
        message:
          error instanceof Error
            ? error.message
            : 'No se pudo verificar el motor de ordenes MEXAS.',
      })
    }

    return res.status(200).json({
      canPlaceOrders: true,
      matchingEngineReady: true,
    })
  } catch (error) {
    console.error('MEXAS order readiness failed', error)

    if (error instanceof APIError) {
      return res.status(error.code).json({ message: error.message })
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Could not check MEXAS order readiness.'
    return res.status(500).json({ message })
  }
}
