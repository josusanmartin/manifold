import { Bet, LimitBet } from './bet'
import {
  canMexasMatchCrossingOrders,
  canMexasResolveFilledPositions,
  getMissingMexasEscrowCapabilities,
  getMexasSettlementAudit,
  hasOperationalMexasEscrow,
  hasMexasFilledExposure,
  hasMexasSettlementExposure,
  hasTransactionalMexasMatchingEngine,
  MEXAS_ONCHAIN_ESCROW_IMPLEMENTED,
} from './mexas-settlement'

function bet(props: Partial<Bet> & Pick<Bet, 'id' | 'userId'>): Bet {
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

function order(props: Partial<LimitBet> & Pick<LimitBet, 'id' | 'userId'>) {
  return {
    ...bet({
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
    mexasFundsReserved: true,
    mexasFundsReleased: false,
    mexasReservedAmount: props.orderAmount ?? 10,
  } as LimitBet
}

describe('MEXAS settlement audit', () => {
  test('detects filled exposure on partially and fully filled orders', () => {
    expect(
      hasMexasFilledExposure(
        order({ id: 'partial', userId: 'u1', amount: 2, shares: 4 })
      )
    ).toBe(true)
    expect(hasMexasFilledExposure(order({ id: 'open', userId: 'u1' }))).toBe(
      false
    )
  })

  test('audits a fully matched YES/NO pair without creating payout surplus', () => {
    const audit = getMexasSettlementAudit([
      bet({
        id: 'yes',
        userId: 'u1',
        amount: 7,
        outcome: 'YES',
        shares: 10,
      }),
      bet({
        id: 'no',
        userId: 'u2',
        amount: 3,
        outcome: 'NO',
        shares: 10,
      }),
    ])

    expect(audit).toEqual({
      filledBetCount: 2,
      filledStake: 10,
      openReservationRefund: 0,
      yesPayout: 10,
      noPayout: 10,
      cancelPayout: 10,
    })
  })

  test('separates filled exposure from remaining open reservation refunds', () => {
    const audit = getMexasSettlementAudit([
      order({
        id: 'partial-open',
        userId: 'u1',
        amount: 2,
        orderAmount: 5,
        outcome: 'YES',
        shares: 4,
      }),
    ])

    expect(audit).toEqual({
      filledBetCount: 1,
      filledStake: 2,
      openReservationRefund: 3,
      yesPayout: 4,
      noPayout: 0,
      cancelPayout: 2,
    })
    expect(hasMexasSettlementExposure(audit)).toBe(true)
  })

  test('reports no settlement exposure for an empty book', () => {
    const audit = getMexasSettlementAudit([])

    expect(audit).toEqual({
      filledBetCount: 0,
      filledStake: 0,
      openReservationRefund: 0,
      yesPayout: 0,
      noPayout: 0,
      cancelPayout: 0,
    })
    expect(hasMexasSettlementExposure(audit)).toBe(false)
  })

  test('enables live matching only for RPC plus operational escrow', () => {
    expect(canMexasMatchCrossingOrders({})).toBe(false)
    expect(
      canMexasMatchCrossingOrders({
        settlementMode: 'escrow',
      })
    ).toBe(false)
    expect(
      canMexasMatchCrossingOrders({
        matchingEngineMode: 'rpc',
      })
    ).toBe(false)
    expect(
      canMexasMatchCrossingOrders({
        settlementMode: 'escrow',
        matchingEngineMode: 'rpc',
      })
    ).toBe(false)
    expect(
      canMexasMatchCrossingOrders({
        escrowImplementation: 'onchain-transfer',
        settlementMode: 'escrow',
        matchingEngineMode: 'rpc',
      })
    ).toBe(false)
    expect(
      canMexasMatchCrossingOrders({
        allowUnescrowedMatching: 'true',
        matchingEngineMode: 'rpc',
      })
    ).toBe(false)
    expect(
      hasTransactionalMexasMatchingEngine({
        matchingEngineMode: 'rpc',
      })
    ).toBe(true)
    expect(
      hasOperationalMexasEscrow({
        escrowImplementation: 'onchain-transfer',
        settlementMode: 'escrow',
      })
    ).toBe(false)
    expect(MEXAS_ONCHAIN_ESCROW_IMPLEMENTED).toBe(false)
    expect(getMissingMexasEscrowCapabilities()).toEqual([
      'captureOrderStake',
      'releaseOpenOrderStake',
      'payoutResolvedPositions',
    ])
  })

  test('allows resolution only with operational escrow', () => {
    expect(canMexasResolveFilledPositions({})).toBe(false)
    expect(canMexasResolveFilledPositions({ settlementMode: 'escrow' })).toBe(
      false
    )
    expect(
      canMexasResolveFilledPositions({
        escrowImplementation: 'onchain-transfer',
        settlementMode: 'escrow',
      })
    ).toBe(false)
    expect(
      canMexasResolveFilledPositions({
        allowUnescrowedResolution: 'true',
      })
    ).toBe(false)
  })
})
