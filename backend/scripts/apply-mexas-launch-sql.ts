import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const { Client } = require('pg')

const MIGRATION_FILES = [
  'backend/supabase/migrations/2026060201_allow_mex_contract_token.sql',
  'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql',
  'backend/supabase/migrations/2026060203_add_mexas_matching_health.sql',
  'backend/supabase/migrations/20260602153551_add_mexas_orderbook_indexes.sql',
]

const REQUIRED_CONTRACT_IDS = ['mexwcwin26a', 'ukrwarend26a']

function parseEnvLine(line: string) {
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

  if (!process.env[key]) process.env[key] = value
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

function getProjectRef() {
  const refOrUrl =
    process.env.SUPABASE_INSTANCE_ID ||
    process.env.NEXT_PUBLIC_SUPABASE_INSTANCE_ID ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL

  if (!refOrUrl) return undefined
  if (!refOrUrl.startsWith('http')) return refOrUrl
  return new URL(refOrUrl).hostname.split('.')[0]
}

function getConnectionString() {
  const explicit =
    process.env.MEXAS_SUPABASE_DB_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL
  if (explicit) return explicit

  const password =
    process.env.MEXAS_SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD
  const projectRef = getProjectRef()
  if (!password || !projectRef) return undefined

  return `postgresql://postgres:${encodeURIComponent(
    password
  )}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`
}

function readSql() {
  const root = resolve(__dirname, '../..')
  const migrationSql = MIGRATION_FILES.map((path) => {
    const fullPath = resolve(root, path)
    return `-- ${path}\n${readFileSync(fullPath, 'utf8')}`
  }).join('\n\n')

  const contractIds = REQUIRED_CONTRACT_IDS.map((id) => `'${id}'`).join(', ')
  const verificationSql = `
do $$
declare
  v_failures text[] := array[]::text[];
  v_row record;
begin
  for v_row in
    select id, token, data ->> 'token' as data_token
    from public.contracts
    where id in (${contractIds})
  loop
    if v_row.id is null then
      v_failures := array_append(v_failures, 'contract row with null id');
    elsif v_row.token is distinct from 'MEX' or v_row.data_token is distinct from 'MEX' then
      v_failures := array_append(
        v_failures,
        v_row.id || ' token=' || coalesce(v_row.token, 'null') || ' dataToken=' || coalesce(v_row.data_token, 'null')
      );
    end if;
  end loop;

  if (
    select count(*)
    from public.contracts
    where id in (${contractIds})
  ) <> ${REQUIRED_CONTRACT_IDS.length} then
    v_failures := array_append(v_failures, 'required MEXAS contract row missing');
  end if;

  if to_regprocedure('public.mexas_match_orderbook_limit_order(text,bigint,integer)') is null then
    v_failures := array_append(v_failures, 'matching RPC missing');
  end if;

  if to_regprocedure('public.mexas_orderbook_matching_engine_ready()') is null then
    v_failures := array_append(v_failures, 'matching health RPC missing');
  elsif public.mexas_orderbook_matching_engine_ready() is distinct from true then
    v_failures := array_append(v_failures, 'matching health RPC returned false');
  end if;

  if to_regclass('public.contract_bets_mexas_orderbook_no_asks_idx') is null then
    v_failures := array_append(v_failures, 'NO ask orderbook index missing');
  end if;

  if to_regclass('public.contract_bets_mexas_orderbook_yes_bids_idx') is null then
    v_failures := array_append(v_failures, 'YES bid orderbook index missing');
  end if;

  if not has_function_privilege(
    'service_role',
    'public.mexas_match_orderbook_limit_order(text,bigint,integer)',
    'execute'
  ) then
    v_failures := array_append(v_failures, 'service_role cannot execute matching RPC');
  end if;

  if not has_function_privilege(
    'service_role',
    'public.mexas_orderbook_matching_engine_ready()',
    'execute'
  ) then
    v_failures := array_append(v_failures, 'service_role cannot execute matching health RPC');
  end if;

  if has_function_privilege(
    'anon',
    'public.mexas_match_orderbook_limit_order(text,bigint,integer)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.mexas_match_orderbook_limit_order(text,bigint,integer)',
    'execute'
  ) then
    v_failures := array_append(v_failures, 'public clients can execute matching RPC');
  end if;

  if has_function_privilege(
    'anon',
    'public.mexas_orderbook_matching_engine_ready()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.mexas_orderbook_matching_engine_ready()',
    'execute'
  ) then
    v_failures := array_append(v_failures, 'public clients can execute matching health RPC');
  end if;

  if array_length(v_failures, 1) is not null then
    raise exception 'MEXAS launch SQL verification failed: %', array_to_string(v_failures, '; ');
  end if;

  raise notice 'PASS MEXAS launch SQL applied and verified.';
end
$$;
`

  return `${migrationSql}

-- Existing seed markets were created before the SQL token constraint allowed
-- MEX. Keep the data token and normalized SQL column aligned.
update public.contracts
set token = 'MEX'
where id in (${contractIds})
  and data ->> 'token' = 'MEX'
  and token <> 'MEX';

-- Make the new RPCs visible to Supabase/PostgREST as soon as the transaction
-- commits.
notify pgrst, 'reload schema';

-- Verification block for manual Supabase SQL Editor runs. This raises if the
-- migration, market token normalization, schema reload target, or RPC grants are
-- incomplete.
${verificationSql}
`
}

function wrapSqlForManualRun(sql: string) {
  return `-- MEXAS launch SQL for Supabase SQL Editor.
-- The script is transaction-wrapped so verification errors roll back all DDL
-- and DML from this launch SQL.
begin;

${sql}
commit;
`
}

async function verify(client: any) {
  const contractRows = await client.query(
    `
      select id, token, data ->> 'token' as data_token
      from public.contracts
      where id = any($1::text[])
      order by id
    `,
    [REQUIRED_CONTRACT_IDS]
  )
  const health = await client.query(
    `select public.mexas_orderbook_matching_engine_ready() as ready`
  )

  const failures: string[] = []
  for (const id of REQUIRED_CONTRACT_IDS) {
    const row = contractRows.rows.find((candidate: any) => candidate.id === id)
    if (!row) {
      failures.push(`${id} missing`)
    } else if (row.token !== 'MEX' || row.data_token !== 'MEX') {
      failures.push(
        `${id} token=${row.token ?? 'null'} dataToken=${
          row.data_token ?? 'null'
        }`
      )
    }
  }
  if (health.rows[0]?.ready !== true) {
    failures.push('matching health RPC returned false')
  }

  if (failures.length) {
    throw new Error(`Verification failed: ${failures.join('; ')}`)
  }

  console.log('PASS MEXAS launch SQL applied and verified.')
}

async function main() {
  loadEnvFiles()

  const sql = readSql()
  if (process.argv.includes('--print-sql')) {
    console.log(wrapSqlForManualRun(sql))
    return
  }

  const connectionString = getConnectionString()
  if (!connectionString) {
    console.error(
      [
        'Missing Postgres connection string.',
        'Set MEXAS_SUPABASE_DB_URL, SUPABASE_DB_URL, DATABASE_URL, MEXAS_SUPABASE_DB_PASSWORD, or SUPABASE_DB_PASSWORD.',
        'You can also run with --print-sql and paste the SQL into Supabase SQL Editor.',
      ].join('\n')
    )
    process.exitCode = 1
    return
  }

  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query('begin')
    await client.query(sql)
    await verify(client)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
