import { ShieldCheckIcon, SwitchHorizontalIcon } from '@heroicons/react/outline'
import { MEXAS_TOKEN } from 'common/crypto/mexas'
import type { ReactNode } from 'react'
import { Button } from 'web/components/buttons/button'
import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { Row } from 'web/components/layout/row'
import { LogoSEO } from 'web/components/LogoSEO'
import { ManifoldLogo } from 'web/components/nav/manifold-logo'
import { useRedirectIfSignedIn } from 'web/hooks/use-redirect-if-signed-in'

export default function LoginPage() {
  const privy = usePrivyLogin()
  useRedirectIfSignedIn('/payments')

  return (
    <Page
      trackPageView={'login page'}
      hideSidebar
      hideBottomBar
      hideFooter
      className="lg:col-span-10"
    >
      <Col className="min-h-screen w-full bg-[#f7f8fa] px-4 py-6 dark:bg-slate-950">
        <LogoSEO />
        <Col className="mx-auto w-full max-w-5xl gap-5">
          <ManifoldLogo className="!w-auto !px-0" />

          <div className="border-ink-200 bg-canvas-0 grid overflow-hidden rounded-md border lg:grid-cols-[minmax(0,1fr)_360px]">
            <Col className="gap-6 p-5 sm:p-8">
              <Col className="gap-2">
                <div className="text-ink-500 text-xs font-semibold uppercase">
                  MEXAS Markets
                </div>
                <h1 className="text-ink-1000 text-3xl font-semibold tracking-normal">
                  Trade with {MEXAS_TOKEN.symbol} on Arbitrum
                </h1>
              </Col>

              <div className="divide-ink-200 border-ink-200 overflow-hidden rounded-md border">
                <LoginRow
                  icon={<ShieldCheckIcon className="h-5 w-5" />}
                  label="Privy account"
                  value="Email or wallet"
                />
                <LoginRow
                  icon={<SwitchHorizontalIcon className="h-5 w-5" />}
                  label="Settlement"
                  value={MEXAS_TOKEN.chainName}
                />
              </div>
            </Col>

            <Col className="border-ink-200 gap-4 border-t p-5 sm:p-8 lg:border-l lg:border-t-0">
              <Col className="gap-1">
                <h2 className="text-ink-1000 text-lg font-semibold">Sign in</h2>
                <p className="text-ink-500 text-sm">
                  Privy creates the account and embedded wallet.
                </p>
              </Col>
              <Button
                color="none"
                size="lg"
                onClick={privy.login}
                disabled={!privy.configured || !privy.ready}
                className="disabled:bg-ink-300 w-full bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
              >
                Continue with Privy
              </Button>
            </Col>
          </div>
        </Col>
      </Col>
    </Page>
  )
}

function LoginRow(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <Row className="items-center justify-between gap-4 px-4 py-3">
      <Row className="text-ink-900 min-w-0 items-center gap-3">
        <span className="text-teal-600">{props.icon}</span>
        <span className="truncate text-sm font-semibold">{props.label}</span>
      </Row>
      <span className="text-ink-500 shrink-0 text-sm">{props.value}</span>
    </Row>
  )
}
