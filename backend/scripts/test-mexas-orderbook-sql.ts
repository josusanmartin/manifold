import { createHash, randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const { Client } = require('pg')

const MIGRATION_FILES = [
  'backend/supabase/migrations/2026060201_allow_mex_contract_token.sql',
  'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql',
  'backend/supabase/migrations/2026060203_add_mexas_matching_health.sql',
  'backend/supabase/migrations/20260602153551_add_mexas_orderbook_indexes.sql',
  'backend/supabase/migrations/2026060301_add_mexas_treasury_settlement_ledger.sql',
  'backend/supabase/migrations/2026060302_add_mexas_escrow_capture_guard.sql',
  'backend/supabase/migrations/2026060303_add_mexas_treasury_processing_status.sql',
  'backend/supabase/migrations/2026060401_harden_mexas_treasury_ledger.sql',
  'backend/supabase/migrations/2026060402_lock_down_legacy_supabase_surface.sql',
]

const ROOT = resolve(__dirname, '../..')
const POSTGRES_IMAGE = process.env.MEXAS_SQL_TEST_POSTGRES_IMAGE ?? 'postgres'
const POSTGRES_PASSWORD = 'postgres'
const MATCH_TIMESTAMP_MS = 1780492800000

type PgClient = InstanceType<typeof Client>
type MatchPayload = {
  matches: {
    makerBetId: string
    makerAmount: number
    makerUserId: string
    price: number
    shares: number
    takerAmount: number
  }[]
  taker: Record<string, unknown>
}

function runDocker(args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim()
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
  }
}

let savepointCounter = 0

function getEscrowTxHash(seed: string) {
  return `0x${createHash('sha256').update(seed).digest('hex')}`
}

async function expectAsyncError(
  client: PgClient,
  callback: () => Promise<void>,
  pattern: RegExp,
  message: string
) {
  const savepoint = `expect_async_error_${++savepointCounter}`
  await client.query(`savepoint ${savepoint}`)

  try {
    await callback()
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await client.query(`rollback to savepoint ${savepoint}`)
    await client.query(`release savepoint ${savepoint}`)
    assert(
      pattern.test(errorMessage),
      `${message}: unexpected error ${errorMessage}`
    )
    return
  }

  await client.query(`rollback to savepoint ${savepoint}`)
  await client.query(`release savepoint ${savepoint}`)
  throw new Error(`${message}: expected query to fail.`)
}

async function expectSqlError(
  client: PgClient,
  sql: string,
  params: unknown[],
  pattern: RegExp,
  message: string
) {
  const savepoint = `expect_sql_error_${++savepointCounter}`
  await client.query(`savepoint ${savepoint}`)

  try {
    await client.query(sql, params)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await client.query(`rollback to savepoint ${savepoint}`)
    await client.query(`release savepoint ${savepoint}`)
    assert(
      pattern.test(errorMessage),
      `${message}: unexpected error ${errorMessage}`
    )
    return
  }

  await client.query(`rollback to savepoint ${savepoint}`)
  await client.query(`release savepoint ${savepoint}`)
  throw new Error(`${message}: expected query to fail.`)
}

function readLaunchMigrationSql() {
  return MIGRATION_FILES.map((path) =>
    readFileSync(resolve(ROOT, path), 'utf8')
  ).join('\n\n')
}

function getMappedPostgresPort(containerId: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const output = runDocker(['port', containerId, '5432/tcp'])
    const firstLine = output.split(/\r?\n/).find(Boolean)
    const match = firstLine?.match(/:(\d+)$/)
    if (match) return Number(match[1])
  }
  throw new Error('Docker did not expose a Postgres port.')
}

async function waitForPostgres(connectionString: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 60; attempt++) {
    const client = new Client({ connectionString })
    try {
      await client.connect()
      await client.query('select 1')
      await client.end()
      return
    } catch (error) {
      lastError = error
      await client.end().catch(() => undefined)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Postgres did not become ready.')
}

async function startPostgres() {
  const name = `mexas-orderbook-sql-${randomUUID()}`
  const containerId = runDocker([
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-e',
    `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
    '-e',
    'POSTGRES_DB=postgres',
    '-p',
    '127.0.0.1::5432',
    POSTGRES_IMAGE,
  ])

  const stop = () => {
    try {
      runDocker(['stop', containerId])
    } catch {
      // The container may already be gone if Docker failed during startup.
    }
  }

  try {
    const port = getMappedPostgresPort(containerId)
    const connectionString = `postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${port}/postgres`
    await waitForPostgres(connectionString)
    return { connectionString, stop }
  } catch (error) {
    stop()
    throw error
  }
}

async function connect(connectionString: string) {
  const client = new Client({ connectionString })
  await client.connect()
  return client
}

async function withServiceRole<T>(
  client: PgClient,
  callback: () => Promise<T>
) {
  await client.query('begin')
  try {
    await client.query('set local role service_role')
    const result = await callback()
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}

async function createMinimalSchema(client: PgClient) {
  await client.query(`
    drop schema public cascade;
    create schema public;

    do $$
    begin
      create role anon;
    exception when duplicate_object then null;
    end
    $$;

    do $$
    begin
      create role authenticated;
    exception when duplicate_object then null;
    end
    $$;

    do $$
    begin
      create role service_role;
    exception when duplicate_object then null;
    end
    $$;

    alter role service_role bypassrls;

    grant usage on schema public to anon, authenticated, service_role;

    create table public.users (
      id text primary key,
      balance numeric(38, 8) not null default 0,
      data jsonb not null default '{}'::jsonb
    );

    create table public.contracts (
      id text primary key,
      token text not null default 'MANA',
      close_time timestamptz null,
      resolution text null,
      resolution_time timestamptz null,
      resolution_probability numeric null,
      last_bet_time timestamptz null,
      last_updated_time timestamptz null,
      data jsonb not null default '{}'::jsonb
    );

    create table public.contract_bets (
      bet_id text primary key,
      contract_id text not null references public.contracts (id),
      user_id text not null references public.users (id),
      created_time timestamptz not null default now(),
      updated_time timestamptz not null default now(),
      expires_at timestamptz null,
      amount numeric(38, 8) not null default 0,
      shares numeric(38, 8) not null default 0,
      data jsonb not null default '{}'::jsonb,
      is_cancelled boolean not null default false,
      is_filled boolean not null default false,
      is_redemption boolean not null default false,
      outcome text null,
      answer_id text null,
      is_api boolean not null default false,
      loan_amount numeric(38, 8) not null default 0,
      prob_after numeric null,
      prob_before numeric null
    );

    grant select, insert, update, delete on table
      public.users,
      public.contracts,
      public.contract_bets
    to service_role;
  `)
}

async function applyMexasLaunchSql(client: PgClient) {
  await client.query(readLaunchMigrationSql())
  await client.query(`
    grant select, insert, update, delete on all tables in schema public to service_role;
  `)
}

function contractData() {
  return {
    token: 'MEX',
    mechanism: 'cpmm-1',
    outcomeType: 'BINARY',
    isResolved: false,
  }
}

async function seedUsers(client: PgClient, userIds: string[]) {
  for (const userId of userIds) {
    await client.query(
      `
        insert into public.users (id, balance, data)
        values ($1, 100, '{}'::jsonb)
        on conflict (id) do nothing
      `,
      [userId]
    )
  }
}

async function seedContract(
  client: PgClient,
  contractId: string,
  overrides: { closeTime?: Date; resolved?: boolean } = {}
) {
  await client.query(
    `
      insert into public.contracts (
        id,
        token,
        close_time,
        resolution_time,
        data
      )
      values ($1, 'MEX', $2, $3, $4::jsonb)
    `,
    [
      contractId,
      overrides.closeTime ?? null,
      overrides.resolved ? new Date(MATCH_TIMESTAMP_MS - 60_000) : null,
      JSON.stringify({
        ...contractData(),
        isResolved: overrides.resolved === true,
      }),
    ]
  )
}

async function seedOrder(
  client: PgClient,
  params: {
    amount?: number
    contractId: string
    createdTime: Date
    escrowed?: boolean
    expiresAt?: Date
    fundsReleased?: boolean
    id: string
    dataIsCancelled?: boolean
    dataIsFilled?: boolean
    dataIsRedemption?: boolean
    escrowTxHash?: string
    isCancelled?: boolean
    isFilled?: boolean
    limitProb: number
    orderAmount: number
    outcome: 'YES' | 'NO'
    shares?: number
    userId: string
  }
) {
  const data = {
    id: params.id,
    userId: params.userId,
    contractId: params.contractId,
    createdTime: params.createdTime.getTime(),
    amount: params.amount ?? 0,
    shares: params.shares ?? 0,
    outcome: params.outcome,
    orderAmount: params.orderAmount,
    limitProb: params.limitProb,
    isFilled: params.dataIsFilled ?? params.isFilled ?? false,
    isCancelled: params.dataIsCancelled ?? params.isCancelled ?? false,
    isRedemption: params.dataIsRedemption ?? false,
    fills: [],
    mexasFundsReserved: true,
    mexasFundsReleased: params.fundsReleased ?? false,
    mexasReservedAmount: params.orderAmount,
    mexasStakeEscrowed: params.escrowed ? true : undefined,
    mexasEscrowTxHash: params.escrowed
      ? params.escrowTxHash ?? getEscrowTxHash(params.id)
      : undefined,
    mexasEscrowPayerAddress: params.escrowed
      ? '0x1111111111111111111111111111111111111111'
      : undefined,
    mexasEscrowTreasuryAddress: params.escrowed
      ? '0x2222222222222222222222222222222222222222'
      : undefined,
    expiresAt: params.expiresAt?.getTime(),
  }

  await client.query(
    `
      insert into public.contract_bets (
        bet_id,
        contract_id,
        user_id,
        created_time,
        expires_at,
        amount,
        shares,
        data,
        is_cancelled,
        is_filled,
        is_redemption,
        outcome
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, false, $11)
    `,
    [
      params.id,
      params.contractId,
      params.userId,
      params.createdTime,
      params.expiresAt ?? null,
      params.amount ?? 0,
      params.shares ?? 0,
      JSON.stringify(data),
      params.isCancelled ?? false,
      params.isFilled ?? false,
      params.outcome,
    ]
  )
}

async function matchOrder(client: PgClient, betId: string) {
  return await withServiceRole(client, async () => {
    const { rows } = await client.query(
      `
        select public.mexas_match_orderbook_limit_order($1, $2, 100) as result
      `,
      [betId, MATCH_TIMESTAMP_MS]
    )
    return rows[0].result as MatchPayload
  })
}

async function loadOrder(client: PgClient, betId: string) {
  const { rows } = await client.query(
    `
      select bet_id, amount, shares, is_filled, is_cancelled, data
      from public.contract_bets
      where bet_id = $1
    `,
    [betId]
  )
  assert(rows.length === 1, `Expected order ${betId} to exist.`)
  return rows[0] as {
    amount: string
    bet_id: string
    data: Record<string, unknown>
    is_cancelled: boolean
    is_filled: boolean
    shares: string
  }
}

async function testReadinessAndPermissions(client: PgClient) {
  const { rows } = await client.query(`
    select
      public.mexas_orderbook_matching_engine_ready() as matching_ready,
      public.mexas_treasury_settlement_ledger_ready() as ledger_ready,
      public.mexas_escrow_capture_ready() as capture_ready,
      public.mexas_legacy_surface_locked_down() as legacy_surface_ready,
      has_function_privilege(
        'service_role',
        'public.mexas_match_orderbook_limit_order(text,bigint,integer)',
        'execute'
      ) as service_can_match,
      has_function_privilege(
        'anon',
        'public.mexas_match_orderbook_limit_order(text,bigint,integer)',
        'execute'
      ) as anon_can_match,
      has_function_privilege(
        'authenticated',
        'public.mexas_match_orderbook_limit_order(text,bigint,integer)',
        'execute'
      ) as authenticated_can_match
  `)

  const row = rows[0]
  assertEqual(row.matching_ready, true, 'matching health RPC')
  assertEqual(row.ledger_ready, true, 'treasury ledger health RPC')
  assertEqual(row.capture_ready, true, 'escrow capture health RPC')
  assertEqual(row.legacy_surface_ready, true, 'legacy surface health RPC')
  assertEqual(row.service_can_match, true, 'service role matching grant')
  assertEqual(row.anon_can_match, false, 'anon matching grant')
  assertEqual(
    row.authenticated_can_match,
    false,
    'authenticated matching grant'
  )

  await client.query('begin')
  try {
    await client.query('set local role anon')
    await client.query(
      `select public.mexas_match_orderbook_limit_order('missing', $1, 100)`,
      [MATCH_TIMESTAMP_MS]
    )
    throw new Error('anon unexpectedly executed the matching RPC.')
  } catch (error) {
    assert(
      error instanceof Error &&
        /permission denied|does not exist/i.test(error.message),
      `unexpected anon execution error: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  } finally {
    await client.query('rollback').catch(() => undefined)
  }
}

async function insertTreasuryTransfer(
  client: PgClient,
  params: {
    error?: string
    id: string
    idempotencyKey: string
    status: string
    txHash?: string
  }
) {
  await client.query(
    `
      insert into public.mexas_treasury_transfers (
        id,
        idempotency_key,
        transfer_type,
        status,
        user_id,
        amount,
        token_address,
        chain_id,
        treasury_address,
        recipient_address,
        tx_hash,
        error,
        metadata,
        updated_time,
        submitted_time,
        confirmed_time
      )
      values (
        $1,
        $2,
        'order-release',
        $3,
        'treasury-user',
        1,
        '0xc4c2ede4f6fd623acc86c492bdf099b3ba2b8303',
        42161,
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
        $4,
        $5,
        '{}'::jsonb,
        now(),
        case when $3 in ('submitted', 'confirmed') then now() else null end,
        case when $3 = 'confirmed' then now() else null end
      )
    `,
    [
      params.id,
      params.idempotencyKey,
      params.status,
      params.txHash ?? null,
      params.error ?? null,
    ]
  )
}

async function testTreasuryLedgerIdempotencyAndRls(client: PgClient) {
  await seedUsers(client, ['treasury-user'])

  await withServiceRole(client, async () => {
    await insertTreasuryTransfer(client, {
      id: 'treasury-processing',
      idempotencyKey: 'treasury-key-1',
      status: 'processing',
    })

    const { rows } = await client.query(
      `
        select status
        from public.mexas_treasury_transfers
        where idempotency_key = 'treasury-key-1'
      `
    )
    assertEqual(
      rows[0]?.status,
      'processing',
      'treasury processing status is accepted'
    )

    const { rows: hardeningRows } = await client.query(
      `
        select
          to_regclass('public.mexas_treasury_transfers_bet_id_idx') is not null as has_bet_id_idx,
          exists (
            select 1
            from pg_policy p
            join pg_class c on c.oid = p.polrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname = 'mexas_treasury_transfers'
              and p.polname = 'mexas_treasury_transfers_service_role_only'
          ) as has_service_role_policy,
          public.mexas_treasury_settlement_ledger_ready() as ledger_ready
      `
    )
    assertEqual(
      hardeningRows[0]?.has_bet_id_idx,
      true,
      'treasury bet_id FK index exists'
    )
    assertEqual(
      hardeningRows[0]?.has_service_role_policy,
      true,
      'treasury service-role policy exists'
    )
    assertEqual(
      hardeningRows[0]?.ledger_ready,
      true,
      'treasury readiness includes advisor hardening'
    )

    await expectSqlError(
      client,
      `
        insert into public.mexas_treasury_transfers (
          id,
          idempotency_key,
          transfer_type,
          status,
          user_id,
          amount,
          token_address,
          chain_id,
          treasury_address,
          recipient_address,
          metadata,
          updated_time
        )
        values (
          'treasury-duplicate-key',
          'treasury-key-1',
          'order-release',
          'processing',
          'treasury-user',
          1,
          '0xc4c2ede4f6fd623acc86c492bdf099b3ba2b8303',
          42161,
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
          '{}'::jsonb,
          now()
        )
      `,
      [],
      /duplicate key|unique/i,
      'duplicate treasury idempotency key'
    )

    await insertTreasuryTransfer(client, {
      id: 'treasury-submitted',
      idempotencyKey: 'treasury-key-2',
      status: 'submitted',
      txHash: `0x${'a'.repeat(64)}`,
    })
    await expectSqlError(
      client,
      `
        insert into public.mexas_treasury_transfers (
          id,
          idempotency_key,
          transfer_type,
          status,
          user_id,
          amount,
          token_address,
          chain_id,
          treasury_address,
          recipient_address,
          tx_hash,
          metadata,
          updated_time,
          submitted_time
        )
        values (
          'treasury-duplicate-tx',
          'treasury-key-3',
          'order-release',
          'submitted',
          'treasury-user',
          1,
          '0xc4c2ede4f6fd623acc86c492bdf099b3ba2b8303',
          42161,
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
          $1,
          '{}'::jsonb,
          now(),
          now()
        )
      `,
      [`0x${'a'.repeat(64)}`],
      /duplicate key|unique/i,
      'duplicate treasury tx hash'
    )

    await expectSqlError(
      client,
      `
        insert into public.mexas_treasury_transfers (
          id,
          idempotency_key,
          transfer_type,
          status,
          user_id,
          amount,
          token_address,
          chain_id,
          treasury_address,
          recipient_address,
          metadata,
          updated_time
        )
        values (
          'treasury-failed-without-error',
          'treasury-key-4',
          'order-release',
          'failed',
          'treasury-user',
          1,
          '0xc4c2ede4f6fd623acc86c492bdf099b3ba2b8303',
          42161,
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
          '{}'::jsonb,
          now()
        )
      `,
      [],
      /check constraint/i,
      'failed treasury transfer requires an error'
    )
  })

  await client.query('begin')
  try {
    await client.query('set local role anon')
    await expectSqlError(
      client,
      'select * from public.mexas_treasury_transfers',
      [],
      /permission denied/i,
      'anonymous treasury ledger read'
    )
    await expectSqlError(
      client,
      `
        insert into public.mexas_treasury_transfers (
          id,
          idempotency_key,
          transfer_type,
          status,
          user_id,
          amount,
          token_address,
          chain_id,
          treasury_address,
          recipient_address,
          metadata,
          updated_time
        )
        values (
          'anon-treasury-transfer',
          'anon-key',
          'order-release',
          'pending',
          'treasury-user',
          1,
          '0xc4c2ede4f6fd623acc86c492bdf099b3ba2b8303',
          42161,
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
          '{}'::jsonb,
          now()
        )
      `,
      [],
      /permission denied/i,
      'anonymous treasury ledger insert'
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}

async function testPriceTimePriority(client: PgClient) {
  const contractId = 'price-time'
  await seedUsers(client, [
    'same-user',
    'maker-cheap',
    'maker-cancelled',
    'maker-json-cancelled',
    'maker-json-filled',
    'maker-json-redemption',
    'maker-old',
    'maker-new',
    'maker-expired',
    'maker-filled',
    'maker-released',
    'taker',
  ])
  await seedContract(client, contractId)
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:01Z'),
    id: 'same-user-better-ask',
    limitProb: 0.55,
    orderAmount: 4.5,
    outcome: 'NO',
    userId: 'taker',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:02Z'),
    id: 'expired-best-ask',
    limitProb: 0.5,
    orderAmount: 5,
    outcome: 'NO',
    userId: 'maker-expired',
    expiresAt: new Date(MATCH_TIMESTAMP_MS - 60_000),
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:02.100Z'),
    id: 'cancelled-best-ask',
    isCancelled: true,
    limitProb: 0.52,
    orderAmount: 5,
    outcome: 'NO',
    userId: 'maker-cancelled',
  })
  await seedOrder(client, {
    amount: 2,
    contractId,
    createdTime: new Date('2026-06-03T00:00:02.200Z'),
    id: 'filled-best-ask',
    isFilled: true,
    limitProb: 0.53,
    orderAmount: 5,
    outcome: 'NO',
    shares: 4,
    userId: 'maker-filled',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:02.225Z'),
    dataIsCancelled: true,
    id: 'json-cancelled-best-ask',
    limitProb: 0.535,
    orderAmount: 5,
    outcome: 'NO',
    userId: 'maker-json-cancelled',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:02.250Z'),
    dataIsFilled: true,
    id: 'json-filled-best-ask',
    limitProb: 0.537,
    orderAmount: 5,
    outcome: 'NO',
    userId: 'maker-json-filled',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:02.275Z'),
    dataIsRedemption: true,
    id: 'json-redemption-best-ask',
    limitProb: 0.539,
    orderAmount: 5,
    outcome: 'NO',
    userId: 'maker-json-redemption',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:02.300Z'),
    fundsReleased: true,
    id: 'released-best-ask',
    limitProb: 0.54,
    orderAmount: 5,
    outcome: 'NO',
    userId: 'maker-released',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:03Z'),
    id: 'cheap-ask',
    limitProb: 0.6,
    orderAmount: 4,
    outcome: 'NO',
    userId: 'maker-cheap',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:04Z'),
    id: 'old-ask',
    limitProb: 0.7,
    orderAmount: 3,
    outcome: 'NO',
    userId: 'maker-old',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:05Z'),
    id: 'new-ask',
    limitProb: 0.7,
    orderAmount: 3,
    outcome: 'NO',
    userId: 'maker-new',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:06Z'),
    id: 'taker-price-time',
    limitProb: 0.8,
    orderAmount: 20,
    outcome: 'YES',
    userId: 'taker',
  })

  const result = await matchOrder(client, 'taker-price-time')

  assertDeepEqual(
    result.matches.map((match) => match.makerBetId),
    ['cheap-ask', 'old-ask', 'new-ask'],
    'price-time maker order'
  )
  assertDeepEqual(
    result.matches.map((match) => match.takerAmount),
    [6, 7, 7],
    'price-time taker fill amounts'
  )

  const taker = await loadOrder(client, 'taker-price-time')
  assertEqual(Number(taker.amount), 20, 'filled taker amount')
  assertEqual(Number(taker.shares), 30, 'filled taker shares')
  assertEqual(taker.is_filled, true, 'taker filled flag')

  const sameUserAsk = await loadOrder(client, 'same-user-better-ask')
  assertEqual(Number(sameUserAsk.amount), 0, 'same-user ask stays untouched')
  const expiredAsk = await loadOrder(client, 'expired-best-ask')
  assertEqual(Number(expiredAsk.amount), 0, 'expired ask stays untouched')
  const cancelledAsk = await loadOrder(client, 'cancelled-best-ask')
  assertEqual(Number(cancelledAsk.amount), 0, 'cancelled ask stays untouched')
  const filledAsk = await loadOrder(client, 'filled-best-ask')
  assertEqual(Number(filledAsk.amount), 2, 'filled ask stays untouched')
  const jsonCancelledAsk = await loadOrder(client, 'json-cancelled-best-ask')
  assertEqual(
    Number(jsonCancelledAsk.amount),
    0,
    'json-cancelled ask stays untouched'
  )
  const jsonFilledAsk = await loadOrder(client, 'json-filled-best-ask')
  assertEqual(
    Number(jsonFilledAsk.amount),
    0,
    'json-filled ask stays untouched'
  )
  const jsonRedemptionAsk = await loadOrder(client, 'json-redemption-best-ask')
  assertEqual(
    Number(jsonRedemptionAsk.amount),
    0,
    'json-redemption ask stays untouched'
  )
  const releasedAsk = await loadOrder(client, 'released-best-ask')
  assertEqual(Number(releasedAsk.amount), 0, 'released ask stays untouched')
}

async function testEscrowedNoSidePriceTimePriority(client: PgClient) {
  const contractId = 'no-side-price-time'
  await seedUsers(client, [
    'no-maker-below',
    'no-maker-high',
    'no-maker-new',
    'no-maker-old',
    'no-taker',
  ])
  await seedContract(client, contractId)
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:00Z'),
    escrowed: true,
    id: 'no-side-same-user-bid',
    limitProb: 0.9,
    orderAmount: 9,
    outcome: 'YES',
    userId: 'no-taker',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:01Z'),
    escrowed: true,
    id: 'no-side-below-cross-bid',
    limitProb: 0.45,
    orderAmount: 4.5,
    outcome: 'YES',
    userId: 'no-maker-below',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:02Z'),
    escrowed: true,
    id: 'no-side-high-bid',
    limitProb: 0.8,
    orderAmount: 4,
    outcome: 'YES',
    userId: 'no-maker-high',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:03Z'),
    escrowed: true,
    id: 'no-side-old-bid',
    limitProb: 0.6,
    orderAmount: 6,
    outcome: 'YES',
    userId: 'no-maker-old',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:04Z'),
    escrowed: true,
    id: 'no-side-new-bid',
    limitProb: 0.6,
    orderAmount: 6,
    outcome: 'YES',
    userId: 'no-maker-new',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:00:05Z'),
    escrowed: true,
    id: 'no-side-taker',
    limitProb: 0.5,
    orderAmount: 9,
    outcome: 'NO',
    userId: 'no-taker',
  })

  const result = await matchOrder(client, 'no-side-taker')

  assertDeepEqual(
    result.matches.map((match) => match.makerBetId),
    ['no-side-high-bid', 'no-side-old-bid', 'no-side-new-bid'],
    'NO-side price-time maker order'
  )
  assertDeepEqual(
    result.matches.map((match) => match.takerAmount),
    [1, 4, 4],
    'NO-side taker fill amounts'
  )
  assertDeepEqual(
    result.matches.map((match) => match.price),
    [0.8, 0.6, 0.6],
    'NO-side maker prices'
  )

  const taker = await loadOrder(client, 'no-side-taker')
  assertEqual(Number(taker.amount), 9, 'NO-side taker filled amount')
  assertEqual(Number(taker.shares), 25, 'NO-side taker shares')
  assertEqual(taker.is_filled, true, 'NO-side taker filled flag')

  const sameUserBid = await loadOrder(client, 'no-side-same-user-bid')
  assertEqual(Number(sameUserBid.amount), 0, 'NO-side same-user bid untouched')
  const belowCrossBid = await loadOrder(client, 'no-side-below-cross-bid')
  assertEqual(
    Number(belowCrossBid.amount),
    0,
    'NO-side non-crossing bid untouched'
  )
}

async function testConcurrentTakers(
  client: PgClient,
  connectionString: string
) {
  const contractId = 'concurrent-takers'
  await seedUsers(client, ['maker-race', 'taker-a', 'taker-b'])
  await seedContract(client, contractId)
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:01:00Z'),
    id: 'race-maker',
    limitProb: 0.7,
    orderAmount: 3,
    outcome: 'NO',
    userId: 'maker-race',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:01:01Z'),
    id: 'race-taker-a',
    limitProb: 0.8,
    orderAmount: 7,
    outcome: 'YES',
    userId: 'taker-a',
  })
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:01:02Z'),
    id: 'race-taker-b',
    limitProb: 0.8,
    orderAmount: 7,
    outcome: 'YES',
    userId: 'taker-b',
  })

  const firstClient = await connect(connectionString)
  const secondClient = await connect(connectionString)
  try {
    const [first, second] = await Promise.all([
      matchOrder(firstClient, 'race-taker-a'),
      matchOrder(secondClient, 'race-taker-b'),
    ])
    const totalMatches = first.matches.length + second.matches.length
    assertEqual(totalMatches, 1, 'only one concurrent taker fills the maker')

    const maker = await loadOrder(client, 'race-maker')
    assertEqual(Number(maker.amount), 3, 'race maker filled once')
    assertEqual(Number(maker.shares), 10, 'race maker shares filled once')
    assertEqual(maker.is_filled, true, 'race maker filled flag')

    const takerA = await loadOrder(client, 'race-taker-a')
    const takerB = await loadOrder(client, 'race-taker-b')
    assertEqual(
      Number(takerA.amount) + Number(takerB.amount),
      7,
      'only one taker spends stake'
    )
    assertEqual(
      Number(takerA.shares) + Number(takerB.shares),
      10,
      'only one taker receives shares'
    )
  } finally {
    await firstClient.end()
    await secondClient.end()
  }
}

async function testEscrowAndMarketGuards(client: PgClient) {
  await seedUsers(client, [
    'wallet-maker',
    'escrow-maker',
    'bad-escrow-maker',
    'bad-escrow-taker',
    'guard-taker',
  ])

  await seedContract(client, 'wallet-vs-escrow')
  await seedOrder(client, {
    contractId: 'wallet-vs-escrow',
    createdTime: new Date('2026-06-03T00:02:00Z'),
    escrowed: true,
    id: 'escrow-ask',
    limitProb: 0.6,
    orderAmount: 4,
    outcome: 'NO',
    userId: 'escrow-maker',
  })
  await seedOrder(client, {
    contractId: 'wallet-vs-escrow',
    createdTime: new Date('2026-06-03T00:02:01Z'),
    id: 'wallet-ask',
    limitProb: 0.7,
    orderAmount: 3,
    outcome: 'NO',
    userId: 'wallet-maker',
  })
  await seedOrder(client, {
    contractId: 'wallet-vs-escrow',
    createdTime: new Date('2026-06-03T00:02:02Z'),
    id: 'wallet-taker',
    limitProb: 0.8,
    orderAmount: 7,
    outcome: 'YES',
    userId: 'guard-taker',
  })

  const result = await matchOrder(client, 'wallet-taker')
  assertDeepEqual(
    result.matches.map((match) => match.makerBetId),
    ['wallet-ask'],
    'wallet taker only matches wallet-reserved asks'
  )

  await seedContract(client, 'bad-escrow-metadata')
  await seedOrder(client, {
    contractId: 'bad-escrow-metadata',
    createdTime: new Date('2026-06-03T00:02:10Z'),
    escrowed: true,
    id: 'bad-escrow-ask',
    limitProb: 0.7,
    orderAmount: 3,
    outcome: 'NO',
    userId: 'bad-escrow-maker',
  })
  await client.query(
    "update public.contract_bets set data = data - 'mexasEscrowTxHash' where bet_id = $1",
    ['bad-escrow-ask']
  )
  await seedOrder(client, {
    contractId: 'bad-escrow-metadata',
    createdTime: new Date('2026-06-03T00:02:11Z'),
    escrowed: true,
    id: 'bad-escrow-taker',
    limitProb: 0.8,
    orderAmount: 7,
    outcome: 'YES',
    userId: 'bad-escrow-taker',
  })
  await expectMatchError(
    client,
    'bad-escrow-taker',
    /Escrowed maker is missing capture metadata/
  )

  await seedContract(client, 'closed-market', {
    closeTime: new Date(MATCH_TIMESTAMP_MS - 60_000),
  })
  await seedOrder(client, {
    contractId: 'closed-market',
    createdTime: new Date('2026-06-03T00:03:00Z'),
    id: 'closed-taker',
    limitProb: 0.8,
    orderAmount: 7,
    outcome: 'YES',
    userId: 'guard-taker',
  })
  await expectMatchError(client, 'closed-taker', /Trading is closed/)

  await seedContract(client, 'resolved-market', { resolved: true })
  await seedOrder(client, {
    contractId: 'resolved-market',
    createdTime: new Date('2026-06-03T00:04:00Z'),
    id: 'resolved-taker',
    limitProb: 0.8,
    orderAmount: 7,
    outcome: 'YES',
    userId: 'guard-taker',
  })
  await expectMatchError(client, 'resolved-taker', /Market is resolved/)

  await seedContract(client, 'expired-taker-market')
  await seedOrder(client, {
    contractId: 'expired-taker-market',
    createdTime: new Date('2026-06-03T00:05:00Z'),
    expiresAt: new Date(MATCH_TIMESTAMP_MS - 60_000),
    id: 'expired-taker',
    limitProb: 0.8,
    orderAmount: 7,
    outcome: 'YES',
    userId: 'guard-taker',
  })
  await expectMatchError(client, 'expired-taker', /Taker order is expired/)
}

async function testEscrowCaptureHashUniqueness(client: PgClient) {
  const contractId = 'escrow-capture-unique'
  const duplicateHash = getEscrowTxHash('duplicate-capture')
  await seedUsers(client, ['capture-a', 'capture-b'])
  await seedContract(client, contractId)
  await seedOrder(client, {
    contractId,
    createdTime: new Date('2026-06-03T00:06:00Z'),
    escrowTxHash: duplicateHash,
    escrowed: true,
    id: 'capture-a-order',
    limitProb: 0.4,
    orderAmount: 1,
    outcome: 'YES',
    userId: 'capture-a',
  })

  await client.query('begin')
  try {
    await expectAsyncError(
      client,
      () =>
        seedOrder(client, {
          contractId,
          createdTime: new Date('2026-06-03T00:06:01Z'),
          escrowTxHash: duplicateHash,
          escrowed: true,
          id: 'capture-b-order',
          limitProb: 0.5,
          orderAmount: 1,
          outcome: 'NO',
          userId: 'capture-b',
        }),
      /duplicate key|unique/i,
      'duplicate escrow capture tx hash'
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}

async function expectMatchError(
  client: PgClient,
  betId: string,
  pattern: RegExp
) {
  try {
    await matchOrder(client, betId)
  } catch (error) {
    assert(
      error instanceof Error && pattern.test(error.message),
      `unexpected matcher error for ${betId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return
  }
  throw new Error(`Expected matcher to reject ${betId}.`)
}

async function runStep(name: string, step: () => Promise<void>) {
  process.stdout.write(`- ${name}... `)
  await step()
  process.stdout.write('ok\n')
}

async function main() {
  const postgres = await startPostgres()
  const client = await connect(postgres.connectionString)

  try {
    await runStep('create minimal Supabase schema', () =>
      createMinimalSchema(client)
    )
    await runStep('apply MEXAS launch SQL', () => applyMexasLaunchSql(client))
    await runStep('verify readiness RPCs and grants', () =>
      testReadinessAndPermissions(client)
    )
    await runStep('verify treasury ledger idempotency and RLS', () =>
      testTreasuryLedgerIdempotencyAndRls(client)
    )
    await runStep('verify SQL price-time priority', () =>
      testPriceTimePriority(client)
    )
    await runStep('verify escrowed NO-side SQL price-time priority', () =>
      testEscrowedNoSidePriceTimePriority(client)
    )
    await runStep('verify concurrent takers serialize on one maker', () =>
      testConcurrentTakers(client, postgres.connectionString)
    )
    await runStep('verify escrow capture tx hash uniqueness', () =>
      testEscrowCaptureHashUniqueness(client)
    )
    await runStep(
      'verify escrow separation, closed markets, resolved markets, and expired takers',
      () => testEscrowAndMarketGuards(client)
    )
    console.log('PASS MEXAS SQL orderbook integration audit.')
  } finally {
    await client.end().catch(() => undefined)
    postgres.stop()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
