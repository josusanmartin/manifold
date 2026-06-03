import { LimitBet } from './bet'
import {
  getMexasLimitOrderExpiresAt,
  getMexasOpenOrderAmount,
  getMexasCrossingOrders,
  hasValidMexasLimitOrderExpiration,
  matchMexasLimitOrder,
  sortMexasMakersForTaker,
} from './mexas-order-book'

function order(props: Partial<LimitBet> & Pick<LimitBet, 'id'>): LimitBet {
  return {
    id: props.id,
    userId: props.userId ?? `user-${props.id}`,
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
    orderAmount: props.orderAmount ?? 10,
    limitProb: props.limitProb ?? 0.5,
    isFilled: props.isFilled ?? false,
    isCancelled: props.isCancelled ?? false,
    fills: props.fills ?? [],
  }
}

describe('MEXAS order book matching', () => {
  test('sorts YES takers by lowest ask then oldest order', () => {
    const makers = [
      order({ id: 'new-70', outcome: 'NO', limitProb: 0.7, createdTime: 3 }),
      order({ id: 'old-70', outcome: 'NO', limitProb: 0.7, createdTime: 2 }),
      order({ id: 'ask-60', outcome: 'NO', limitProb: 0.6, createdTime: 4 }),
    ]

    expect(sortMexasMakersForTaker('YES', makers).map((o) => o.id)).toEqual([
      'ask-60',
      'old-70',
      'new-70',
    ])
  })

  test('sorts NO takers by highest bid then oldest order', () => {
    const makers = [
      order({ id: 'old-50', outcome: 'YES', limitProb: 0.5, createdTime: 2 }),
      order({ id: 'bid-60', outcome: 'YES', limitProb: 0.6, createdTime: 4 }),
      order({ id: 'new-50', outcome: 'YES', limitProb: 0.5, createdTime: 3 }),
    ]

    expect(sortMexasMakersForTaker('NO', makers).map((o) => o.id)).toEqual([
      'bid-60',
      'old-50',
      'new-50',
    ])
  })

  test('sorts exact timestamp ties by id', () => {
    const makers = [
      order({ id: 'b', outcome: 'NO', limitProb: 0.6, createdTime: 2 }),
      order({ id: 'a', outcome: 'NO', limitProb: 0.6, createdTime: 2 }),
    ]

    expect(sortMexasMakersForTaker('YES', makers).map((o) => o.id)).toEqual([
      'a',
      'b',
    ])
  })

  test('matches a YES order against crossing NO asks at maker price', () => {
    const maker = order({
      id: 'ask-70',
      outcome: 'NO',
      limitProb: 0.7,
      orderAmount: 3,
    })

    const result = matchMexasLimitOrder({
      amount: 7,
      limitProb: 0.8,
      makers: [maker],
      outcome: 'YES',
      takerBetId: 'taker',
      timestamp: 10,
    })

    expect(result.matches).toHaveLength(1)
    expect(result.takerAmount).toBe(7)
    expect(result.takerShares).toBe(10)
    expect(result.remainingAmount).toBe(0)
    expect(result.matches[0].makerAmount).toBe(3)
    expect(result.matches[0].updatedMaker.isFilled).toBe(true)
  })

  test('matches a NO order against crossing YES bids at maker price', () => {
    const maker = order({
      id: 'bid-70',
      outcome: 'YES',
      limitProb: 0.7,
      orderAmount: 7,
    })

    const result = matchMexasLimitOrder({
      amount: 3,
      limitProb: 0.6,
      makers: [maker],
      outcome: 'NO',
      takerBetId: 'taker',
      timestamp: 10,
    })

    expect(result.matches).toHaveLength(1)
    expect(result.takerAmount).toBe(3)
    expect(result.takerShares).toBe(10)
    expect(result.remainingAmount).toBe(0)
    expect(result.matches[0].makerAmount).toBe(7)
    expect(result.matches[0].updatedMaker.isFilled).toBe(true)
  })

  test('leaves unmatched amount open after partial fill', () => {
    const maker = order({
      id: 'small-ask',
      outcome: 'NO',
      limitProb: 0.5,
      orderAmount: 2,
    })

    const result = matchMexasLimitOrder({
      amount: 10,
      limitProb: 0.6,
      makers: [maker],
      outcome: 'YES',
      takerBetId: 'taker',
      timestamp: 10,
    })

    expect(result.takerAmount).toBe(2)
    expect(result.takerShares).toBe(4)
    expect(result.remainingAmount).toBe(8)
    expect(getMexasOpenOrderAmount(result.matches[0].updatedMaker)).toBe(0)
  })

  test('fills multiple equal-price makers by time before moving to newer orders', () => {
    const result = matchMexasLimitOrder({
      amount: 40,
      limitProb: 0.8,
      makers: [
        order({
          id: 'new-ask',
          outcome: 'NO',
          limitProb: 0.7,
          createdTime: 3,
          orderAmount: 3,
        }),
        order({
          id: 'old-ask',
          outcome: 'NO',
          limitProb: 0.7,
          createdTime: 2,
          orderAmount: 7,
        }),
        order({
          id: 'better-ask',
          outcome: 'NO',
          limitProb: 0.6,
          createdTime: 4,
          orderAmount: 6,
        }),
      ],
      outcome: 'YES',
      takerBetId: 'taker',
      timestamp: 10,
    })

    expect(result.matches.map((match) => match.maker.id)).toEqual([
      'better-ask',
      'old-ask',
      'new-ask',
    ])
    expect(result.matches.map((match) => match.makerAmount)).toEqual([6, 7, 3])
    expect(result.takerAmount).toBeCloseTo(32.33333333)
    expect(result.remainingAmount).toBeCloseTo(7.66666667)
  })

  test('conserves MEX stake on each fill across different prices', () => {
    const result = matchMexasLimitOrder({
      amount: 25,
      limitProb: 0.8,
      makers: [
        order({
          id: 'cheap-ask',
          outcome: 'NO',
          limitProb: 0.4,
          createdTime: 2,
          orderAmount: 6,
        }),
        order({
          id: 'mid-ask',
          outcome: 'NO',
          limitProb: 0.6,
          createdTime: 3,
          orderAmount: 8,
        }),
      ],
      outcome: 'YES',
      takerBetId: 'taker',
      timestamp: 10,
    })

    expect(result.matches).toHaveLength(2)
    for (const match of result.matches) {
      expect(match.takerAmount + match.makerAmount).toBeCloseTo(match.shares)
      expect(match.updatedMaker.amount).toBeCloseTo(
        (match.maker.amount ?? 0) + match.makerAmount
      )
      expect(match.updatedMaker.shares).toBeCloseTo(
        (match.maker.shares ?? 0) + match.shares
      )
    }
    expect(
      result.matches.reduce((total, match) => total + match.takerAmount, 0)
    ).toBeCloseTo(result.takerAmount)
    expect(result.takerAmount + result.remainingAmount).toBeCloseTo(25)
  })

  test('does not match non-crossing orders', () => {
    const result = matchMexasLimitOrder({
      amount: 5,
      limitProb: 0.4,
      makers: [
        order({
          id: 'ask-70',
          outcome: 'NO',
          limitProb: 0.7,
          orderAmount: 3,
        }),
      ],
      outcome: 'YES',
      takerBetId: 'taker',
      timestamp: 10,
    })

    expect(result.matches).toHaveLength(0)
    expect(result.takerAmount).toBe(0)
    expect(result.remainingAmount).toBe(5)
  })

  test('detects only open crossing MEXAS orders in price-time priority', () => {
    const makers = [
      order({
        id: 'filled-better-ask',
        outcome: 'NO',
        limitProb: 0.5,
        isFilled: true,
      }),
      order({
        id: 'cancelled-better-ask',
        outcome: 'NO',
        limitProb: 0.55,
        isCancelled: true,
      }),
      order({
        id: 'old-crossing-ask',
        outcome: 'NO',
        limitProb: 0.7,
        createdTime: 2,
      }),
      order({
        id: 'new-crossing-ask',
        outcome: 'NO',
        limitProb: 0.7,
        createdTime: 3,
      }),
      order({
        id: 'non-crossing-ask',
        outcome: 'NO',
        limitProb: 0.9,
      }),
      order({ id: 'same-side', outcome: 'YES', limitProb: 0.6 }),
    ]

    expect(
      getMexasCrossingOrders({
        limitProb: 0.8,
        makers,
        outcome: 'YES',
      }).map((o) => o.id)
    ).toEqual(['old-crossing-ask', 'new-crossing-ask'])
  })

  test('does not match the taker against their own opposite orders', () => {
    const result = matchMexasLimitOrder({
      amount: 10,
      limitProb: 0.8,
      makers: [
        order({
          id: 'own-ask',
          userId: 'trader-1',
          outcome: 'NO',
          limitProb: 0.7,
          orderAmount: 3,
        }),
        order({
          id: 'other-ask',
          userId: 'trader-2',
          outcome: 'NO',
          limitProb: 0.75,
          orderAmount: 1,
        }),
      ],
      outcome: 'YES',
      takerBetId: 'taker',
      takerUserId: 'trader-1',
      timestamp: 10,
    })

    expect(result.matches.map((match) => match.maker.id)).toEqual(['other-ask'])
    expect(result.takerAmount).toBe(3)
    expect(result.remainingAmount).toBe(7)
  })

  test('ignores escrowed makers while the current matcher only supports wallet-reserved orders', () => {
    const escrowedAsk = {
      ...order({
        id: 'escrowed-ask',
        userId: 'trader-2',
        outcome: 'NO',
        limitProb: 0.6,
        createdTime: 1,
        orderAmount: 2,
      }),
      mexasFundsReserved: true,
      mexasStakeEscrowed: true,
    } as LimitBet
    const walletAsk = order({
      id: 'wallet-ask',
      userId: 'trader-3',
      outcome: 'NO',
      limitProb: 0.7,
      createdTime: 2,
      orderAmount: 3,
    })

    expect(
      getMexasCrossingOrders({
        limitProb: 0.8,
        makers: [escrowedAsk, walletAsk],
        outcome: 'YES',
      }).map((o) => o.id)
    ).toEqual(['wallet-ask'])

    const result = matchMexasLimitOrder({
      amount: 10,
      limitProb: 0.8,
      makers: [escrowedAsk, walletAsk],
      outcome: 'YES',
      takerBetId: 'taker',
      timestamp: 10,
    })

    expect(result.matches.map((match) => match.maker.id)).toEqual([
      'wallet-ask',
    ])
    expect(result.takerAmount).toBe(7)
    expect(result.remainingAmount).toBe(3)
  })

  test('derives and validates order expiration times', () => {
    const now = 1_000

    expect(getMexasLimitOrderExpiresAt(now, {})).toBeUndefined()
    expect(getMexasLimitOrderExpiresAt(now, { expiresAt: 2_000 })).toBe(2_000)
    expect(getMexasLimitOrderExpiresAt(now, { expiresMillisAfter: 500 })).toBe(
      1_500
    )
    expect(hasValidMexasLimitOrderExpiration(now, undefined)).toBe(true)
    expect(hasValidMexasLimitOrderExpiration(now, 1_001)).toBe(true)
    expect(hasValidMexasLimitOrderExpiration(now, 1_000)).toBe(false)
    expect(hasValidMexasLimitOrderExpiration(now, 999)).toBe(false)
  })
})
