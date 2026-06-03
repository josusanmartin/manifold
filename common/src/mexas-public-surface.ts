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

function decodePathname(pathname: string) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

function normalizeMexasPublicPath(pathname: string) {
  const decodedPath = decodePathname(pathname)
  const slashPrefixedPath = decodedPath.startsWith('/')
    ? decodedPath
    : `/${decodedPath}`
  const collapsedPath = slashPrefixedPath.replace(/\/+/g, '/')
  const trimmedPath =
    collapsedPath.length > 1 ? collapsedPath.replace(/\/+$/, '') : '/'

  return trimmedPath.toLowerCase()
}

const MEXAS_BLOCKED_PUBLIC_PATH_SET = new Set(
  MEXAS_BLOCKED_PUBLIC_PATHS.map(normalizeMexasPublicPath)
)

export function isBlockedMexasPublicPath(pathname: string) {
  return MEXAS_BLOCKED_PUBLIC_PATH_SET.has(normalizeMexasPublicPath(pathname))
}
