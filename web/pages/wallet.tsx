import { MEXAS_TOKEN } from 'common/crypto/mexas'
import { MexasWalletPanel } from 'web/components/crypto/mexas-wallet-panel'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { SEO } from 'web/components/SEO'

function WalletHeader() {
  return (
    <Col className="gap-1">
      <div className="text-ink-500 text-xs font-semibold uppercase">
        Arbitrum One
      </div>
      <h1 className="text-ink-1000 text-3xl font-semibold tracking-normal">
        MEX Wallet
      </h1>
      <p className="text-ink-600 max-w-2xl text-sm">
        Deposit, hold, and withdraw {MEXAS_TOKEN.symbol} directly from your
        Privy wallet. Deposited tokens remain on-chain and available in this
        wallet.
      </p>
    </Col>
  )
}

export default function WalletPage() {
  return (
    <Page trackPageView="mex wallet page">
      <SEO
        title="MEX Wallet"
        description="Deposit and withdraw MEXAS on Arbitrum."
        url="/wallet"
      />
      <Col className="mx-auto w-full max-w-3xl gap-6 px-2 py-6">
        <WalletHeader />
        <MexasWalletPanel />
      </Col>
    </Page>
  )
}
