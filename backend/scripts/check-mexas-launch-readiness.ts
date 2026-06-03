import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { type LimitBet } from 'common/bet'
import {
  getMissingMexasEscrowCapabilities,
  getMexasSettlementAudit,
  hasOperationalMexasEscrow,
} from 'common/mexas-settlement'
import { MEXAS_PUBLIC_RPC_URL, MEXAS_TOKEN } from 'common/crypto/mexas'
import {
  hasActiveMexasWalletReservation,
  hasMexasEscrowCaptureMetadata,
  hasMexasEscrowedStake,
  getMexasRemainingReservedAmount,
  isMexasOrderBookOnlyContract,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import { getMexasOpenOrderAmount } from 'common/mexas-order-book'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import { createClient } from 'common/supabase/utils'
import type { Row, SupabaseClient } from 'common/supabase/utils'
import { privateKeyToAccount } from 'viem/accounts'

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
  'MEXAS_TREASURY_SIGNER_SECRET',
]

const REQUIRED_PUBLIC_ENVS = [
  'NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS',
  'NEXT_PUBLIC_PRIVY_APP_ID',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
]

const LAUNCH_SQL_APPLY_ENVS = [
  'MEXAS_SUPABASE_DB_URL',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'MEXAS_SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_PASSWORD',
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

const CONTRACT_PAGE_SIZE = 1000
const OPEN_ORDER_PAGE_SIZE = 1000
const ORDER_LOCK_TIMEOUT_MS = 2 * 60 * 1000
const RESOLUTION_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const TRANSFER_PROCESSING_TIMEOUT_MS = 2 * 60 * 1000
const DEFAULT_TREASURY_MIN_GAS_WEI = 100_000_000_000_000n
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const TREASURY_SIGNER_SECRET_PATTERN = /^0x[0-9a-fA-F]{64}$/
const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000'
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231'
const EPSILON = 1e-9

type OpenMexasOrder = {
  betId: string
  remainingReservedUnits: bigint
  userId: string
}

type OpenMexasLimitOrder = {
  betId: string
  contractId: string
  limitProb: number
  openAmount: number
  outcome: 'YES' | 'NO'
}

type UnsafeOpenMexasLimitOrder = OpenMexasLimitOrder & {
  reasons: string[]
}

type EscrowedOpenMexasLimitOrder = OpenMexasLimitOrder & {
  hasCaptureMetadata: boolean
}

type MexasMarketLockIssue = {
  ageMs?: number
  contractId: string
  detail: string
  lockType: 'order' | 'resolution'
  timeoutMs: number
}

type SettlementExposureCheckOptions = {
  hasOperationalEscrow: boolean
}

type UserBacking = {
  orderIds: string[]
  requiredUnits: bigint
}

type MexasWalletUser = {
  balance: number
  id: string
  walletAddress: string
}

type MexasContractTokenAlignmentRow = {
  dataToken: string | undefined
  id: string
  slug: string | null
  token: string | null
}

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

function compactDiagnosticText(text: string) {
  const compacted = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return compacted.length > 600 ? `${compacted.slice(0, 600)}...` : compacted
}

function formatDiagnosticError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return compactDiagnosticText(String(error))
  }
  const fields = error as {
    code?: string
    details?: string
    hint?: string
    message?: string
  }
  const message = [
    fields.message,
    fields.details ? `details=${fields.details}` : undefined,
    fields.hint ? `hint=${fields.hint}` : undefined,
    fields.code ? `code=${fields.code}` : undefined,
  ]
    .filter(Boolean)
    .join('; ')

  return compactDiagnosticText(message || JSON.stringify(error))
}

function hasEnv(name: string) {
  return !!process.env[name]?.trim()
}

function getRequiredProductionEnvPresenceFailures(
  keys: string[],
  vercelEnvNames: Set<string>
) {
  return keys.flatMap((key) => {
    if (vercelEnvNames.has(key)) return []
    if (hasEnv(key))
      return [`${key} is only set locally, not in Vercel production`]
    return [`${key} is missing from Vercel production`]
  })
}

function getRequiredReadableProductionEnvFailures(
  keys: string[],
  vercelEnvNames: Set<string>,
  vercelEnvValues: Map<string, string>
) {
  return keys.flatMap((key) => {
    const pulledValue = vercelEnvValues.get(key)
    if (pulledValue !== undefined) {
      return pulledValue.trim() ? [] : [`${key} is empty in Vercel production`]
    }

    if (hasEnv(key)) {
      return [`${key} is only set locally, not in Vercel production`]
    }

    if (vercelEnvNames.has(key)) {
      return [
        `${key} exists in Vercel production but is not readable; public env vars must be added with --no-sensitive`,
      ]
    }

    return [`${key} is missing from Vercel production`]
  })
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

function getCurrentGitCommitInfo() {
  try {
    const hash = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const timestampSeconds = Number(
      execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
        cwd: resolve(__dirname, '../..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    )

    if (!hash || !Number.isFinite(timestampSeconds)) return undefined
    return { hash, timestampMs: timestampSeconds * 1000 }
  } catch {
    return undefined
  }
}

function getVercelProductionDeployment(siteUrl: string) {
  try {
    const host = new URL(siteUrl).host
    const output = execFileSync('vercel', ['inspect', host, '--format=json'], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const deployment = JSON.parse(output) as {
      createdAt?: number
      id?: string
      readyState?: string
      target?: string
      uid?: string
      url?: string
    }
    return deployment
  } catch {
    return undefined
  }
}

function getEnvOrVercelValue(
  name: string,
  vercelEnvValues: Map<string, string>
) {
  return process.env[name]?.trim() || vercelEnvValues.get(name)?.trim()
}

function normalizeEvmAddress(address: string) {
  return address.toLowerCase()
}

function formatAddressForDiagnostics(address: string | undefined) {
  if (!address) return 'missing'
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getLastNonEmptyLines(output: unknown, maxLines = 8) {
  return String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
    .join('; ')
}

function checkBackendApiCompile(): CheckResult {
  try {
    execFileSync('corepack', ['yarn', '--cwd', 'backend/api', 'compile'], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        COREPACK_ENABLE_STRICT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return pass('backend API compile', 'backend/api TypeScript compile passes.')
  } catch (error) {
    const details =
      typeof error === 'object' && error
        ? [
            getLastNonEmptyLines((error as { stdout?: unknown }).stdout),
            getLastNonEmptyLines((error as { stderr?: unknown }).stderr),
            (error as { message?: string }).message,
          ]
            .filter(Boolean)
            .join('; ')
        : String(error)
    return fail(
      'backend API compile',
      details || 'backend/api TypeScript compile failed.'
    )
  }
}

function checkTreasuryWalletEnv(
  vercelEnvValues: Map<string, string>
): CheckResult {
  const serverTreasury = getEnvOrVercelValue(
    'MEXAS_TREASURY_WALLET_ADDRESS',
    vercelEnvValues
  )
  const publicTreasury = getEnvOrVercelValue(
    'NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS',
    vercelEnvValues
  )
  const failures: string[] = []

  for (const [name, address] of [
    ['MEXAS_TREASURY_WALLET_ADDRESS', serverTreasury],
    ['NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS', publicTreasury],
  ] as const) {
    if (!address) {
      failures.push(`${name} is missing or empty`)
      continue
    }
    if (!EVM_ADDRESS_PATTERN.test(address)) {
      failures.push(`${name} is not a valid EVM address`)
      continue
    }
    const normalizedAddress = normalizeEvmAddress(address)
    if (normalizedAddress === ZERO_EVM_ADDRESS) {
      failures.push(`${name} cannot be the zero address`)
    }
    if (normalizedAddress === normalizeEvmAddress(MEXAS_TOKEN.address)) {
      failures.push(`${name} cannot be the MEXAS token contract address`)
    }
  }

  if (
    serverTreasury &&
    publicTreasury &&
    EVM_ADDRESS_PATTERN.test(serverTreasury) &&
    EVM_ADDRESS_PATTERN.test(publicTreasury) &&
    normalizeEvmAddress(serverTreasury) !== normalizeEvmAddress(publicTreasury)
  ) {
    failures.push(
      `server treasury ${formatAddressForDiagnostics(
        serverTreasury
      )} does not match public treasury ${formatAddressForDiagnostics(
        publicTreasury
      )}`
    )
  }

  return failures.length
    ? fail('treasury wallet env', failures.join('; '))
    : pass(
        'treasury wallet env',
        'Server and public treasury wallet addresses are valid and match.'
      )
}

function checkTreasurySignerEnv(
  vercelEnvNames: Set<string>,
  vercelEnvValues: Map<string, string>
): CheckResult {
  const treasuryAddress = getEnvOrVercelValue(
    'MEXAS_TREASURY_WALLET_ADDRESS',
    vercelEnvValues
  )
  const signerSecret = getEnvOrVercelValue(
    'MEXAS_TREASURY_SIGNER_SECRET',
    vercelEnvValues
  )

  if (!vercelEnvNames.has('MEXAS_TREASURY_SIGNER_SECRET') && !signerSecret) {
    return fail(
      'treasury signer env',
      'MEXAS_TREASURY_SIGNER_SECRET is missing from Vercel production.'
    )
  }
  if (!signerSecret) {
    return fail(
      'treasury signer env',
      'MEXAS_TREASURY_SIGNER_SECRET exists in Vercel production but is not readable locally; set the same secret locally before launch so the derived signer can be verified.'
    )
  }
  if (!TREASURY_SIGNER_SECRET_PATTERN.test(signerSecret)) {
    return fail(
      'treasury signer env',
      'MEXAS_TREASURY_SIGNER_SECRET must be a 0x-prefixed 32-byte private key.'
    )
  }
  if (!treasuryAddress || !EVM_ADDRESS_PATTERN.test(treasuryAddress)) {
    return fail(
      'treasury signer env',
      'MEXAS_TREASURY_WALLET_ADDRESS must be valid before checking the treasury signer.'
    )
  }

  const signerAddress = privateKeyToAccount(
    signerSecret as `0x${string}`
  ).address
  if (
    normalizeEvmAddress(signerAddress) !== normalizeEvmAddress(treasuryAddress)
  ) {
    return fail(
      'treasury signer env',
      `Derived signer ${formatAddressForDiagnostics(
        signerAddress
      )} does not match configured treasury ${formatAddressForDiagnostics(
        treasuryAddress
      )}.`
    )
  }

  return pass(
    'treasury signer env',
    `Treasury signer derives the configured treasury address ${formatAddressForDiagnostics(
      treasuryAddress
    )}.`
  )
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

function getRowData(row: { data: unknown } | null): Record<string, unknown> {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function mexasAmountToUnits(amount: number) {
  return BigInt(Math.round(Math.max(0, amount) * 10 ** MEXAS_TOKEN.decimals))
}

function formatMexasUnits(units: bigint) {
  const divisor = 10n ** BigInt(MEXAS_TOKEN.decimals)
  const whole = units / divisor
  const fraction = units % divisor
  if (fraction === 0n) return whole.toString()

  const padded = fraction.toString().padStart(MEXAS_TOKEN.decimals, '0')
  return `${whole}.${padded.replace(/0+$/, '')}`
}

function formatWeiAsEth(wei: bigint) {
  const divisor = 10n ** 18n
  const whole = wei / divisor
  const fraction = wei % divisor
  if (fraction === 0n) return whole.toString()

  const padded = fraction.toString().padStart(18, '0')
  return `${whole}.${padded.replace(/0+$/, '')}`
}

function subtractUnitsFloorZero(units: bigint, amount: bigint) {
  return units > amount ? units - amount : 0n
}

function encodeBalanceOfCall(address: string) {
  return `${ERC20_BALANCE_OF_SELECTOR}${address
    .toLowerCase()
    .replace(/^0x/, '')
    .padStart(64, '0')}`
}

async function readMexasWalletBalanceUnits(address: string) {
  const response = await fetch(
    process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || MEXAS_PUBLIC_RPC_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            data: encodeBalanceOfCall(address),
            to: MEXAS_TOKEN.address,
          },
          'latest',
        ],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Arbitrum RPC returned HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    error?: { message?: string }
    result?: string
  }
  if (payload.error) {
    throw new Error(payload.error.message ?? 'Arbitrum RPC returned an error')
  }
  if (!payload.result || !/^0x[0-9a-fA-F]+$/.test(payload.result)) {
    throw new Error('Arbitrum RPC returned an invalid balance result')
  }

  return BigInt(payload.result)
}

async function readArbitrumNativeBalanceWei(address: string) {
  const response = await fetch(
    process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || MEXAS_PUBLIC_RPC_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Arbitrum RPC returned HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    error?: { message?: string }
    result?: string
  }
  if (payload.error) {
    throw new Error(payload.error.message ?? 'Arbitrum RPC returned an error')
  }
  if (!payload.result || !/^0x[0-9a-fA-F]+$/.test(payload.result)) {
    throw new Error('Arbitrum RPC returned an invalid native balance result')
  }

  return BigInt(payload.result)
}

function getTreasuryMinGasWei(vercelEnvValues: Map<string, string>) {
  const raw = getEnvOrVercelValue('MEXAS_TREASURY_MIN_GAS_WEI', vercelEnvValues)
  if (!raw) return DEFAULT_TREASURY_MIN_GAS_WEI
  if (!/^\d+$/.test(raw)) {
    throw new Error('MEXAS_TREASURY_MIN_GAS_WEI must be an integer wei value')
  }
  return BigInt(raw)
}

async function checkTreasuryGasFunding(
  vercelEnvValues: Map<string, string>
): Promise<CheckResult> {
  try {
    const treasuryAddress = getEnvOrVercelValue(
      'MEXAS_TREASURY_WALLET_ADDRESS',
      vercelEnvValues
    )
    if (!treasuryAddress || !EVM_ADDRESS_PATTERN.test(treasuryAddress)) {
      return fail(
        'treasury gas funding',
        'MEXAS_TREASURY_WALLET_ADDRESS must be valid before checking treasury gas.'
      )
    }

    const normalizedTreasury = normalizeEvmAddress(treasuryAddress)
    const minGasWei = getTreasuryMinGasWei(vercelEnvValues)
    const balanceWei = await readArbitrumNativeBalanceWei(normalizedTreasury)
    if (balanceWei < minGasWei) {
      return fail(
        'treasury gas funding',
        `Treasury has ${formatWeiAsEth(
          balanceWei
        )} ETH on Arbitrum, below required ${formatWeiAsEth(
          minGasWei
        )} ETH for outgoing MEX transfers. Fund the treasury with Arbitrum ETH or tune MEXAS_TREASURY_MIN_GAS_WEI.`
      )
    }

    return pass(
      'treasury gas funding',
      `Treasury has ${formatWeiAsEth(
        balanceWei
      )} ETH on Arbitrum for outgoing MEX transfers.`
    )
  } catch (error) {
    return fail('treasury gas funding', formatDiagnosticError(error))
  }
}

async function loadMexasOrderbookContractIds(db: SupabaseClient) {
  const ids = new Set(REQUIRED_MEXAS_CONTRACTS.map((contract) => contract.id))

  for (let from = 0; ; from += CONTRACT_PAGE_SIZE) {
    const { data, error } = await db
      .from('contracts')
      .select('data, importance_score, token')
      .contains('data', { token: 'MEX' } as any)
      .range(from, from + CONTRACT_PAGE_SIZE - 1)

    if (error) throw error

    for (const row of (data ?? []) as Row<'contracts'>[]) {
      const contract = convertContract(row)
      if (isMexasOrderBookOnlyContract(contract)) ids.add(contract.id)
    }
    if ((data ?? []).length < CONTRACT_PAGE_SIZE) break
  }

  return [...ids]
}

async function loadMexasContractTokenAlignmentRows(db: SupabaseClient) {
  const rowsById = new Map<string, MexasContractTokenAlignmentRow>()
  const addRows = (rows: Row<'contracts'>[]) => {
    for (const row of rows) {
      const dataToken = getRowData(row).token
      rowsById.set(row.id, {
        dataToken: typeof dataToken === 'string' ? dataToken : undefined,
        id: row.id,
        slug: row.slug,
        token: row.token,
      })
    }
  }

  for (let from = 0; ; from += CONTRACT_PAGE_SIZE) {
    const { data, error } = await db
      .from('contracts')
      .select('id,slug,token,data')
      .contains('data', { token: 'MEX' } as any)
      .range(from, from + CONTRACT_PAGE_SIZE - 1)

    if (error) throw error
    addRows((data ?? []) as Row<'contracts'>[])
    if ((data ?? []).length < CONTRACT_PAGE_SIZE) break
  }

  for (let from = 0; ; from += CONTRACT_PAGE_SIZE) {
    const { data, error } = await db
      .from('contracts')
      .select('id,slug,token,data')
      .eq('token', 'MEX')
      .range(from, from + CONTRACT_PAGE_SIZE - 1)

    if (error) throw error
    addRows((data ?? []) as Row<'contracts'>[])
    if ((data ?? []).length < CONTRACT_PAGE_SIZE) break
  }

  return [...rowsById.values()]
}

async function checkMexasContractTokenAlignment(
  db: SupabaseClient
): Promise<{ needsLaunchSql: boolean; result: CheckResult }> {
  try {
    const rows = await loadMexasContractTokenAlignmentRows(db)
    const mismatches = rows.filter(
      (row) => row.token !== 'MEX' || row.dataToken !== 'MEX'
    )

    if (mismatches.length) {
      return {
        needsLaunchSql: true,
        result: fail(
          'MEXAS contract token alignment',
          `${mismatches
            .slice(0, 5)
            .map(
              (row) =>
                `${row.id} token=${row.token ?? 'null'} dataToken=${
                  row.dataToken ?? 'null'
                }`
            )
            .join('; ')}${
            mismatches.length > 5 ? `; ${mismatches.length - 5} more` : ''
          }. Run apply:mexas-launch-sql so every data-tokened MEX contract has contracts.token=MEX.`
        ),
      }
    }

    if (!rows.length) {
      return {
        needsLaunchSql: false,
        result: fail(
          'MEXAS contract token alignment',
          'No contracts with token=MEX or data.token=MEX were found.'
        ),
      }
    }

    return {
      needsLaunchSql: false,
      result: pass(
        'MEXAS contract token alignment',
        `${rows.length} MEXAS contract rows have aligned SQL and data tokens.`
      ),
    }
  } catch (error) {
    const message = formatDiagnosticError(error)
    return {
      needsLaunchSql: false,
      result: fail('MEXAS contract token alignment', message),
    }
  }
}

async function loadOpenMexasOrderbookContractIds(db: SupabaseClient) {
  const contractIds = await loadMexasOrderbookContractIds(db)
  if (!contractIds.length) return []

  const { data, error } = await db
    .from('contracts')
    .select('id')
    .in('id', contractIds)
    .is('resolution_time', null)

  if (error) throw error
  return ((data ?? []) as Pick<Row<'contracts'>, 'id'>[]).map((row) => row.id)
}

async function loadOpenReservedMexasOrders(
  db: SupabaseClient,
  contractIds: string[]
) {
  if (!contractIds.length) return []

  const now = new Date().toISOString()
  const orders: OpenMexasOrder[] = []

  for (let from = 0; ; from += OPEN_ORDER_PAGE_SIZE) {
    const { data, error } = await db
      .from('contract_bets')
      .select('*')
      .in('contract_id', contractIds)
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .eq('data->>mexasFundsReserved', 'true')
      .eq('data->>mexasFundsReleased', 'false')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .range(from, from + OPEN_ORDER_PAGE_SIZE - 1)

    if (error) throw error

    for (const row of (data ?? []) as Row<'contract_bets'>[]) {
      const bet = convertBet(row)
      if ((bet as any).mexasFundsReleased === true) continue
      if (!hasActiveMexasWalletReservation(bet as any)) continue

      const remainingReservedAmount = getMexasRemainingReservedAmount(
        bet as any
      )
      const remainingReservedUnits = mexasAmountToUnits(remainingReservedAmount)
      if (remainingReservedUnits <= 0n) continue

      orders.push({
        betId: bet.id,
        remainingReservedUnits,
        userId: bet.userId,
      })
    }
    if ((data ?? []).length < OPEN_ORDER_PAGE_SIZE) break
  }

  return orders
}

async function loadMexasWalletUsersWithPositiveBalance(db: SupabaseClient) {
  const users: MexasWalletUser[] = []

  for (let from = 0; ; from += OPEN_ORDER_PAGE_SIZE) {
    const { data, error } = await db
      .from('users')
      .select('id,balance,data')
      .gt('balance', 0)
      .not('data->>privyWalletAddress', 'is', null)
      .range(from, from + OPEN_ORDER_PAGE_SIZE - 1)

    if (error) throw error

    for (const row of (data ?? []) as Row<'users'>[]) {
      const walletAddress = getRowData(row).privyWalletAddress
      if (typeof walletAddress !== 'string') continue
      users.push({
        balance: row.balance,
        id: row.id,
        walletAddress,
      })
    }
    if ((data ?? []).length < OPEN_ORDER_PAGE_SIZE) break
  }

  return users
}

async function loadOpenMexasLimitOrders(
  db: SupabaseClient,
  contractIds: string[]
) {
  if (!contractIds.length) return []

  const now = new Date().toISOString()
  const orders: OpenMexasLimitOrder[] = []

  for (let from = 0; ; from += OPEN_ORDER_PAGE_SIZE) {
    const { data, error } = await db
      .from('contract_bets')
      .select('*')
      .in('contract_id', contractIds)
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .eq('data->>mexasFundsReserved', 'true')
      .eq('data->>mexasFundsReleased', 'false')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .range(from, from + OPEN_ORDER_PAGE_SIZE - 1)

    if (error) throw error

    for (const row of (data ?? []) as Row<'contract_bets'>[]) {
      const bet = convertBet(row)
      if (bet.answerId) continue
      if (bet.outcome !== 'YES' && bet.outcome !== 'NO') continue
      if (typeof bet.limitProb !== 'number') continue

      const openAmount = getMexasOpenOrderAmount(bet as any)
      if (openAmount <= EPSILON) continue

      orders.push({
        betId: bet.id,
        contractId: bet.contractId,
        limitProb: bet.limitProb,
        openAmount,
        outcome: bet.outcome,
      })
    }
    if ((data ?? []).length < OPEN_ORDER_PAGE_SIZE) break
  }

  return orders
}

function getUnsafeOpenMexasOrderReasons(bet: MexasReservedOrderData) {
  const reasons: string[] = []
  if (bet.mexasFundsReserved !== true) reasons.push('funds not reserved')
  if (bet.mexasFundsReleased !== false) {
    reasons.push(
      bet.mexasFundsReleased === true
        ? 'funds already released'
        : 'funds release flag missing'
    )
  }
  if (getMexasRemainingReservedAmount(bet) <= EPSILON) {
    reasons.push('no remaining reserved amount')
  }
  return reasons
}

async function loadUnsafeOpenMexasLimitOrders(
  db: SupabaseClient,
  contractIds: string[]
) {
  if (!contractIds.length) return []

  const now = new Date().toISOString()
  const unsafeOrders: UnsafeOpenMexasLimitOrder[] = []

  for (let from = 0; ; from += OPEN_ORDER_PAGE_SIZE) {
    const { data, error } = await db
      .from('contract_bets')
      .select('*')
      .in('contract_id', contractIds)
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .range(from, from + OPEN_ORDER_PAGE_SIZE - 1)

    if (error) throw error

    for (const row of (data ?? []) as Row<'contract_bets'>[]) {
      const bet = convertBet(row)
      if (bet.answerId) continue
      if (bet.outcome !== 'YES' && bet.outcome !== 'NO') continue
      if (typeof bet.limitProb !== 'number') continue

      const openAmount = getMexasOpenOrderAmount(bet as any)
      if (openAmount <= EPSILON) continue

      const reasons = getUnsafeOpenMexasOrderReasons(
        bet as MexasReservedOrderData
      )
      if (!reasons.length) continue

      unsafeOrders.push({
        betId: bet.id,
        contractId: bet.contractId,
        limitProb: bet.limitProb,
        openAmount,
        outcome: bet.outcome,
        reasons,
      })
    }
    if ((data ?? []).length < OPEN_ORDER_PAGE_SIZE) break
  }

  return unsafeOrders
}

async function loadOpenEscrowedMexasLimitOrders(
  db: SupabaseClient,
  contractIds: string[]
) {
  if (!contractIds.length) return []

  const now = new Date().toISOString()
  const orders: EscrowedOpenMexasLimitOrder[] = []

  for (let from = 0; ; from += OPEN_ORDER_PAGE_SIZE) {
    const { data, error } = await db
      .from('contract_bets')
      .select('*')
      .in('contract_id', contractIds)
      .eq('is_filled', false)
      .eq('is_cancelled', false)
      .eq('data->>mexasFundsReserved', 'true')
      .eq('data->>mexasFundsReleased', 'false')
      .eq('data->>mexasStakeEscrowed', 'true')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .range(from, from + OPEN_ORDER_PAGE_SIZE - 1)

    if (error) throw error

    for (const row of (data ?? []) as Row<'contract_bets'>[]) {
      const bet = convertBet(row)
      if (bet.answerId) continue
      if (bet.outcome !== 'YES' && bet.outcome !== 'NO') continue
      if (typeof bet.limitProb !== 'number') continue

      const reservedBet = bet as LimitBet & MexasReservedOrderData
      if (!hasMexasEscrowedStake(reservedBet)) continue

      const openAmount = getMexasOpenOrderAmount(reservedBet)
      if (openAmount <= EPSILON) continue

      orders.push({
        betId: bet.id,
        contractId: bet.contractId,
        hasCaptureMetadata: hasMexasEscrowCaptureMetadata(reservedBet),
        limitProb: bet.limitProb,
        openAmount,
        outcome: bet.outcome,
      })
    }
    if ((data ?? []).length < OPEN_ORDER_PAGE_SIZE) break
  }

  return orders
}

function formatProbability(prob: number) {
  return `${(prob * 100).toFixed(2)}%`
}

function formatLockAge(issue: MexasMarketLockIssue) {
  if (issue.ageMs === undefined) return 'age unknown'
  const ageSeconds = Math.max(0, Math.round(issue.ageMs / 1000))
  const timeoutSeconds = Math.round(issue.timeoutMs / 1000)
  const freshness = issue.ageMs < issue.timeoutMs ? 'fresh' : 'stale'
  return `${ageSeconds}s old (${freshness}; timeout ${timeoutSeconds}s)`
}

function getLockAgeMs(data: Record<string, unknown>, key: string) {
  const since = data[key]
  return typeof since === 'number' ? Date.now() - since : undefined
}

async function loadOpenMexasContractRows(db: SupabaseClient) {
  const contractIds = await loadOpenMexasOrderbookContractIds(db)
  if (!contractIds.length) return []

  const rows: Row<'contracts'>[] = []
  for (let index = 0; index < contractIds.length; index += CONTRACT_PAGE_SIZE) {
    const { data, error } = await db
      .from('contracts')
      .select('*')
      .in('id', contractIds.slice(index, index + CONTRACT_PAGE_SIZE))

    if (error) throw error
    rows.push(...((data ?? []) as Row<'contracts'>[]))
  }

  return rows
}

function getMexasMarketLockIssues(row: Row<'contracts'>) {
  const data = getRowData(row)
  const issues: MexasMarketLockIssue[] = []

  if (data.mexasOrderLock === true) {
    const owner =
      typeof data.mexasOrderLockOwner === 'string'
        ? data.mexasOrderLockOwner
        : 'unknown owner'
    issues.push({
      ageMs: getLockAgeMs(data, 'mexasOrderLockSince'),
      contractId: row.id,
      detail: owner,
      lockType: 'order',
      timeoutMs: ORDER_LOCK_TIMEOUT_MS,
    })
  }

  if (data.mexasResolving === true) {
    const outcome =
      typeof data.mexasResolvingOutcome === 'string'
        ? data.mexasResolvingOutcome
        : 'unknown outcome'
    issues.push({
      ageMs: getLockAgeMs(data, 'mexasResolvingSince'),
      contractId: row.id,
      detail: outcome,
      lockType: 'resolution',
      timeoutMs: RESOLUTION_LOCK_TIMEOUT_MS,
    })
  }

  return issues
}

async function checkNoMexasMarketLocks(
  db: SupabaseClient
): Promise<CheckResult> {
  try {
    const rows = await loadOpenMexasContractRows(db)
    const issues = rows.flatMap(getMexasMarketLockIssues)

    if (issues.length) {
      return fail(
        'market lock residue',
        `${issues
          .slice(0, 5)
          .map(
            (issue) =>
              `${issue.contractId} ${issue.lockType} lock ${formatLockAge(
                issue
              )}: ${issue.detail}`
          )
          .join('; ')}${issues.length > 5 ? `; ${issues.length - 5} more` : ''}`
      )
    }

    return pass(
      'market lock residue',
      `No active order or resolution locks found across ${rows.length} unresolved MEXAS markets.`
    )
  } catch (error) {
    const message = formatDiagnosticError(error)
    return fail('market lock residue', message)
  }
}

async function checkNoUnsafeOpenMexasOrders(
  db: SupabaseClient
): Promise<CheckResult> {
  try {
    const contractIds = await loadOpenMexasOrderbookContractIds(db)
    const unsafeOrders = await loadUnsafeOpenMexasLimitOrders(db, contractIds)

    if (unsafeOrders.length) {
      return fail(
        'open order reservation flags',
        `${unsafeOrders
          .slice(0, 5)
          .map(
            (order) =>
              `${order.contractId}/${order.betId} ${
                order.outcome
              } ${formatProbability(order.limitProb)} ${
                order.openAmount
              } MEX: ${order.reasons.join(', ')}`
          )
          .join('; ')}${
          unsafeOrders.length > 5 ? `; ${unsafeOrders.length - 5} more` : ''
        }`
      )
    }

    return pass(
      'open order reservation flags',
      `All ${contractIds.length} unresolved MEXAS markets have only actively reserved visible orders.`
    )
  } catch (error) {
    const message = formatDiagnosticError(error)
    return fail('open order reservation flags', message)
  }
}

async function checkEscrowedMexasStakeReleaseReadiness(
  db: SupabaseClient,
  hasOperationalEscrow: boolean
): Promise<CheckResult> {
  try {
    const contractIds = await loadOpenMexasOrderbookContractIds(db)
    const escrowedOrders = await loadOpenEscrowedMexasLimitOrders(
      db,
      contractIds
    )

    if (!escrowedOrders.length) {
      return pass(
        'escrowed stake release readiness',
        'No active escrowed MEXAS order stake requires treasury release.'
      )
    }

    const missingMetadata = escrowedOrders.filter(
      (order) => !order.hasCaptureMetadata
    )
    if (missingMetadata.length) {
      return fail(
        'escrowed stake release readiness',
        `${missingMetadata
          .slice(0, 5)
          .map(
            (order) =>
              `${order.contractId}/${order.betId} missing escrow capture metadata`
          )
          .join('; ')}${
          missingMetadata.length > 5
            ? `; ${missingMetadata.length - 5} more`
            : ''
        }`
      )
    }

    if (!hasOperationalEscrow) {
      return fail(
        'escrowed stake release readiness',
        `${escrowedOrders.length} active escrowed MEXAS orders require operational treasury release/payout code before matching, cancel, or resolution can be enabled.`
      )
    }

    return pass(
      'escrowed stake release readiness',
      `${escrowedOrders.length} active escrowed MEXAS orders have capture metadata and operational escrow is enabled.`
    )
  } catch (error) {
    const message = formatDiagnosticError(error)
    return fail('escrowed stake release readiness', message)
  }
}

async function checkNoCrossedMexasOrderBooks(
  db: SupabaseClient
): Promise<CheckResult> {
  try {
    const contractIds = await loadOpenMexasOrderbookContractIds(db)
    const orders = await loadOpenMexasLimitOrders(db, contractIds)
    const ordersByContractId = orders.reduce((map, order) => {
      const contractOrders = map.get(order.contractId) ?? []
      contractOrders.push(order)
      map.set(order.contractId, contractOrders)
      return map
    }, new Map<string, OpenMexasLimitOrder[]>())
    const failures: string[] = []

    for (const [contractId, contractOrders] of ordersByContractId) {
      const yesBid = contractOrders
        .filter((order) => order.outcome === 'YES')
        .sort(
          (a, b) => b.limitProb - a.limitProb || a.betId.localeCompare(b.betId)
        )[0]
      const noAsk = contractOrders
        .filter((order) => order.outcome === 'NO')
        .sort(
          (a, b) => a.limitProb - b.limitProb || a.betId.localeCompare(b.betId)
        )[0]

      if (!yesBid || !noAsk) continue
      if (yesBid.limitProb + EPSILON < noAsk.limitProb) continue

      failures.push(
        `${contractId} crossed: YES ${formatProbability(yesBid.limitProb)} (${
          yesBid.betId
        }) >= NO ${formatProbability(noAsk.limitProb)} (${noAsk.betId})`
      )
    }

    if (failures.length) {
      return fail(
        'crossed order books',
        `${failures.slice(0, 5).join('; ')}${
          failures.length > 5 ? `; ${failures.length - 5} more` : ''
        }`
      )
    }

    return pass(
      'crossed order books',
      `No crossed open MEXAS order books found across ${contractIds.length} unresolved markets.`
    )
  } catch (error) {
    const message = formatDiagnosticError(error)
    return fail('crossed order books', message)
  }
}

async function checkOpenMexasOrderBacking(
  db: SupabaseClient
): Promise<CheckResult> {
  try {
    const contractIds = await loadMexasOrderbookContractIds(db)
    const orders = await loadOpenReservedMexasOrders(db, contractIds)
    if (!orders.length) {
      return pass(
        'open order backing',
        'No open reserved MEXAS orders require on-chain backing.'
      )
    }

    const backingByUserId = new Map<string, UserBacking>()
    for (const order of orders) {
      const backing = backingByUserId.get(order.userId) ?? {
        orderIds: [],
        requiredUnits: 0n,
      }
      backing.orderIds.push(order.betId)
      backing.requiredUnits += order.remainingReservedUnits
      backingByUserId.set(order.userId, backing)
    }

    const { data: users, error } = await db
      .from('users')
      .select('id,data')
      .in('id', [...backingByUserId.keys()])

    if (error) throw error

    const userById = new Map(
      ((users ?? []) as Row<'users'>[]).map((row) => [row.id, row])
    )
    const failures: string[] = []

    for (const [userId, backing] of backingByUserId) {
      const userRow = userById.get(userId)
      const walletAddress = getRowData(userRow ?? null).privyWalletAddress

      if (typeof walletAddress !== 'string') {
        failures.push(
          `${userId} has no Privy wallet for ${backing.orderIds[0]}`
        )
        continue
      }
      if (!EVM_ADDRESS_PATTERN.test(walletAddress)) {
        failures.push(
          `${userId} has invalid Privy wallet for ${backing.orderIds[0]}`
        )
        continue
      }

      const walletUnits = await readMexasWalletBalanceUnits(walletAddress)
      if (walletUnits < backing.requiredUnits) {
        failures.push(
          `${userId} reserves ${formatMexasUnits(
            backing.requiredUnits
          )} MEX but wallet has ${formatMexasUnits(walletUnits)} MEX`
        )
      }
    }

    if (failures.length) {
      return fail(
        'open order backing',
        `${failures.slice(0, 5).join('; ')}${
          failures.length > 5 ? `; ${failures.length - 5} more` : ''
        }`
      )
    }

    return pass(
      'open order backing',
      `${orders.length} open reserved MEXAS orders are covered by users' on-chain MEX.`
    )
  } catch (error) {
    const message = formatDiagnosticError(error)
    return fail('open order backing', message)
  }
}

async function checkInternalMexasBalanceBacking(
  db: SupabaseClient
): Promise<CheckResult> {
  try {
    const contractIds = await loadMexasOrderbookContractIds(db)
    const orders = await loadOpenReservedMexasOrders(db, contractIds)
    const reservedUnitsByUserId = new Map<string, bigint>()
    for (const order of orders) {
      reservedUnitsByUserId.set(
        order.userId,
        (reservedUnitsByUserId.get(order.userId) ?? 0n) +
          order.remainingReservedUnits
      )
    }

    const users = await loadMexasWalletUsersWithPositiveBalance(db)
    if (!users.length) {
      return pass(
        'internal balance backing',
        'No positive internal MEX balances require on-chain backing.'
      )
    }

    const failures: string[] = []
    for (const user of users) {
      if (!EVM_ADDRESS_PATTERN.test(user.walletAddress)) {
        failures.push(`${user.id} has invalid Privy wallet`)
        continue
      }

      const internalUnits = mexasAmountToUnits(user.balance)
      const reservedUnits = reservedUnitsByUserId.get(user.id) ?? 0n
      const walletUnits = await readMexasWalletBalanceUnits(user.walletAddress)
      const availableWalletUnits = subtractUnitsFloorZero(
        walletUnits,
        reservedUnits
      )
      if (internalUnits <= availableWalletUnits) continue

      failures.push(
        `${user.id} internal ${formatMexasUnits(
          internalUnits
        )} MEX exceeds backed available ${formatMexasUnits(
          availableWalletUnits
        )} MEX after ${formatMexasUnits(reservedUnits)} MEX reserved`
      )
    }

    if (failures.length) {
      return fail(
        'internal balance backing',
        `${failures.slice(0, 5).join('; ')}${
          failures.length > 5 ? `; ${failures.length - 5} more` : ''
        }`
      )
    }

    return pass(
      'internal balance backing',
      `${users.length} positive internal MEX balances are covered by on-chain wallet balances after open reservations.`
    )
  } catch (error) {
    const message = formatDiagnosticError(error)
    return fail('internal balance backing', message)
  }
}

async function checkMexasSettlementExposure(
  db: SupabaseClient,
  options: SettlementExposureCheckOptions
): Promise<CheckResult> {
  try {
    const contractIds = await loadOpenMexasOrderbookContractIds(db)
    if (!contractIds.length) {
      return pass(
        'settlement exposure',
        'No unresolved MEXAS orderbook markets found.'
      )
    }

    const rows: Row<'contract_bets'>[] = []
    for (let from = 0; ; from += OPEN_ORDER_PAGE_SIZE) {
      const { data, error } = await db
        .from('contract_bets')
        .select('*')
        .in('contract_id', contractIds)
        .eq('is_cancelled', false)
        .range(from, from + OPEN_ORDER_PAGE_SIZE - 1)

      if (error) throw error

      rows.push(...((data ?? []) as Row<'contract_bets'>[]))
      if ((data ?? []).length < OPEN_ORDER_PAGE_SIZE) break
    }

    const rowsByContractId = rows.reduce((map, row) => {
      const contractRows = map.get(row.contract_id) ?? []
      contractRows.push(row)
      map.set(row.contract_id, contractRows)
      return map
    }, new Map<string, Row<'contract_bets'>[]>())
    const audit = getMexasSettlementAudit(rows.map((row) => convertBet(row)))
    const filledContractExposures = [...rowsByContractId.entries()]
      .map(([contractId, contractRows]) => {
        const contractAudit = getMexasSettlementAudit(
          contractRows.map((row) => convertBet(row))
        )
        return {
          audit: contractAudit,
          contractId,
          rows: contractRows,
        }
      })
      .filter(({ audit }) => audit.filledBetCount > 0)
    const filledContractAudit = getMexasSettlementAudit(
      filledContractExposures.flatMap(({ rows }) =>
        rows.map((row) => convertBet(row))
      )
    )
    const contractExposureDetails = filledContractExposures.map(
      ({ audit, contractId }) =>
        `${contractId}: ${audit.filledBetCount} filled, open refunds ${audit.openReservationRefund}, total YES ${audit.yesCredit}, total NO ${audit.noCredit}, total CANCEL ${audit.cancelCredit}`
    )
    if (audit.filledBetCount === 0) {
      return pass(
        'settlement exposure',
        'No filled MEXAS positions require resolution payouts yet.'
      )
    }

    if (!options.hasOperationalEscrow) {
      return fail(
        'settlement exposure',
        `${
          audit.filledBetCount
        } filled MEXAS positions require escrow before resolution payouts. Filled-market credit exposure: YES ${
          filledContractAudit.yesCredit
        } MEX, NO ${filledContractAudit.noCredit} MEX, CANCEL ${
          filledContractAudit.cancelCredit
        } MEX. Open reservation refunds across all unresolved MEXAS markets: ${
          audit.openReservationRefund
        } MEX. Markets: ${contractExposureDetails.slice(0, 5).join('; ')}${
          contractExposureDetails.length > 5
            ? `; ${contractExposureDetails.length - 5} more`
            : ''
        }. Run "COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts audit:mexas-settlement" for the full exposure report. For test-only remediation, use the transaction-wrapped SQL path: run "COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts print:mexas-test-unwind-sql > /tmp/mexas-test-unwind.sql", review the rollback-protected SQL manually, then change rollback to commit only after review. The REST unwind script remains available for dry-run inspection with "COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts audit:mexas-test-unwind".`
      )
    }

    return pass(
      'settlement exposure',
      `${audit.filledBetCount} filled MEXAS positions have operational escrow for resolution payouts. Filled-market credit exposure: YES ${filledContractAudit.yesCredit} MEX, NO ${filledContractAudit.noCredit} MEX, CANCEL ${filledContractAudit.cancelCredit} MEX.`
    )
  } catch (error) {
    const message = formatDiagnosticError(error)
    return fail('settlement exposure', message)
  }
}

async function checkTreasuryTransferReconciliation(db: SupabaseClient) {
  const staleBefore = new Date(
    Date.now() - TRANSFER_PROCESSING_TIMEOUT_MS
  ).toISOString()

  try {
    const { data, error } = await db
      .from('mexas_treasury_transfers')
      .select('id,idempotency_key,transfer_type,updated_time,tx_hash')
      .eq('status', 'processing')
      .lt('updated_time', staleBefore)
      .order('updated_time', { ascending: true })
      .limit(20)

    if (error) {
      return fail(
        'treasury transfer reconciliation',
        `Could not read treasury transfer ledger: ${formatDiagnosticError(
          error
        )}`
      )
    }

    const staleTransfers = (data ?? []) as Row<'mexas_treasury_transfers'>[]
    if (staleTransfers.length) {
      return fail(
        'treasury transfer reconciliation',
        `${
          staleTransfers.length
        } stale processing treasury transfer(s) require manual reconciliation before launch: ${staleTransfers
          .map(
            (row) =>
              `${row.idempotency_key} ${row.transfer_type} updated ${row.updated_time}`
          )
          .join('; ')}`
      )
    }

    return pass(
      'treasury transfer reconciliation',
      'No stale processing MEXAS treasury transfers require manual reconciliation.'
    )
  } catch (error) {
    return fail(
      'treasury transfer reconciliation',
      formatDiagnosticError(error)
    )
  }
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
  const serverEnvFailures = getRequiredProductionEnvPresenceFailures(
    REQUIRED_SERVER_ENVS,
    vercelEnvNames
  )
  const publicEnvFailures = getRequiredReadableProductionEnvFailures(
    REQUIRED_PUBLIC_ENVS,
    vercelEnvNames,
    vercelEnvValues
  )
  let needsLaunchSql = false
  let supabaseDb: SupabaseClient | undefined

  checks.push(checkBackendApiCompile())
  checks.push(
    serverEnvFailures.length
      ? fail('server env', serverEnvFailures.join('; '))
      : pass(
          'server env',
          'Required server env vars exist in Vercel production.'
        )
  )
  checks.push(
    publicEnvFailures.length
      ? fail('public env', publicEnvFailures.join('; '))
      : pass(
          'public env',
          'Required public env vars are non-empty in Vercel production.'
        )
  )
  checks.push(checkTreasuryWalletEnv(vercelEnvValues))
  checks.push(checkTreasurySignerEnv(vercelEnvNames, vercelEnvValues))
  checks.push(await checkTreasuryGasFunding(vercelEnvValues))

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
    supabaseDb = db
    const { error: mexContractsError, count } = await db
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('token', 'MEX')

    checks.push(
      mexContractsError
        ? fail(
            'supabase MEX contracts',
            `Could not read MEX contracts: ${formatDiagnosticError(
              mexContractsError
            )}. This usually means the launch SQL has not been applied yet.`
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
      const tokenConstraintLikelyBlocksMex = (requiredContracts ?? []).some(
        (row) => {
          const data =
            row.data && typeof row.data === 'object' && !Array.isArray(row.data)
              ? (row.data as Record<string, unknown>)
              : {}
          return row.token !== 'MEX' && data.token === 'MEX'
        }
      )
      if (contractFailures.length) needsLaunchSql = true

      checks.push(
        contractFailures.length
          ? fail(
              'required MEXAS contracts',
              `Invalid rows: ${contractFailures.join('; ')}${
                tokenConstraintLikelyBlocksMex
                  ? '; contracts_token_check still needs the launch SQL so SQL token can be set to MEX'
                  : ''
              }`
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
    if (matchingReadyError || matchingReady !== true) needsLaunchSql = true
    checks.push(
      matchingReadyError
        ? fail(
            'matching RPC health',
            `Health RPC is not callable: ${formatDiagnosticError(
              matchingReadyError
            )}`
          )
        : matchingReady === true
        ? pass('matching RPC health', 'Matching health RPC reports ready.')
        : fail('matching RPC health', 'Matching health RPC returned false.')
    )

    const { data: treasuryLedgerReady, error: treasuryLedgerReadyError } =
      await db.rpc('mexas_treasury_settlement_ledger_ready')
    if (treasuryLedgerReadyError || treasuryLedgerReady !== true) {
      needsLaunchSql = true
    }
    checks.push(
      treasuryLedgerReadyError
        ? fail(
            'treasury settlement ledger',
            `Health RPC is not callable: ${formatDiagnosticError(
              treasuryLedgerReadyError
            )}`
          )
        : treasuryLedgerReady === true
        ? pass(
            'treasury settlement ledger',
            'Treasury settlement ledger health RPC reports ready.'
          )
        : fail(
            'treasury settlement ledger',
            'Treasury settlement ledger health RPC returned false.'
          )
    )

    const { data: escrowCaptureReady, error: escrowCaptureReadyError } =
      await db.rpc('mexas_escrow_capture_ready')
    if (escrowCaptureReadyError || escrowCaptureReady !== true) {
      needsLaunchSql = true
    }
    checks.push(
      escrowCaptureReadyError
        ? fail(
            'escrow capture guard',
            `Health RPC is not callable: ${formatDiagnosticError(
              escrowCaptureReadyError
            )}`
          )
        : escrowCaptureReady === true
        ? pass(
            'escrow capture guard',
            'Escrow capture idempotency guard reports ready.'
          )
        : fail(
            'escrow capture guard',
            'Escrow capture idempotency guard returned false.'
          )
    )

    const tokenAlignment = await checkMexasContractTokenAlignment(db)
    if (tokenAlignment.needsLaunchSql) needsLaunchSql = true
    checks.push(tokenAlignment.result)

    checks.push(await checkNoUnsafeOpenMexasOrders(db))
    checks.push(await checkNoMexasMarketLocks(db))
    checks.push(await checkOpenMexasOrderBacking(db))
    checks.push(await checkInternalMexasBalanceBacking(db))
    checks.push(await checkNoCrossedMexasOrderBooks(db))
  }

  if (needsLaunchSql) {
    const hasLaunchSqlApplyAccess = LAUNCH_SQL_APPLY_ENVS.some(hasEnv)
    checks.push(
      hasLaunchSqlApplyAccess
        ? pass(
            'launch SQL apply access',
            'A local Postgres connection env var is present for apply:mexas-launch-sql.'
          )
        : fail(
            'launch SQL apply access',
            `Launch SQL is missing and no local Postgres connection env is set. Set one of ${LAUNCH_SQL_APPLY_ENVS.join(
              ', '
            )}, or run "COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts apply:mexas-launch-sql --print-sql" and paste it into Supabase SQL Editor. Service-role REST cannot apply this because contracts_token_check and RPC/index DDL require Postgres SQL access.`
          )
    )
  } else {
    checks.push(
      pass('launch SQL apply access', 'Launch SQL is already applied.')
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
  const escrowImplementation = getEnvOrVercelValue(
    'MEXAS_ESCROW_IMPLEMENTATION',
    vercelEnvValues
  )
  const escrowCaptureOrders = getEnvOrVercelValue(
    'MEXAS_ENABLE_ESCROW_CAPTURE_ORDERS',
    vercelEnvValues
  )
  const hasOperationalEscrow = hasOperationalMexasEscrow({
    escrowImplementation,
    settlementMode,
  })
  const missingEscrowCapabilities = getMissingMexasEscrowCapabilities()
  if (supabaseDb) {
    checks.push(await checkTreasuryTransferReconciliation(supabaseDb))
    checks.push(
      await checkMexasSettlementExposure(supabaseDb, { hasOperationalEscrow })
    )
    checks.push(
      await checkEscrowedMexasStakeReleaseReadiness(
        supabaseDb,
        hasOperationalEscrow
      )
    )
  }
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
    hasOperationalEscrow
      ? pass(
          'escrow implementation',
          'MEXAS on-chain escrow implementation is enabled and implemented.'
        )
      : fail(
          'escrow implementation',
          escrowImplementation === 'onchain-transfer'
            ? `MEXAS_ESCROW_IMPLEMENTATION=onchain-transfer is configured, but escrow capabilities are missing: ${missingEscrowCapabilities.join(
                ', '
              )}.`
            : 'MEXAS_ESCROW_IMPLEMENTATION must be onchain-transfer before live matching or resolving filled MEXAS positions.'
        )
  )
  checks.push(
    escrowCaptureOrders === 'true' && hasOperationalEscrow
      ? pass('escrow capture flag', 'MEXAS_ENABLE_ESCROW_CAPTURE_ORDERS=true.')
      : escrowCaptureOrders === 'true'
      ? fail(
          'escrow capture flag',
          'MEXAS_ENABLE_ESCROW_CAPTURE_ORDERS cannot be true until treasury release and resolution payout escrow capabilities are implemented.'
        )
      : fail(
          'escrow capture flag',
          'MEXAS_ENABLE_ESCROW_CAPTURE_ORDERS must be true before launch so crossing orders can capture stake on-chain.'
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

  const commitInfo = getCurrentGitCommitInfo()
  const deployment = getVercelProductionDeployment(siteUrl)
  if (!commitInfo) {
    checks.push(warn('deployment freshness', 'Could not read local git HEAD.'))
  } else if (!deployment) {
    checks.push(
      fail('deployment freshness', 'Could not inspect production deployment.')
    )
  } else if (
    deployment.readyState !== 'READY' ||
    deployment.target !== 'production'
  ) {
    checks.push(
      fail(
        'deployment freshness',
        `Production deployment is ${deployment.readyState ?? 'unknown'} / ${
          deployment.target ?? 'unknown'
        }.`
      )
    )
  } else if ((deployment.createdAt ?? 0) < commitInfo.timestampMs) {
    checks.push(
      fail(
        'deployment freshness',
        `Active deployment ${
          deployment.id ?? deployment.uid ?? deployment.url ?? 'unknown'
        } predates HEAD ${commitInfo.hash.slice(0, 9)}. Redeploy production.`
      )
    )
  } else {
    checks.push(
      pass(
        'deployment freshness',
        `Production deployment includes code at or after HEAD ${commitInfo.hash.slice(
          0,
          9
        )}.`
      )
    )
  }

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
      const message = formatDiagnosticError(error)
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
    console.error(formatDiagnosticError(error))
    process.exitCode = 1
  })
}
