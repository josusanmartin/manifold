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

export function getMexasResolutionCreditEvents(
  bets: Bet[],
  outcome: resolution
) {
  return bets.flatMap((bet) => {
    const events: { userId: string; amount: number; creditKey: string }[] = []
    const reservationRefund = getMexasOpenReservationRefund(bet)
    const resolvedPayout = getMexasResolvedBetPayout(bet, outcome)

    if (reservationRefund > 0) {
      events.push({
        userId: bet.userId,
        amount: reservationRefund,
        creditKey: getMexasOrderReleaseCreditKey(bet.id),
      })
    }
    if (resolvedPayout > 0) {
      events.push({
        userId: bet.userId,
        amount: resolvedPayout,
        creditKey: getMexasBetResolutionCreditKey(bet.id, outcome),
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
