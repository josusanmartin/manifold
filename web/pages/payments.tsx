import { MEXAS_TOKEN } from 'common/crypto/mexas'
import { DisplayUser } from 'common/api/user-types'
import { Button } from 'web/components/buttons/button'
import { MexasWalletPanel } from 'web/components/crypto/mexas-wallet-panel'
import { Col } from 'web/components/layout/col'
import { Modal } from 'web/components/layout/modal'
import { Page } from 'web/components/layout/page'
import { SEO } from 'web/components/SEO'
import { useUser } from 'web/hooks/use-user'
import { User } from 'web/lib/firebase/users'

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

export default function Payments() {
  return (
    <Page trackPageView="mex wallet page">
      <SEO
        title="MEX Wallet"
        description="Deposit and withdraw MEXAS on Arbitrum."
        url="/payments"
      />
      <Col className="mx-auto w-full max-w-3xl gap-6 px-2 py-6">
        <WalletHeader />
        <MexasWalletPanel />
      </Col>
    </Page>
  )
}

export const UserPayments = (props: { userId: string }) => {
  const { userId } = props
  const user = useUser()

  if (user === undefined) return null

  if (!user || user.id !== userId) {
    return (
      <Col className="border-ink-200 bg-canvas-50 text-ink-600 rounded-md border p-4 text-sm">
        Wallet controls are private to the signed-in account.
      </Col>
    )
  }

  return (
    <Col className="w-full gap-4">
      <WalletHeader />
      <MexasWalletPanel />
    </Col>
  )
}

export const PaymentsModal = (props: {
  fromUser: User
  toUser?: DisplayUser
  show: boolean
  setShow: (show: boolean) => void
  defaultMessage?: string
  defaultAmount?: number
  groupId?: string
  postId?: string
  onSuccess?: (amount: number) => void
}) => {
  const { show, setShow } = props

  return (
    <Modal open={show} setOpen={setShow} size="md">
      <Col className="bg-canvas-0 gap-5 overflow-hidden rounded-xl p-5 shadow-xl">
        <Col className="gap-1">
          <h2 className="text-ink-1000 text-xl font-semibold">MEX Wallet</h2>
          <p className="text-ink-600 text-sm">
            Use your wallet to deposit or withdraw {MEXAS_TOKEN.symbol} on{' '}
            {MEXAS_TOKEN.chainName}.
          </p>
        </Col>
        <MexasWalletPanel />
        <Button
          color="gray-white"
          size="md"
          className="self-end"
          onClick={() => setShow(false)}
        >
          Close
        </Button>
      </Col>
    </Modal>
  )
}
