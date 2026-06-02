import { APIError } from 'common/api/utils'
import { type MexasSettlementAudit } from 'common/mexas-settlement'

function isEscrowSettlementMode() {
  return process.env.MEXAS_SETTLEMENT_MODE === 'escrow'
}

function allowsUnescrowedMatching() {
  return process.env.MEXAS_ALLOW_UNESCROWED_MATCHING === 'true'
}

function allowsUnescrowedResolution() {
  return process.env.MEXAS_ALLOW_UNESCROWED_RESOLUTION === 'true'
}

export function assertMexasCanMatchCrossingOrders(hasCrossingOrders: boolean) {
  if (!hasCrossingOrders) return
  if (isEscrowSettlementMode() || allowsUnescrowedMatching()) return

  throw new APIError(
    503,
    'El matching MEXAS requiere escrow on-chain. Puedes abrir ordenes limite, pero los cruces estan desactivados hasta configurar MEXAS_SETTLEMENT_MODE=escrow.'
  )
}

export function assertMexasCanResolveFilledPositions(
  audit: MexasSettlementAudit
) {
  if (audit.filledBetCount === 0) return
  if (isEscrowSettlementMode() || allowsUnescrowedResolution()) return

  throw new APIError(
    503,
    `La resolucion MEXAS tiene ${audit.filledBetCount} posiciones llenadas y requiere escrow on-chain antes de pagar saldos internos. Configura MEXAS_SETTLEMENT_MODE=escrow cuando exista custodia real.`
  )
}
