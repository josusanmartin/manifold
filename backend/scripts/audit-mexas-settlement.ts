import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { Bet } from 'common/bet'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import { getMexasResolvedBetPayout } from 'common/mexas-resolution'
import {
  getMexasSettlementAudit,
  hasMexasFilledExposure,
} from 'common/mexas-settlement'
import { convertBet } from 'common/supabase/bets'
import { convertContract } from 'common/supabase/contracts'
import { createClient } from 'common/supabase/utils'
import type { Row, SupabaseClient } from 'common/supabase/utils'

const PAGE_SIZE = 1000

type ContractExposure = {
  audit: ReturnType<typeof getMexasSettlementAudit>
  bets: FilledExposure[]
  contractId: string
  question: string
  slug: string
}

type FilledExposure = {
  amount: number
  betId: string
  cancelPayout: number
  contractId: string
  createdTime: number
  noPayout: number
  outcome?: string
  shares: number
  userId: string
  yesPayout: number
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

async function loadMexasOrderbookContracts(db: SupabaseClient) {
  const rows: Row<'contracts'>[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('contracts')
      .select('*')
      .contains('data', { token: 'MEX' } as any)
      .is('resolution_time', null)
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...((data ?? []) as Row<'contracts'>[]))
    if ((data ?? []).length < PAGE_SIZE) break
  }

  return rows
    .map((row) => ({ contract: convertContract(row), row }))
    .filter(({ contract }) => isMexasOrderBookOnlyContract(contract))
}

async function loadContractBets(db: SupabaseClient, contractId: string) {
  const rows: Row<'contract_bets'>[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('contract_bets')
      .select('*')
      .eq('contract_id', contractId)
      .eq('is_cancelled', false)
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...((data ?? []) as Row<'contract_bets'>[]))
    if ((data ?? []).length < PAGE_SIZE) break
  }

  return rows.map((row) => convertBet(row))
}

function toFilledExposure(bet: Bet): FilledExposure {
  return {
    amount: bet.amount ?? 0,
    betId: bet.id,
    cancelPayout: getMexasResolvedBetPayout(bet, 'CANCEL'),
    contractId: bet.contractId,
    createdTime: bet.createdTime,
    noPayout: getMexasResolvedBetPayout(bet, 'NO'),
    outcome: bet.outcome,
    shares: bet.shares ?? 0,
    userId: bet.userId,
    yesPayout: getMexasResolvedBetPayout(bet, 'YES'),
  }
}

async function loadSettlementExposure(db: SupabaseClient) {
  const contracts = await loadMexasOrderbookContracts(db)
  const exposures: ContractExposure[] = []

  for (const { contract } of contracts) {
    const bets = await loadContractBets(db, contract.id)
    const filledBets = bets.filter(hasMexasFilledExposure)
    const audit = getMexasSettlementAudit(bets)
    if (audit.filledBetCount === 0) continue

    exposures.push({
      audit,
      bets: filledBets.map(toFilledExposure),
      contractId: contract.id,
      question: contract.question,
      slug: contract.slug,
    })
  }

  return exposures
}

function printTextReport(exposures: ContractExposure[]) {
  if (!exposures.length) {
    console.log('PASS No filled MEXAS settlement exposure found.')
    return
  }

  console.log(
    `FAIL ${exposures.length} MEXAS market(s) have filled settlement exposure.`
  )
  console.log(
    'These positions cannot be safely resolved until escrow is operational or the exposure is manually remediated.'
  )
  console.log('')

  for (const exposure of exposures) {
    console.log(`${exposure.contractId} ${exposure.slug}`)
    console.log(exposure.question)
    console.log(
      `  filled=${exposure.audit.filledBetCount} stake=${exposure.audit.filledStake} MEX YES=${exposure.audit.yesPayout} MEX NO=${exposure.audit.noPayout} MEX CANCEL=${exposure.audit.cancelPayout} MEX`
    )
    for (const bet of exposure.bets) {
      console.log(
        `  bet=${bet.betId} user=${bet.userId} outcome=${bet.outcome ?? 'n/a'} amount=${bet.amount} shares=${bet.shares} payouts(YES=${bet.yesPayout}, NO=${bet.noPayout}, CANCEL=${bet.cancelPayout})`
      )
    }
    console.log('')
  }

  console.log('Remediation options:')
  console.log('  1. Implement on-chain escrow and keep these positions active.')
  console.log(
    '  2. Resolve only after treasury/escrow can cover the maximum payout exposure.'
  )
  console.log(
    '  3. For test-only markets, manually unwind after reviewing the JSON report and user balances.'
  )
}

async function main() {
  loadEnvFiles()

  const json = process.argv.includes('--json')
  const supabaseUrlOrInstanceId = getSupabaseUrlOrInstanceId()
  const supabaseAdminKey = getSupabaseAdminKey()

  if (!supabaseUrlOrInstanceId || !supabaseAdminKey) {
    throw new Error('Missing Supabase URL/instance id or admin/service key.')
  }

  const db = createClient(supabaseUrlOrInstanceId, supabaseAdminKey)
  const exposures = await loadSettlementExposure(db)

  if (json) {
    console.log(JSON.stringify({ exposures }, null, 2))
  } else {
    printTextReport(exposures)
  }

  if (exposures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
