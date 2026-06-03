import { Bet } from './bet'
import {
  getMexasOpenReservationRefund,
  getMexasResolvedBetPayout,
} from './mexas-resolution'

const EPSILON = 1e-9

export type MexasEscrowCapability =
  | 'captureOrderStake'
  | 'releaseOpenOrderStake'
  | 'payoutResolvedPositions'

export const MEXAS_ONCHAIN_ESCROW_CAPABILITIES: Record<
  MexasEscrowCapability,
  boolean
> = {
  captureOrderStake: false,
  releaseOpenOrderStake: false,
  payoutResolvedPositions: false,
}

export const MEXAS_ONCHAIN_ESCROW_IMPLEMENTED = Object.values(
  MEXAS_ONCHAIN_ESCROW_CAPABILITIES
).every(Boolean)

export type MexasSettlementAudit = {
  cancelCredit: number
  filledBetCount: number
  filledStake: number
  noCredit: number
  openReservationRefund: number
  yesCredit: number
  yesPayout: number
  noPayout: number
  cancelPayout: number
}

export type MexasSettlementSettings = {
  allowUnescrowedMatching?: string
  allowUnescrowedResolution?: string
  escrowImplementation?: string
  matchingEngineMode?: string
  settlementMode?: string
}

function roundAmount(value: number) {
  return Math.round(value * 1e8) / 1e8
}

export function hasMexasFilledExposure(bet: Bet) {
  return (
    !bet.isCancelled &&
    (bet.amount ?? 0) > EPSILON &&
    (bet.shares ?? 0) > EPSILON
  )
}

export function getMexasSettlementAudit(bets: Bet[]): MexasSettlementAudit {
  const audit: MexasSettlementAudit = {
    cancelCredit: 0,
    filledBetCount: 0,
    filledStake: 0,
    noCredit: 0,
    openReservationRefund: 0,
    yesCredit: 0,
    yesPayout: 0,
    noPayout: 0,
    cancelPayout: 0,
  }

  for (const bet of bets) {
    const openReservationRefund = getMexasOpenReservationRefund(bet)
    audit.openReservationRefund += openReservationRefund

    if (!hasMexasFilledExposure(bet)) continue

    audit.filledBetCount += 1
    audit.filledStake += Math.max(0, bet.amount ?? 0)
    audit.yesPayout += getMexasResolvedBetPayout(bet, 'YES')
    audit.noPayout += getMexasResolvedBetPayout(bet, 'NO')
    audit.cancelPayout += getMexasResolvedBetPayout(bet, 'CANCEL')
  }

  audit.yesCredit = audit.openReservationRefund + audit.yesPayout
  audit.noCredit = audit.openReservationRefund + audit.noPayout
  audit.cancelCredit = audit.openReservationRefund + audit.cancelPayout

  return {
    cancelCredit: roundAmount(audit.cancelCredit),
    filledBetCount: audit.filledBetCount,
    filledStake: roundAmount(audit.filledStake),
    noCredit: roundAmount(audit.noCredit),
    openReservationRefund: roundAmount(audit.openReservationRefund),
    yesCredit: roundAmount(audit.yesCredit),
    yesPayout: roundAmount(audit.yesPayout),
    noPayout: roundAmount(audit.noPayout),
    cancelPayout: roundAmount(audit.cancelPayout),
  }
}

export function hasMexasSettlementExposure(audit: MexasSettlementAudit) {
  return audit.filledBetCount > 0 || audit.openReservationRefund > EPSILON
}

export function hasTransactionalMexasMatchingEngine(
  settings: MexasSettlementSettings
) {
  // Only the Supabase RPC path updates maker and taker rows inside one
  // transaction. The TypeScript matcher remains a deterministic simulator.
  return settings.matchingEngineMode === 'rpc'
}

export function hasOperationalMexasEscrow(settings: MexasSettlementSettings) {
  return (
    MEXAS_ONCHAIN_ESCROW_IMPLEMENTED &&
    settings.settlementMode === 'escrow' &&
    settings.escrowImplementation === 'onchain-transfer'
  )
}

export function canMexasAcceptLimitOrders(_settings: MexasSettlementSettings) {
  // Resting limit orders can be reserved and later released/cancelled without
  // settling a filled trade. Crossing orders are gated separately.
  return true
}

export function getMissingMexasEscrowCapabilities() {
  return Object.entries(MEXAS_ONCHAIN_ESCROW_CAPABILITIES)
    .filter(([, implemented]) => !implemented)
    .map(([capability]) => capability as MexasEscrowCapability)
}

export function canMexasMatchCrossingOrders(settings: MexasSettlementSettings) {
  return (
    hasTransactionalMexasMatchingEngine(settings) &&
    hasOperationalMexasEscrow(settings)
  )
}

export function canMexasResolveFilledPositions(
  settings: MexasSettlementSettings
) {
  return hasOperationalMexasEscrow(settings)
}
