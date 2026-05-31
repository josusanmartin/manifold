import { Button } from 'web/components/buttons/button'
import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { LogoSEO } from 'web/components/LogoSEO'
import { ManifoldLogo } from 'web/components/nav/manifold-logo'
import { useRedirectIfSignedIn } from 'web/hooks/use-redirect-if-signed-in'

export default function LoginPage() {
  const privy = usePrivyLogin()
  useRedirectIfSignedIn()

  return (
    <Page trackPageView={'login page'} hideSidebar>
      <Col className="mx-auto mt-8 w-full max-w-md items-center gap-8 px-4">
        <ManifoldLogo className="!w-auto" />
        <LogoSEO />

        <Col className="bg-canvas-0 flex w-full flex-col gap-6 rounded-lg p-8 shadow-md">
          <h1 className="text-primary-500 text-center text-2xl font-medium">
            Sign up with Privy
          </h1>
          <Button
            color="gradient"
            size="lg"
            onClick={privy.login}
            disabled={!privy.configured || !privy.ready}
          >
            Continue with Privy
          </Button>
        </Col>
      </Col>
    </Page>
  )
}
