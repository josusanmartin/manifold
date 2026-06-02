import { LimitBet } from './bet'
import {
  getMexasOpenOrderAmount,
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
})
