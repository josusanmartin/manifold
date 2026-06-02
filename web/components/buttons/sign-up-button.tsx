import clsx from 'clsx'

import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'
import { Button } from './button'
import { Col } from '../layout/col'
import { Row } from 'web/components/layout/row'

export const SidebarSignUpButton = (props: { className?: string }) => {
  const { className } = props
  const privy = usePrivyLogin()

  return (
    <Col className={clsx('mt-4', className)}>
      <Button
        color="none"
        size="xl"
        onClick={privy.login}
        disabled={!privy.configured || !privy.ready}
        className="disabled:bg-ink-300 w-full bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
      >
        Registrarse con Privy
      </Button>
    </Col>
  )
}

export const SignUpButton = (props: { className?: string }) => {
  const { className } = props
  const privy = usePrivyLogin()

  return (
    <Button
      color="none"
      size="md"
      onClick={privy.login}
      disabled={!privy.configured || !privy.ready}
      className={clsx(
        'disabled:bg-ink-300 bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100',
        className
      )}
    >
      Registrarse
    </Button>
  )
}

export const GoogleSignInButton = (props: { onClick: () => any }) => {
  return (
    <Button
      onClick={props.onClick}
      color="none"
      size={'lg'}
      className="whitespace-nowrap bg-slate-950 text-white shadow-sm outline-2 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
    >
      <Row className={'items-center gap-2 p-2'}>
        <img
          src="/google.svg"
          alt=""
          width={24}
          height={24}
          className="rounded-full bg-white"
        />
        <span>Iniciar sesión con Google</span>
      </Row>
    </Button>
  )
}
