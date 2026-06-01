import { MEXAS_TOKEN } from 'common/crypto/mexas'
import { DisplayUser } from 'common/api/user-types'
import { GetServerSideProps } from 'next'
import { Button } from 'web/components/buttons/button'
import { MexasWalletSummary } from 'web/components/crypto/mexas-wallet-panel'
import { Col } from 'web/components/layout/col'
import { Modal } from 'web/components/layout/modal'
import { useUser } from 'web/hooks/use-user'
import { User } from 'web/lib/firebase/users'

export default function Payments() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/wallet',
    permanent: false,
  },
})

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
    <MexasWalletSummary className="w-full" />
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
            Deposit {MEXAS_TOKEN.symbol} to your Privy wallet on{' '}
            {MEXAS_TOKEN.chainName}.
          </p>
        </Col>
        <MexasWalletSummary />
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
