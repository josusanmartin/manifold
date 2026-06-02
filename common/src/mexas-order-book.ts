import { fill, LimitBet } from './bet'

const EPSILON = 1e-9

export type MexasOutcome = 'YES' | 'NO'

export type MexasMatchedOrder = {
  maker: LimitBet
  updatedMaker: LimitBet
  takerFill: fill
  price: number
  shares: number
  takerAmount: number
  makerAmount: number
}

export type MexasMatchResult = {
  matches: MexasMatchedOrder[]
  takerAmount: number
  takerShares: number
  takerFills: fill[]
  remainingAmount: number
}

function roundAmount(value: number) {
  return Math.round(value * 1e8) / 1e8
}

export function getMexasOrderPrice(outcome: MexasOutcome, limitProb: number) {
  return outcome === 'YES' ? limitProb : 1 - limitProb
}

export function getMexasOrderShares(
  outcome: MexasOutcome,
  limitProb: number,
  amount: number
) {
  const price = getMexasOrderPrice(outcome, limitProb)
  return price <= 0 ? 0 : amount / price
}

export function getMexasOrderAmountForShares(
  outcome: MexasOutcome,
  limitProb: number,
  shares: number
) {
  return shares * getMexasOrderPrice(outcome, limitProb)
}

export function getMexasOpenOrderAmount(order: LimitBet) {
  return Math.max(0, (order.orderAmount ?? 0) - (order.amount ?? 0))
}

export function getMexasLimitOrderExpiresAt(
  now: number,
  params: {
    expiresAt?: number
    expiresMillisAfter?: number
  }
) {
  if (params.expiresAt !== undefined) return params.expiresAt
  if (params.expiresMillisAfter !== undefined) {
    return now + params.expiresMillisAfter
  }
  return undefined
}

export function hasValidMexasLimitOrderExpiration(
  now: number,
  expiresAt?: number
) {
  return expiresAt === undefined || expiresAt > now
}

export function isMexasCrossingOrder(
  takerOutcome: MexasOutcome,
  takerLimitProb: number,
  maker: LimitBet
) {
  if (maker.outcome === takerOutcome) return false
  if (maker.limitProb === undefined) return false

  return takerOutcome === 'YES'
    ? maker.limitProb <= takerLimitProb
    : maker.limitProb >= takerLimitProb
}

export function sortMexasMakersForTaker(
  takerOutcome: MexasOutcome,
  orders: LimitBet[]
) {
  return [...orders].sort((a, b) => {
    const priceDiff =
      takerOutcome === 'YES'
        ? a.limitProb - b.limitProb
        : b.limitProb - a.limitProb

    if (Math.abs(priceDiff) > EPSILON) return priceDiff
    const timeDiff = a.createdTime - b.createdTime
    if (timeDiff !== 0) return timeDiff
    return a.id.localeCompare(b.id)
  })
}

export function getMexasCrossingOrders(params: {
  limitProb: number
  makers: LimitBet[]
  outcome: MexasOutcome
  takerUserId?: string
}) {
  const { limitProb, makers, outcome, takerUserId } = params
  return sortMexasMakersForTaker(
    outcome,
    makers.filter((maker) => {
      return (
        (!takerUserId || maker.userId !== takerUserId) &&
        !maker.isFilled &&
        !maker.isCancelled &&
        getMexasOpenOrderAmount(maker) > EPSILON &&
        isMexasCrossingOrder(outcome, limitProb, maker)
      )
    })
  )
}

export function matchMexasLimitOrder(params: {
  amount: number
  limitProb: number
  makers: LimitBet[]
  outcome: MexasOutcome
  takerBetId: string
  takerUserId?: string
  timestamp: number
}) {
  const { amount, limitProb, outcome, takerBetId, takerUserId, timestamp } =
    params
  let remainingAmount = amount
  let takerAmount = 0
  let takerShares = 0
  const matches: MexasMatchedOrder[] = []

  const makers = getMexasCrossingOrders({
    limitProb,
    makers: params.makers,
    outcome,
    takerUserId,
  })

  for (const maker of makers) {
    if (remainingAmount <= EPSILON) break

    const makerOpenAmount = getMexasOpenOrderAmount(maker)
    if (makerOpenAmount <= EPSILON) continue

    const price = maker.limitProb
    const takerMaxShares = getMexasOrderShares(outcome, price, remainingAmount)
    const makerMaxShares = getMexasOrderShares(
      maker.outcome as MexasOutcome,
      price,
      makerOpenAmount
    )
    const shares = roundAmount(Math.min(takerMaxShares, makerMaxShares))
    if (shares <= EPSILON) continue

    const fillTakerAmount = roundAmount(
      getMexasOrderAmountForShares(outcome, price, shares)
    )
    const fillMakerAmount = roundAmount(
      getMexasOrderAmountForShares(maker.outcome as MexasOutcome, price, shares)
    )

    const takerFill: fill = {
      matchedBetId: maker.id,
      amount: fillTakerAmount,
      shares,
      timestamp,
    }
    const makerFill: fill = {
      matchedBetId: takerBetId,
      amount: fillMakerAmount,
      shares,
      timestamp,
    }
    const updatedMakerAmount = roundAmount(
      (maker.amount ?? 0) + fillMakerAmount
    )
    const updatedMakerShares = roundAmount((maker.shares ?? 0) + shares)
    const updatedMakerOpenAmount = Math.max(
      0,
      (maker.orderAmount ?? 0) - updatedMakerAmount
    )
    const updatedMaker: LimitBet = {
      ...maker,
      amount: updatedMakerAmount,
      shares: updatedMakerShares,
      fills: [...(maker.fills ?? []), makerFill],
      isFilled: updatedMakerOpenAmount <= EPSILON,
    }

    matches.push({
      maker,
      updatedMaker,
      takerFill,
      price,
      shares,
      takerAmount: fillTakerAmount,
      makerAmount: fillMakerAmount,
    })

    remainingAmount = roundAmount(remainingAmount - fillTakerAmount)
    takerAmount = roundAmount(takerAmount + fillTakerAmount)
    takerShares = roundAmount(takerShares + shares)
  }

  return {
    matches,
    takerAmount,
    takerShares,
    takerFills: matches.map((match) => match.takerFill),
    remainingAmount: Math.max(0, remainingAmount),
  } satisfies MexasMatchResult
}
