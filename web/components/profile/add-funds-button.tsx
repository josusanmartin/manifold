import { useRouter } from 'next/router'
import { useUser } from 'web/hooks/use-user'
import { Button, SizeType } from '../buttons/button'

export function AddFundsButton(props: {
  userId?: string
  className?: string
  size?: SizeType
}) {
  const { userId, className, size } = props
  const user = useUser()
  const router = useRouter()

  if (!userId || user?.id !== userId) return null

  return (
    <Button
      onClick={() =>
        router.asPath.includes('/wallet')
          ? router.reload()
          : router.push('/wallet')
      }
      size={size ?? 'md'}
      color="none"
      className={`disabled:bg-ink-300 bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 ${
        className ?? ''
      }`}
    >
      Cartera
    </Button>
  )
}
