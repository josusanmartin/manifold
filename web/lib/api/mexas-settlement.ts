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
    'El matching MEXAS requiere escrow on-chain y un motor transaccional atomico. Puedes abrir ordenes limite, pero los cruces estan desactivados hasta implementar el motor de settlement.'
  )
}

export async function assertMexasCanAcceptLimitOrders(db: SupabaseClient) {
  if (canMexasAcceptLimitOrders(getMexasSettlementSettings())) {
    await assertMexasOrderbookMatchingEngineReady(db)
    return
  }

  throw new APIError(
    503,
    'Las ordenes MEXAS requieren el motor transaccional de libro de ordenes antes de reservar MEX.'
  )
}

export function assertMexasCanResolveFilledPositions(
  audit: MexasSettlementAudit
) {
  if (audit.filledBetCount === 0) return
  if (canMexasResolveFilledPositions(getMexasSettlementSettings())) return

  throw new APIError(
    503,
    `La resolucion MEXAS tiene ${audit.filledBetCount} posiciones llenadas y requiere escrow on-chain antes de pagar saldos internos. Configura MEXAS_SETTLEMENT_MODE=escrow cuando exista custodia real.`
  )
}
