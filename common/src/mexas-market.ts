type MexasOrderBookCandidate = {
  mechanism?: string
  outcomeType?: string
  takerAPIOrdersDisabled?: boolean
  token?: string
}

export function isMexasOrderBookOnlyContract(
  contract: MexasOrderBookCandidate
) {
  if (contract.takerAPIOrdersDisabled) return true

  return (
    contract.token !== 'CASH' &&
    contract.mechanism === 'cpmm-1' &&
    contract.outcomeType === 'BINARY'
  )
}

export type MexasReservedOrderData = {
  id?: string
  createdTime?: number
  amount?: number
  orderAmount?: number
  mexasReservedAmount?: number
  mexasFundsReserved?: boolean
  mexasFundsReleased?: boolean
}

export function getMexasRemainingReservedAmount(order: MexasReservedOrderData) {
  const reservedAmount =
    typeof order.mexasReservedAmount === 'number'
      ? order.mexasReservedAmount
      : order.orderAmount ?? 0
  const filledAmount = order.amount ?? 0

  return Math.max(0, reservedAmount - filledAmount)
}

export function getTotalMexasRemainingReservedAmount(
  orders: MexasReservedOrderData[]
) {
  return orders.reduce(
    (total, order) => total + getMexasRemainingReservedAmount(order),
    0
  )
}

export function getMexasAvailableBalance(params: {
  onChainAmount: number
  openReservedAmount: number
}) {
  return Math.max(
    0,
    Math.round((params.onChainAmount - params.openReservedAmount) * 1e8) / 1e8
  )
}

export function getUnbackedMexasOrderIds(
  orders: (MexasReservedOrderData & { id: string })[],
  backedAmount: number
) {
  const totalReserved = getTotalMexasRemainingReservedAmount(orders)
  let excess = totalReserved - Math.max(0, backedAmount)
  if (excess <= 1e-9) return []

  const newestFirst = [...orders]
    .filter((order) => getMexasRemainingReservedAmount(order) > 1e-9)
    .sort((a, b) => {
      const timeDiff = (b.createdTime ?? 0) - (a.createdTime ?? 0)
      if (timeDiff !== 0) return timeDiff
      return b.id.localeCompare(a.id)
    })

  const unbackedIds: string[] = []
  for (const order of newestFirst) {
    if (excess <= 1e-9) break

    unbackedIds.push(order.id)
    excess -= getMexasRemainingReservedAmount(order)
  }

  return unbackedIds
}
