export const MEXAS_BLOCKED_PUBLIC_PATHS = [
  '/SweepiesFlat.svg',
  '/SweepiesFlatX.svg',
  '/ai.png',
  '/black-ios-badge.png',
  '/dgg-logo.svg',
  '/discord-logo.svg',
  '/discord-ss.png',
  '/election-map24.png',
  '/flappy-logo.gif',
  '/google.svg',
  '/images/Manifest_Logo.png',
  '/images/cash-icon.png',
  '/images/donate.png',
  '/logo-april-fools.svg',
  '/logo-banner.png',
  '/logo-bat-black.png',
  '/logo-bat-blue.png',
  '/logo-bat-white.png',
  '/logo-cover.png',
  '/logo-flapping-with-money.gif',
  '/logo-turkey.png',
  '/logo-white.svg',
  '/logo.png',
  '/logo.svg',
  '/money-bag.svg',
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
  '/midterms2022.png',
  '/simple-bat-blue.png',
  '/simple-bat-white.png',
  '/spice.svg',
  '/stylized-crane-black.png',
  '/sweepies.svg',
  '/sweeps-infographic.svg',
  '/testimonials/astralCodexTen.png',
  '/testimonials/destinyicon.jpg',
  '/testimonials/eliezerYudkowsky.jpeg',
  '/testimonials/snecko.jpeg',
  '/twitch-bot-obs-screenshot.jpg',
  '/twitch-glitch.svg',
  '/twitch-logo.png',
  '/twitter-logo.svg',
  '/buy-mana-graphics/10k.png',
  '/welcome/manifold-example.gif',
] as const

export const MEXAS_BLOCKED_PUBLIC_PATH_PREFIXES = [
  '/achievement-badges/',
  '/buy-mana-graphics/',
  '/cards/',
  '/complex-systems/',
  '/data/',
  '/landing/',
  '/lottie/',
  '/market-tiers/',
  '/merch/',
  '/mp3s/',
  '/pakman/',
  '/political-candidates/',
  '/politics-party/',
  '/sounds/',
  '/theoremone/',
  '/welcome/',
] as const

export const MEXAS_BLOCKED_PUBLIC_SMOKE_PATHS = [
  ...MEXAS_BLOCKED_PUBLIC_PATHS,
  '/achievement-badges/totalVolumeMana.png',
  '/cards/back_green.png',
  '/complex-systems/complex-systems.jpg',
  '/data/elections-data.ts',
  '/landing/stonks.png',
  '/lottie/money-bag.json',
  '/market-tiers/Premium.svg',
  '/merch/White-Logo-Cap-Black.png',
  '/mp3s/coins.mp3',
  '/pakman/pakman_show.png',
  '/political-candidates/trump.png',
  '/politics-party/democrat_symbol.png',
  '/sounds/droplet3.m4a',
  '/theoremone/TheoremOne-Logo.svg',
  '/welcome/treasure.png',
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

const MEXAS_BLOCKED_PUBLIC_PATH_PREFIXES_NORMALIZED =
  MEXAS_BLOCKED_PUBLIC_PATH_PREFIXES.map(normalizeMexasPublicPath)

export function isBlockedMexasPublicPath(pathname: string) {
  const path = normalizeMexasPublicPath(pathname)
  return (
    MEXAS_BLOCKED_PUBLIC_PATH_SET.has(path) ||
    MEXAS_BLOCKED_PUBLIC_PATH_PREFIXES_NORMALIZED.some((prefix) =>
      path.startsWith(prefix)
    )
  )
}
