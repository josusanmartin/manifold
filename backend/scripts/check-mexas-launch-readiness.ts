import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { createClient } from 'common/supabase/utils'

type CheckStatus = 'pass' | 'warn' | 'fail'

type CheckResult = {
  details: string
  name: string
  status: CheckStatus
}

const REQUIRED_SERVER_ENVS = [
  'PROD_ADMIN_SUPABASE_KEY',
  'PRIVY_APP_ID',
  'PRIVY_APP_SECRET',
  'MEXAS_TREASURY_WALLET_ADDRESS',
]

const REQUIRED_PUBLIC_ENVS = [
  'NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS',
  'NEXT_PUBLIC_PRIVY_APP_ID',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
]

const REQUIRED_MEXAS_CONTRACTS = [
  {
    id: 'mexwcwin26a',
    slug: 'ganara-mexico-la-copa-mundial-2026',
  },
  {
    id: 'ukrwarend26a',
    slug: 'will-the-russia-ukraine-war-end-by-december-31-2026',
  },
]

function parseEnvAssignment(line: string) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return

  const index = trimmed.indexOf('=')
  if (index <= 0) return

  const key = trimmed.slice(0, index).trim()
  let value = trimmed.slice(index + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return { key, value }
}

function parseEnvLine(line: string) {
  const assignment = parseEnvAssignment(line)
  if (assignment && !process.env[assignment.key]) {
    process.env[assignment.key] = assignment.value
  }
}

function loadEnvFiles() {
  const roots = [process.cwd(), resolve(__dirname, '../..')]
  const seen = new Set<string>()

  for (const root of roots) {
    for (const path of ['.env', '.env.local', 'web/.env', 'web/.env.local']) {
      const fullPath = resolve(root, path)
      if (seen.has(fullPath) || !existsSync(fullPath)) continue
      seen.add(fullPath)
      for (const line of readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
        parseEnvLine(line)
      }
    }
  }
}

function pass(name: string, details: string): CheckResult {
  return { details, name, status: 'pass' }
}

function warn(name: string, details: string): CheckResult {
  return { details, name, status: 'warn' }
}

function fail(name: string, details: string): CheckResult {
  return { details, name, status: 'fail' }
}

function hasEnv(name: string) {
  return !!process.env[name]?.trim()
}

function getVercelProductionEnvNames() {
  try {
    const output = execFileSync('vercel', ['env', 'ls', 'production'], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((name) => /^[A-Z0-9_]+$/.test(name))
    )
  } catch {
    return new Set<string>()
  }
}

function getVercelProductionEnvValues() {
  const env = new Map<string, string>()
  const tempDir = mkdtempSync(resolve(tmpdir(), 'mexas-vercel-env-'))
  const envFile = resolve(tempDir, '.env.production')

  try {
    execFileSync(
      'vercel',
      ['env', 'pull', envFile, '--environment', 'production', '--yes'],
      {
        cwd: resolve(__dirname, '../..'),
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'ignore'],
      }
    )

    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const assignment = parseEnvAssignment(line)
      if (assignment) env.set(assignment.key, assignment.value)
    }
  } catch {
    // Vercel env names are still checked separately; values are best-effort for
    // validating launch-mode flags without exposing secrets.
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }

  return env
}

function hasEnvOrVercelEnv(name: string, vercelEnvNames: Set<string>) {
  return hasEnv(name) || vercelEnvNames.has(name)
}

function getEnvOrVercelValue(
  name: string,
  vercelEnvValues: Map<string, string>
) {
  return process.env[name]?.trim() || vercelEnvValues.get(name)?.trim()
}

function getSupabaseUrlOrInstanceId() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_INSTANCE_ID ||
    process.env.NEXT_PUBLIC_SUPABASE_INSTANCE_ID
  )
}

function getSupabaseAdminKey() {
  return (
    process.env.PROD_ADMIN_SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.DEV_ADMIN_SUPABASE_KEY
  )
}

async function checkUrl(url: string) {
  const response = await fetch(url, { redirect: 'follow' })
  return response.status
}

async function runChecks() {
  loadEnvFiles()

  const checks: CheckResult[] = []
  const vercelEnvNames = getVercelProductionEnvNames()
  const vercelEnvValues = getVercelProductionEnvValues()
  const missingServer = REQUIRED_SERVER_ENVS.filter(
    (key) => !hasEnvOrVercelEnv(key, vercelEnvNames)
  )
  const missingPublic = REQUIRED_PUBLIC_ENVS.filter(
    (key) => !hasEnvOrVercelEnv(key, vercelEnvNames)
  )

  checks.push(
    missingServer.length
      ? fail('server env', `Missing: ${missingServer.join(', ')}`)
      : pass('server env', 'Required server env vars are present.')
  )
  checks.push(
    missingPublic.length
      ? fail('public env', `Missing: ${missingPublic.join(', ')}`)
      : pass('public env', 'Required public env vars are present.')
  )

  const supabaseUrlOrInstanceId = getSupabaseUrlOrInstanceId()
  const supabaseAdminKey = getSupabaseAdminKey()
  if (!supabaseUrlOrInstanceId || !supabaseAdminKey) {
    checks.push(
      fail(
        'supabase admin client',
        'Missing Supabase URL/instance id or admin/service key.'
      )
    )
  } else {
    const db = createClient(supabaseUrlOrInstanceId, supabaseAdminKey)
    const { error: mexContractsError, count } = await db
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('token', 'MEX')

    checks.push(
      mexContractsError
        ? fail(
            'supabase MEX contracts',
            `Could not read MEX contracts: ${mexContractsError.message}`
          )
        : pass(
            'supabase MEX contracts',
            `Supabase is reachable; ${count ?? 0} MEX contracts found.`
          )
    )

    const { data: requiredContracts, error: requiredContractsError } = await db
      .from('contracts')
      .select('id,token,slug,data')
      .in(
        'id',
        REQUIRED_MEXAS_CONTRACTS.map((contract) => contract.id)
      )

    if (requiredContractsError) {
      checks.push(
        fail(
          'required MEXAS contracts',
          `Could not read required contracts: ${requiredContractsError.message}`
        )
      )
    } else {
      const rowsById = new Map(
        (requiredContracts ?? []).map((row) => [row.id, row])
      )
      const contractFailures = REQUIRED_MEXAS_CONTRACTS.flatMap((contract) => {
        const row = rowsById.get(contract.id)
        if (!row) return [`${contract.id} is missing`]

        const data =
          row.data && typeof row.data === 'object' && !Array.isArray(row.data)
            ? (row.data as Record<string, unknown>)
            : {}
        const failures: string[] = []
        if (row.slug !== contract.slug) {
          failures.push(`${contract.id} slug=${row.slug}`)
        }
        if (row.token !== 'MEX') {
          failures.push(`${contract.id} sql token=${row.token}`)
        }
        if (data.token !== 'MEX') {
          failures.push(`${contract.id} data token=${String(data.token)}`)
        }
        return failures
      })

      checks.push(
        contractFailures.length
          ? fail(
              'required MEXAS contracts',
              `Invalid rows: ${contractFailures.join('; ')}`
            )
          : pass(
              'required MEXAS contracts',
              'Required MEXAS market rows are present and tokenized as MEX.'
            )
      )
    }

    const { data: matchingReady, error: matchingReadyError } = await db.rpc(
      'mexas_orderbook_matching_engine_ready'
    )
    checks.push(
      matchingReadyError
        ? fail(
            'matching RPC health',
            `Health RPC is not callable: ${matchingReadyError.message}`
          )
        : matchingReady === true
        ? pass('matching RPC health', 'Matching health RPC reports ready.')
        : fail('matching RPC health', 'Matching health RPC returned false.')
    )
  }

  const matchingMode = getEnvOrVercelValue(
    'MEXAS_MATCHING_ENGINE_MODE',
    vercelEnvValues
  )
  const settlementMode = getEnvOrVercelValue(
    'MEXAS_SETTLEMENT_MODE',
    vercelEnvValues
  )
  checks.push(
    matchingMode === 'rpc'
      ? pass('matching mode', 'MEXAS_MATCHING_ENGINE_MODE=rpc.')
      : fail(
          'matching mode',
          'MEXAS_MATCHING_ENGINE_MODE must be rpc before launch.'
        )
  )
  checks.push(
    settlementMode === 'escrow'
      ? pass('settlement mode', 'MEXAS_SETTLEMENT_MODE=escrow.')
      : fail(
          'settlement mode',
          'MEXAS_SETTLEMENT_MODE must be escrow before launch.'
        )
  )
  checks.push(
    getEnvOrVercelValue('MEXAS_ALLOW_UNESCROWED_MATCHING', vercelEnvValues) ===
      'true' ||
      getEnvOrVercelValue(
        'MEXAS_ALLOW_UNESCROWED_RESOLUTION',
        vercelEnvValues
      ) === 'true'
      ? fail(
          'unescrowed overrides',
          'Unescrowed matching/resolution overrides must be disabled for launch.'
        )
      : pass('unescrowed overrides', 'No unescrowed overrides are enabled.')
  )

  const siteUrl =
    process.env.MEXAS_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://mexas-manifold.vercel.app'
  for (const path of [
    '/wallet',
    '/checkout',
    '/mexas-test/ganara-mexico-la-copa-mundial-2026',
  ]) {
    try {
      const status = await checkUrl(`${siteUrl}${path}`)
      checks.push(
        status >= 200 && status < 400
          ? pass(`site ${path}`, `${status}`)
          : fail(`site ${path}`, `${status}`)
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      checks.push(fail(`site ${path}`, message))
    }
  }

  return checks
}

async function main() {
  const checks = await runChecks()
  const hasFailure = checks.some((check) => check.status === 'fail')

  for (const check of checks) {
    const marker =
      check.status === 'pass'
        ? 'PASS'
        : check.status === 'warn'
        ? 'WARN'
        : 'FAIL'
    console.log(`${marker} ${check.name}: ${check.details}`)
  }

  if (hasFailure) {
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
