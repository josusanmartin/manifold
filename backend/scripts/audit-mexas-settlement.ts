import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { Bet } from 'common/bet'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import {
  getMexasOpenReservationRefund,
  getMexasResolutionPayout,
  getMexasResolvedBetPayout,
} from 'common/mexas-resolution'
import {
  getMissingMexasEscrowCapabilities,
  getMexasSettlementAudit,
  hasMexasEscrowSettlementExposure,
  hasMexasFilledExposure,
  hasOperationalMexasEscrow,
  type MexasSettlementSettings,
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
  cancelCredit: number
  cancelPayout: number
  contractId: string
  createdTime: number
  noPayout: number
  openReservationRefund: number
  outcome?: string
  shares: number
  userId: string
  yesPayout: number
}

type SettlementExposureReportOptions = {
  hasOperationalEscrow: boolean
  missingEscrowCapabilities: string[]
  strict: boolean
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

function getMexasSettlementSettings(): MexasSettlementSettings {
  return {
    escrowImplementation: process.env.MEXAS_ESCROW_IMPLEMENTATION,
    settlementMode: process.env.MEXAS_SETTLEMENT_MODE,
  }
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
    cancelCredit: getMexasResolutionPayout(bet, 'CANCEL'),
    cancelPayout: getMexasResolvedBetPayout(bet, 'CANCEL'),
    contractId: bet.contractId,
    createdTime: bet.createdTime,
    noPayout: getMexasResolvedBetPayout(bet, 'NO'),
    openReservationRefund: getMexasOpenReservationRefund(bet),
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
    if (!hasMexasEscrowSettlementExposure(audit)) continue

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

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlNumber(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid SQL number: ${value}`)
  }
  return value.toFixed(8).replace(/\.?0+$/, '')
}

function printTestUnwindSql(exposures: ContractExposure[]) {
  console.log('-- MEXAS TEST-ONLY FILLED EXPOSURE UNWIND SQL')
  console.log('-- Review every statement before running it in Supabase SQL Editor.')
  console.log('-- This credits each user with the CANCEL credit and marks the filled bet cancelled.')
  console.log('-- The transaction ends with ROLLBACK by default; change ROLLBACK to COMMIT only after review.')
  console.log('')
  console.log('begin;')
  console.log('')

  for (const exposure of exposures) {
    console.log(
      `-- ${exposure.contractId} ${exposure.slug}: ${exposure.question}`
    )
    for (const bet of exposure.bets) {
      const creditKey = `mexas-test-unwind:${bet.betId}`
      console.log('do $$')
      console.log('declare')
      console.log(`  v_bet_id text := ${sqlLiteral(bet.betId)};`)
      console.log(`  v_contract_id text := ${sqlLiteral(bet.contractId)};`)
      console.log(`  v_user_id text := ${sqlLiteral(bet.userId)};`)
      console.log(`  v_credit_key text := ${sqlLiteral(creditKey)};`)
      console.log(`  v_credit_amount numeric := ${sqlNumber(bet.cancelCredit)};`)
      console.log(`  v_expected_amount numeric := ${sqlNumber(bet.amount)};`)
      console.log(`  v_expected_shares numeric := ${sqlNumber(bet.shares)};`)
      console.log('  v_user_data jsonb;')
      console.log('  v_credit_keys jsonb;')
      console.log('  v_count integer;')
      console.log('begin')
      console.log('  if v_credit_amount <= 0 then')
      console.log("    raise exception 'Unwind credit must be positive for %', v_bet_id;")
      console.log('  end if;')
      console.log('')
      console.log('  perform 1')
      console.log('  from public.contracts c')
      console.log('  where c.id = v_contract_id')
      console.log("    and c.data ->> 'token' = 'MEX'")
      console.log("    and c.data ->> 'mechanism' = 'cpmm-1'")
      console.log("    and c.data ->> 'outcomeType' = 'BINARY'")
      console.log('    and c.resolution_time is null')
      console.log('  for update;')
      console.log('  if not found then')
      console.log("    raise exception 'MEXAS contract is missing/resolved/not eligible: %', v_contract_id;")
      console.log('  end if;')
      console.log('')
      console.log('  perform 1')
      console.log('  from public.contract_bets b')
      console.log('  where b.bet_id = v_bet_id')
      console.log('    and b.contract_id = v_contract_id')
      console.log('    and b.user_id = v_user_id')
      console.log('    and coalesce(b.amount, 0) > 0')
      console.log('    and coalesce(b.shares, 0) > 0')
      console.log('    and round(coalesce(b.amount, 0)::numeric, 8) = v_expected_amount')
      console.log('    and round(coalesce(b.shares, 0)::numeric, 8) = v_expected_shares')
      console.log('  for update;')
      console.log('  if not found then')
      console.log("    raise exception 'Filled MEXAS bet changed or is not eligible: %', v_bet_id;")
      console.log('  end if;')
      console.log('')
      console.log('  select coalesce(u.data, \'{}\'::jsonb)')
      console.log('  into v_user_data')
      console.log('  from public.users u')
      console.log('  where u.id = v_user_id')
      console.log('  for update;')
      console.log('  if not found then')
      console.log("    raise exception 'User missing for MEXAS unwind: %', v_user_id;")
      console.log('  end if;')
      console.log('')
      console.log("  v_credit_keys := case")
      console.log("    when jsonb_typeof(v_user_data -> 'mexasBalanceCreditKeys') = 'array'")
      console.log("      then v_user_data -> 'mexasBalanceCreditKeys'")
      console.log("    else '[]'::jsonb")
      console.log('  end;')
      console.log('  if v_credit_keys ? v_credit_key then')
      console.log("    raise exception 'Unwind credit key already exists: %', v_credit_key;")
      console.log('  end if;')
      console.log('')
      console.log('  update public.users')
      console.log('  set')
      console.log('    balance = round(balance + v_credit_amount, 8),')
      console.log('    data = v_user_data || jsonb_build_object(')
      console.log("      'mexasBalanceCreditKeys',")
      console.log('      v_credit_keys || to_jsonb(v_credit_key)')
      console.log('    )')
      console.log('  where id = v_user_id;')
      console.log('  get diagnostics v_count = row_count;')
      console.log('  if v_count <> 1 then')
      console.log("    raise exception 'Expected to credit one user for %, credited %', v_bet_id, v_count;")
      console.log('  end if;')
      console.log('')
      console.log('  update public.contract_bets')
      console.log('  set')
      console.log('    is_cancelled = true,')
      console.log('    data = coalesce(data, \'{}\'::jsonb) || jsonb_build_object(')
      console.log("      'isCancelled', true,")
      console.log("      'mexasTestUnwound', true,")
      console.log("      'mexasTestUnwindCreditKey', v_credit_key,")
      console.log("      'mexasTestUnwindCreditAmount', v_credit_amount,")
      console.log("      'mexasTestUnwoundAt', floor(extract(epoch from clock_timestamp()) * 1000)")
      console.log('    )')
      console.log('  where bet_id = v_bet_id;')
      console.log('  get diagnostics v_count = row_count;')
      console.log('  if v_count <> 1 then')
      console.log("    raise exception 'Expected to mark one filled bet for %, marked %', v_bet_id, v_count;")
      console.log('  end if;')
      console.log('end $$;')
      console.log('')
    }
  }

  console.log('-- Keep this as rollback until the reviewed diff/counts are correct.')
  console.log('rollback;')
}

function printTextReport(
  exposures: ContractExposure[],
  options: SettlementExposureReportOptions
) {
  if (!exposures.length) {
    console.log(
      'PASS No filled or treasury-escrowed open MEXAS settlement exposure found.'
    )
    return
  }

  const blocked = options.strict || !options.hasOperationalEscrow
  console.log(
    `${
      blocked ? 'FAIL' : 'PASS'
    } ${exposures.length} MEXAS market(s) have filled or treasury-escrowed settlement exposure.`
  )
  if (blocked) {
    console.log(
      'These positions cannot be safely resolved until escrow is operational or the exposure is manually remediated.'
    )
    if (options.missingEscrowCapabilities.length) {
      console.log(
        `Missing escrow capabilities: ${options.missingEscrowCapabilities.join(
          ', '
        )}.`
      )
    }
  } else {
    console.log(
      'Operational on-chain escrow is configured, so this exposure can remain active and be settled by the normal resolution flow.'
    )
    console.log('Pass --strict to fail on any exposure inventory.')
  }
  console.log('')

  for (const exposure of exposures) {
    console.log(`${exposure.contractId} ${exposure.slug}`)
    console.log(exposure.question)
    console.log(
      `  filled=${exposure.audit.filledBetCount} stake=${exposure.audit.filledStake} MEX openRefunds=${exposure.audit.openReservationRefund} MEX treasuryOpenRefunds=${exposure.audit.escrowedOpenReservationRefund} MEX walletOpenRefunds=${exposure.audit.walletOpenReservationRefund} MEX totalCredits(YES=${exposure.audit.yesCredit}, NO=${exposure.audit.noCredit}, CANCEL=${exposure.audit.cancelCredit}) MEX`
    )
    if (!exposure.bets.length) {
      console.log(
        '  no filled bets; exposure is an open order refund held by treasury escrow.'
      )
    }
    for (const bet of exposure.bets) {
      console.log(
        `  bet=${bet.betId} user=${bet.userId} outcome=${bet.outcome ?? 'n/a'} amount=${bet.amount} shares=${bet.shares} openRefund=${bet.openReservationRefund} payouts(YES=${bet.yesPayout}, NO=${bet.noPayout}, CANCEL=${bet.cancelPayout}) cancelCredit=${bet.cancelCredit}`
      )
    }
    console.log('')
  }

  if (blocked) {
    console.log('Remediation options:')
    console.log('  1. Implement on-chain escrow and keep these positions active.')
    console.log(
      '  2. Resolve only after treasury/escrow can cover the maximum payout exposure.'
    )
    console.log(
      '  3. For test-only markets, run again with --print-test-unwind-sql, review the rollback-protected SQL, then manually decide whether to commit.'
    )
    console.log(
      '     That SQL only unwinds filled test positions; open treasury-escrowed orders should be cancelled or released through the order flow.'
    )
  } else {
    console.log('Operational notes:')
    console.log(
      '  1. Keep treasury MEX and ETH backing monitored with check:mexas-launch.'
    )
    console.log(
      '  2. Use --strict only when preparing manual remediation or test-market cleanup.'
    )
  }
  console.log('')
  console.log('Commands:')
  console.log(
    '  COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts audit:mexas-settlement'
  )
  console.log(
    '  COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts audit:mexas-settlement -- --operational-escrow'
  )
  console.log(
    '  COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts audit:mexas-settlement -- --strict'
  )
  console.log(
    '  COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts print:mexas-test-unwind-sql > /tmp/mexas-test-unwind.sql'
  )
  console.log(
    '  Review /tmp/mexas-test-unwind.sql. It ends with rollback; change that to commit only after manual review.'
  )
}

async function main() {
  loadEnvFiles()

  const json = process.argv.includes('--json')
  const printUnwindSql = process.argv.includes('--print-test-unwind-sql')
  const operationalEscrowOverride = process.argv.includes(
    '--operational-escrow'
  )
  const strict = process.argv.includes('--strict')
  const supabaseUrlOrInstanceId = getSupabaseUrlOrInstanceId()
  const supabaseAdminKey = getSupabaseAdminKey()

  if (!supabaseUrlOrInstanceId || !supabaseAdminKey) {
    throw new Error('Missing Supabase URL/instance id or admin/service key.')
  }

  const db = createClient(supabaseUrlOrInstanceId, supabaseAdminKey)
  const exposures = await loadSettlementExposure(db)
  const missingEscrowCapabilities = getMissingMexasEscrowCapabilities()
  const reportOptions: SettlementExposureReportOptions = {
    hasOperationalEscrow:
      operationalEscrowOverride ||
      hasOperationalMexasEscrow(getMexasSettlementSettings()),
    missingEscrowCapabilities: operationalEscrowOverride
      ? []
      : missingEscrowCapabilities,
    strict,
  }

  if (printUnwindSql) {
    printTestUnwindSql(exposures)
    return
  } else if (json) {
    console.log(JSON.stringify({ exposures, ...reportOptions }, null, 2))
  } else {
    printTextReport(exposures, reportOptions)
  }

  if (exposures.length && (strict || !reportOptions.hasOperationalEscrow)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
