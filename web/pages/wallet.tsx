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
        Wallet MEX
      </h1>
      <p className="text-ink-600 max-w-2xl text-sm">
        Deposita, conserva y retira {MEXAS_TOKEN.symbol} directamente desde tu
        Wallet Privy. Los tokens depositados permanecen en cadena y disponibles
        en esta Wallet.
      </p>
    </Col>
  )
}

export default function WalletPage() {
  return (
    <Page trackPageView="mex wallet page">
      <SEO
        title="Wallet MEX"
        description="Deposita y retira MEXAS en Arbitrum."
        url="/wallet"
      />
      <Col className="mx-auto w-full max-w-3xl gap-6 px-2 py-6">
        <WalletHeader />
        <MexasWalletPanel />
      </Col>
    </Page>
  )
}
