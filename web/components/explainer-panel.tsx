import { ChevronDoubleDownIcon } from '@heroicons/react/solid'
import clsx from 'clsx'
import { ENV_CONFIG } from 'common/envs/constants'
import Link from 'next/link'
import React from 'react'
import { FaGift } from 'react-icons/fa6'
import { GoGraph } from 'react-icons/go'
import { TbTargetArrow } from 'react-icons/tb'
import { track } from 'web/lib/service/analytics'
import { AboutManifold } from './about-manifold'
import { Col } from './layout/col'
import { Row } from './layout/row'
import { Card } from './widgets/card'

import { ManaCoin } from 'web/public/custom-components/manaCoin'

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
        <GoGraph className="mr-2  " /> What is MEXAS?
      </>
    }
    onClick={() => onClick('What is MEXAS?')}
  >
    <AboutManifold />
  </ExpandSection>
)

const Accuracy = ({ onClick }: { onClick: (sectionTitle: string) => void }) => (
  <ExpandSection
    title={
      <>
        <TbTargetArrow className="mr-2" /> Are our predictions accurate?
      </>
    }
    onClick={() => onClick('Are our forecasts accurate?')}
  >
    <div className="pb-2">
      Yes! MEXAS markets are designed to stay calibrated through open trading.
      <a
        className="text-primary-700 ml-1 hover:underline"
        href="/checkout"
      >
        Explore live markets
      </a>
      .
    </div>
    <div className="pb-2">
      Prices move as traders buy and sell outcomes, so the market price becomes
      the current crowd estimate.
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
        <ManaCoin className="!mr-2 h-4 w-4 grayscale" />
        Why use MEX?
      </>
    }
    onClick={() => onClick('Why use MEX?')}
  >
    <div className="pb-2">
      MEX ({ENV_CONFIG.moneyMoniker}) is the Arbitrum token used to trade on
      MEXAS markets.
    </div>
    <div className="pb-2">
      Deposits stay in your Privy wallet, and withdrawals send tokens directly
      on-chain.
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
        How do I win cash prizes?
      </>
    }
    onClick={() => onClick('How do I win cash prizes?')}
  >
    <div className="pb-2">
      MEXAS can settle rewards and withdrawals through your connected wallet.
    </div>
    <div className="pb-2">
      Keep enough Arbitrum ETH in the wallet to pay gas for token transfers.
    </div>
    <div className="pb-2">
      <Link href="/wallet" className="text-primary-700 hover:underline">
        Open MEX wallet →
      </Link>
    </div>
  </ExpandSection>
)
