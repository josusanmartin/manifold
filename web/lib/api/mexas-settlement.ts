import { APIError } from 'common/api/utils'
import {
  canMexasMatchCrossingOrders,
  canMexasResolveFilledPositions,
  type MexasSettlementAudit,
  type MexasSettlementSettings,
} from 'common/mexas-settlement'

function getMexasSettlementSettings(): MexasSettlementSettings {
  return {
    allowUnescrowedMatching: process.env.MEXAS_ALLOW_UNESCROWED_MATCHING,
    allowUnescrowedResolution: process.env.MEXAS_ALLOW_UNESCROWED_RESOLUTION,
    matchingEngineMode: process.env.MEXAS_MATCHING_ENGINE_MODE,
    settlementMode: process.env.MEXAS_SETTLEMENT_MODE,
  }
}

export function assertMexasCanMatchCrossingOrders(hasCrossingOrders: boolean) {
  if (!hasCrossingOrders) return
  if (canMexasMatchCrossingOrders(getMexasSettlementSettings())) return

  throw new APIError(
    503,
    'El matching MEXAS requiere escrow on-chain y un motor transaccional. Puedes abrir ordenes limite, pero los cruces estan desactivados hasta configurar MEXAS_SETTLEMENT_MODE=escrow y MEXAS_MATCHING_ENGINE_MODE=transactional.'
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
