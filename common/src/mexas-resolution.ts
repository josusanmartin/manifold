import { Bet, LimitBet } from './bet'
import { resolution } from './contract'
import {
  getMexasRemainingReservedAmount,
  type MexasReservedOrderData,
} from './mexas-market'

export function getMexasResolvedBetPayout(bet: Bet, outcome: resolution) {
  if (bet.isCancelled) return 0
  if (outcome === 'CANCEL') return Math.max(0, bet.amount ?? 0)
  return bet.outcome === outcome ? Math.max(0, bet.shares ?? 0) : 0
}

export function getMexasOpenReservationRefund(bet: Bet) {
  if (bet.limitProb === undefined || bet.orderAmount === undefined) return 0

  const order = bet as LimitBet & MexasReservedOrderData
  if (order.mexasFundsReserved !== true || order.mexasFundsReleased === true) {
    return 0
  }

  return getMexasRemainingReservedAmount(order)
}

export function getMexasResolutionPayout(bet: Bet, outcome: resolution) {
  return (
    getMexasOpenReservationRefund(bet) + getMexasResolvedBetPayout(bet, outcome)
  )
}

export function getMexasOrderReleaseCreditKey(betId: string) {
  return `mexas-order-release:${betId}`
}

export function getMexasBetResolutionCreditKey(
  betId: string,
  outcome: resolution
) {
  return `mexas-resolution:${betId}:${outcome}`
}

export type MexasResolutionCreditEvent = {
  amount: number
  betId: string
  contractId: string
  creditKey: string
  outcome?: resolution
  transferType: 'order-release' | 'resolution-payout' | 'resolution-cancel'
  userId: string
}

export function getMexasResolutionCreditEvents(
  bets: Bet[],
  outcome: resolution
) {
  return bets.flatMap((bet) => {
    const events: MexasResolutionCreditEvent[] = []
    const reservationRefund = getMexasOpenReservationRefund(bet)
    const resolvedPayout = getMexasResolvedBetPayout(bet, outcome)

    if (reservationRefund > 0) {
      events.push({
        amount: reservationRefund,
        betId: bet.id,
        contractId: bet.contractId,
        creditKey: getMexasOrderReleaseCreditKey(bet.id),
        transferType: 'order-release',
        userId: bet.userId,
      })
    }
    if (resolvedPayout > 0) {
      events.push({
        amount: resolvedPayout,
        betId: bet.id,
        contractId: bet.contractId,
        creditKey: getMexasBetResolutionCreditKey(bet.id, outcome),
        outcome,
        transferType:
          outcome === 'CANCEL' ? 'resolution-cancel' : 'resolution-payout',
        userId: bet.userId,
      })
    }

    return events
  })
}

export function getMexasResolutionPayoutsByUser(
  bets: Bet[],
  outcome: resolution
) {
  const payoutsByUser = new Map<string, number>()

  for (const bet of bets) {
    const payout = getMexasResolutionPayout(bet, outcome)
    if (payout > 0) {
      payoutsByUser.set(
        bet.userId,
        (payoutsByUser.get(bet.userId) ?? 0) + payout
      )
    }
  }

  return payoutsByUser
}
