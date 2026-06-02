import {
  getMexasAvailableBalance,
  getTotalMexasRemainingReservedAmount,
  getUnbackedMexasOrderIds,
  type MexasReservedOrderData,
} from './mexas-market'

function order(
  props: MexasReservedOrderData & { id: string }
): MexasReservedOrderData & { id: string } {
  return {
    amount: 0,
    orderAmount: 10,
    ...props,
  }
}

describe('MEXAS reserved order backing', () => {
  test('sums remaining reserved amount across open orders', () => {
    expect(
      getTotalMexasRemainingReservedAmount([
        order({ id: 'a', orderAmount: 10, amount: 3 }),
        order({ id: 'b', orderAmount: 5, amount: 0 }),
        order({ id: 'c', mexasReservedAmount: 8, amount: 2 }),
      ])
    ).toBe(18)
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
})
