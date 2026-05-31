'use client'
import clsx from 'clsx'

import { MEXAS_TOKEN } from 'common/crypto/mexas'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { MexasWalletPanel } from 'web/components/crypto/mexas-wallet-panel'
import { SEO } from 'web/components/SEO'
import { Row } from 'web/components/layout/row'
import { ExternalLinkIcon } from '@heroicons/react/solid'
import Link from 'next/link'
import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'

const FEATURED_MARKET_URL = '/mexas-test/who-will-win-the-2026-fifa-world-cu'

const WORLD_CUP_MARKETS = [
  { name: 'France', yes: 17.1, no: 83.0, volume: '33.0M' },
  { name: 'Spain', yes: 17.0, no: 83.1, volume: '26.8M' },
  { name: 'England', yes: 11.2, no: 88.9, volume: '22.1M' },
  { name: 'Portugal', yes: 9.4, no: 90.7, volume: '26.9M' },
  { name: 'Argentina', yes: 9.0, no: 91.1, volume: '24.0M' },
  { name: 'Brazil', yes: 8.8, no: 91.3, volume: '23.7M' },
  { name: 'Germany', yes: 5.2, no: 94.9, volume: '22.7M' },
  { name: 'Netherlands', yes: 3.7, no: 96.4, volume: '26.4M' },
  { name: 'Mexico', yes: 1.1, no: 99.0, volume: '27.4M' },
]

function MarketHeader() {
  return (
    <div className="border-ink-200 bg-canvas-0 border-b px-4 py-3 sm:px-5">
      <Row className="flex-wrap items-center justify-between gap-3">
        <Col className="gap-1">
          <Row className="text-ink-500 flex-wrap items-center gap-2 text-xs font-medium uppercase">
            <span>Sports</span>
            <span>/</span>
            <span>Soccer</span>
            <span className="rounded bg-teal-50 px-2 py-0.5 text-teal-700 dark:bg-teal-950 dark:text-teal-200">
              Arbitrum MEX
            </span>
          </Row>
          <h1 className="text-ink-1000 text-2xl font-semibold tracking-normal sm:text-3xl">
            World Cup Winner
          </h1>
        </Col>
        <Row className="divide-ink-200 border-ink-200 text-ink-700 overflow-hidden rounded-md border bg-white text-xs font-medium dark:bg-slate-950">
          <div className="px-3 py-2">
            <span className="text-ink-500 mr-1">Vol.</span> MEX 1.39B
          </div>
          <div className="border-ink-200 border-l px-3 py-2">
            <span className="text-ink-500 mr-1">Closes</span> Jul 20, 2026
          </div>
        </Row>
      </Row>
    </div>
  )
}

function PriceButton(props: { side: 'yes' | 'no'; price: number }) {
  const yes = props.side === 'yes'
  return (
    <Link
      href={FEATURED_MARKET_URL}
      className={clsx(
        'min-w-[90px] rounded px-3 py-2 text-center text-xs font-semibold transition-colors',
        yes
          ? 'bg-teal-600 text-white hover:bg-teal-700'
          : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white'
      )}
    >
      Buy {yes ? 'Yes' : 'No'} {props.price.toFixed(1)}c
    </Link>
  )
}

function FeaturedMarketTable() {
  return (
    <section className="border-ink-200 bg-canvas-0 overflow-hidden rounded-md border">
      <MarketHeader />
      <Col className="divide-ink-200 divide-y">
        {WORLD_CUP_MARKETS.map((market) => (
          <Row
            key={market.name}
            className="hover:bg-canvas-50 items-center gap-3 px-4 py-3 transition-colors sm:px-5"
          >
            <div className="min-w-0 flex-1">
              <Row className="items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-ink-900 truncate text-sm font-semibold">
                    {market.name}
                  </div>
                  <div className="text-ink-500 text-xs">
                    MEX {market.volume} Vol.
                  </div>
                </div>
                <div className="text-ink-900 w-14 text-right text-lg font-semibold">
                  {Math.round(market.yes)}%
                </div>
              </Row>
              <div className="bg-ink-100 mt-2 h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${Math.max(1, market.yes)}%` }}
                />
              </div>
            </div>
            <Row className="hidden shrink-0 gap-2 sm:flex">
              <PriceButton side="yes" price={market.yes} />
              <PriceButton side="no" price={market.no} />
            </Row>
          </Row>
        ))}
      </Col>
      <div className="border-ink-200 bg-canvas-50 border-t px-4 py-3 sm:px-5">
        <Link
          href={FEATURED_MARKET_URL}
          className="text-ink-900 inline-flex items-center gap-1 text-sm font-semibold hover:text-teal-700"
        >
          Open full market
          <ExternalLinkIcon className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}

function WalletStatus(props: {
  walletAddress?: string
  authenticated: boolean
}) {
  const { walletAddress, authenticated } = props
  const label = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : authenticated
    ? 'Wallet pending'
    : 'Not connected'

  return (
    <Row className="border-ink-200 items-center justify-between rounded-md border px-3 py-2 text-sm">
      <span className="text-ink-500">Privy wallet</span>
      <span className="text-ink-900 font-semibold">{label}</span>
    </Row>
  )
}

function MexasRail() {
  const privy = usePrivyLogin()

  return (
    <aside className="border-ink-200 bg-canvas-0 h-fit rounded-md border">
      <Col className="gap-4 p-4">
        <Col className="gap-1">
          <h2 className="text-ink-1000 text-lg font-semibold">Wallet MEX</h2>
          <p className="text-ink-500 text-sm">
            MEX deposited to your wallet stays available on{' '}
            {MEXAS_TOKEN.chainName}.
          </p>
        </Col>

        <WalletStatus
          authenticated={privy.authenticated}
          walletAddress={privy.walletAddress}
        />

        <MexasWalletPanel />

        <a
          href={MEXAS_TOKEN.arbiscanUrl}
          target="_blank"
          rel="noreferrer"
          className="text-ink-600 hover:text-ink-900 inline-flex items-center gap-1 text-xs font-medium"
        >
          Token contract
          <ExternalLinkIcon className="h-3.5 w-3.5" />
        </a>
      </Col>
    </aside>
  )
}

function CheckoutContent() {
  return (
    <Col className="min-h-screen w-full gap-4 bg-[#f7f8fa] px-3 py-4 dark:bg-slate-950 sm:px-5">
      <Row className="flex-wrap items-center justify-between gap-3">
        <Col className="gap-1">
          <div className="text-ink-500 text-xs font-semibold uppercase">
            MEXAS Markets
          </div>
          <div className="text-ink-1000 text-xl font-semibold">
            Trade outcomes from your wallet
          </div>
        </Col>
        <Link
          href={FEATURED_MARKET_URL}
          className="border-ink-200 bg-canvas-0 text-ink-900 hover:bg-canvas-50 rounded-md border px-3 py-2 text-sm font-semibold"
        >
          View market
        </Link>
      </Row>

      <div className="grid w-full gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <FeaturedMarketTable />
        <MexasRail />
      </div>
    </Col>
  )
}

export default function CheckoutPage() {
  return (
    <Page trackPageView="checkout page" className="lg:col-span-10" hideFooter>
      <SEO
        title="MEXAS Markets"
        description="Trade prediction markets with MEXAS on Arbitrum."
        url="/checkout"
      />

      <CheckoutContent />
    </Page>
  )
}
