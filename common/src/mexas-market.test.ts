import {
  getMexasAvailableBalance,
  getMexasSyncedAvailableBalance,
  hasActiveMexasReservation,
  hasActiveMexasWalletReservation,
  hasMexasEscrowCaptureMetadata,
  hasMexasEscrowedStake,
  isMexasTestUnwound,
  isMexasOrderBookOnlyContract,
  getTotalMexasRemainingReservedAmount,
  getUnbackedMexasOrderIds,
  wasMexasStakeEscrowed,
  type MexasReservedOrderData,
} from './mexas-market'

function order(
  props: MexasReservedOrderData & { id: string }
): MexasReservedOrderData & { id: string } {
  return {
    amount: 0,
    mexasFundsReserved: true,
    mexasFundsReleased: false,
    orderAmount: 10,
    ...props,
  }
}

describe('MEXAS reserved order backing', () => {
  test('identifies only MEX binary CPMM contracts', () => {
    expect(
      isMexasOrderBookOnlyContract({
        token: 'MEX',
        mechanism: 'cpmm-1',
        outcomeType: 'BINARY',
      })
    ).toBe(true)
    expect(
      isMexasOrderBookOnlyContract({
        token: 'MANA',
        mechanism: 'cpmm-1',
        outcomeType: 'BINARY',
      })
    ).toBe(false)
    expect(
      isMexasOrderBookOnlyContract({
        token: 'MANA',
        mechanism: 'cpmm-1',
        outcomeType: 'BINARY',
        takerAPIOrdersDisabled: true,
      })
    ).toBe(false)
    expect(
      isMexasOrderBookOnlyContract({
        token: 'MEX',
        mechanism: 'cpmm-1',
        outcomeType: 'BINARY',
        takerAPIOrdersDisabled: true,
      })
    ).toBe(true)
  })

  test('sums remaining reserved amount across open orders', () => {
    expect(
      getTotalMexasRemainingReservedAmount([
        order({ id: 'a', orderAmount: 10, amount: 3 }),
        order({ id: 'b', orderAmount: 5, amount: 0 }),
        order({ id: 'c', mexasReservedAmount: 8, amount: 2 }),
      ])
    ).toBe(18)
  })

  test('ignores released or unreserved orders when summing active reservations', () => {
    const active = order({ id: 'active', orderAmount: 10, amount: 3 })
    const released = order({
      id: 'released',
      orderAmount: 10,
      amount: 0,
      mexasFundsReleased: true,
    })
    const unreserved = order({
      id: 'unreserved',
      orderAmount: 10,
      amount: 0,
      mexasFundsReserved: false,
    })

    expect(hasActiveMexasReservation(active)).toBe(true)
    expect(hasActiveMexasReservation(released)).toBe(false)
    expect(hasActiveMexasReservation(unreserved)).toBe(false)
    expect(
      getTotalMexasRemainingReservedAmount([active, released, unreserved])
    ).toBe(7)
    expect(getUnbackedMexasOrderIds([active, released, unreserved], 0)).toEqual(
      ['active']
    )
  })

  test('excludes escrowed stake from wallet reservation backing', () => {
    const walletReserved = order({
      id: 'wallet-reserved',
      orderAmount: 10,
      amount: 3,
    })
    const escrowed = order({
      id: 'escrowed',
      orderAmount: 10,
      amount: 3,
      mexasStakeEscrowed: true,
      mexasEscrowTxHash:
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mexasEscrowPayerAddress: '0x1111111111111111111111111111111111111111',
      mexasEscrowTreasuryAddress: '0x2222222222222222222222222222222222222222',
      mexasEscrowAmount: 10,
    })

    expect(hasActiveMexasReservation(escrowed)).toBe(true)
    expect(hasActiveMexasWalletReservation(walletReserved)).toBe(true)
    expect(hasActiveMexasWalletReservation(escrowed)).toBe(false)
    expect(wasMexasStakeEscrowed(escrowed)).toBe(true)
    expect(hasMexasEscrowedStake(escrowed)).toBe(true)
    expect(hasMexasEscrowCaptureMetadata(escrowed)).toBe(true)
    expect(
      getTotalMexasRemainingReservedAmount([walletReserved, escrowed])
    ).toBe(7)
    expect(getUnbackedMexasOrderIds([walletReserved, escrowed], 0)).toEqual([
      'wallet-reserved',
    ])
    expect(
      hasMexasEscrowCaptureMetadata({
        ...escrowed,
        mexasEscrowTxHash: undefined,
      })
    ).toBe(false)
  })

  test('keeps escrow capture metadata after the open reservation is released', () => {
    const releasedEscrowed = order({
      id: 'released-escrowed',
      orderAmount: 10,
      amount: 3,
      mexasFundsReleased: true,
      mexasStakeEscrowed: true,
      mexasEscrowTxHash:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mexasEscrowPayerAddress: '0x1111111111111111111111111111111111111111',
      mexasEscrowTreasuryAddress: '0x2222222222222222222222222222222222222222',
      mexasEscrowAmount: 10,
    })

    expect(hasActiveMexasReservation(releasedEscrowed)).toBe(false)
    expect(hasMexasEscrowedStake(releasedEscrowed)).toBe(false)
    expect(wasMexasStakeEscrowed(releasedEscrowed)).toBe(true)
    expect(hasMexasEscrowCaptureMetadata(releasedEscrowed)).toBe(true)
    expect(isMexasTestUnwound(releasedEscrowed)).toBe(false)
  })

  test('marks manually unwound test exposure separately from cancellation', () => {
    expect(
      isMexasTestUnwound(
        order({
          id: 'test-unwound',
          amount: 1,
          mexasTestUnwound: true,
        })
      )
    ).toBe(true)
  })

  test('does not cancel orders when on-chain backing covers reserves', () => {
    const orders = [
      order({ id: 'old', createdTime: 1, orderAmount: 8 }),
      order({ id: 'new', createdTime: 2, orderAmount: 2 }),
    ]

    expect(getUnbackedMexasOrderIds(orders, 10)).toEqual([])
    expect(getUnbackedMexasOrderIds(orders, 11)).toEqual([])
  })

  test('selects newest orders first until remaining reserves are backed', () => {
    const orders = [
      order({ id: 'old', createdTime: 1, orderAmount: 8 }),
      order({ id: 'newer', createdTime: 3, orderAmount: 2 }),
      order({ id: 'newest', createdTime: 4, orderAmount: 4 }),
    ]

    expect(getUnbackedMexasOrderIds(orders, 10)).toEqual(['newest'])
    expect(getUnbackedMexasOrderIds(orders, 8)).toEqual(['newest', 'newer'])
    expect(getUnbackedMexasOrderIds(orders, 7)).toEqual([
      'newest',
      'newer',
      'old',
    ])
  })

  test('breaks equal-time cancellation ties by id deterministically', () => {
    const orders = [
      order({ id: 'a', createdTime: 1, orderAmount: 4 }),
      order({ id: 'b', createdTime: 1, orderAmount: 4 }),
    ]

    expect(getUnbackedMexasOrderIds(orders, 4)).toEqual(['b'])
  })

  test('derives available balance from on-chain MEX minus open reservations', () => {
    expect(
      getMexasAvailableBalance({
        onChainAmount: 9,
        openReservedAmount: 5,
      })
    ).toBe(4)
    expect(
      getMexasAvailableBalance({
        onChainAmount: 4,
        openReservedAmount: 5,
      })
    ).toBe(0)
    expect(
      getMexasAvailableBalance({
        onChainAmount: 10.123456789,
        openReservedAmount: 0.000000004,
      })
    ).toBe(10.12345679)
  })

  test('syncs wallet balance incrementally without restoring spent filled stake', () => {
    expect(
      getMexasSyncedAvailableBalance({
        currentBalance: 0,
        onChainAmount: 10,
        onChainDeltaAmount: 0,
        openReservedAmount: 0,
      })
    ).toBe(0)
    expect(
      getMexasSyncedAvailableBalance({
        currentBalance: 0,
        onChainAmount: 15,
        onChainDeltaAmount: 5,
        openReservedAmount: 0,
      })
    ).toBe(5)
    expect(
      getMexasSyncedAvailableBalance({
        currentBalance: 10,
        onChainAmount: 8,
        onChainDeltaAmount: -2,
        openReservedAmount: 0,
      })
    ).toBe(8)
  })

  test('caps synced wallet balance by on-chain backing after open reservations', () => {
    expect(
      getMexasSyncedAvailableBalance({
        currentBalance: 20,
        onChainAmount: 12,
        onChainDeltaAmount: 0,
        openReservedAmount: 5,
      })
    ).toBe(7)
  })
})
