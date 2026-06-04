type MexasOrderBookCandidate = {
  mechanism?: string
  outcomeType?: string
  takerAPIOrdersDisabled?: boolean
  token?: string
}

export function isMexasOrderBookOnlyContract(
  contract: MexasOrderBookCandidate
) {
  return (
    contract.token === 'MEX' &&
    contract.mechanism === 'cpmm-1' &&
    contract.outcomeType === 'BINARY'
  )
}

export type MexasReservedOrderData = {
  id?: string
  createdTime?: number
  amount?: number
  orderAmount?: number
  isCancelled?: boolean
  isFilled?: boolean
  isRedemption?: boolean
  mexasReservedAmount?: number
  mexasFundsReserved?: boolean
  mexasFundsReleased?: boolean
  mexasReleaseCreditAmount?: number
  mexasReleaseCreditKey?: string
  mexasReleaseReason?: string
  mexasReleasedAt?: number
  mexasStakeEscrowed?: boolean
  mexasEscrowTxHash?: string
  mexasEscrowPayerAddress?: string
  mexasEscrowTreasuryAddress?: string
  mexasEscrowAmount?: number
  mexasTreasuryReleaseTransferId?: string
  mexasTreasuryReleaseTxHash?: string
  mexasTestUnwound?: boolean
}

export function hasActiveMexasReservation(order: MexasReservedOrderData) {
  return order.mexasFundsReserved === true && order.mexasFundsReleased !== true
}

export function hasInactiveMexasOrderDataFlags(
  order: Pick<
    MexasReservedOrderData,
    'isCancelled' | 'isFilled' | 'isRedemption'
  >
) {
  return (
    order.isCancelled === true ||
    order.isFilled === true ||
    order.isRedemption === true
  )
}

export function hasActiveMexasWalletReservation(order: MexasReservedOrderData) {
  return hasActiveMexasReservation(order) && order.mexasStakeEscrowed !== true
}

export function wasMexasStakeEscrowed(order: MexasReservedOrderData) {
  return order.mexasStakeEscrowed === true
}

export function isMexasTestUnwound(order: MexasReservedOrderData) {
  return order.mexasTestUnwound === true
}

export function hasMexasEscrowedStake(order: MexasReservedOrderData) {
  return hasActiveMexasReservation(order) && wasMexasStakeEscrowed(order)
}

export function hasMexasEscrowCaptureMetadata(order: MexasReservedOrderData) {
  return (
    wasMexasStakeEscrowed(order) &&
    typeof order.mexasEscrowTxHash === 'string' &&
    typeof order.mexasEscrowPayerAddress === 'string' &&
    typeof order.mexasEscrowTreasuryAddress === 'string'
  )
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
    (total, order) =>
      total +
      (hasActiveMexasWalletReservation(order)
        ? getMexasRemainingReservedAmount(order)
        : 0),
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

function roundMexasAmount(amount: number) {
  return Math.round(amount * 1e8) / 1e8
}

export function getMexasSyncedAvailableBalance(params: {
  currentBalance: number
  onChainAmount: number
  onChainDeltaAmount: number
  openReservedAmount: number
}) {
  const ledgerAvailableAmount = Math.max(
    0,
    roundMexasAmount(params.currentBalance + params.onChainDeltaAmount)
  )
  const backedAvailableAmount = getMexasAvailableBalance({
    onChainAmount: params.onChainAmount,
    openReservedAmount: params.openReservedAmount,
  })

  return Math.min(ledgerAvailableAmount, backedAvailableAmount)
}

export function getUnbackedMexasOrderIds(
  orders: (MexasReservedOrderData & { id: string })[],
  backedAmount: number
) {
  const totalReserved = getTotalMexasRemainingReservedAmount(orders)
  let excess = totalReserved - Math.max(0, backedAmount)
  if (excess <= 1e-9) return []

  const newestFirst = [...orders]
    .filter(
      (order) =>
        hasActiveMexasWalletReservation(order) &&
        getMexasRemainingReservedAmount(order) > 1e-9
    )
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
