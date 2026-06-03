import { APIError } from 'common/api/utils'
import {
  canMexasAcceptLimitOrders,
  canMexasMatchCrossingOrders,
  canMexasResolveFilledPositions,
  hasOperationalMexasEscrow,
  type MexasSettlementAudit,
  type MexasSettlementSettings,
} from 'common/mexas-settlement'
import type { SupabaseClient } from 'common/supabase/utils'
import { assertMexasOrderbookMatchingEngineReady } from './mexas-rpc-matching'
import { assertMexasEscrowCaptureReady } from './mexas-escrow-capture'
import { assertMexasTreasuryTransferRuntimeReady } from './mexas-treasury-transfer'

function getMexasSettlementSettings(): MexasSettlementSettings {
  return {
    allowUnescrowedMatching: process.env.MEXAS_ALLOW_UNESCROWED_MATCHING,
    allowUnescrowedResolution: process.env.MEXAS_ALLOW_UNESCROWED_RESOLUTION,
    enableEscrowCaptureOrders: process.env.MEXAS_ENABLE_ESCROW_CAPTURE_ORDERS,
    escrowImplementation: process.env.MEXAS_ESCROW_IMPLEMENTATION,
    matchingEngineMode: process.env.MEXAS_MATCHING_ENGINE_MODE,
    settlementMode: process.env.MEXAS_SETTLEMENT_MODE,
  }
}

function formatReadinessMessage(error: unknown) {
  if (error instanceof APIError) return error.message
  if (error instanceof Error) return error.message
  return 'La liquidación on-chain MEXAS no está lista.'
}

export async function getMexasEscrowRuntimeStatus(db: SupabaseClient): Promise<{
  enabled: boolean
  message?: string
}> {
  const settings = getMexasSettlementSettings()
  if (
    process.env.MEXAS_ENABLE_ESCROW_CAPTURE_ORDERS !== 'true' ||
    !hasOperationalMexasEscrow(settings) ||
    !canMexasMatchCrossingOrders(settings)
  ) {
    return {
      enabled: false,
      message:
        'Puedes abrir órdenes límite que agreguen liquidez. Las órdenes que cruzan el libro están pausadas hasta completar la liquidación MEXAS.',
    }
  }

  try {
    await assertMexasOrderbookMatchingEngineReady(db)
    await assertMexasEscrowCaptureReady(db)
    await assertMexasTreasuryTransferRuntimeReady(db)
    return { enabled: true }
  } catch (error) {
    return {
      enabled: false,
      message: formatReadinessMessage(error),
    }
  }
}

export async function assertMexasCanMatchCrossingOrders(
  db: SupabaseClient,
  hasCrossingOrders: boolean
) {
  if (!hasCrossingOrders) return
  const escrowRuntime = await getMexasEscrowRuntimeStatus(db)
  if (escrowRuntime.enabled) return

  throw new APIError(
    503,
    escrowRuntime.message ??
      'Las órdenes que cruzan el libro están pausadas mientras se completa la liquidación MEXAS. No se ejecutará ni reservará MEX nuevo.'
  )
}

export async function assertMexasCanAcceptLimitOrders(_db: SupabaseClient) {
  if (canMexasAcceptLimitOrders(getMexasSettlementSettings())) {
    return
  }

  throw new APIError(503, 'No se pueden abrir órdenes MEXAS en este momento.')
}

export async function assertMexasCanResolveFilledPositions(
  db: SupabaseClient,
  audit: MexasSettlementAudit
) {
  if (audit.filledBetCount === 0) return
  if (canMexasResolveFilledPositions(getMexasSettlementSettings())) {
    const escrowRuntime = await getMexasEscrowRuntimeStatus(db)
    if (escrowRuntime.enabled) return
  }

  throw new APIError(
    503,
    `La resolución MEXAS tiene ${audit.filledBetCount} posiciones llenadas y queda pausada hasta completar la liquidación segura.`
  )
}
