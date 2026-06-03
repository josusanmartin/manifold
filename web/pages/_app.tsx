import type { AppProps } from 'next/app'
import { Figtree } from 'next/font/google'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { AuthProvider, AuthUser } from 'web/components/auth-context'
import { PrivyWalletProviders } from 'web/components/crypto/privy-wallet-providers'
import { NativeMessageProvider } from 'web/components/native-message-provider'
import { Sweepstakes } from 'web/components/sweepstakes-provider'
import { OptimisticEntitlementsProvider } from 'web/hooks/use-optimistic-entitlements'
import { useHasLoaded } from 'web/hooks/use-has-loaded'
import { useIOSBodyFix } from 'web/hooks/use-ios-body-fix'
import { useMobileScrollRestoration } from 'web/hooks/use-mobile-scroll-restoration'
import { useRefreshAllClients } from 'web/hooks/use-refresh-all-clients'
import { ThemeProvider } from 'web/hooks/use-theme'
import {
  MEXAS_SITE_DESCRIPTION,
  MEXAS_SITE_NAME,
  MEXAS_SITE_URL,
} from 'web/lib/mexas-brand'
import { getIsNative } from 'web/lib/native/is-native'
import { postMessageToNative } from 'web/lib/native/post-message'
import { DevtoolsDetector, setupDevtoolsDetector } from 'web/lib/util/devtools'
import '../styles/globals.css'
// See https://nextjs.org/docs/basic-features/font-optimization#google-fonts
// and if you add a font, you must add it to tailwind config as well for it to work.

const mainFont = Figtree({
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-main',
  subsets: ['latin'],
})

function firstLine(msg: string) {
  const newlineIndex = msg.indexOf('\n')
  if (newlineIndex === -1) {
    return msg
  }
  return msg.substring(0, newlineIndex)
}

// It can be very hard to see client logs on native, so send them manually
if (getIsNative()) {
  const log = console.log.bind(console)
  console.log = (...args) => {
    postMessageToNative('log', { args })
    log(...args)
  }
  console.error = (...args) => {
    postMessageToNative('log', { args })
    log(...args)
  }
}

function printBuildInfo() {
  // These are undefined if e.g. dev server
  if (process.env.NEXT_PUBLIC_VERCEL_ENV) {
    const env = process.env.NEXT_PUBLIC_VERCEL_ENV
    const msg = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE
    const owner = process.env.NEXT_PUBLIC_VERCEL_GIT_REPO_OWNER
    const repo = process.env.NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG
    const sha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
    const url = `https://github.com/${owner}/${repo}/commit/${sha}`
    console.info(`Build: ${env} / ${firstLine(msg || '???')} / ${url}`)
  }
}

// ian: Required by GambleId
const useDevtoolsDetector = () => {
  const [_, setDetector] = useState<DevtoolsDetector | null>(null)
  const [isDevtoolsOpen, setIsDevtoolsOpen] = useState(false)

  useEffect(() => {
    const ignore =
      window.location.host === 'localhost:3000' ||
      process.env.NEXT_PUBLIC_FIREBASE_ENV === 'DEV'

    if (ignore) {
      return
    }
    const devtoolsDetector = setupDevtoolsDetector()
    setDetector(devtoolsDetector)

    devtoolsDetector.config.onDetectOpen = () => {
      setIsDevtoolsOpen(true)
    }

    // Start detecting right away
    devtoolsDetector.paused = false

    return () => {
      // Pause the detector when component unmounts
      devtoolsDetector.paused = true
    }
  }, [])
  return isDevtoolsOpen
}

// specially treated props that may be present in the server/static props
type ManifoldPageProps = { auth?: AuthUser }

function MyApp({ Component, pageProps }: AppProps<ManifoldPageProps>) {
  useEffect(printBuildInfo, [])
  useHasLoaded()
  useRefreshAllClients()
  useIOSBodyFix()
  useMobileScrollRestoration()

  // ian: Required by GambleId
  const devToolsOpen = false //useDevtoolsDetector()
  const router = useRouter()

  useEffect(() => {
    const handleRouteChange = (url: string) => {
      ;(window as any).dataLayer?.push({
        event: 'page_view',
        page_path: url,
        page_location: window.location.href,
        page_title: document.title,
        'gtm.start': new Date().getTime(),
      })
    }
    router.events.on('routeChangeComplete', handleRouteChange)
    return () => {
      router.events.off('routeChangeComplete', handleRouteChange)
    }
  }, [router.events])

  const title = MEXAS_SITE_NAME
  const description = MEXAS_SITE_DESCRIPTION

  return (
    <>
      <Head>
        <title>{title}</title>

        <meta
          property="og:title"
          name="twitter:title"
          content={title}
          key="title"
        />
        <meta name="description" content={description} key="description1" />
        <meta
          property="og:description"
          name="twitter:description"
          content={description}
          key="description2"
        />
        <meta property="og:url" content={MEXAS_SITE_URL} key="url" />
        <meta property="og:site_name" content={MEXAS_SITE_NAME} />
        <meta name="twitter:card" content="summary" key="card" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        {/* set safari overscroll/address bar to canvas-0. TODO: change based on site theme preference */}
        <meta
          name="theme-color"
          content="#1e293b"
          media="(prefers-color-scheme: dark)"
        />
        <meta
          name="theme-color"
          content="#fdfeff"
          media="(prefers-color-scheme: light)"
        />
      </Head>
      <style>
        {`html {
          --font-main: ${mainFont.style.fontFamily};
        }`}
      </style>

      {/*
        ian: It would be nice to find a way to let people take screenshots of a crash + console log.
        One idea: just disable them for !user.sweepstakesVerified users.
        */}
      {devToolsOpen ? (
        <div
          className={'flex h-screen flex-col items-center justify-center p-4'}
        >
          No puedes usar herramientas de desarrollo con MEXAS. Cierra las
          herramientas y actualiza la página.
        </div>
      ) : (
        <ThemeProvider>
          <a
            href="#main-content"
            className="focus:bg-primary-500 focus:text-ink-0 sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded focus:px-4 focus:py-2"
          >
            Saltar al contenido principal
          </a>
          <PrivyWalletProviders>
            <AuthProvider serverUser={pageProps.auth}>
              <OptimisticEntitlementsProvider>
                <Sweepstakes>
                  <NativeMessageProvider>
                    <Component {...pageProps} />
                  </NativeMessageProvider>
                </Sweepstakes>
              </OptimisticEntitlementsProvider>
            </AuthProvider>
          </PrivyWalletProviders>
        </ThemeProvider>
      )}
    </>
  )
}

export default MyApp
