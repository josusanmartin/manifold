import {
  ChartBarIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
} from '@heroicons/react/outline'
import type { ReactNode } from 'react'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { Row } from 'web/components/layout/row'
import { ManifoldLogo } from 'web/components/nav/manifold-logo'
import { SEO } from 'web/components/SEO'

const MARKET_POINTS = [
  {
    icon: <ChartBarIcon className="h-5 w-5" />,
    label: 'Mercados',
    value: 'Resultados de eventos con precios en MEX',
  },
  {
    icon: <CurrencyDollarIcon className="h-5 w-5" />,
    label: 'Token',
    value: 'MEX en Arbitrum',
  },
  {
    icon: <ShieldCheckIcon className="h-5 w-5" />,
    label: 'Cartera',
    value: 'Cartera integrada de Privy',
  },
]

export default function AboutPage() {
  return (
    <Page trackPageView={'about page'} className="lg:col-span-10" hideFooter>
      <SEO
        title="Acerca de MEXAS Markets"
        description="MEXAS Markets es un mercado de predicción que usa MEX en Arbitrum."
        url="/about"
      />

      <Col className="min-h-screen w-full gap-5 bg-[#f7f8fa] px-4 py-6 dark:bg-slate-950">
        <Col className="mx-auto w-full max-w-5xl gap-5">
          <ManifoldLogo className="!w-auto !px-0" />

          <section className="border-ink-200 bg-canvas-0 rounded-md border p-5 sm:p-8">
            <Col className="max-w-2xl gap-3">
              <div className="text-ink-500 text-xs font-semibold uppercase">
                Acerca de
              </div>
              <h1 className="text-ink-1000 text-3xl font-semibold tracking-normal">
                MEXAS Markets
              </h1>
              <p className="text-ink-600 text-base">
                MEXAS Markets es una plataforma de mercados de predicción
                centrada en MEX sobre Arbitrum.
              </p>
            </Col>
          </section>

          <div className="grid gap-3 md:grid-cols-3">
            {MARKET_POINTS.map((point) => (
              <InfoPanel
                key={point.label}
                icon={point.icon}
                label={point.label}
                value={point.value}
              />
            ))}
          </div>
        </Col>
      </Col>
    </Page>
  )
}

function InfoPanel(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <Row className="border-ink-200 bg-canvas-0 items-start gap-3 rounded-md border p-4">
      <span className="mt-0.5 text-teal-600">{props.icon}</span>
      <Col className="gap-1">
        <span className="text-ink-900 text-sm font-semibold">
          {props.label}
        </span>
        <span className="text-ink-500 text-sm">{props.value}</span>
      </Col>
    </Row>
  )
}
