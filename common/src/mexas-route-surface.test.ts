import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

type Redirect = {
  source: string
  destination: string
  permanent: boolean
  has?: { type: string; key: string; value?: string }[]
}

// next.config.js is CommonJS and has no declaration file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../../web/next.config.js') as {
  redirects: () => Promise<Redirect[]>
}

async function getRedirectsBySource() {
  const redirects = await nextConfig.redirects()
  return new Map(redirects.map((redirect) => [redirect.source, redirect]))
}

function listPageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listPageFiles(path)
    return /\.(tsx|ts|jsx|js)$/.test(entry.name) ? [path] : []
  })
}

function readRepoFile(path: string) {
  return readFileSync(join(__dirname, '..', '..', path), 'utf8')
}

function pageFileToRoute(file: string) {
  let route = relative(join(__dirname, '..', '..', 'web', 'pages'), file)
    .replace(/\.(tsx|ts|jsx|js)$/, '')
    .replace(/\\/g, '/')

  if (route === '_app' || route === '_document') return undefined
  if (route === 'index') return '/'
  if (route.endsWith('/index')) route = route.slice(0, -'/index'.length)

  return (
    '/' +
    route
      .replace(/\[\[\.\.\.(.+?)\]\]/g, ':$1*')
      .replace(/\[\.\.\.(.+?)\]/g, ':$1*')
      .replace(/\[(.+?)\]/g, ':$1')
  )
}

function redirectSourceToRouteRegex(source: string) {
  const escaped = source
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:([A-Za-z0-9_]+)\*/g, '(?:/.*)?')
    .replace(/\/:([A-Za-z0-9_]+)\+/g, '/.+')
    .replace(/\/:([A-Za-z0-9_]+)/g, '/[^/]+')

  return new RegExp(`^${escaped}$`)
}

async function getRedirectMatchers() {
  const redirects = await nextConfig.redirects()
  return redirects.map((redirect) => ({
    ...redirect,
    regex: redirectSourceToRouteRegex(redirect.source),
  }))
}

const MEXAS_ALLOWED_PUBLIC_PAGE_ROUTES = new Set([
  '/404',
  '/:username',
  '/:username/:contractSlug',
  '/about',
  '/checkout',
  '/login',
  '/me',
  '/wallet',
])

describe('MEXAS route surface', () => {
  test('redirects legacy product pages away from public launch surface', async () => {
    const redirectsBySource = await getRedirectsBySource()
    const protectedRoutes = [
      '/',
      '/activity',
      '/admin',
      '/admin/:path*',
      '/ai',
      '/ai/:path*',
      '/analytics',
      '/browse',
      '/browse/for-you',
      '/browse/:path*',
      '/browse/:slug+',
      '/dashboard',
      '/dashboard/:path*',
      '/dashboard/:slug',
      '/calibration',
      '/:username/calibration',
      '/charity',
      '/charity/:path*',
      '/calculator',
      '/comments',
      '/complexsystems',
      '/cowp',
      '/create',
      '/create-post',
      '/discord-bot',
      '/embed/:path*',
      '/elections',
      '/election',
      '/election/:path*',
      '/explore',
      '/feed',
      '/find',
      '/group/:slug*',
      '/groups',
      '/home',
      '/home/:newsSlug*',
      '/lab',
      '/labs',
      '/leaderboards',
      '/leaderboards/:path*',
      '/leagues',
      '/leagues/:path*',
      '/live',
      '/mana-auction',
      '/manachan',
      '/membership',
      '/messages',
      '/messages/:path*',
      '/my-calibration',
      '/news',
      '/news/:newsSlug*',
      '/notifications',
      '/og-test/:path*',
      '/old-charity',
      '/old-charity/:path*',
      '/old-posts/:slug*',
      '/pakman',
      '/post/:path*',
      '/posts',
      '/politics',
      '/predictle',
      '/press',
      '/prize',
      '/prize/:path*',
      '/public-messages',
      '/public-messages/:path*',
      '/questions',
      '/redeem',
      '/referrals',
      '/register-on-discord',
      '/reports',
      '/reports/:path*',
      '/search',
      '/server-sitemap.xml',
      '/shop',
      '/shop/:path*',
      '/sign-in-waiting',
      '/sitemap',
      '/sports',
      '/stats',
      '/styles',
      '/supporter',
      '/this-month',
      '/todo',
      '/topic/:path*',
      '/twitch',
      '/tv',
      '/tv/:path*',
      '/versus',
      '/websocket-live',
      '/welcomeoffer',
      '/wrapped',
      '/yc-s23',
    ]

    for (const source of protectedRoutes) {
      expect(redirectsBySource.get(source)).toMatchObject({
        destination: '/checkout',
        permanent: false,
      })
    }
  })

  test('removed legacy product pages are redirect-only stubs', () => {
    const redirectOnlyPages = [
      'web/pages/charity.tsx',
      'web/pages/charity/[giveawayNum].tsx',
      'web/pages/calculator.tsx',
      'web/pages/discord-bot.tsx',
      'web/pages/admin/prize.tsx',
      'web/pages/admin/sales.tsx',
      'web/pages/admin/txns.tsx',
      'web/pages/admin/whales.tsx',
      'web/pages/lab.tsx',
      'web/pages/mana-auction.tsx',
      'web/pages/manachan.tsx',
      'web/pages/notifications.tsx',
      'web/pages/predictle.tsx',
      'web/pages/press.tsx',
      'web/pages/prize.tsx',
      'web/pages/prize/[sweepstakesNum].tsx',
      'web/pages/shop.tsx',
      'web/pages/sitemap.tsx',
      'web/pages/twitch.tsx',
    ]

    for (const path of redirectOnlyPages) {
      const source = readRepoFile(path)

      expect(source).toContain("import { GetServerSideProps } from 'next'")
      expect(source).toContain('return null')
      expect(source).toContain('getServerSideProps: GetServerSideProps')
      expect(source).toContain("destination: '/checkout'")
      expect(source).toContain('permanent: false')
      expect(source.split('\n').length).toBeLessThanOrEqual(14)

      for (const legacyMarker of [
        'useAPIGetter',
        'Predictle',
        'Prize Drawing',
        'Manifold',
        'Mana',
        'Sweepstakes',
        'CryptoProviders',
        'SEO',
        'track(',
      ]) {
        expect(source).not.toContain(legacyMarker)
      }
    }
  })

  test('redirects informational legacy aliases to the MEXAS about page', async () => {
    const redirectsBySource = await getRedirectsBySource()

    for (const source of [
      '/api',
      '/api/v0',
      '/api-docs',
      '/data',
      '/data/:path*',
      '/docs',
      '/docs/:path*',
      '/faq',
      '/mana-only-terms',
      '/privacy-policy',
      '/privacy',
      '/prize-faq',
      '/prize-rules',
      '/sweepstakes-rules',
      '/terms',
    ]) {
      expect(redirectsBySource.get(source)).toMatchObject({
        destination: '/about',
        permanent: false,
      })
    }
  })

  test('does not redirect legacy aliases to blocked legacy pages', async () => {
    const redirects = await nextConfig.redirects()
    const disallowedDestinations = [
      '/browse',
      '/browse/',
      '/dashboard',
      '/election',
      '/lab',
      '/membership',
      '/news',
      '/post',
      '/stats',
      '/topic',
      '/VersusBot',
    ]

    for (const redirect of redirects) {
      expect(
        disallowedDestinations.some((destination) =>
          redirect.destination.startsWith(destination)
        )
      ).toBe(false)
    }
  })

  test('normalizes removed profile tabs to the MEXAS summary tab', async () => {
    const redirectsBySource = await getRedirectsBySource()

    expect(redirectsBySource.get('/:username')).toMatchObject({
      destination: '/:username?tab=summary',
      permanent: false,
      has: [
        {
          type: 'query',
          key: 'tab',
          value: 'comments|achievements',
        },
      ],
    })
  })

  test('every non-API Next page is either a MEXAS page or redirected away', async () => {
    const pageRoutes = listPageFiles(join(__dirname, '..', '..', 'web', 'pages'))
      .map(pageFileToRoute)
      .filter(
        (route): route is string =>
          !!route && route !== '/api' && !route.startsWith('/api/')
      )
    const redirectMatchers = await getRedirectMatchers()

    const unhandledRoutes = pageRoutes
      .filter((route) => !MEXAS_ALLOWED_PUBLIC_PAGE_ROUTES.has(route))
      .filter(
        (route) => !redirectMatchers.some((matcher) => matcher.regex.test(route))
      )
      .sort()

    expect(unhandledRoutes).toEqual([])
  })
})
