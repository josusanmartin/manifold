import { Bet, LimitBet } from './bet'
import { type MexasReservedOrderData } from './mexas-market'
import {
  canMexasMatchCrossingOrders,
  canMexasAcceptLimitOrders,
  canMexasResolveFilledPositions,
  getMissingMexasEscrowCapabilities,
  hasMexasEscrowSettlementExposure,
  getMexasSettlementAudit,
  hasOperationalMexasEscrow,
  hasMexasFilledExposure,
  hasMexasSettlementExposure,
  hasTransactionalMexasMatchingEngine,
  MEXAS_ONCHAIN_ESCROW_IMPLEMENTED,
} from './mexas-settlement'

function bet(
  props: Partial<Bet & MexasReservedOrderData> & Pick<Bet, 'id' | 'userId'>
): Bet {
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
    mexasTestUnwound: props.mexasTestUnwound,
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
    expect(
      hasMexasFilledExposure(
        order({
          id: 'cancelled-filled',
          userId: 'u1',
          amount: 2,
          shares: 4,
          isCancelled: true,
        })
      )
    ).toBe(true)
  })

  test('keeps cancelled filled bets in settlement exposure', () => {
    const audit = getMexasSettlementAudit([
      bet({
        id: 'cancelled-filled',
        userId: 'u1',
        amount: 6,
        outcome: 'YES',
        shares: 20,
        isCancelled: true,
      }),
    ])

    expect(audit).toEqual({
      cancelCredit: 6,
      escrowedOpenReservationRefund: 0,
      filledBetCount: 1,
      filledStake: 6,
      noCredit: 0,
      openReservationRefund: 0,
      walletOpenReservationRefund: 0,
      yesCredit: 20,
      yesPayout: 20,
      noPayout: 0,
      cancelPayout: 6,
    })
    expect(hasMexasSettlementExposure(audit)).toBe(true)
  })

  test('ignores manually unwound test exposure in settlement exposure', () => {
    const audit = getMexasSettlementAudit([
      bet({
        id: 'test-unwound',
        userId: 'u1',
        amount: 6,
        outcome: 'YES',
        shares: 20,
        isCancelled: true,
        mexasTestUnwound: true,
      }),
    ])

    expect(audit).toEqual({
      cancelCredit: 0,
      escrowedOpenReservationRefund: 0,
      filledBetCount: 0,
      filledStake: 0,
      noCredit: 0,
      openReservationRefund: 0,
      walletOpenReservationRefund: 0,
      yesCredit: 0,
      yesPayout: 0,
      noPayout: 0,
      cancelPayout: 0,
    })
    expect(hasMexasSettlementExposure(audit)).toBe(false)
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
      cancelCredit: 10,
      escrowedOpenReservationRefund: 0,
      filledBetCount: 2,
      filledStake: 10,
      noCredit: 10,
      openReservationRefund: 0,
      walletOpenReservationRefund: 0,
      yesCredit: 10,
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
      cancelCredit: 5,
      escrowedOpenReservationRefund: 0,
      filledBetCount: 1,
      filledStake: 2,
      noCredit: 3,
      openReservationRefund: 3,
      walletOpenReservationRefund: 3,
      yesCredit: 7,
      yesPayout: 4,
      noPayout: 0,
      cancelPayout: 2,
    })
    expect(hasMexasSettlementExposure(audit)).toBe(true)
  })

  test('reports no settlement exposure for an empty book', () => {
    const audit = getMexasSettlementAudit([])

    expect(audit).toEqual({
      cancelCredit: 0,
      escrowedOpenReservationRefund: 0,
      filledBetCount: 0,
      filledStake: 0,
      noCredit: 0,
      openReservationRefund: 0,
      walletOpenReservationRefund: 0,
      yesCredit: 0,
      yesPayout: 0,
      noPayout: 0,
      cancelPayout: 0,
    })
    expect(hasMexasSettlementExposure(audit)).toBe(false)
  })

  test('separates escrowed open refunds from wallet-reserved open refunds', () => {
    const audit = getMexasSettlementAudit([
      order({
        id: 'wallet-open',
        userId: 'u1',
        amount: 2,
        orderAmount: 5,
      }),
      {
        ...order({
          id: 'escrow-open',
          userId: 'u2',
          amount: 1,
          orderAmount: 4,
        }),
        mexasStakeEscrowed: true,
      } as LimitBet,
    ])

    expect(audit.openReservationRefund).toBe(6)
    expect(audit.walletOpenReservationRefund).toBe(3)
    expect(audit.escrowedOpenReservationRefund).toBe(3)
    expect(hasMexasEscrowSettlementExposure(audit)).toBe(true)
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
        enableEscrowCaptureOrders: 'true',
        escrowImplementation: 'onchain-transfer',
        settlementMode: 'escrow',
        matchingEngineMode: 'rpc',
      })
    ).toBe(true)
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
    expect(canMexasAcceptLimitOrders({})).toBe(true)
    expect(
      canMexasAcceptLimitOrders({
        matchingEngineMode: 'rpc',
      })
    ).toBe(true)
    expect(
      canMexasAcceptLimitOrders({
        escrowImplementation: 'onchain-transfer',
        matchingEngineMode: 'rpc',
        settlementMode: 'escrow',
      })
    ).toBe(true)
    expect(
      hasOperationalMexasEscrow({
        escrowImplementation: 'onchain-transfer',
        settlementMode: 'escrow',
      })
    ).toBe(true)
    expect(MEXAS_ONCHAIN_ESCROW_IMPLEMENTED).toBe(true)
    expect(getMissingMexasEscrowCapabilities()).toEqual([])
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
    ).toBe(true)
    expect(
      canMexasResolveFilledPositions({
        allowUnescrowedResolution: 'true',
      })
    ).toBe(false)
  })
})
