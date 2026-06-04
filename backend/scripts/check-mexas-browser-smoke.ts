import { execFileSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

type BrowserContextOptions = any
type Browser = any
type ConsoleMessage = any
type Page = any
type Request = any
type Response = any

type BrowserResult = {
  details: string
  name: string
  status: 'pass' | 'fail'
}

type PageCheck = {
  path: string
  requiredGroups: string[][]
}

type ViewportCheck = {
  context: BrowserContextOptions
  name: string
}

const SITE_URL =
  process.env.MEXAS_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://mexas-manifold.vercel.app'

const BROWSER_TIMEOUT_MS = Number(
  process.env.MEXAS_BROWSER_TIMEOUT_MS ?? 30_000
)

const ARTIFACT_DIR =
  process.env.MEXAS_BROWSER_ARTIFACT_DIR || '/tmp/mexas-browser-smoke'

const SITE_ORIGIN = new URL(SITE_URL).origin
const SITE_HOSTNAME = new URL(SITE_URL).hostname
const IS_LOCAL_SITE =
  SITE_HOSTNAME === 'localhost' ||
  SITE_HOSTNAME === '127.0.0.1' ||
  SITE_HOSTNAME === '[::1]'

const PLAYWRIGHT_VERSION = '1.60.0'
const PLAYWRIGHT_TMP_DIR =
  process.env.MEXAS_PLAYWRIGHT_TMP_DIR || '/tmp/mexas-browser-playwright'

function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    const packageJsonPath = join(PLAYWRIGHT_TMP_DIR, 'package.json')
    mkdirSync(PLAYWRIGHT_TMP_DIR, { recursive: true })

    if (!existsSync(packageJsonPath)) {
      execFileSync('npm', ['init', '-y'], {
        cwd: PLAYWRIGHT_TMP_DIR,
        stdio: 'ignore',
      })
    }

    execFileSync('npm', ['install', `playwright@${PLAYWRIGHT_VERSION}`], {
      cwd: PLAYWRIGHT_TMP_DIR,
      stdio: 'inherit',
    })

    return require(join(PLAYWRIGHT_TMP_DIR, 'node_modules', 'playwright'))
  }
}

const { chromium, devices } = loadPlaywright()

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

const CRITICAL_RESOURCE_TYPES = new Set([
  'document',
  'fetch',
  'script',
  'stylesheet',
  'xhr',
])

const PAGES: PageCheck[] = [
  {
    path: '/about',
    requiredGroups: [
      ['MEXAS Markets'],
      ['MEX en Arbitrum'],
      ['Wallet integrada de Privy'],
    ],
  },
  {
    path: '/login',
    requiredGroups: [
      ['Continuar con Privy'],
      ['Privy crea la cuenta y la Wallet integrada'],
    ],
  },
  {
    path: '/wallet',
    requiredGroups: [
      ['Wallet MEX'],
      ['Wallet Privy', 'Privy'],
      [
        'Depositar',
        'Cargando Wallet',
        'Continuar con Privy',
        'Registrarse con Privy',
        'Conectar Wallet Privy',
      ],
    ],
  },
  {
    path: '/checkout',
    requiredGroups: [
      ['Abre órdenes límite desde tu Wallet'],
      ['Abrir mercado'],
      ['¿Ganará México la Copa Mundial 2026?'],
    ],
  },
  {
    path: '/josusanmartin?tab=summary',
    requiredGroups: [
      ['Wallet'],
      ['josusanmartin'],
    ],
  },
  {
    path: '/mexas-test/ganara-mexico-la-copa-mundial-2026',
    requiredGroups: [
      ['¿Ganará México la Copa Mundial 2026?'],
      ['Libro de órdenes'],
      ['Compras SÍ', 'COMPRAS SÍ'],
      ['Ventas SÍ', 'VENTAS SÍ'],
      ['Orden SÍ'],
      ['Orden NO'],
    ],
  },
  {
    path: '/mexas-test/terminara-la-guerra-entre-rusia-y-ucrania-antes-del-31-de-diciembre-de-2026',
    requiredGroups: [
      [
        '¿Terminará la guerra entre Rusia y Ucrania antes del 31 de diciembre de 2026?',
      ],
      ['Resuelve SÍ si Rusia y Ucrania acuerdan formalmente'],
      ['Libro de órdenes'],
      ['Compras SÍ', 'COMPRAS SÍ'],
      ['Ventas SÍ', 'VENTAS SÍ'],
      ['Orden SÍ'],
      ['Orden NO'],
    ],
  },
]

const VIEWPORTS: ViewportCheck[] = [
  {
    name: 'desktop',
    context: {
      viewport: { height: 900, width: 1440 },
    },
  },
  {
    name: 'mobile',
    context: {
      ...devices['iPhone 14'],
    },
  },
]

function pass(name: string, details: string): BrowserResult {
  return { details, name, status: 'pass' }
}

function fail(name: string, details: string): BrowserResult {
  return { details, name, status: 'fail' }
}

function getUrl(path: string) {
  return new URL(path, SITE_URL).toString()
}

function isSameOrigin(url: string) {
  return new URL(url).origin === new URL(SITE_URL).origin
}

function normalizeText(input: string) {
  return input.replace(/\s+/g, ' ').trim()
}

function formatConsoleMessage(message: ConsoleMessage) {
  return `${message.type()}: ${message.text()}`
}

function describeVercelChallenge(status: number) {
  return `Vercel Firewall challenge active with status ${status}. Disable Attack Mode interactively with "vercel firewall attack-mode disable" or adjust the Vercel WAF challenge rule before launch. If Attack Mode is already disabled, this can be Vercel system mitigation against the probing IP; wait for cooldown or have a human temporarily run "vercel firewall system-mitigations pause" for QA and resume protection afterwards.`
}

function isIgnoredConsoleError(message: string) {
  const isPrivyAppConfigCors =
    message.includes('auth.privy.io/api/v1/apps/') &&
    message.includes(`from origin '${SITE_ORIGIN}' has been blocked by CORS`)

  const isExternalFetchFailed =
    message === 'error: Failed to load resource: net::ERR_FAILED'

  // Same-origin critical failures are tracked through request/response events.
  // Privy app-config CORS noise in headless Chromium is covered separately by
  // the launch readiness origin check.
  return (
    isPrivyAppConfigCors ||
    isExternalFetchFailed
  )
}

function isCriticalResponse(response: Response) {
  if (!isSameOrigin(response.url())) return false
  if (response.status() < 400) return false
  return CRITICAL_RESOURCE_TYPES.has(response.request().resourceType())
}

function isCriticalRequestFailure(request: Request) {
  if (!isSameOrigin(request.url())) return false
  return CRITICAL_RESOURCE_TYPES.has(request.resourceType())
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function waitForHydration(page: Page) {
  await page.waitForSelector('body', {
    state: 'attached',
    timeout: BROWSER_TIMEOUT_MS,
  })
  await page.waitForLoadState('domcontentloaded', {
    timeout: BROWSER_TIMEOUT_MS,
  })

  try {
    await page.waitForLoadState('networkidle', { timeout: 5_000 })
  } catch {
    // Wallet/auth providers can keep the network busy. The stability checks below
    // still catch critical failed requests and runtime errors.
  }

  await page.waitForTimeout(750)
}

async function writeFailureScreenshot(
  page: Page,
  viewport: string,
  path: string
) {
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const safePath = path
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
  const screenshotPath = `${ARTIFACT_DIR}/${viewport}-${safePath || 'root'}.png`
  await page.screenshot({ fullPage: true, path: screenshotPath })
  return screenshotPath
}

async function checkVercelChallengePreflight(browser: Browser) {
  const results: BrowserResult[] = []
  if (IS_LOCAL_SITE) return results

  const maybeFetch = (globalThis as any).fetch as
    | ((url: string, init?: { redirect?: string }) => Promise<Response>)
    | undefined
  if (maybeFetch) {
    try {
      const response = await maybeFetch(getUrl('/checkout'), {
        redirect: 'manual',
      })
      const status = response.status
      const challenge = response.headers.get('x-vercel-mitigated') === 'challenge'

      if (challenge) {
        results.push(
          fail(
            'browser preflight Vercel Firewall',
            describeVercelChallenge(status)
          )
        )
        return results
      }
    } catch {
      // Fall through to the browser probe below.
    }
  }

  const context = await browser.newContext({
    ...VIEWPORTS[0].context,
    colorScheme: 'light',
    locale: 'es-MX',
  })
  const page = await context.newPage()

  try {
    const response = await page.goto(getUrl('/checkout'), {
      timeout: BROWSER_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    })
    const status = response?.status() ?? 0
    const challenge = response?.headers()['x-vercel-mitigated'] === 'challenge'

    if (challenge) {
      results.push(
        fail(
          'browser preflight Vercel Firewall',
          describeVercelChallenge(status)
        )
      )
    }
  } catch {
    // Let the per-page checks report ordinary reachability/runtime failures.
  } finally {
    await page.close()
    await context.close()
  }

  return results
}

async function checkRenderedPage(
  page: Page,
  check: PageCheck,
  viewport: string
) {
  const results: BrowserResult[] = []
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') {
      const formatted = formatConsoleMessage(message)
      if (!isIgnoredConsoleError(formatted)) {
        consoleErrors.push(formatted)
      }
    }
  })
  page.on('pageerror', (error: Error) => {
    pageErrors.push(error.message)
  })
  page.on('requestfailed', (request: Request) => {
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return
    if (isCriticalRequestFailure(request)) {
      failedRequests.push(
        `${request.resourceType()} ${request.url()} ${
          request.failure()?.errorText ?? 'request failed'
        }`
      )
    }
  })
  page.on('response', (response: Response) => {
    if (isCriticalResponse(response)) {
      failedRequests.push(
        `${response.request().resourceType()} ${response.url()} ${response.status()}`
      )
    }
  })

  const response = await page.goto(getUrl(check.path), {
    timeout: BROWSER_TIMEOUT_MS,
    waitUntil: 'domcontentloaded',
  })
  const status = response?.status() ?? 0
  const challenge = response?.headers()['x-vercel-mitigated'] === 'challenge'

  if (challenge) {
    results.push(
      fail(
        `browser ${viewport} ${check.path}`,
        describeVercelChallenge(status)
      )
    )
    return results
  }

  results.push(
    status >= 200 && status < 400
      ? pass(`browser ${viewport} ${check.path}`, `${status}`)
      : fail(`browser ${viewport} ${check.path}`, `${status}`)
  )

  await waitForHydration(page)

  const rendered = await page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    return {
      bodyText: body?.innerText ?? '',
      documentReadyState: document.readyState,
      horizontalOverflow: Math.max(root.scrollWidth, body.scrollWidth) -
        window.innerWidth,
      title: document.title,
    }
  })
  const visibleText = normalizeText(rendered.bodyText)

  const missingGroups = check.requiredGroups.filter(
    (group) => !group.some((copy) => visibleText.includes(copy))
  )
  results.push(
    missingGroups.length
      ? fail(
          `browser copy ${viewport} ${check.path}`,
          `Missing one of: ${missingGroups
            .map((group) => `[${group.join(' | ')}]`)
            .join(', ')}`
        )
      : pass(
          `browser copy ${viewport} ${check.path}`,
          'Required hydrated copy is visible.'
        )
  )

  const forbidden = FORBIDDEN_VISIBLE_COPY.filter((copy) =>
    visibleText.includes(copy)
  )
  results.push(
    forbidden.length
      ? fail(
          `browser legacy copy ${viewport} ${check.path}`,
          `Found: ${forbidden.join(', ')}`
        )
      : pass(
          `browser legacy copy ${viewport} ${check.path}`,
          'No forbidden hydrated copy found.'
        )
  )

  const overflow = Math.ceil(rendered.horizontalOverflow)
  results.push(
    overflow <= 2
      ? pass(
          `browser layout ${viewport} ${check.path}`,
          `No horizontal overflow (${overflow}px).`
        )
      : fail(
          `browser layout ${viewport} ${check.path}`,
          `Horizontal overflow ${overflow}px.`
        )
  )

  results.push(
    consoleErrors.length || pageErrors.length || failedRequests.length
      ? fail(
          `browser runtime ${viewport} ${check.path}`,
          [
            ...pageErrors.map((message) => `pageerror ${message}`),
            ...consoleErrors,
            ...failedRequests,
          ]
            .slice(0, 8)
            .join('; ')
        )
      : pass(
          `browser runtime ${viewport} ${check.path}`,
          `readyState=${rendered.documentReadyState}; title=${rendered.title}`
        )
  )

  if (results.some((result) => result.status === 'fail')) {
    const screenshotPath = await writeFailureScreenshot(page, viewport, check.path)
    results.push(
      pass(
        `browser screenshot ${viewport} ${check.path}`,
        `Saved ${screenshotPath}`
      )
    )
  }

  return results
}

async function runBrowserSmoke() {
  const browser = await chromium.launch({ headless: true })
  const results: BrowserResult[] = []

  try {
    const preflightResults = await checkVercelChallengePreflight(browser)
    results.push(...preflightResults)
    if (preflightResults.some((result) => result.status === 'fail')) {
      return results
    }

    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        ...viewport.context,
        colorScheme: 'light',
        locale: 'es-MX',
      })

      try {
        for (const check of PAGES) {
          const page = await context.newPage()
          try {
            try {
              results.push(
                ...(await checkRenderedPage(page, check, viewport.name))
              )
            } catch (error) {
              results.push(
                fail(
                  `browser ${viewport.name} ${check.path}`,
                  formatUnknownError(error)
                )
              )
              try {
                const screenshotPath = await writeFailureScreenshot(
                  page,
                  viewport.name,
                  check.path
                )
                results.push(
                  pass(
                    `browser screenshot ${viewport.name} ${check.path}`,
                    `Saved ${screenshotPath}`
                  )
                )
              } catch (screenshotError) {
                results.push(
                  fail(
                    `browser screenshot ${viewport.name} ${check.path}`,
                    formatUnknownError(screenshotError)
                  )
                )
              }
            }
          } finally {
            await page.close()
          }
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }

  return results
}

async function main() {
  const results = await runBrowserSmoke()
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
