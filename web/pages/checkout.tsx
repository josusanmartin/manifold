'use client'
import clsx from 'clsx'

import { MEXAS_TOKEN } from 'common/crypto/mexas'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { MexasWalletSummary } from 'web/components/crypto/mexas-wallet-panel'
import { SEO } from 'web/components/SEO'
import { Row } from 'web/components/layout/row'
import { ExternalLinkIcon } from '@heroicons/react/solid'
import Link from 'next/link'

const FEATURED_MARKET_URL = '/mexas-test/ganara-mexico-la-copa-mundial-2026'
const UKRAINE_MARKET_URL =
  '/mexas-test/will-the-russia-ukraine-war-end-by-december-31-2026'

function MarketHeader() {
  return (
    <div className="border-ink-200 bg-canvas-0 border-b px-4 py-3 sm:px-5">
      <Row className="flex-wrap items-center justify-between gap-3">
        <Col className="gap-1">
          <Row className="text-ink-500 flex-wrap items-center gap-2 text-xs font-medium uppercase">
            <span>Deportes</span>
            <span>/</span>
            <span>Fútbol</span>
            <span className="rounded bg-teal-50 px-2 py-0.5 text-teal-700 dark:bg-teal-950 dark:text-teal-200">
              Arbitrum MEX
            </span>
          </Row>
          <h1 className="text-ink-1000 text-2xl font-semibold tracking-normal sm:text-3xl">
            ¿Ganará México la Copa Mundial 2026?
          </h1>
        </Col>
        <Row className="divide-ink-200 border-ink-200 text-ink-700 overflow-hidden rounded-md border bg-white text-xs font-medium dark:bg-slate-950">
          <div className="px-3 py-2">
            <span className="text-ink-500 mr-1">Vol.</span> MEX 1.39B
          </div>
          <div className="border-ink-200 border-l px-3 py-2">
            <span className="text-ink-500 mr-1">Cierra</span> 20 jul 2026
          </div>
        </Row>
      </Row>
    </div>
  )
}

function PriceButton(props: {
  side: 'yes' | 'no'
  href?: string
}) {
  const yes = props.side === 'yes'
  return (
    <Link
      href={props.href ?? FEATURED_MARKET_URL}
      className={clsx(
        'min-w-[90px] rounded px-3 py-2 text-center text-xs font-semibold transition-colors',
        yes
          ? 'bg-teal-600 text-white hover:bg-teal-700'
          : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white'
      )}
    >
      Orden {yes ? 'Sí' : 'No'}
    </Link>
  )
}

function SimpleMarketCard() {
  return (
    <section className="border-ink-200 bg-canvas-0 overflow-hidden rounded-md border">
      <div className="border-ink-200 border-b px-4 py-3 sm:px-5">
        <Row className="flex-wrap items-center justify-between gap-3">
          <Col className="gap-1">
            <Row className="text-ink-500 flex-wrap items-center gap-2 text-xs font-medium uppercase">
              <span>Geopolítica</span>
              <span>/</span>
              <span>Ucrania</span>
              <span className="rounded bg-teal-50 px-2 py-0.5 text-teal-700 dark:bg-teal-950 dark:text-teal-200">
                SÍ/NO
              </span>
            </Row>
            <h2 className="text-ink-1000 text-lg font-semibold sm:text-xl">
              ¿Terminará la guerra entre Rusia y Ucrania antes del 31 de
              diciembre de 2026?
            </h2>
          </Col>
          <div className="text-ink-900 text-2xl font-semibold">Sin precio</div>
        </Row>
      </div>

      <Col className="gap-3 p-4 sm:p-5">
        <Row className="text-ink-500 flex-wrap items-center gap-3 text-xs font-medium">
          <span>MEX 0 Vol.</span>
          <span>Cierra 31 dic 2026</span>
          <span>Libro de órdenes activo</span>
        </Row>
        <Row className="flex-wrap gap-2">
          <PriceButton side="yes" href={UKRAINE_MARKET_URL} />
          <PriceButton side="no" href={UKRAINE_MARKET_URL} />
        </Row>
        <Link
          href={UKRAINE_MARKET_URL}
          className="text-ink-900 inline-flex items-center gap-1 text-sm font-semibold hover:text-teal-700"
        >
          Abrir mercado Sí/No
          <ExternalLinkIcon className="h-4 w-4" />
        </Link>
      </Col>
    </section>
  )
}

function FeaturedMarketTable() {
  return (
    <section className="border-ink-200 bg-canvas-0 overflow-hidden rounded-md border">
      <MarketHeader />
      <Col className="gap-3 p-4 sm:p-5">
        <Row className="flex-wrap items-center justify-between gap-3">
          <Col className="gap-1">
            <div className="text-ink-900 text-sm font-semibold">México</div>
            <div className="text-ink-500 text-xs">MEX 0 Vol.</div>
          </Col>
          <div className="text-ink-900 text-2xl font-semibold">Sin precio</div>
        </Row>
        <Row className="flex-wrap gap-2">
          <PriceButton side="yes" />
          <PriceButton side="no" />
        </Row>
      </Col>
      <div className="border-ink-200 bg-canvas-50 border-t px-4 py-3 sm:px-5">
        <Link
          href={FEATURED_MARKET_URL}
          className="text-ink-900 inline-flex items-center gap-1 text-sm font-semibold hover:text-teal-700"
        >
          Abrir mercado
          <ExternalLinkIcon className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}

function MexasRail() {
  return (
    <aside className="border-ink-200 bg-canvas-0 h-fit rounded-md border">
      <Col className="gap-4 p-4">
        <Col className="gap-1">
          <h2 className="text-ink-1000 text-lg font-semibold">Wallet MEX</h2>
          <p className="text-ink-500 text-sm">
            El MEX depositado en tu Wallet permanece disponible en{' '}
            {MEXAS_TOKEN.chainName}.
          </p>
        </Col>

        <MexasWalletSummary />
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
            Mercados MEXAS
          </div>
          <div className="text-ink-1000 text-xl font-semibold">
            Opera mercados desde tu Wallet
          </div>
        </Col>
        <Link
          href={FEATURED_MARKET_URL}
          className="border-ink-200 bg-canvas-0 text-ink-900 hover:bg-canvas-50 rounded-md border px-3 py-2 text-sm font-semibold"
        >
          Ver mercado
        </Link>
      </Row>

      <div className="grid w-full gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Col className="gap-4">
          <SimpleMarketCard />
          <FeaturedMarketTable />
        </Col>
        <MexasRail />
      </div>
    </Col>
  )
}

export default function CheckoutPage() {
  return (
    <Page trackPageView="checkout page" className="lg:col-span-10" hideFooter>
      <SEO
        title="Mercados MEXAS"
        description="Opera mercados de predicción con MEXAS en Arbitrum."
        url="/checkout"
      />

      <CheckoutContent />
    </Page>
  )
}
