import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { LimitBet } from 'common/bet'
import {
  getMexasRemainingReservedAmount,
  hasActiveMexasWalletReservation,
  hasInactiveMexasOrderDataFlags,
  isMexasOrderBookOnlyContract,
  type MexasReservedOrderData,
} from 'common/mexas-market'
import { getMexasOpenOrderAmount } from 'common/mexas-order-book'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import {
  createClient,
  type Row,
  type SupabaseClient,
} from 'common/supabase/utils'
import { releaseCancelledMexasOrder } from 'web/lib/api/mexas-orders'

const PAGE_SIZE = 1000

type WalletReservedOrder = {
  bet: LimitBet & MexasReservedOrderData
  contractQuestion: string
  row: Row<'contract_bets'>
}

function getRowData(row: { data: unknown } | null) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
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
  if (error instanceof Error) {
    return compactDiagnosticText(error.message)
  }

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

  if (message) return compactDiagnosticText(message)

  try {
    return compactDiagnosticText(JSON.stringify(error))
  } catch {
    return compactDiagnosticText(String(error))
  }
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

function loadEnvFiles() {
  const roots = [process.cwd(), resolve(__dirname, '../..')]
  const seen = new Set<string>()

  for (const root of roots) {
    for (const path of ['.env', '.env.local', 'web/.env', 'web/.env.local']) {
      const fullPath = resolve(root, path)
      if (seen.has(fullPath) || !existsSync(fullPath)) continue
      seen.add(fullPath)
      for (const line of readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
        const assignment = parseEnvAssignment(line)
        if (assignment && !process.env[assignment.key]) {
          process.env[assignment.key] = assignment.value
        }
      }
    }
  }
}

function loadVercelProductionEnv() {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'mexas-wallet-orders-env-'))
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
      if (assignment && !process.env[assignment.key]) {
        process.env[assignment.key] = assignment.value
      }
    }
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
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

async function loadMexasOrderbookContractRows(db: SupabaseClient) {
  const rows: Row<'contracts'>[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('contracts')
      .select('*')
      .contains('data', { token: 'MEX' } as any)
      .is('resolution_time', null)
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(
        `Failed to load MEXAS contracts: ${formatDiagnosticError(error)}`
      )
    }
    rows.push(...((data ?? []) as Row<'contracts'>[]))
    if ((data ?? []).length < PAGE_SIZE) break
  }

  return rows.filter((row) =>
    isMexasOrderBookOnlyContract(convertContract(row))
  )
}

async function loadActiveWalletReservedOrders(db: SupabaseClient) {
  const contractRows = await loadMexasOrderbookContractRows(db)
  const orders: WalletReservedOrder[] = []
  const now = new Date().toISOString()

  for (const contractRow of contractRows) {
    const contract = convertContract(contractRow)
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from('contract_bets')
        .select('*')
        .eq('contract_id', contract.id)
        .eq('is_filled', false)
        .eq('is_cancelled', false)
        .eq('data->>mexasFundsReserved', 'true')
        .eq('data->>mexasFundsReleased', 'false')
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        throw new Error(
          `Failed to load wallet-reserved orders for ${
            contract.id
          }: ${formatDiagnosticError(error)}`
        )
      }

      for (const row of (data ?? []) as Row<'contract_bets'>[]) {
        if (hasInactiveMexasOrderDataFlags(getRowData(row))) continue
        const bet = convertBet(row) as LimitBet & MexasReservedOrderData
        if (bet.answerId) continue
        if (bet.outcome !== 'YES' && bet.outcome !== 'NO') continue
        if (bet.limitProb === undefined) continue
        if (!hasActiveMexasWalletReservation(bet)) continue
        if (getMexasOpenOrderAmount(bet) <= 1e-9) continue

        orders.push({
          bet,
          contractQuestion: contract.question,
          row,
        })
      }

      if ((data ?? []).length < PAGE_SIZE) break
    }
  }

  return orders
}

function formatPercent(prob: number | undefined) {
  return prob === undefined ? 'n/a' : `${(prob * 100).toFixed(2)}%`
}

function printPlan(orders: WalletReservedOrder[]) {
  if (!orders.length) {
    console.log('PASS No active wallet-reserved MEXAS orders found.')
    return
  }

  console.log(
    `Found ${orders.length} active wallet-reserved MEXAS order(s) blocking escrow launch.`
  )
  for (const { bet, contractQuestion } of orders) {
    console.log(
      [
        `contract=${bet.contractId}`,
        `bet=${bet.id}`,
        `user=${bet.userId}`,
        `outcome=${bet.outcome}`,
        `prob=${formatPercent(bet.limitProb)}`,
        `openAmount=${getMexasOpenOrderAmount(bet)}`,
        `refund=${getMexasRemainingReservedAmount(bet)}`,
        `question=${contractQuestion}`,
      ].join(' ')
    )
  }
}

async function applyCancellation(
  db: SupabaseClient,
  order: WalletReservedOrder
) {
  const releasedRow = await releaseCancelledMexasOrder(db, order.row)
  if (!releasedRow) {
    throw new Error(`Order changed during cancellation: ${order.bet.id}`)
  }

  return convertBet(releasedRow) as LimitBet & MexasReservedOrderData
}

async function main() {
  const apply = process.argv.includes('--apply')
  const confirmed = process.argv.includes('--confirm-wallet-reserved-cancel')

  loadEnvFiles()
  if (!getSupabaseUrlOrInstanceId() || !getSupabaseAdminKey()) {
    loadVercelProductionEnv()
  }

  const supabaseUrlOrInstanceId = getSupabaseUrlOrInstanceId()
  const supabaseAdminKey = getSupabaseAdminKey()
  if (!supabaseUrlOrInstanceId || !supabaseAdminKey) {
    throw new Error('Missing Supabase URL/instance id or admin/service key.')
  }

  const db = createClient(supabaseUrlOrInstanceId, supabaseAdminKey)
  const orders = await loadActiveWalletReservedOrders(db)
  printPlan(orders)

  if (!apply) {
    console.log(
      'Dry run only. Pass --apply --confirm-wallet-reserved-cancel to cancel and refund these orders.'
    )
    return
  }
  if (!confirmed) {
    throw new Error(
      'Refusing to apply without --confirm-wallet-reserved-cancel.'
    )
  }

  for (const order of orders) {
    const releasedBet = await applyCancellation(db, order)
    console.log(
      [
        'APPLIED cancelled',
        `bet=${releasedBet.id}`,
        `user=${releasedBet.userId}`,
        `released=${releasedBet.mexasFundsReleased === true}`,
        `credit=${releasedBet.mexasReleaseCreditAmount ?? 0}`,
        `reason=${releasedBet.mexasReleaseReason ?? 'n/a'}`,
      ].join(' ')
    )
  }
}

main().catch((error) => {
  console.error(formatDiagnosticError(error))
  process.exit(1)
})
