import { APIError } from 'common/api/utils'
import {
  canMexasAcceptLimitOrders,
  canMexasMatchCrossingOrders,
  canMexasResolveFilledPositions,
  type MexasSettlementAudit,
  type MexasSettlementSettings,
} from 'common/mexas-settlement'
import type { SupabaseClient } from 'common/supabase/utils'
import { assertMexasOrderbookMatchingEngineReady } from './mexas-rpc-matching'

function getMexasSettlementSettings(): MexasSettlementSettings {
  return {
    allowUnescrowedMatching: process.env.MEXAS_ALLOW_UNESCROWED_MATCHING,
    allowUnescrowedResolution: process.env.MEXAS_ALLOW_UNESCROWED_RESOLUTION,
    escrowImplementation: process.env.MEXAS_ESCROW_IMPLEMENTATION,
    matchingEngineMode: process.env.MEXAS_MATCHING_ENGINE_MODE,
    settlementMode: process.env.MEXAS_SETTLEMENT_MODE,
  }
}

export async function assertMexasCanMatchCrossingOrders(
  db: SupabaseClient,
  hasCrossingOrders: boolean
) {
  if (!hasCrossingOrders) return
  if (canMexasMatchCrossingOrders(getMexasSettlementSettings())) {
    await assertMexasOrderbookMatchingEngineReady(db)
    return
  }

  throw new APIError(
    503,
    'Las órdenes que cruzan el libro están pausadas mientras se completa la liquidación MEXAS. No se ejecutará ni reservará MEX nuevo.'
  )
}

export async function assertMexasCanAcceptLimitOrders(_db: SupabaseClient) {
  if (canMexasAcceptLimitOrders(getMexasSettlementSettings())) {
    return
  }

  throw new APIError(
    503,
    'No se pueden abrir órdenes MEXAS en este momento.'
  )
}

export function assertMexasCanResolveFilledPositions(
  audit: MexasSettlementAudit
) {
  if (audit.filledBetCount === 0) return
  if (canMexasResolveFilledPositions(getMexasSettlementSettings())) return

  throw new APIError(
    503,
    `La resolución MEXAS tiene ${audit.filledBetCount} posiciones llenadas y queda pausada hasta completar la liquidación segura.`
  )
}
