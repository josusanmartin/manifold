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

async function runSmoke() {
  const results: SmokeResult[] = []

  for (const page of PAGES) {
    results.push(...(await checkPage(page.path, page.required)))
  }

  results.push(await checkOrderBook('mexwcwin26a'))
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
