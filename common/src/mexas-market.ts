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
  amount?: number
  orderAmount?: number
  mexasReservedAmount?: number
  mexasFundsReserved?: boolean
  mexasFundsReleased?: boolean
}

export function getMexasRemainingReservedAmount(
  order: MexasReservedOrderData
) {
  const reservedAmount =
    typeof order.mexasReservedAmount === 'number'
      ? order.mexasReservedAmount
      : order.orderAmount ?? 0
  const filledAmount = order.amount ?? 0

  return Math.max(0, reservedAmount - filledAmount)
}
