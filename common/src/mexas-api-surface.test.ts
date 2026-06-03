import {
  MEXAS_BLOCKED_API_SMOKE_PATHS,
  isAllowedMexasApiProxyPath,
  isBlockedMexasApiProxyPath,
} from './mexas-api-surface'

describe('MEXAS public API surface', () => {
  test.each(MEXAS_BLOCKED_API_SMOKE_PATHS)(
    'blocks legacy endpoint %s',
    (path) => {
      expect(isBlockedMexasApiProxyPath(path)).toBe(true)
    }
  )

  test.each([
    'v0/bet',
    'v0/bets',
    'v0/market/mexwcwin26a/mexas-order-readiness',
    'v0/market/mexwcwin26a/mexas-resolution-readiness',
    'v0/market/mexwcwin26a/resolve',
    'v0/revalidate',
  ])('does not classify local MEXAS endpoint %s as legacy', (path) => {
    expect(isBlockedMexasApiProxyPath(path)).toBe(false)
  })

  test.each([
    'v0/user/by-id/example',
    'v0/deployment-id',
    'v0/search-markets-full',
    'v0/txns',
    'v0/me/update',
  ])('blocks unknown external proxy endpoint %s by default', (path) => {
    expect(isBlockedMexasApiProxyPath(path)).toBe(false)
    expect(isAllowedMexasApiProxyPath(path)).toBe(false)
  })

  test('has no external Manifold API proxy allowlist for launch', () => {
    expect(isAllowedMexasApiProxyPath('v0/search-markets-full')).toBe(false)
    expect(isAllowedMexasApiProxyPath('v0/user/by-id/balance')).toBe(false)
  })
})
