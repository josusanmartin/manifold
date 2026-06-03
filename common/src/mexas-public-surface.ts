export const MEXAS_BLOCKED_PUBLIC_PATHS = [
  '/pairs-trader.html',
  '/rps.html',
  '/mtg/index.html',
  '/mtg/guess.html',
  '/mtg/jsons/set.json',
  '/custom-components/manaCoin.tsx',
  '/custom-components/manaFlatCoin.tsx',
  '/mana.svg',
  '/manaFlat.svg',
  '/predictle-logo.png',
  '/prize-drawing-og.png',
  '/manachan.png',
  '/buy-mana-graphics/10k.png',
  '/welcome/manifold-example.gif',
] as const

export function isBlockedMexasPublicPath(pathname: string) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  return MEXAS_BLOCKED_PUBLIC_PATHS.includes(
    normalizedPath as (typeof MEXAS_BLOCKED_PUBLIC_PATHS)[number]
  )
}
