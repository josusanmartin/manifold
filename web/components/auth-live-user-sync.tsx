import { PrivateUser, User } from 'common/user'
import toast from 'react-hot-toast'
import { useEffectCheckEquality } from 'web/hooks/use-effect-check-equality'
import { useWebsocketPrivateUser, useWebsocketUser } from 'web/hooks/use-user'
import { Row } from './layout/row'
import { TokenNumber } from './widgets/token-number'

export function AuthLiveUserSync(props: {
  authLoaded: boolean
  setPrivateUser: (privateUser: PrivateUser) => void
  setUser: (user: User) => void
  uid: string | undefined
  user: User | null | undefined
}) {
  const { authLoaded, setPrivateUser, setUser, uid, user } = props
  const listenUser = useWebsocketUser(uid)
  useEffectCheckEquality(() => {
    if (authLoaded && listenUser) {
      if (user) {
        const balanceChange = listenUser.balance - user.balance
        const cashBalanceChange = listenUser.cashBalance - user.cashBalance

        if (balanceChange > 0 || cashBalanceChange > 0) {
          showToast(balanceChange, cashBalanceChange)
        }
      }
      setUser(listenUser)
    }
  }, [authLoaded, listenUser])

  const listenPrivateUser = useWebsocketPrivateUser(uid)
  useEffectCheckEquality(() => {
    if (authLoaded && listenPrivateUser) setPrivateUser(listenPrivateUser)
  }, [authLoaded, listenPrivateUser])

  return null
}

const showToast = (manaChange: number, cashChange: number) => {
  toast.success(
    <Row className="gap-1">
      <span>Recibido</span>
      {manaChange > 0 && (
        <Row className="items-center justify-center">
          +
          <TokenNumber
            amount={manaChange}
            className="font-bold"
            coinType="MEX"
          />
          {cashChange > 0 && <span className="mx-1">&</span>}
        </Row>
      )}
      {cashChange > 0 && (
        <Row className="items-center justify-center">
          +
          <TokenNumber
            amount={cashChange}
            className="font-bold"
            coinType="CASH"
          />
        </Row>
      )}
    </Row>,
    { duration: 5000, icon: '🎉' }
  )
}
