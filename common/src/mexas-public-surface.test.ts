import {
  isBlockedMexasPublicPath,
  MEXAS_BLOCKED_PUBLIC_SMOKE_PATHS,
} from './mexas-public-surface'

describe('MEXAS public static surface', () => {
  test.each([
    '/mana.svg',
    '/MANA.svg',
    '/%6dana.svg',
    '//mana.svg',
    '/logo.svg',
    '/SweepiesFlat.svg',
    '/twitter-logo.svg',
    '/achievement-badges/totalVolumeMana.png',
    '/achievement-badges/highestNetworthMana.png',
    '/buy-mana-graphics/100k.png',
    '/cards/back_green.png',
    '/landing/stonks.png',
    '/lottie/money-bag.json',
    '/market-tiers/Premium.svg',
    '/merch/White-Logo-Cap-Black.png',
    '/political-candidates/trump.png',
    '/politics-party/democrat_symbol.png',
    '/theoremone/TheoremOne-Logo.svg',
    '/welcome/treasure.png',
    '/welcome/manifold-example.gif',
  ])('blocks legacy public asset %s', (path) => {
    expect(isBlockedMexasPublicPath(path)).toBe(true)
  })

  test.each([
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
    '/opensearch.xml',
    '/testimonials/testimonials.json',
    '/images/default-avatar.png',
    '/fonts/ReadexPro-Regular.ttf',
  ])('allows launch static asset %s', (path) => {
    expect(isBlockedMexasPublicPath(path)).toBe(false)
  })

  test('smoke list covers direct files and representative blocked folders', () => {
    for (const path of [
      '/logo.svg',
      '/mana.svg',
      '/achievement-badges/totalVolumeMana.png',
      '/merch/White-Logo-Cap-Black.png',
      '/welcome/treasure.png',
    ]) {
      expect(MEXAS_BLOCKED_PUBLIC_SMOKE_PATHS).toContain(path)
    }
  })
})
