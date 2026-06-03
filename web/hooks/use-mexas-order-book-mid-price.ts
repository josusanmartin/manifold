import { useEffect, useState } from 'react'

export type MexasOrderBookBet = {
  amount?: number
  isCancelled?: boolean
  isFilled?: boolean
  limitProb?: number
  orderAmount?: number
  outcome?: string
}

function remainingOrderAmount(order: MexasOrderBookBet) {
  return Math.max(0, (order.orderAmount ?? 0) - (order.amount ?? 0))
}

export function getMexasOrderBookMidPrice(orders: MexasOrderBookBet[]) {
  const openOrders = orders.filter((order) => {
    return (
      order.limitProb != null &&
      order.orderAmount != null &&
      !order.isFilled &&
      !order.isCancelled &&
      remainingOrderAmount(order) > 0
    )
  })
  const bids = openOrders
    .filter((order) => order.outcome === 'YES')
    .map((order) => order.limitProb as number)
  const asks = openOrders
    .filter((order) => order.outcome === 'NO')
    .map((order) => order.limitProb as number)

  if (!bids.length || !asks.length) return undefined

  const bestBid = Math.max(...bids)
  const bestAsk = Math.min(...asks)
  return (bestBid + bestAsk) / 2
}

export function mexasOrderBookPriceLabel(price?: number) {
  return price == null ? 'Sin precio' : `${(price * 100).toFixed(1)}c`
}

export function useMexasOrderBookMidPrice(
  contractId: string,
  enabled = true
) {
  const [midPrice, setMidPrice] = useState<number | undefined>()

  useEffect(() => {
    if (!enabled) {
      setMidPrice(undefined)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const response = await fetch(
          `/api/mexas-order-book?contractId=${encodeURIComponent(
            contractId
          )}&limit=500`
        )
        if (!response.ok) {
          throw new Error(`Order book failed: ${response.status}`)
        }
        const orders = (await response.json()) as MexasOrderBookBet[]
        if (!cancelled) setMidPrice(getMexasOrderBookMidPrice(orders))
      } catch (error) {
        console.error(error)
        if (!cancelled) setMidPrice(undefined)
      }
    }

    load()
    const interval = setInterval(load, 10_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [contractId, enabled])

  return midPrice
}
