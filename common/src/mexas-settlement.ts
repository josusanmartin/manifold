import { Bet } from './bet'
import {
  getMexasOpenReservationRefund,
  getMexasResolvedBetPayout,
} from './mexas-resolution'

const EPSILON = 1e-9

export type MexasSettlementAudit = {
  filledBetCount: number
  filledStake: number
  openReservationRefund: number
  yesPayout: number
  noPayout: number
  cancelPayout: number
}

function roundAmount(value: number) {
  return Math.round(value * 1e8) / 1e8
}

export function hasMexasFilledExposure(bet: Bet) {
  return (bet.amount ?? 0) > EPSILON && (bet.shares ?? 0) > EPSILON
}

export function getMexasSettlementAudit(bets: Bet[]): MexasSettlementAudit {
  const audit: MexasSettlementAudit = {
    filledBetCount: 0,
    filledStake: 0,
    openReservationRefund: 0,
    yesPayout: 0,
    noPayout: 0,
    cancelPayout: 0,
  }

  for (const bet of bets) {
    audit.openReservationRefund += getMexasOpenReservationRefund(bet)

    if (!hasMexasFilledExposure(bet)) continue

    audit.filledBetCount += 1
    audit.filledStake += Math.max(0, bet.amount ?? 0)
    audit.yesPayout += getMexasResolvedBetPayout(bet, 'YES')
    audit.noPayout += getMexasResolvedBetPayout(bet, 'NO')
    audit.cancelPayout += getMexasResolvedBetPayout(bet, 'CANCEL')
  }

  return {
    filledBetCount: audit.filledBetCount,
    filledStake: roundAmount(audit.filledStake),
    openReservationRefund: roundAmount(audit.openReservationRefund),
    yesPayout: roundAmount(audit.yesPayout),
    noPayout: roundAmount(audit.noPayout),
    cancelPayout: roundAmount(audit.cancelPayout),
  }
}

export function hasMexasSettlementExposure(audit: MexasSettlementAudit) {
  return audit.filledBetCount > 0 || audit.openReservationRefund > EPSILON
}
