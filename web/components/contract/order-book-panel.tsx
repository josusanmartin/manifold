import { LimitBet, Bet } from 'common/bet'
import {
  BinaryOrPseudoNumericContract,
  CPMMMultiContract,
} from 'common/contract'
import { shortFormatNumber } from 'common/util/format'
import { orderBy, sumBy } from 'lodash'
import { useEffect, useState } from 'react'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import { getMexasOpenOrderAmount } from 'common/mexas-order-book'
import { useMexasOrderReadiness } from 'web/hooks/use-mexas-order-readiness'
import { Col } from '../layout/col'
import { Row } from '../layout/row'

type OrderBookContract = BinaryOrPseudoNumericContract | CPMMMultiContract

type MarketRow = {
  answerId?: string
  name: string
  prob?: number
}

type Level = {
  price: number
  size: number
}

function isOpenLimitBet(bet: Bet): bet is LimitBet {
  return (
    bet.limitProb !== undefined &&
    bet.orderAmount !== undefined &&
    !bet.isFilled &&
    !bet.isCancelled
  )
}

function remainingOrderAmount(bet: LimitBet) {
  return getMexasOpenOrderAmount(bet)
}

function getMarkets(contract: OrderBookContract): MarketRow[] {
  const hideReferencePrice = isMexasOrderBookOnlyContract(contract)
  if ('answers' in contract) {
    return orderBy(
      contract.answers
        .filter((answer) => !answer.isOther)
        .map((answer) => ({
          answerId: answer.id,
          name: answer.text,
          prob: hideReferencePrice ? undefined : answer.prob,
        })),
      ['prob'],
      ['desc']
    ).slice(0, 8)
  }

  return [{ name: 'SÍ', prob: hideReferencePrice ? undefined : contract.prob }]
}

function getLevels(orders: LimitBet[], outcome: 'YES' | 'NO') {
  const levelsByPrice = new Map<number, number>()
  for (const order of orders) {
    if (order.outcome !== outcome) continue
    const size = remainingOrderAmount(order)
    if (size <= 0) continue

    const price = Math.round(order.limitProb * 1000) / 1000
    levelsByPrice.set(price, (levelsByPrice.get(price) ?? 0) + size)
  }

  return Array.from(levelsByPrice.entries()).map(([price, size]) => ({
    price,
    size,
  }))
}

function getBookForMarket(openOrders: LimitBet[], market: MarketRow) {
  const orders = openOrders.filter((order) =>
    market.answerId ? order.answerId === market.answerId : !order.answerId
  )
  const bids = orderBy(getLevels(orders, 'YES'), ['price'], ['desc'])
  const asks = orderBy(getLevels(orders, 'NO'), ['price'], ['asc'])

  return { bids, asks }
}

function priceLabel(price?: number) {
  return price === undefined ? '--' : `${(price * 100).toFixed(1)}c`
}

function sizeLabel(size?: number) {
  return size === undefined || size <= 0
    ? '--'
    : `${shortFormatNumber(size)} MEX`
}

export function MarketOrderBookPanel(props: { contract: OrderBookContract }) {
  const { contract } = props
  const markets = getMarkets(contract)
  const { data, loading } = useMexasOpenOrders(contract.id)
  const openOrders = (data ?? []).filter(isOpenLimitBet)
  const orderBookOnly = isMexasOrderBookOnlyContract(contract)
  const orderReadiness = useMexasOrderReadiness(contract.id, orderBookOnly)

  if (!markets.length) return null

  const primaryMarket = markets[0]
  const primaryBook = getBookForMarket(openOrders, primaryMarket)
  const hasOpenOrders = openOrders.length > 0
  const ordersPaused = orderBookOnly && orderReadiness?.canPlaceOrders === false
  const matchingPaused =
    orderBookOnly &&
    orderReadiness !== undefined &&
    orderReadiness.canPlaceOrders &&
    !orderReadiness.matchingEngineReady

  return (
    <Col className="border-ink-200 bg-canvas-0 mt-4 overflow-hidden rounded-md border">
      <Row className="border-ink-200 items-center justify-between border-b px-4 py-3">
        <Col className="gap-0">
          <h2 className="text-ink-1000 text-base font-semibold">
            Libro de órdenes
          </h2>
          <span className="text-ink-500 text-xs">
            Órdenes límite abiertas en MEX
          </span>
        </Col>
        <span className="text-ink-500 text-xs">
          {loading ? 'Cargando' : `${openOrders.length} abiertas`}
        </span>
      </Row>

      {ordersPaused && (
        <div className="border-ink-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Nuevas órdenes pausadas mientras se completa la liquidación MEXAS.
          Puedes consultar el libro y cancelar tus órdenes abiertas; no se
          reservará MEX nuevo.
        </div>
      )}

      {matchingPaused && (
        <div className="border-ink-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Puedes abrir órdenes límite que agreguen liquidez. Las órdenes que
          cruzan el libro están pausadas hasta completar la liquidación MEXAS.
        </div>
      )}

      {'answers' in contract ? (
        <MultiMarketBook markets={markets} openOrders={openOrders} />
      ) : (
        <BinaryMarketBook
          market={primaryMarket}
          bids={primaryBook.bids}
          asks={primaryBook.asks}
          showReferencePrice={!orderBookOnly}
        />
      )}

      {!hasOpenOrders && !loading && (
        <div className="border-ink-200 text-ink-500 border-t px-4 py-3 text-sm">
          {orderBookOnly
            ? 'Aún no hay precio. Abre la primera orden límite para crear el libro.'
            : 'Aún no hay órdenes límite abiertas. El precio actual del mercado se muestra arriba; las órdenes nuevas aparecerán aquí.'}
        </div>
      )}
    </Col>
  )
}

function useMexasOpenOrders(contractId: string) {
  const [data, setData] = useState<Bet[] | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadOrders = async (showLoading: boolean) => {
      if (showLoading) setLoading(true)

      try {
        const response = await fetch(
          `/api/mexas-order-book?contractId=${encodeURIComponent(
            contractId
          )}&limit=500`
        )
        if (!response.ok) {
          throw new Error(`Order book request failed: ${response.status}`)
        }
        const orders = (await response.json()) as Bet[]
        if (!cancelled) setData(orders)
      } catch (error) {
        console.error(error)
        if (!cancelled) setData([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadOrders(true)
    const interval = setInterval(() => loadOrders(false), 10_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [contractId])

  return { data, loading }
}

function BinaryMarketBook(props: {
  market: MarketRow
  bids: Level[]
  asks: Level[]
  showReferencePrice: boolean
}) {
  const { market, bids, asks, showReferencePrice } = props
  const visibleAsks = asks.slice(0, 5)
  const visibleBids = bids.slice(0, 5)

  return (
    <div>
      {showReferencePrice && (
        <Row className="bg-canvas-50 border-ink-200 items-center justify-between border-b px-4 py-3">
          <span className="text-ink-900 text-sm font-semibold">
            {market.name}
          </span>
          <span className="text-ink-1000 text-lg font-semibold">
            {priceLabel(market.prob)}
          </span>
        </Row>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2">
        <BookSide levels={visibleBids} side="bid" />
        <BookSide levels={visibleAsks} side="ask" />
      </div>
    </div>
  )
}

function BookSide(props: { levels: Level[]; side: 'bid' | 'ask' }) {
  const { levels, side } = props
  const isBid = side === 'bid'

  return (
    <Col
      className={
        isBid
          ? 'md:border-ink-200 md:border-r'
          : 'border-ink-200 border-t md:border-t-0'
      }
    >
      <Row className="text-ink-500 bg-canvas-50 border-ink-200 border-b px-4 py-2 text-xs font-medium uppercase">
        <span className="flex-1">{isBid ? 'Compras SÍ' : 'Ventas SÍ'}</span>
        <span className="w-20 text-right">Precio</span>
        <span className="w-20 text-right">Tamaño</span>
      </Row>
      <Col className="divide-ink-100 min-h-[112px] divide-y">
        {levels.length ? (
          levels.map((level) => (
            <BookLevel
              key={`${side}-${level.price}`}
              level={level}
              side={side}
            />
          ))
        ) : (
          <Row className="text-ink-500 items-center justify-center px-4 py-6 text-sm">
            {isBid ? 'Sin compras' : 'Sin ventas'}
          </Row>
        )}
      </Col>
    </Col>
  )
}

function BookLevel(props: { level: Level; side: 'bid' | 'ask' }) {
  const { level, side } = props
  const isBid = side === 'bid'

  return (
    <Row className="relative items-center justify-between px-4 py-2 text-sm">
      <div
        className={
          isBid
            ? 'absolute inset-y-1 right-0 bg-teal-500/10'
            : 'bg-scarlet-500/10 absolute inset-y-1 right-0'
        }
        style={{ width: `${Math.min(90, Math.max(8, level.size / 20))}%` }}
      />
      <span
        className={
          isBid
            ? 'relative flex-1 font-semibold text-teal-700 dark:text-teal-300'
            : 'text-scarlet-600 relative flex-1 font-semibold'
        }
      >
        {isBid ? 'Compra' : 'Venta'}
      </span>
      <span
        className={
          isBid
            ? 'relative w-20 text-right font-semibold text-teal-700 dark:text-teal-300'
            : 'text-scarlet-600 relative w-20 text-right font-semibold'
        }
      >
        {priceLabel(level.price)}
      </span>
      <span className="text-ink-700 relative w-20 text-right">
        {sizeLabel(level.size)}
      </span>
    </Row>
  )
}

function MultiMarketBook(props: {
  markets: MarketRow[]
  openOrders: LimitBet[]
}) {
  const { markets, openOrders } = props

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-canvas-50 text-ink-500 border-ink-200 border-b text-xs uppercase">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Resultado</th>
            <th className="px-4 py-2 text-right font-medium">Último</th>
            <th className="px-4 py-2 text-right font-medium">Compra</th>
            <th className="px-4 py-2 text-right font-medium">Venta</th>
            <th className="px-4 py-2 text-right font-medium">Tamaño abierto</th>
          </tr>
        </thead>
        <tbody className="divide-ink-100 divide-y">
          {markets.map((market) => {
            const { bids, asks } = getBookForMarket(openOrders, market)
            const bestBid = bids[0]
            const bestAsk = asks[0]
            const openSize = sumBy([...bids, ...asks], 'size')

            return (
              <tr key={market.answerId ?? market.name}>
                <td className="text-ink-900 max-w-[220px] truncate px-4 py-3 font-semibold">
                  {market.name}
                </td>
                <td className="text-ink-700 px-4 py-3 text-right">
                  {priceLabel(market.prob)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-teal-700 dark:text-teal-300">
                  {priceLabel(bestBid?.price)}
                </td>
                <td className="text-scarlet-600 px-4 py-3 text-right font-semibold">
                  {priceLabel(bestAsk?.price)}
                </td>
                <td className="text-ink-700 px-4 py-3 text-right">
                  {sizeLabel(openSize)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
