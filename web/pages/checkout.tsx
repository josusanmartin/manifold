'use client'
import clsx from 'clsx'

import { isUserBanned } from 'common/ban-utils'
import {
  MEXAS_ACCOUNT_CREDIT_PER_TOKEN,
  MEXAS_TOKEN,
} from 'common/crypto/mexas'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { MexasCheckoutButton } from 'web/components/crypto/mexas-checkout-button'
import { SEO } from 'web/components/SEO'
import { useUser } from 'web/hooks/use-user'
import { useAPIGetter } from 'web/hooks/use-api-getter'
import { useState } from 'react'
import { Row } from 'web/components/layout/row'
import { Button } from 'web/components/buttons/button'
import {
  CheckCircleIcon,
  ArrowRightIcon,
  BanIcon,
} from '@heroicons/react/solid'
import Image from 'next/image'
import Link from 'next/link'

const MEXAS_TIERS = [10, 25, 50, 100, 500, 1000, 2500]

function MexasCreditsTable() {
  return (
    <Col className="gap-2">
      <Row className="items-center justify-between">
        <span className="text-ink-700 text-sm font-semibold">
          MEX account credit
        </span>
      </Row>
      <div className="border-ink-200 dark:border-ink-300 overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-canvas-50 text-ink-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Pay</th>
              <th className="px-3 py-2 text-right font-medium">You get</th>
            </tr>
          </thead>
          <tbody className="divide-ink-100 dark:divide-ink-200 divide-y">
            {MEXAS_TIERS.map((mexas) => {
              const total = mexas * MEXAS_ACCOUNT_CREDIT_PER_TOKEN
              return (
                <tr key={mexas}>
                  <td className="text-ink-800 px-3 py-2 font-medium">
                    {mexas.toLocaleString()} {MEXAS_TOKEN.symbol}
                  </td>
                  <td className="text-ink-900 px-3 py-2 text-right font-semibold">
                    {total.toLocaleString()} {MEXAS_TOKEN.symbol}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-ink-500 text-xs">
        1 on-chain {MEXAS_TOKEN.symbol} on Arbitrum maps to{' '}
        {MEXAS_ACCOUNT_CREDIT_PER_TOKEN.toLocaleString()} in-app{' '}
        {MEXAS_TOKEN.symbol}.
      </p>
    </Col>
  )
}

function CheckoutContent() {
  const user = useUser()
  const [paymentCompleted, setPaymentCompleted] = useState(false)

  // Check if user is banned from purchasing
  const { data: userBansData } = useAPIGetter(
    'get-user-bans',
    user?.id ? { userId: user.id } : undefined
  )
  const isPurchaseBanned = userBansData?.bans
    ? isUserBanned(userBansData.bans as any, 'purchase')
    : false
  const canPay = !isPurchaseBanned

  return (
    <Col className="mx-auto w-full max-w-xl gap-4 px-4 py-6 sm:py-8">
      {/* Main Payment Card */}
      <div className="bg-canvas-0 overflow-hidden rounded-xl shadow-md">
        {/* Header */}
        <div className="border-ink-100 border-b bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4 dark:from-indigo-950/30 dark:to-purple-950/30">
          <Row className="items-center justify-between gap-2">
            <h1 className="text-primary-700 text-xl font-semibold sm:text-2xl">
              Fund with MEX
            </h1>
            <Row className="items-center gap-1 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-3 py-1 text-xs font-bold text-white shadow-sm dark:from-teal-600/80 dark:to-emerald-600/80">
              <span>1 {MEXAS_TOKEN.symbol}</span>
              <ArrowRightIcon className="h-3 w-3" />
              <span>{MEXAS_ACCOUNT_CREDIT_PER_TOKEN} MEX</span>
            </Row>
          </Row>
        </div>

        {/* Payment Status States */}
        {paymentCompleted ? (
          <Col className="items-center p-6 text-center sm:p-8">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30">
              <CheckCircleIcon className="h-8 w-8 text-teal-600" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-teal-600">
              Payment Successful!
            </h2>
            <p className="text-ink-600 mb-6 text-sm">
              Your MEX is being credited to your account. This may take a few
              minutes.
            </p>
            <Link href="/checkout">
              <Button color="indigo" size="lg">
                Back to checkout
              </Button>
            </Link>
          </Col>
        ) : (
          <Col className="gap-4 p-6 sm:p-8">
            <div className="flex justify-center">
              <Image
                src="/buy-mana-graphics/100k.png"
                alt="MEXAS Stablecoin"
                width={140}
                height={140}
                className="object-contain"
              />
            </div>

            <p className="text-ink-600 text-center text-sm">
              Pay with {MEXAS_TOKEN.name} on Arbitrum via Privy.
            </p>

            <Col className="mx-auto w-full max-w-sm gap-3">
              {isPurchaseBanned ? (
                <button
                  disabled
                  className={clsx(
                    'relative w-full overflow-hidden rounded-xl border-2 border-transparent',
                    'cursor-not-allowed bg-gray-400',
                    'px-8 py-4 text-lg font-semibold text-white shadow-lg'
                  )}
                >
                  <Row className="items-center justify-center gap-3">
                    <BanIcon className="h-6 w-6" />
                    <span>Purchases Disabled</span>
                  </Row>
                </button>
              ) : (
                <MexasCheckoutButton
                  disabled={!canPay}
                  onCompleted={() => setPaymentCompleted(true)}
                />
              )}
            </Col>

            <div className="text-ink-600 rounded-lg bg-amber-50/50 p-4 text-sm dark:bg-amber-950/20">
              <p>
                MEXAS payments settle on Arbitrum and{' '}
                <strong className="text-ink-700">are not reversible</strong>.
                Send only {MEXAS_TOKEN.symbol} on Arbitrum to the configured
                treasury wallet.
              </p>
            </div>

            <MexasCreditsTable />
          </Col>
        )}
      </div>
    </Col>
  )
}

export default function CheckoutPage() {
  return (
    <Page trackPageView="checkout page">
      <SEO
        title="Fund with MEX"
        description="Fund your account with MEXAS on Arbitrum."
        url="/checkout"
        image="/buy-mana-graphics/100k.png"
      />

      <CheckoutContent />
    </Page>
  )
}
