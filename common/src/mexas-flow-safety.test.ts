import { readFileSync } from 'fs'
import { join } from 'path'

function readRepoFile(path: string) {
  return readFileSync(join(__dirname, '..', '..', path), 'utf8')
}

function countOccurrences(source: string, marker: string) {
  return source.split(marker).length - 1
}

function compactWhitespace(source: string) {
  return source.replace(/\s+/g, ' ').trim()
}

function expectMarkersInOrder(source: string, markers: string[]) {
  let previousIndex = -1

  for (const marker of markers) {
    const index = source.indexOf(marker, previousIndex + 1)
    expect(index).toBeGreaterThan(previousIndex)
    previousIndex = index
  }
}

describe('MEXAS flow safety guardrails', () => {
  test('places MEXAS orders under a user balance lock before the contract order lock', () => {
    const source = readRepoFile('web/pages/api/v0/bet.ts')

    expect(source).toContain('acquireMexasUserBalanceLock')
    expect(source).toContain('releaseMexasUserBalanceLock')
    expect(source).toContain('skipUserBalanceLock: true')
    expectMarkersInOrder(source, [
      'const balanceLockOwner = await acquireMexasUserBalanceLock(db, userId)',
      'const lock = await acquireMexasOrderLock(db, params.contractId)',
      'await updateUserBalanceCas(db, userId, -reservedAmount',
      ".from('contract_bets')",
      '.insert(betToRow(bet))',
    ])
  })

  test('does not recursively acquire user locks during already-locked cleanup', () => {
    const source = readRepoFile('web/pages/api/v0/bet.ts')

    expect(
      countOccurrences(source, 'skipUserBalanceLock: true')
    ).toBeGreaterThanOrEqual(6)
  })

  test('cancels MEXAS orders and refunds reserved funds under the user balance lock', () => {
    const source = readRepoFile('web/pages/api/v0/bet/cancel/[betId].ts')

    expectMarkersInOrder(source, [
      'const balanceLockOwner = await acquireMexasUserBalanceLock(db, userId)',
      'await releaseUnbackedMexasOrders(db',
      'const releasedBetRow = shouldReleaseMexasFunds',
      'await releaseMexasUserBalanceLock(db, userId, balanceLockOwner)',
    ])
    expect(source).toContain('skipUserBalanceLock: true')
  })

  test('releases expired and unbacked orders only when the order row has not changed', () => {
    const source = readRepoFile('web/lib/api/mexas-orders.ts')

    expectMarkersInOrder(source, [
      'const { data: updatedRow, error } = await db',
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
      'if (!updatedRow) return 0',
      'await updateMexasUserBalanceCas(db, bet.userId, refundAmount',
    ])
    expectMarkersInOrder(source, [
      'async function cancelUnbackedMexasOrder',
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
    ])
  })

  test('resolves markets by locking each participant while crediting and releasing orders', () => {
    const source = readRepoFile(
      'web/pages/api/v0/market/[contractId]/resolve.ts'
    )

    expect(source).toContain('applyMexasResolutionCreditsAndReleases')
    expectMarkersInOrder(source, [
      'const balanceLockOwner = await acquireMexasUserBalanceLock(db, eventUserId)',
      'await updateMexasUserBalanceCas(db, event.userId, event.amount',
      'await releaseOpenOrder(db, entry)',
      'await releaseMexasUserBalanceLock(db, eventUserId, balanceLockOwner)',
    ])
  })

  test('syncs Privy wallet balances under the user balance lock', () => {
    const source = readRepoFile('web/pages/api/privy-user.ts')

    expectMarkersInOrder(source, [
      'const balanceLockOwner = await acquireMexasUserBalanceLock(db, userRow.id)',
      'const walletSync = await getMexasWalletSync',
      ".eq('balance', latestUserRow.balance)",
      'await releaseMexasUserBalanceLock(db, userRow.id, balanceLockOwner)',
    ])
  })

  test('requires the RPC matching engine before live crossing matches can run', () => {
    const source = readRepoFile('common/src/mexas-settlement.ts')

    expectMarkersInOrder(source, [
      'export function hasTransactionalMexasMatchingEngine',
      "return settings.matchingEngineMode === 'rpc'",
      'export function canMexasMatchCrossingOrders',
      "settings.settlementMode === 'escrow'",
    ])
  })

  test('uses the Supabase RPC matcher instead of the in-process simulator on live orders', () => {
    const source = readRepoFile('web/pages/api/v0/bet.ts')

    expectMarkersInOrder(source, [
      'const hasCrossingOrders = crossingOrderRows.length > 0',
      'await assertMexasCanMatchCrossingOrders(db, hasCrossingOrders)',
      'reservedAmount = getMexasRemainingReservedAmount(bet)',
      'await updateUserBalanceCas(db, userId, -reservedAmount',
      '.insert(betToRow(bet))',
      'await matchMexasOrderbookLimitOrderRpc(db, bet.id)',
    ])
    expect(source).toContain('matchMexasOrderbookLimitOrderRpc')
    expect(source).not.toContain('async function matchMexasOrder(')
    expect(source).not.toContain('async function updateLimitBetCas(')
  })

  test('refunds the inserted MEXAS order when post-insert matching fails', () => {
    const source = readRepoFile('web/pages/api/v0/bet.ts')

    expectMarkersInOrder(source, [
      'async function cancelInsertedMexasOrderAndRefund',
      'const currentBet = convertBet(currentRow as Row',
      'const refundAmount = getMexasRemainingReservedAmount(currentBet)',
      ".eq('bet_id', bet.id)",
      ".eq('user_id', userId)",
      ".eq('is_cancelled', false)",
      ".eq('is_filled', false)",
      ".eq('updated_time', currentRow.updated_time)",
      'await refundMexasReservation(',
      'refundAmount',
    ])
    expectMarkersInOrder(source, [
      'const matchedBet = hasCrossingOrders',
      '? await matchMexasOrderbookLimitOrderRpc(db, bet.id)',
      '} catch (error) {',
      'if (debited && !inserted && bet)',
      'if (debited && inserted && bet)',
      'await cancelInsertedMexasOrderAndRefund(',
    ])
  })

  test('locks down the MEXAS matching RPC to the backend service role', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )
    const sql = compactWhitespace(source)

    expect(sql).toMatch(
      /create or replace function public\.mexas_match_orderbook_limit_order ?\(/
    )
    expect(sql).toContain('returns jsonb language plpgsql security invoker')
    expect(source).toContain('for update')
    expect(sql).toMatch(
      /revoke execute on function public\.mexas_match_orderbook_limit_order ?\(text, bigint, integer\) from public, anon, authenticated/
    )
    expect(sql).toMatch(
      /grant execute on function public\.mexas_match_orderbook_limit_order ?\(text, bigint, integer\) to service_role/
    )
    expect(source).not.toContain('skip locked')
  })

  test('keeps the SQL matcher atomic and deterministic under concurrent takers', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )

    expectMarkersInOrder(source, [
      'from public.contract_bets',
      'where bet_id = p_taker_bet_id',
      'for update;',
      'from public.contracts',
      'where id = v_taker.contract_id',
      'for update;',
      'while v_remaining_amount > v_epsilon',
      'select *',
      'into v_maker',
      'order by',
      "case when v_taker_outcome = 'YES' then (b.data ->> 'limitProb')::numeric end asc",
      "case when v_taker_outcome = 'NO' then (b.data ->> 'limitProb')::numeric end desc",
      'b.created_time asc',
      'b.bet_id asc',
      'limit 1',
      'for update;',
      'update public.contract_bets',
      'where bet_id = v_maker.bet_id',
      'update public.contract_bets',
      'where bet_id = v_taker.bet_id',
    ])
    expect(source).not.toContain('skip locked')
  })

  test('the SQL matcher rejects closed/resolved markets and expired orders', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )

    expectMarkersInOrder(source, [
      'if v_contract.resolution_time is not null',
      "raise exception 'Market is resolved'",
      'if v_contract.close_time is not null and v_contract.close_time <= v_now_ts',
      "raise exception 'Trading is closed'",
      'if v_taker.expires_at is not null and v_taker.expires_at <= v_now_ts',
      "raise exception 'Taker order is expired'",
    ])
    expectMarkersInOrder(source, [
      'and coalesce(b.is_cancelled, false) = false',
      'and coalesce(b.is_filled, false) = false',
      'and (b.expires_at is null or b.expires_at > v_now_ts)',
    ])
  })

  test('preflights the MEXAS matching RPC before a crossing order can debit funds', () => {
    const source = readRepoFile('web/lib/api/mexas-settlement.ts')
    const helper = readRepoFile('web/lib/api/mexas-rpc-matching.ts')
    const migration = readRepoFile(
      'backend/supabase/migrations/2026060203_add_mexas_matching_health.sql'
    )

    expectMarkersInOrder(source, [
      'export async function assertMexasCanMatchCrossingOrders',
      'canMexasMatchCrossingOrders(getMexasSettlementSettings())',
      'await assertMexasOrderbookMatchingEngineReady(db)',
    ])
    expect(helper).toContain("db.rpc('mexas_orderbook_matching_engine_ready')")
    expectMarkersInOrder(migration, [
      'create or replace function public.mexas_orderbook_matching_engine_ready',
      "to_regprocedure('public.mexas_match_orderbook_limit_order(text,bigint,integer)') is not null",
      'revoke execute on function public.mexas_orderbook_matching_engine_ready() from public, anon, authenticated',
      'grant execute on function public.mexas_orderbook_matching_engine_ready() to service_role',
    ])
  })

  test('fails closed before proxying unknown Manifold API endpoints', () => {
    const source = readRepoFile('web/proxy.ts')

    expectMarkersInOrder(source, [
      'if (shouldSkipProxy(path))',
      'if (isBlockedMexasApiProxyPath(path))',
      'if (!isAllowedMexasApiProxyPath(path))',
      'return NextResponse.json(MEXAS_API_UNAVAILABLE_RESPONSE, { status: 404 })',
      "return new Response('Permanent Redirect'",
    ])
  })
})
