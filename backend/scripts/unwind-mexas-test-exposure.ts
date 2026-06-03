import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { Bet } from 'common/bet'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import { getMexasResolutionPayout } from 'common/mexas-resolution'
import { hasMexasFilledExposure } from 'common/mexas-settlement'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import {
  createClient,
  type Row,
  type SupabaseClient,
} from 'common/supabase/utils'
import { updateMexasUserBalanceCas } from 'web/lib/api/mexas-balance'

const PAGE_SIZE = 1000
const TEST_UNWIND_CONTRACT_IDS = ['ukrwarend26a'] as const

type FilledExposure = {
  amount: number
  bet: Bet
  cancelCredit: number
  contractId: string
  shares: number
  userId: string
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
  const tempDir = mkdtempSync(resolve(tmpdir(), 'mexas-unwind-env-'))
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

function getRowData(row: { data: unknown } | null): Record<string, unknown> {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function roundAmount(value: number) {
  return Math.round(value * 1e8) / 1e8
}

async function loadContractBets(db: SupabaseClient, contractId: string) {
  const rows: Row<'contract_bets'>[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('contract_bets')
      .select('*')
      .eq('contract_id', contractId)
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...((data ?? []) as Row<'contract_bets'>[]))
    if ((data ?? []).length < PAGE_SIZE) break
  }

  return rows
}

async function loadFilledTestExposures(db: SupabaseClient) {
  const exposures: FilledExposure[] = []

  for (const contractId of TEST_UNWIND_CONTRACT_IDS) {
    const { data: contractRow, error: contractError } = await db
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .maybeSingle()

    if (contractError) throw contractError
    if (!contractRow) continue

    const contract = convertContract(contractRow as Row<'contracts'>)
    if (!isMexasOrderBookOnlyContract(contract)) {
      throw new Error(`${contractId} is not a MEXAS orderbook market.`)
    }
    if (contract.isResolved) {
      throw new Error(`${contractId} is already resolved.`)
    }

    const rows = await loadContractBets(db, contractId)
    for (const row of rows) {
      const bet = convertBet(row)
      if (!hasMexasFilledExposure(bet)) continue
      exposures.push({
        amount: roundAmount(bet.amount ?? 0),
        bet,
        cancelCredit: roundAmount(getMexasResolutionPayout(bet, 'CANCEL')),
        contractId,
        shares: roundAmount(bet.shares ?? 0),
        userId: bet.userId,
      })
    }
  }

  return exposures
}

async function assertCurrentFilledBet(
  db: SupabaseClient,
  exposure: FilledExposure
) {
  const { data: row, error } = await db
    .from('contract_bets')
    .select('*')
    .eq('bet_id', exposure.bet.id)
    .eq('contract_id', exposure.contractId)
    .eq('user_id', exposure.userId)
    .maybeSingle()

  if (error) throw error
  if (!row) throw new Error(`Bet ${exposure.bet.id} is missing.`)

  const typedRow = row as Row<'contract_bets'>
  const currentBet = convertBet(typedRow)
  if (!hasMexasFilledExposure(currentBet)) {
    throw new Error(`Bet ${exposure.bet.id} is no longer filled exposure.`)
  }
  if (
    roundAmount(currentBet.amount ?? 0) !== exposure.amount ||
    roundAmount(currentBet.shares ?? 0) !== exposure.shares
  ) {
    throw new Error(`Bet ${exposure.bet.id} amount/shares changed.`)
  }

  return { alreadyCancelled: currentBet.isCancelled === true, row: typedRow }
}

async function applyUnwind(db: SupabaseClient, exposure: FilledExposure) {
  if (exposure.cancelCredit <= 0) {
    throw new Error(`Unwind credit must be positive for ${exposure.bet.id}.`)
  }

  const current = await assertCurrentFilledBet(db, exposure)
  const creditKey = `mexas-test-unwind:${exposure.bet.id}`

  await updateMexasUserBalanceCas(db, exposure.userId, exposure.cancelCredit, {
    creditKey,
  })

  const data = getRowData(current.row)
  if (data.mexasTestUnwound === true) {
    return 'already-unwound'
  }

  const { data: updatedRow, error: updateError } = await db
    .from('contract_bets')
    .update({
      is_cancelled: true,
      data: {
        ...data,
        isCancelled: true,
        mexasTestUnwound: true,
        mexasTestUnwindCreditAmount: exposure.cancelCredit,
        mexasTestUnwindCreditKey: creditKey,
        mexasTestUnwoundAt: Date.now(),
      } as any,
    })
    .eq('bet_id', exposure.bet.id)
    .eq('updated_time', current.row.updated_time)
    .select('bet_id')
    .maybeSingle()

  if (updateError) throw updateError
  if (!updatedRow) {
    throw new Error(`Bet ${exposure.bet.id} changed during unwind.`)
  }

  return current.alreadyCancelled ? 'marked-already-cancelled' : 'cancelled'
}

function printPlan(exposures: FilledExposure[]) {
  if (!exposures.length) {
    console.log('PASS No test MEXAS filled exposure found.')
    return
  }

  console.log(
    `Found ${exposures.length} test filled MEXAS exposure(s) eligible for unwind.`
  )
  for (const exposure of exposures) {
    console.log(
      [
        `contract=${exposure.contractId}`,
        `bet=${exposure.bet.id}`,
        `user=${exposure.userId}`,
        `amount=${exposure.amount}`,
        `shares=${exposure.shares}`,
        `cancelCredit=${exposure.cancelCredit}`,
      ].join(' ')
    )
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const confirmed = process.argv.includes('--confirm-test-unwind')

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
  const exposures = await loadFilledTestExposures(db)
  printPlan(exposures)

  if (!apply) {
    console.log('Dry run only. Pass --apply --confirm-test-unwind to modify data.')
    return
  }
  if (!confirmed) {
    throw new Error('Refusing to apply without --confirm-test-unwind.')
  }

  for (const exposure of exposures) {
    const result = await applyUnwind(db, exposure)
    console.log(`APPLIED ${result} bet=${exposure.bet.id}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
