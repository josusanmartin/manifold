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
  '/api/v0/comments',
  '/api/v0/comment-thread',
  '/api/v0/comment-reactions',
  '/api/v0/create-post-comment',
  '/api/v0/create-post',
  '/api/v0/edit-comment',
  '/api/v0/hide-comment',
  '/api/v0/pin-comment',
  '/api/v0/post',
  '/api/v0/record-comment-view',
  '/api/v0/react',
  '/api/v0/update-post',
  '/api/v0/user-comments',
  '/api/v0/create-public-chat-message',
  '/api/v0/follow-contract',
  '/api/v0/follow-post',
  '/api/v0/get-feed',
  '/api/v0/get-channel-messages',
  '/api/v0/get-unified-feed',
  '/api/v0/purchase-boost',
  '/api/v0/remove-boost',
  '/api/v0/get-boost-history',
  '/api/v0/managram',
  '/api/v0/managrams',
  '/api/v0/manalink',
  '/api/v0/claimmanalink',
  '/api/v0/deployment-id',
  '/api/v0/get-mana-supply',
  '/api/v0/get-mana-summary-stats',
  '/api/v0/get-active-user-mana-stats',
  '/api/v0/convert-cash-to-mana',
  '/api/v0/convert-sp-to-mana',
  '/api/v0/create-daimo-session',
  '/api/v0/get-crypto-purchase-status',
  '/api/v0/record-mexas-purchase',
  '/api/v0/create-idenfy-session',
  '/api/v0/get-idenfy-status',
  '/api/v0/get-verification-status-gidx',
  '/api/v0/get-verification-documents-gidx',
  '/api/v0/register-gidx',
  '/api/v0/upload-document-gidx',
  '/api/v0/claim-free-loan',
  '/api/v0/get-free-loan-available',
  '/api/v0/get-market-loan-max',
  '/api/v0/get-next-loan-amount',
  '/api/v0/get-total-loan-amount',
  '/api/v0/repay-loan',
  '/api/v0/request-loan',
  '/api/v0/search-markets-full',
  '/api/v0/user/by-id/balance',
  '/api/v0/market/mexwcwin26a/add-liquidity',
  '/api/v0/market/mexwcwin26a/remove-liquidity',
  '/api/v0/market/mexwcwin26a/add-bounty',
  '/api/v0/market/mexwcwin26a/award-bounty',
  '/api/v0/market/mexwcwin26a/answer',
  '/api/v0/get-predictle-result',
  '/api/v0/save-predictle-result',
  '/api/v0/admin-create-charity-giveaway',
  '/api/v0/admin-create-sweepstakes',
  '/api/v0/admin-get-prize-claims',
  '/api/v0/buy-charity-giveaway-tickets',
  '/api/v0/buy-sweepstakes-tickets',
  '/api/v0/claim-free-sweepstakes-ticket',
  '/api/v0/claim-sweepstakes-prize',
  '/api/v0/get-charity-giveaway',
  '/api/v0/get-sweepstakes',
  '/api/v0/get-sweepstakes-prize-claim',
  '/api/v0/get-ticket-stock',
  '/api/v0/shop-purchase',
  '/api/v0/toggle-merch-stock',
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

async function fetchManual(path: string, init?: RequestInit) {
  const response = await fetch(`${SITE_URL}${path}`, {
    redirect: 'manual',
    ...init,
  })
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

async function checkResolutionReadiness(contractId: string) {
  const { response, text } = await fetchText(
    `/api/v0/market/${encodeURIComponent(
      contractId
    )}/mexas-resolution-readiness`
  )
  if (response.status < 200 || response.status >= 400) {
    return fail(`resolution readiness ${contractId}`, `${response.status}`)
  }

  try {
    const data = JSON.parse(text)
    const valid =
      data &&
      typeof data === 'object' &&
      typeof data.canResolve === 'boolean' &&
      typeof data.requiresEscrow === 'boolean' &&
      Number.isFinite(data.filledBetCount)
    return valid
      ? pass(
          `resolution readiness ${contractId}`,
          `canResolve=${data.canResolve}, requiresEscrow=${data.requiresEscrow}, filled=${data.filledBetCount}`
        )
      : fail(
          `resolution readiness ${contractId}`,
          'Response does not include readiness booleans.'
        )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`resolution readiness ${contractId}`, message)
  }
}

async function checkBlockedResolutionReadiness(contractId: string) {
  const { response } = await fetchText(
    `/api/v0/market/${encodeURIComponent(
      contractId
    )}/mexas-resolution-readiness`
  )
  return response.status === 404
    ? pass(`blocked resolution readiness ${contractId}`, '404')
    : fail(`blocked resolution readiness ${contractId}`, `${response.status}`)
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

  results.push(...(await Promise.all(BLOCKED_API_PATHS.map(checkBlockedApi))))

  results.push(await checkOrderBook('mexwcwin26a'))
  results.push(await checkOrderBook('ukrwarend26a'))
  results.push(await checkResolutionReadiness('mexwcwin26a'))
  results.push(await checkResolutionReadiness('ukrwarend26a'))
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
      'method resolution readiness POST',
      '/api/v0/market/mexwcwin26a/mexas-resolution-readiness',
      405,
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
