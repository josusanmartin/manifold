type Redirect = {
  source: string
  destination: string
  permanent: boolean
  has?: { type: string; key: string; value?: string }[]
}

const nextConfig = require('../../web/next.config.js') as {
  redirects: () => Promise<Redirect[]>
}

async function getRedirectsBySource() {
  const redirects = await nextConfig.redirects()
  return new Map(redirects.map((redirect) => [redirect.source, redirect]))
}

describe('MEXAS route surface', () => {
  test('redirects legacy product pages away from public launch surface', async () => {
    const redirectsBySource = await getRedirectsBySource()
    const protectedRoutes = [
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
      '/embed/:path*',
      '/elections',
      '/find',
      '/group/:slug*',
      '/groups',
      '/home',
      '/home/:newsSlug*',
      '/news',
      '/news/:newsSlug*',
      '/notifications',
      '/og-test/:path*',
      '/old-posts/:slug*',
      '/post/:path*',
      '/posts',
      '/politics',
      '/questions',
      '/search',
      '/server-sitemap.xml',
      '/shop',
      '/shop/:path*',
      '/sign-in-waiting',
      '/sitemap',
      '/supporter',
      '/this-month',
      '/topic/:path*',
      '/versus',
    ]

    for (const source of protectedRoutes) {
      expect(redirectsBySource.get(source)).toMatchObject({
        destination: '/checkout',
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
})
