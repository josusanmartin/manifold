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

    expect(source).toContain(".lte('expires_at', now)")
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

  test('treats market close time as an inclusive trading cutoff', () => {
    const betSource = readRepoFile('web/pages/api/v0/bet.ts')
    const ordersSource = readRepoFile('web/lib/api/mexas-orders.ts')

    expect(
      countOccurrences(betSource, 'Date.now() >= contract.closeTime')
    ).toBeGreaterThanOrEqual(2)
    expect(ordersSource).toContain(".lte('close_time', now)")
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

  test('syncs wallet balances incrementally instead of restoring spent filled stake', () => {
    const marketSource = readRepoFile('common/src/mexas-market.ts')
    const signupSource = readRepoFile('web/pages/api/privy-user.ts')
    const betSource = readRepoFile('web/pages/api/v0/bet.ts')
    const ordersSource = readRepoFile('web/lib/api/mexas-orders.ts')

    expectMarkersInOrder(marketSource, [
      'export function getMexasSyncedAvailableBalance',
      'currentBalance: number',
      'onChainDeltaAmount: number',
      'const ledgerAvailableAmount = Math.max',
      'const backedAvailableAmount = getMexasAvailableBalance',
      'return Math.min(ledgerAvailableAmount, backedAvailableAmount)',
    ])
    expect(signupSource).toContain('getMexasSyncedAvailableBalance')
    expect(signupSource).toContain('currentBalance: row.balance')
    expect(signupSource).toContain('onChainDeltaAmount: deltaAmount')
    expect(betSource).toContain('getMexasSyncedAvailableBalance')
    expect(betSource).toContain('currentBalance: latestUserRow.balance')
    expect(betSource).toContain('onChainDeltaAmount: deltaAmount')
    expect(ordersSource).toContain(".select('id,balance,data')")
    expect(ordersSource).toContain('currentBalance: userRowById.get(userId)?.balance ?? 0')
    expect(ordersSource).toContain('onChainDeltaAmount: 0')
  })

  test('limits wallet withdrawals to synced MEX and refreshes after the chain receipt', () => {
    const source = readRepoFile('web/components/crypto/mexas-wallet-panel.tsx')

    expectMarkersInOrder(source, [
      'const withdrawableUnits =',
      'balanceUnits !== null && internalAvailableUnits !== null',
      '? minUnits(balanceUnits, internalAvailableUnits)',
    ])
    expectMarkersInOrder(source, [
      'eth_sendTransaction',
      'setWithdrawHash(hash)',
      'setBalanceUnits((units) =>',
      'units - parsedWithdrawAmount',
      'setInternalAvailableAmount((amount) =>',
      'mexasUnitsToAmount(parsedWithdrawAmount)',
      'waitForTransactionReceipt({ hash })',
      '.then(refreshWalletState)',
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

  test('allows crossing MEXAS limit orders through the UI so the RPC can match them', () => {
    const source = readRepoFile('web/components/bet/limit-order-panel.tsx')

    expect(source).not.toContain('mexasCrossingBlocked')
    expect(source).not.toContain('Cruce desactivado')
    expect(source).not.toContain('Los cruces están desactivados')
    expect(source).toContain('const bet = await api(')
    expect(source).toContain("'bet'")
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

  test('persists SQL matcher fills in canonical columns and JSON data', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )
    const sql = compactWhitespace(source)

    expect(sql).toMatch(
      /update public\.contract_bets set amount = v_maker_amount, shares = v_maker_shares, is_filled = v_maker_remaining_amount <= v_epsilon, data = v_maker_data where bet_id = v_maker\.bet_id/
    )
    expect(sql).toMatch(
      /update public\.contract_bets set amount = v_taker_amount, shares = v_taker_shares, is_filled = v_remaining_amount <= v_epsilon, data = v_taker_data where bet_id = v_taker\.bet_id/
    )
  })

  test('SQL matcher credits any unused reserved MEX before marking filled order funds released', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )

    expectMarkersInOrder(source, [
      'v_taker_reserved_amount := coalesce',
      'v_taker_unused_refund := case',
      'update public.users',
      'set balance = round(balance + v_taker_unused_refund, 8)',
      'where id = v_taker.user_id',
      "'mexasReleaseCreditKey'",
      "'mexas-order-price-improvement:' || v_taker.bet_id",
      "'mexasReleaseReason'",
      "'price-improvement'",
      'update public.contract_bets',
      'amount = v_taker_amount',
    ])
    expectMarkersInOrder(source, [
      'v_maker_reserved_amount := coalesce',
      'v_maker_unused_refund := case',
      'update public.users',
      'set balance = round(balance + v_maker_unused_refund, 8)',
      'where id = v_maker.user_id',
      "'mexas-order-price-improvement:' || v_maker.bet_id",
      'update public.contract_bets',
      'amount = v_maker_amount',
    ])
  })

  test('the SQL matcher rejects non-MEXAS markets, closed/resolved markets, and expired orders', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )

    expectMarkersInOrder(source, [
      "v_contract.token = 'MEX'",
      "v_contract.data ->> 'token' = 'MEX'",
      "v_contract.data ->> 'mechanism' = 'cpmm-1'",
      "v_contract.data ->> 'outcomeType' = 'BINARY'",
      "raise exception 'MEXAS matching only supports MEX binary orderbook markets'",
    ])
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

  test('prints self-verifying launch SQL for manual Supabase SQL Editor runs', () => {
    const source = readRepoFile('backend/scripts/apply-mexas-launch-sql.ts')
    const compact = compactWhitespace(source)

    expect(source).toContain('-- Verification block for manual Supabase SQL Editor runs')
    expect(source).toContain("raise exception 'MEXAS launch SQL verification failed: %'")
    expect(source).toContain("raise notice 'PASS MEXAS launch SQL applied and verified.'")
    expect(source).toContain(
      "public.mexas_orderbook_matching_engine_ready() is distinct from true"
    )
    expect(compact).toContain(
      "has_function_privilege( 'service_role', 'public.mexas_match_orderbook_limit_order(text,bigint,integer)', 'execute' )"
    )
    expect(source).toContain("'public clients can execute matching RPC'")
    expect(source).toContain("'public clients can execute matching health RPC'")
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

  test('requires readable public Vercel production env values for launch readiness', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('getRequiredProductionEnvPresenceFailures')
    expect(source).toContain('getRequiredReadableProductionEnvFailures')
    expect(source).toContain('is empty in Vercel production')
    expect(source).toContain(
      'public env vars must be added with --no-sensitive'
    )
    expect(source).toContain('is only set locally, not in Vercel production')
    expect(source).not.toContain('hasEnvOrVercelEnv')
  })
})
