type SmokeResult = {
  details: string
  name: string
  status: 'pass' | 'fail'
}

const SITE_URL =
  process.env.MEXAS_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://mexas-manifold.vercel.app'

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
]

const PAGES = [
  {
    path: '/about',
    required: ['MEXAS Markets', 'MEX en Arbitrum', 'Wallet integrada de Privy'],
  },
  {
    path: '/login',
    required: ['Continuar con Privy', 'Privy crea la cuenta y la Wallet integrada'],
  },
  {
    path: '/wallet',
    required: ['Wallet MEX', 'Wallet Privy', 'Cargando Wallet'],
  },
  {
    path: '/checkout',
    required: ['Opera mercados desde tu Wallet', 'Abrir mercado'],
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
      'Compras',
      'Ventas',
      'Orden SÍ',
      'Orden NO',
    ],
  },
  {
    path: '/mexas-test/will-the-russia-ukraine-war-end-by-december-31-2026',
    required: ['Libro de órdenes', 'Compras', 'Ventas', 'Orden SÍ', 'Orden NO'],
  },
]

const REDIRECTS = [
  { destination: '/checkout', path: '/' },
  { destination: '/checkout', path: '/activity' },
  { destination: '/checkout', path: '/admin' },
  { destination: '/checkout', path: '/browse' },
  { destination: '/checkout', path: '/calibration' },
  { destination: '/checkout', path: '/charity' },
  { destination: '/checkout', path: '/calculator' },
  { destination: '/checkout', path: '/complexsystems' },
  { destination: '/checkout', path: '/cowp' },
  { destination: '/checkout', path: '/create' },
  { destination: '/checkout', path: '/discord-bot' },
  { destination: '/checkout', path: '/explore' },
  { destination: '/checkout', path: '/feed' },
  { destination: '/checkout', path: '/lab' },
  { destination: '/checkout', path: '/leagues' },
  { destination: '/checkout', path: '/live' },
  { destination: '/checkout', path: '/membership' },
  { destination: '/checkout', path: '/messages' },
  { destination: '/checkout', path: '/news' },
  { destination: '/checkout', path: '/old-charity' },
  { destination: '/checkout', path: '/post/test' },
  { destination: '/checkout', path: '/posts' },
  { destination: '/checkout', path: '/press' },
  { destination: '/checkout', path: '/redeem' },
  { destination: '/checkout', path: '/referrals' },
  { destination: '/checkout', path: '/reports' },
  { destination: '/checkout', path: '/sports' },
  { destination: '/checkout', path: '/stats' },
  { destination: '/checkout', path: '/styles' },
  { destination: '/checkout', path: '/topic/test' },
  { destination: '/checkout', path: '/tv' },
  { destination: '/checkout', path: '/wrapped' },
  { destination: '/checkout', path: '/yc-s23' },
  { destination: '/wallet', path: '/payments' },
  { destination: '/wallet', path: '/add-funds' },
  { destination: '/wallet', path: '/links' },
  { destination: '/checkout', path: '/comments' },
  { destination: '/checkout', path: '/leaderboards' },
  { destination: '/checkout', path: '/mana-auction' },
  { destination: '/checkout', path: '/manachan' },
  { destination: '/checkout', path: '/predictle' },
  { destination: '/checkout', path: '/prize' },
  { destination: '/checkout', path: '/shop' },
  { destination: '/checkout', path: '/sitemap' },
]

const BLOCKED_API_PATHS = [
  '/api/v0/comment',
  '/api/v0/deployment-id',
  '/api/v0/get-mana-summary-stats',
  '/api/v0/get-market-loan-max',
  '/api/v0/search-markets-full',
  '/api/v0/user/by-id/balance',
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

async function fetchText(path: string) {
  const response = await fetch(`${SITE_URL}${path}`, { redirect: 'follow' })
  const text = await response.text()
  return { response, text }
}

async function checkRedirect(path: string, destination: string) {
  const response = await fetch(`${SITE_URL}${path}`, { redirect: 'manual' })
  const location = response.headers.get('location') ?? ''
  const locationPath = location.startsWith('http')
    ? new URL(location).pathname
    : location.split('?')[0]

  return response.status >= 300 &&
    response.status < 400 &&
    locationPath === destination
    ? pass(`redirect ${path}`, `${response.status} -> ${destination}`)
    : fail(
        `redirect ${path}`,
        `${response.status} -> ${location || 'no location'}`
      )
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

async function checkBlockedApi(path: string) {
  const response = await fetch(`${SITE_URL}${path}`, { redirect: 'manual' })
  return response.status === 404
    ? pass(`blocked api ${path}`, '404')
    : fail(`blocked api ${path}`, `${response.status}`)
}

async function runSmoke() {
  const results: SmokeResult[] = []

  for (const page of PAGES) {
    results.push(...(await checkPage(page.path, page.required)))
  }

  for (const redirect of REDIRECTS) {
    results.push(await checkRedirect(redirect.path, redirect.destination))
  }

  for (const path of BLOCKED_API_PATHS) {
    results.push(await checkBlockedApi(path))
  }

  results.push(await checkOrderBook('mexwcwin26a'))
  results.push(await checkOrderBook('ukrwarend26a'))
  results.push(await checkBlockedOrderBook('not-a-mexas-market'))
  results.push(await checkBlockedBets('not-a-mexas-market'))
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
