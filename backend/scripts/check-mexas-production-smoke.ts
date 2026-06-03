import { MEXAS_BLOCKED_API_SMOKE_PATHS } from 'common/mexas-api-surface'
import { MEXAS_BLOCKED_PUBLIC_PATHS } from 'common/mexas-public-surface'

type SmokeResult = {
  details: string
  name: string
  status: 'pass' | 'fail'
}

const SITE_URL =
  process.env.MEXAS_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://mexas-manifold.vercel.app'

const SMOKE_FETCH_TIMEOUT_MS = Number(
  process.env.MEXAS_SMOKE_FETCH_TIMEOUT_MS ?? 15_000
)

const FORBIDDEN_VISIBLE_COPY = [
  'Receive Mana',
  'Send Mana',
  'Get mana',
  'Your mana balance',
  'Manifold',
  'manifold.markets',
  'manifoldmarkets',
  'Verify your identity',
  'Verifica tu identidad',
  'Cartera',
  'Contexto del mercado',
  'Comentarios',
  'Comments',
  'Boost',
  'Follow',
  'Twitter',
  'LinkedIn',
  'Prize Drawain',
  'Predictle',
  'Preedictle',
  'Open options',
]

const FORBIDDEN_JSON_COPY = [
  'MANA',
  'Mana',
  'M$',
  'Manifold',
  'manifold.markets',
  'manifoldmarkets',
  'Verify your identity',
  'Cartera',
  'Contexto del mercado',
  'Comments',
  'Boost',
  'Prize Drawain',
  'Predictle',
  'Preedictle',
  'Open options',
]

const PAGES = [
  {
    path: '/about',
    required: ['MEXAS Markets', 'MEX en Arbitrum', 'Wallet integrada de Privy'],
  },
  {
    path: '/login',
    required: [
      'Continuar con Privy',
      'Privy crea la cuenta y la Wallet integrada',
    ],
  },
  {
    path: '/wallet',
    required: ['Wallet MEX', 'Wallet Privy', 'Cargando Wallet'],
  },
  {
    path: '/checkout',
    required: ['Abre órdenes límite desde tu Wallet', 'Abrir mercado'],
  },
  {
    path: '/josusanmartin?tab=summary',
    required: ['Wallet'],
  },
  {
    path: '/mexas-test/ganara-mexico-la-copa-mundial-2026',
    required: [
      '¿Ganará México la Copa Mundial 2026?',
      'Libro de órdenes',
      'Compras SÍ',
      'Ventas SÍ',
      'Orden SÍ',
      'Orden NO',
    ],
  },
  {
    path: '/mexas-test/will-the-russia-ukraine-war-end-by-december-31-2026',
    required: [
      'Libro de órdenes',
      'Compras SÍ',
      'Ventas SÍ',
      'Orden SÍ',
      'Orden NO',
    ],
  },
]

const REDIRECTS = [
  { destination: '/checkout', path: '/' },
  { destination: '/checkout', path: '/activity' },
  { destination: '/checkout', path: '/admin' },
  { destination: '/checkout', path: '/admin/cash-stats' },
  { destination: '/checkout', path: '/ai/test' },
  { destination: '/checkout', path: '/analytics' },
  { destination: '/checkout', path: '/browse' },
  { destination: '/checkout', path: '/browse/for-you' },
  { destination: '/checkout', path: '/browse/politics' },
  { destination: '/checkout', path: '/calibration' },
  { destination: '/checkout', path: '/charity' },
  { destination: '/checkout', path: '/charity/1' },
  { destination: '/checkout', path: '/calculator' },
  { destination: '/checkout', path: '/complexsystems' },
  { destination: '/checkout', path: '/cowp' },
  { destination: '/checkout', path: '/create' },
  { destination: '/checkout', path: '/create-post' },
  { destination: '/checkout', path: '/dashboard' },
  { destination: '/checkout', path: '/dashboard/test' },
  { destination: '/checkout', path: '/discord-bot' },
  { destination: '/checkout', path: '/election/needle' },
  { destination: '/checkout', path: '/elections' },
  { destination: '/checkout', path: '/explore' },
  { destination: '/checkout', path: '/feed' },
  { destination: '/checkout', path: '/find' },
  { destination: '/checkout', path: '/groups' },
  { destination: '/checkout', path: '/group/test' },
  { destination: '/checkout', path: '/home' },
  { destination: '/checkout', path: '/lab' },
  { destination: '/checkout', path: '/labs' },
  { destination: '/checkout', path: '/leagues' },
  { destination: '/checkout', path: '/leagues/test' },
  { destination: '/checkout', path: '/live' },
  { destination: '/checkout', path: '/membership' },
  { destination: '/checkout', path: '/messages' },
  { destination: '/checkout', path: '/messages/test' },
  { destination: '/checkout', path: '/my-calibration' },
  { destination: '/checkout', path: '/news' },
  { destination: '/checkout', path: '/news/test' },
  { destination: '/checkout', path: '/notifications' },
  { destination: '/checkout', path: '/old-charity' },
  { destination: '/checkout', path: '/old-charity/test' },
  { destination: '/checkout', path: '/old-posts/test' },
  { destination: '/checkout', path: '/og-test/test' },
  { destination: '/checkout', path: '/pakman' },
  { destination: '/checkout', path: '/politics' },
  { destination: '/checkout', path: '/post/test' },
  { destination: '/checkout', path: '/posts' },
  { destination: '/checkout', path: '/press' },
  { destination: '/checkout', path: '/public-messages/test' },
  { destination: '/checkout', path: '/questions' },
  { destination: '/checkout', path: '/redeem' },
  { destination: '/checkout', path: '/referrals' },
  { destination: '/checkout', path: '/register-on-discord' },
  { destination: '/checkout', path: '/reports' },
  { destination: '/checkout', path: '/reports/test' },
  { destination: '/checkout', path: '/search' },
  { destination: '/checkout', path: '/server-sitemap.xml' },
  { destination: '/checkout', path: '/sports' },
  { destination: '/checkout', path: '/stats' },
  { destination: '/checkout', path: '/styles' },
  { destination: '/checkout', path: '/supporter' },
  { destination: '/checkout', path: '/this-month' },
  { destination: '/checkout', path: '/todo' },
  { destination: '/checkout', path: '/topic/test' },
  { destination: '/checkout', path: '/twitch' },
  { destination: '/checkout', path: '/tv' },
  { destination: '/checkout', path: '/tv/test' },
  { destination: '/checkout', path: '/umami' },
  { destination: '/checkout', path: '/versus' },
  { destination: '/checkout', path: '/websocket-live' },
  { destination: '/checkout', path: '/welcomeoffer' },
  { destination: '/checkout', path: '/wrapped' },
  { destination: '/checkout', path: '/yc-s23' },
  { destination: '/wallet', path: '/payments' },
  { destination: '/wallet', path: '/add-funds' },
  { destination: '/wallet', path: '/links' },
  {
    path: '/josusanmartin?tab=comments',
    destination: '/josusanmartin?tab=summary',
  },
  {
    path: '/josusanmartin?tab=achievements',
    destination: '/josusanmartin?tab=summary',
  },
  { destination: '/checkout', path: '/comments' },
  { destination: '/checkout', path: '/leaderboards' },
  { destination: '/checkout', path: '/mana-auction' },
  { destination: '/checkout', path: '/manachan' },
  { destination: '/checkout', path: '/predictle' },
  { destination: '/checkout', path: '/prize' },
  { destination: '/checkout', path: '/shop' },
  { destination: '/checkout', path: '/sitemap' },
  { destination: '/about', path: '/api' },
  { destination: '/about', path: '/api/v0' },
  { destination: '/about', path: '/mana-only-terms' },
  { destination: '/about', path: '/privacy' },
  { destination: '/about', path: '/sweepstakes-rules' },
  { destination: '/about', path: '/terms' },
]

const BLOCKED_API_PATHS = [
  ...MEXAS_BLOCKED_API_SMOKE_PATHS.map((path) => `/api/${path}`),
  '/api/og/market',
  '/api/og/topic',
  '/api/og/update',
  '/api/v0/deployment-id',
  '/api/v0/search-markets-full',
  '/api/v0/user/by-id/balance',
]

const STATIC_FILES = [
  {
    path: '/sitemap.xml',
    required: [
      'https://mexas-manifold.vercel.app/checkout',
      'https://mexas-manifold.vercel.app/wallet',
      'ganara-mexico-la-copa-mundial-2026',
    ],
  },
  {
    path: '/robots.txt',
    required: [
      'Host: https://mexas-manifold.vercel.app',
      'Sitemap: https://mexas-manifold.vercel.app/sitemap.xml',
    ],
  },
  {
    path: '/opensearch.xml',
    required: [
      '<ShortName>MEXAS</ShortName>',
      'https://mexas-manifold.vercel.app/checkout',
    ],
  },
  {
    path: '/testimonials/testimonials.json',
    required: ['"testimonials": []'],
  },
]

const BLOCKED_STATIC_PATHS = [...MEXAS_BLOCKED_PUBLIC_PATHS]

const JSON_PAYLOADS = [
  {
    name: 'json orderbook mexwcwin26a',
    path: '/api/mexas-order-book?contractId=mexwcwin26a',
  },
  {
    name: 'json orderbook ukrwarend26a',
    path: '/api/mexas-order-book?contractId=ukrwarend26a',
  },
  {
    name: 'json bets mexwcwin26a',
    path: '/api/v0/bets?contractId=mexwcwin26a&kinds=open-limit',
  },
  {
    name: 'json order readiness mexwcwin26a',
    path: '/api/v0/market/mexwcwin26a/mexas-order-readiness',
  },
  {
    name: 'json order readiness ukrwarend26a',
    path: '/api/v0/market/ukrwarend26a/mexas-order-readiness',
  },
]

function pass(name: string, details: string): SmokeResult {
  return { details, name, status: 'pass' }
}

function fail(name: string, details: string): SmokeResult {
  return { details, name, status: 'fail' }
}

function decodeEntities(input: string) {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function getVisibleText(html: string) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function describeFetchError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

async function smokeFetch(path: string, init?: RequestInit) {
  try {
    return await fetch(`${SITE_URL}${path}`, {
      signal: AbortSignal.timeout(SMOKE_FETCH_TIMEOUT_MS),
      ...init,
    })
  } catch (error) {
    throw new Error(
      `Fetch ${path} failed after ${SMOKE_FETCH_TIMEOUT_MS}ms: ${describeFetchError(
        error
      )}`
    )
  }
}

async function fetchText(path: string) {
  const response = await smokeFetch(path, { redirect: 'follow' })
  const text = await response.text()
  return { response, text }
}

async function fetchManual(path: string, init?: RequestInit) {
  const response = await smokeFetch(path, {
    redirect: 'manual',
    ...init,
  })
  const text = await response.text()
  return { response, text }
}

async function checkRedirect(path: string, destination: string) {
  const response = await smokeFetch(path, { redirect: 'manual' })
  const location = response.headers.get('location') ?? ''
  const decodedLocation = decodeEntities(decodeURIComponentSafe(location))
  const forbiddenLocation = FORBIDDEN_VISIBLE_COPY.filter((copy) =>
    decodedLocation.includes(copy)
  )
  if (forbiddenLocation.length) {
    return fail(
      `redirect ${path}`,
      `Forbidden destination copy: ${forbiddenLocation.join(', ')}`
    )
  }

  const locationUrl = location ? new URL(location, SITE_URL) : undefined
  const actualDestination = locationUrl
    ? destination.includes('?')
      ? `${locationUrl.pathname}${locationUrl.search}`
      : locationUrl.pathname
    : ''

  return response.status >= 300 &&
    response.status < 400 &&
    actualDestination === destination
    ? pass(`redirect ${path}`, `${response.status} -> ${destination}`)
    : fail(
        `redirect ${path}`,
        `${response.status} -> ${location || 'no location'}`
      )
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function checkPage(path: string, required: string[]) {
  const results: SmokeResult[] = []
  const { response, text } = await fetchText(path)
  const visibleText = getVisibleText(text)

  results.push(
    response.status >= 200 && response.status < 400
      ? pass(`page ${path}`, `${response.status}`)
      : fail(`page ${path}`, `${response.status}`)
  )

  const missingRequired = required.filter((copy) => !visibleText.includes(copy))
  results.push(
    missingRequired.length
      ? fail(`copy ${path}`, `Missing: ${missingRequired.join(', ')}`)
      : pass(`copy ${path}`, 'Required visible copy is present.')
  )

  const forbidden = FORBIDDEN_VISIBLE_COPY.filter((copy) =>
    visibleText.includes(copy)
  )
  results.push(
    forbidden.length
      ? fail(`legacy copy ${path}`, `Found: ${forbidden.join(', ')}`)
      : pass(`legacy copy ${path}`, 'No forbidden visible copy found.')
  )

  return results
}

async function checkStaticFile(path: string, required: string[]) {
  const results: SmokeResult[] = []
  const { response, text } = await fetchText(path)

  results.push(
    response.status >= 200 && response.status < 400
      ? pass(`static ${path}`, `${response.status}`)
      : fail(`static ${path}`, `${response.status}`)
  )

  const missingRequired = required.filter((copy) => !text.includes(copy))
  results.push(
    missingRequired.length
      ? fail(`static copy ${path}`, `Missing: ${missingRequired.join(', ')}`)
      : pass(`static copy ${path}`, 'Required static copy is present.')
  )

  const forbidden = FORBIDDEN_VISIBLE_COPY.filter((copy) => text.includes(copy))
  results.push(
    forbidden.length
      ? fail(`static legacy copy ${path}`, `Found: ${forbidden.join(', ')}`)
      : pass(`static legacy copy ${path}`, 'No forbidden static copy found.')
  )

  return results
}

async function checkBlockedStaticFile(path: string) {
  const { response } = await fetchManual(path)
  return response.status === 404
    ? pass(`blocked static ${path}`, '404')
    : fail(`blocked static ${path}`, `${response.status}`)
}

async function checkOrderBook(contractId: string) {
  const { response, text } = await fetchText(
    `/api/mexas-order-book?contractId=${encodeURIComponent(contractId)}`
  )
  if (response.status < 200 || response.status >= 400) {
    return fail(`orderbook ${contractId}`, `${response.status}`)
  }

  try {
    const data = JSON.parse(text)
    return Array.isArray(data)
      ? pass(`orderbook ${contractId}`, `${data.length} open rows`)
      : fail(`orderbook ${contractId}`, 'Response is not an array.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`orderbook ${contractId}`, message)
  }
}

async function checkOrderReadiness(contractId: string) {
  const { response, text } = await fetchText(
    `/api/v0/market/${encodeURIComponent(contractId)}/mexas-order-readiness`
  )
  if (response.status < 200 || response.status >= 400) {
    return fail(`order readiness ${contractId}`, `${response.status}`)
  }

  try {
    const data = JSON.parse(text)
    const valid =
      data &&
      typeof data === 'object' &&
      typeof data.canPlaceOrders === 'boolean' &&
      typeof data.escrowCaptureEnabled === 'boolean' &&
      typeof data.matchingEngineReady === 'boolean'
    if (!valid) {
      return fail(
        `order readiness ${contractId}`,
        'Response does not include readiness booleans.'
      )
    }

    const hasMessage =
      typeof data.message === 'string' && data.message.trim().length > 0
    if (data.escrowCaptureEnabled && !data.matchingEngineReady) {
      return fail(
        `order readiness ${contractId}`,
        'Escrow capture cannot be enabled while matching is not ready.'
      )
    }
    if (data.matchingEngineReady && !data.escrowCaptureEnabled) {
      return fail(
        `order readiness ${contractId}`,
        'Matching cannot be ready while escrow capture is disabled.'
      )
    }
    if (!data.canPlaceOrders && !hasMessage) {
      return fail(
        `order readiness ${contractId}`,
        'Paused order placement is missing an operator message.'
      )
    }
    if (
      data.canPlaceOrders &&
      !data.escrowCaptureEnabled &&
      !data.matchingEngineReady &&
      !hasMessage
    ) {
      return fail(
        `order readiness ${contractId}`,
        'Resting-only order mode is missing an operator message.'
      )
    }

    return pass(
      `order readiness ${contractId}`,
      `canPlaceOrders=${data.canPlaceOrders}, escrowCaptureEnabled=${data.escrowCaptureEnabled}, matchingEngineReady=${data.matchingEngineReady}`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`order readiness ${contractId}`, message)
  }
}

async function checkBlockedResolutionReadiness(contractId: string) {
  const { response } = await fetchText(
    `/api/v0/market/${encodeURIComponent(
      contractId
    )}/mexas-resolution-readiness`
  )
  return response.status === 401
    ? pass(`auth blocked resolution readiness ${contractId}`, '401')
    : fail(`blocked resolution readiness ${contractId}`, `${response.status}`)
}

async function checkBlockedOrderReadiness(contractId: string) {
  const { response } = await fetchText(
    `/api/v0/market/${encodeURIComponent(contractId)}/mexas-order-readiness`
  )
  return response.status === 404
    ? pass(`blocked order readiness ${contractId}`, '404')
    : fail(`blocked order readiness ${contractId}`, `${response.status}`)
}

async function checkBlockedOrderBook(contractId: string) {
  const { response } = await fetchText(
    `/api/mexas-order-book?contractId=${encodeURIComponent(contractId)}`
  )
  return response.status === 404
    ? pass(`blocked orderbook ${contractId}`, '404')
    : fail(`blocked orderbook ${contractId}`, `${response.status}`)
}

async function checkBlockedBets(contractId: string) {
  const { response } = await fetchText(
    `/api/v0/bets?contractId=${encodeURIComponent(contractId)}`
  )
  return response.status === 404
    ? pass(`blocked bets ${contractId}`, '404')
    : fail(`blocked bets ${contractId}`, `${response.status}`)
}

async function checkBetsArray(path: string, name: string) {
  const { response, text } = await fetchText(path)
  if (response.status < 200 || response.status >= 400) {
    return fail(name, `${response.status}`)
  }

  try {
    const data = JSON.parse(text)
    return Array.isArray(data)
      ? pass(name, `${data.length} rows`)
      : fail(name, 'Response is not an array.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(name, message)
  }
}

async function checkJsonPayloadCopy(name: string, path: string) {
  const { response, text } = await fetchText(path)
  if (response.status < 200 || response.status >= 400) {
    return fail(name, `${response.status}`)
  }

  try {
    JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(name, `Invalid JSON: ${message}`)
  }

  const forbidden = FORBIDDEN_JSON_COPY.filter((copy) => text.includes(copy))
  return forbidden.length
    ? fail(name, `Forbidden JSON copy: ${forbidden.join(', ')}`)
    : pass(name, 'No forbidden legacy copy in JSON payload.')
}

async function checkExpectedStatus(
  name: string,
  path: string,
  expectedStatus: number,
  init?: RequestInit
) {
  const { response } = await fetchManual(path, init)
  return response.status === expectedStatus
    ? pass(name, `${expectedStatus}`)
    : fail(name, `${response.status}`)
}

async function checkBlockedApi(path: string) {
  const response = await smokeFetch(path, { redirect: 'manual' })
  return response.status === 404
    ? pass(`blocked api ${path}`, '404')
    : fail(`blocked api ${path}`, `${response.status}`)
}

async function runSmoke() {
  const results: SmokeResult[] = []

  for (const page of PAGES) {
    results.push(...(await checkPage(page.path, page.required)))
  }

  for (const file of STATIC_FILES) {
    results.push(...(await checkStaticFile(file.path, file.required)))
  }

  for (const path of BLOCKED_STATIC_PATHS) {
    results.push(await checkBlockedStaticFile(path))
  }

  for (const redirect of REDIRECTS) {
    results.push(await checkRedirect(redirect.path, redirect.destination))
  }

  results.push(...(await Promise.all(BLOCKED_API_PATHS.map(checkBlockedApi))))

  results.push(await checkOrderBook('mexwcwin26a'))
  results.push(await checkOrderBook('ukrwarend26a'))
  results.push(await checkOrderReadiness('mexwcwin26a'))
  results.push(await checkOrderReadiness('ukrwarend26a'))
  results.push(
    await checkExpectedStatus(
      'auth resolution readiness mexwcwin26a',
      '/api/v0/market/mexwcwin26a/mexas-resolution-readiness',
      401
    )
  )
  results.push(
    await checkExpectedStatus(
      'auth resolution readiness ukrwarend26a',
      '/api/v0/market/ukrwarend26a/mexas-resolution-readiness',
      401
    )
  )
  results.push(
    await checkBetsArray(
      '/api/v0/bets?contractId=mexwcwin26a&kinds=open-limit',
      'bets mexwcwin26a open-limit'
    )
  )
  results.push(
    await checkBetsArray(
      '/api/v0/bets?contractSlug=ganara-mexico-la-copa-mundial-2026&kinds=open-limit',
      'bets mexico slug open-limit'
    )
  )
  results.push(
    await checkExpectedStatus(
      'blocked broad MEXAS bets history',
      '/api/v0/bets?contractId=mexwcwin26a',
      404
    )
  )
  for (const payload of JSON_PAYLOADS) {
    results.push(await checkJsonPayloadCopy(payload.name, payload.path))
  }
  results.push(await checkBlockedOrderBook('not-a-mexas-market'))
  results.push(await checkBlockedBets('not-a-mexas-market'))
  results.push(
    await checkExpectedStatus(
      'blocked bets unknown username',
      '/api/v0/bets?username=__mexas_missing_user__',
      404
    )
  )
  results.push(await checkBlockedResolutionReadiness('not-a-mexas-market'))
  results.push(await checkBlockedOrderReadiness('not-a-mexas-market'))
  results.push(
    await checkExpectedStatus(
      'unknown api fail closed',
      '/api/v0/not-a-real-mexas-api',
      404
    )
  )
  results.push(
    await checkExpectedStatus(
      'blocked api ignores play param',
      '/api/v0/comment?play=true',
      404
    )
  )
  results.push(
    await checkExpectedStatus(
      'blocked static ignores play param',
      '/mana.svg?play=false',
      404
    )
  )
  results.push(
    await checkExpectedStatus('method bets POST', '/api/v0/bets', 405, {
      method: 'POST',
    })
  )
  results.push(
    await checkExpectedStatus(
      'method orderbook POST',
      '/api/mexas-order-book?contractId=mexwcwin26a',
      405,
      { method: 'POST' }
    )
  )
  results.push(
    await checkExpectedStatus(
      'method order readiness POST',
      '/api/v0/market/mexwcwin26a/mexas-order-readiness',
      405,
      { method: 'POST' }
    )
  )
  results.push(
    await checkExpectedStatus(
      'method resolution readiness POST',
      '/api/v0/market/mexwcwin26a/mexas-resolution-readiness',
      405,
      { method: 'POST' }
    )
  )
  results.push(await checkExpectedStatus('method bet GET', '/api/v0/bet', 405))
  results.push(
    await checkExpectedStatus('method privy-user GET', '/api/privy-user', 405)
  )
  results.push(
    await checkExpectedStatus('auth privy-user POST', '/api/privy-user', 401, {
      method: 'POST',
    })
  )
  results.push(
    await checkExpectedStatus('auth bet POST', '/api/v0/bet', 401, {
      method: 'POST',
    })
  )
  results.push(
    await checkExpectedStatus(
      'auth cancel POST',
      '/api/v0/bet/cancel/__missing_bet__',
      401,
      { method: 'POST' }
    )
  )
  results.push(
    await checkExpectedStatus(
      'auth resolve POST',
      '/api/v0/market/mexwcwin26a/resolve',
      401,
      { method: 'POST' }
    )
  )
  return results
}

async function main() {
  const results = await runSmoke()
  const hasFailure = results.some((result) => result.status === 'fail')

  for (const result of results) {
    console.log(
      `${result.status === 'pass' ? 'PASS' : 'FAIL'} ${result.name}: ${
        result.details
      }`
    )
  }

  if (hasFailure) process.exitCode = 1
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
