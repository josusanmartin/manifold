import { ChevronDoubleDownIcon } from '@heroicons/react/solid'
import clsx from 'clsx'
import Link from 'next/link'
import React from 'react'
import { FaCoins, FaGift } from 'react-icons/fa6'
import { GoGraph } from 'react-icons/go'
import { TbTargetArrow } from 'react-icons/tb'
import { track } from 'web/lib/service/analytics'
import { AboutManifold } from './about-manifold'
import { Col } from './layout/col'
import { Row } from './layout/row'
import { Card } from './widgets/card'

export const ExplainerPanel = (props: {
  className?: string
  showWhatIsManifold?: boolean
  showAccuracy?: boolean
}) => {
  const { className, showWhatIsManifold = true, showAccuracy = true } = props
  const handleSectionClick = (sectionTitle: string) => {
    track('explainer section click', { sectionTitle })
  }
  return (
    <Col className={clsx('max-w-xl', className)}>
      {showWhatIsManifold && <WhatIsManifold onClick={handleSectionClick} />}
      {showAccuracy && <Accuracy onClick={handleSectionClick} />}
      <PlayMoney onClick={handleSectionClick} />
      <CashPrizes onClick={handleSectionClick} />
    </Col>
  )
}

export const ExpandSection = (props: {
  title: React.ReactNode
  children: React.ReactNode
  onClick?: () => void
}) => {
  const { title, children, onClick } = props

  return (
    <Card className="my-2">
      <details className="group flex flex-col gap-2">
        <summary className="flex list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
          <Row className="items-center text-lg font-semibold">{title}</Row>
          <span className="ml-auto inline-block h-4 w-4 flex-shrink-0">
            <ChevronDoubleDownIcon
              className="h-full w-full transition group-open:-rotate-180"
              aria-hidden
              onClick={onClick}
            />
          </span>
        </summary>
        <div className="text-ink-900 px-4 pb-3">{children}</div>
      </details>
    </Card>
  )
}

const WhatIsManifold = ({
  onClick,
}: {
  onClick: (sectionTitle: string) => void
}) => (
  <ExpandSection
    title={
      <>
        <GoGraph className="mr-2  " /> ¿Qué es MEXAS?
      </>
    }
    onClick={() => onClick('Qué es MEXAS')}
  >
    <AboutManifold />
  </ExpandSection>
)

const Accuracy = ({ onClick }: { onClick: (sectionTitle: string) => void }) => (
  <ExpandSection
    title={
      <>
        <TbTargetArrow className="mr-2" /> ¿Son precisas las probabilidades?
      </>
    }
    onClick={() => onClick('Son precisas las probabilidades')}
  >
    <div className="pb-2">
      Sí. Los mercados MEXAS se calibran mediante operaciones abiertas.
      <a className="text-primary-700 ml-1 hover:underline" href="/checkout">
        Ver mercados activos
      </a>
      .
    </div>
    <div className="pb-2">
      Los precios cambian cuando los usuarios compran y venden resultados, así
      que el precio del mercado refleja la estimación colectiva actual.
    </div>
    <div></div>
  </ExpandSection>
)

const PlayMoney = ({
  onClick,
}: {
  onClick: (sectionTitle: string) => void
}) => (
  <ExpandSection
    title={
      <>
        <FaCoins className="mr-2 h-4 w-4" />
        ¿Por qué usar MEX?
      </>
    }
    onClick={() => onClick('Por qué usar MEX')}
  >
    <div className="pb-2">
      MEX es el token de Arbitrum que se usa para operar en MEXAS Markets.
    </div>
    <div className="pb-2">
      Los depósitos permanecen en tu cartera Privy y los retiros se envían
      directamente on-chain.
    </div>
  </ExpandSection>
)

const CashPrizes = ({
  onClick,
}: {
  onClick: (sectionTitle: string) => void
}) => (
  <ExpandSection
    title={
      <>
        <FaGift className="mr-2 h-4 w-4" />
        ¿Cómo retiro mis fondos?
      </>
    }
    onClick={() => onClick('Cómo retiro fondos')}
  >
    <div className="pb-2">
      MEXAS liquida retiros a través de tu cartera conectada.
    </div>
    <div className="pb-2">
      Mantén suficiente ETH en Arbitrum para pagar el gas de las transferencias.
    </div>
    <div className="pb-2">
      <Link href="/wallet" className="text-primary-700 hover:underline">
        Abrir cartera MEX
      </Link>
    </div>
  </ExpandSection>
)
