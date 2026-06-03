import { Bet, LimitBet } from './bet'
import {
  getMexasResolutionCreditEvents,
  getMexasOpenReservationRefund,
  getMexasResolutionPayout,
  getMexasResolutionPayoutsByUser,
  getMexasResolvedBetPayout,
} from './mexas-resolution'
import { type MexasReservedOrderData } from './mexas-market'

function filledBet(props: Partial<Bet> & Pick<Bet, 'id' | 'userId'>): Bet {
  return {
    id: props.id,
    userId: props.userId,
    contractId: props.contractId ?? 'contract',
    createdTime: props.createdTime ?? 1,
    amount: props.amount ?? 0,
    loanAmount: 0,
    outcome: props.outcome ?? 'YES',
    shares: props.shares ?? 0,
    probBefore: 0.5,
    probAfter: 0.5,
    fees: { creatorFee: 0, platformFee: 0, liquidityFee: 0 },
    isApi: false,
    isRedemption: false,
    isFilled: props.isFilled ?? true,
    isCancelled: props.isCancelled ?? false,
  } as Bet
}

function limitOrder(
  props: Partial<LimitBet & MexasReservedOrderData> &
    Pick<LimitBet, 'id' | 'userId'>
): LimitBet {
  return {
    ...filledBet({
      id: props.id,
      userId: props.userId,
      amount: props.amount ?? 0,
      outcome: props.outcome ?? 'YES',
      shares: props.shares ?? 0,
      isFilled: props.isFilled ?? false,
      isCancelled: props.isCancelled ?? false,
    }),
    orderAmount: props.orderAmount ?? 10,
    limitProb: props.limitProb ?? 0.5,
    fills: props.fills ?? [],
    mexasFundsReserved: props.mexasFundsReserved ?? true,
    mexasFundsReleased: props.mexasFundsReleased ?? false,
    mexasReservedAmount: props.mexasReservedAmount,
    mexasTestUnwound: props.mexasTestUnwound,
  } as LimitBet
}

describe('MEXAS resolution payouts', () => {
  test('pays winning shares on YES or NO resolution', () => {
    const yes = filledBet({
      id: 'yes',
      userId: 'u1',
      outcome: 'YES',
      amount: 4,
      shares: 12,
    })
    const no = filledBet({
      id: 'no',
      userId: 'u2',
      outcome: 'NO',
      amount: 7,
      shares: 9,
    })

    expect(getMexasResolvedBetPayout(yes, 'YES')).toBe(12)
    expect(getMexasResolvedBetPayout(no, 'YES')).toBe(0)
    expect(getMexasResolvedBetPayout(yes, 'NO')).toBe(0)
    expect(getMexasResolvedBetPayout(no, 'NO')).toBe(9)
  })

  test('cancel resolution returns spent filled amount', () => {
    expect(
      getMexasResolvedBetPayout(
        filledBet({
          id: 'yes',
          userId: 'u1',
          outcome: 'YES',
          amount: 6,
          shares: 20,
        }),
        'CANCEL'
      )
    ).toBe(6)
  })

  test('cancelled filled bets still settle filled exposure', () => {
    const cancelled = filledBet({
      id: 'cancelled-filled',
      userId: 'u1',
      outcome: 'YES',
      amount: 6,
      shares: 20,
      isCancelled: true,
    })

    expect(getMexasResolvedBetPayout(cancelled, 'YES')).toBe(20)
    expect(getMexasResolvedBetPayout(cancelled, 'NO')).toBe(0)
    expect(getMexasResolvedBetPayout(cancelled, 'CANCEL')).toBe(6)
    expect(getMexasResolutionPayout(cancelled, 'YES')).toBe(20)
    expect(getMexasResolutionCreditEvents([cancelled], 'YES')).toEqual([
      {
        amount: 20,
        betId: 'cancelled-filled',
        contractId: 'contract',
        creditKey: 'mexas-resolution:cancelled-filled:YES',
        outcome: 'YES',
        transferType: 'resolution-payout',
        userId: 'u1',
      },
    ])
  })

  test('refunds only remaining reserved amount on open orders', () => {
    expect(
      getMexasOpenReservationRefund(
        limitOrder({
          id: 'partial',
          userId: 'u1',
          amount: 3,
          orderAmount: 10,
        })
      )
    ).toBe(7)
    expect(
      getMexasOpenReservationRefund(
        limitOrder({
          id: 'released',
          userId: 'u1',
          amount: 3,
          orderAmount: 10,
          mexasFundsReleased: true,
        })
      )
    ).toBe(0)
    expect(
      getMexasOpenReservationRefund(
        limitOrder({
          id: 'cancelled-pending-release',
          userId: 'u1',
          amount: 3,
          orderAmount: 10,
          isCancelled: true,
          mexasFundsReleased: false,
        })
      )
    ).toBe(7)
  })

  test('settles cancelled partial orders without double-refunding released reserve', () => {
    const partial = limitOrder({
      id: 'cancelled-partial',
      userId: 'u1',
      amount: 2,
      shares: 4,
      orderAmount: 5,
      outcome: 'YES',
      isCancelled: true,
      mexasFundsReleased: true,
    })

    expect(getMexasOpenReservationRefund(partial)).toBe(0)
    expect(getMexasResolutionPayout(partial, 'YES')).toBe(4)
    expect(getMexasResolutionPayout(partial, 'NO')).toBe(0)
    expect(getMexasResolutionPayout(partial, 'CANCEL')).toBe(2)
    expect(getMexasResolutionCreditEvents([partial], 'YES')).toEqual([
      {
        amount: 4,
        betId: 'cancelled-partial',
        contractId: 'contract',
        creditKey: 'mexas-resolution:cancelled-partial:YES',
        outcome: 'YES',
        transferType: 'resolution-payout',
        userId: 'u1',
      },
    ])
  })

  test('does not pay manually unwound test exposure again', () => {
    const unwound = limitOrder({
      id: 'test-unwound',
      userId: 'u1',
      amount: 2,
      shares: 4,
      orderAmount: 5,
      outcome: 'YES',
      isCancelled: true,
      mexasFundsReleased: true,
      mexasTestUnwound: true,
    })

    expect(getMexasOpenReservationRefund(unwound)).toBe(0)
    expect(getMexasResolutionPayout(unwound, 'YES')).toBe(0)
    expect(getMexasResolutionPayout(unwound, 'CANCEL')).toBe(0)
    expect(getMexasResolutionCreditEvents([unwound], 'YES')).toEqual([])
  })

  test('combines open reservation refund and winning payout', () => {
    const bet = limitOrder({
      id: 'winner-open',
      userId: 'u1',
      outcome: 'YES',
      amount: 4,
      shares: 8,
      orderAmount: 10,
    })

    expect(getMexasResolutionPayout(bet, 'YES')).toBe(14)
    expect(getMexasResolutionPayout(bet, 'NO')).toBe(6)
  })

  test('aggregates payouts by user', () => {
    const payouts = getMexasResolutionPayoutsByUser(
      [
        filledBet({
          id: 'yes-filled',
          userId: 'u1',
          outcome: 'YES',
          amount: 3,
          shares: 7,
        }),
        limitOrder({
          id: 'yes-open',
          userId: 'u1',
          outcome: 'YES',
          amount: 1,
          shares: 2,
          orderAmount: 5,
        }),
        filledBet({
          id: 'no-loser',
          userId: 'u2',
          outcome: 'NO',
          amount: 9,
          shares: 11,
        }),
      ],
      'YES'
    )

    expect(Object.fromEntries(payouts)).toEqual({ u1: 13 })
  })

  test('emits separate idempotency events for reservation refunds and payouts', () => {
    const events = getMexasResolutionCreditEvents(
      [
        limitOrder({
          id: 'partial-open',
          userId: 'u1',
          outcome: 'YES',
          amount: 2,
          shares: 4,
          orderAmount: 5,
        }),
        filledBet({
          id: 'filled-loser',
          userId: 'u2',
          outcome: 'NO',
          amount: 3,
          shares: 8,
        }),
      ],
      'YES'
    )

    expect(events).toEqual([
      {
        amount: 3,
        betId: 'partial-open',
        contractId: 'contract',
        creditKey: 'mexas-order-release:partial-open',
        transferType: 'order-release',
        userId: 'u1',
      },
      {
        amount: 4,
        betId: 'partial-open',
        contractId: 'contract',
        creditKey: 'mexas-resolution:partial-open:YES',
        outcome: 'YES',
        transferType: 'resolution-payout',
        userId: 'u1',
      },
    ])
  })
})
