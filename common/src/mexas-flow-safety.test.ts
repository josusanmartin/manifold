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
      'const contract = convertContract(contractRow) as MarketContract',
      'if (!isMexasOrderBookOnlyContract(contract))',
      "throw new APIError(404, 'Market is not available on MEXAS.')",
      'if (contract.closeTime && Date.now() >= contract.closeTime)',
    ])
    expectMarkersInOrder(source, [
      'const balanceLockOwner = await acquireMexasUserBalanceLock(db, userId)',
      'const lock = await acquireMexasOrderLock(db, params.contractId)',
      'await updateUserBalanceCas(db, userId, -reservedAmount',
      ".from('contract_bets')",
      '.insert(betToRow(bet))',
    ])
  })

  test('acquires the MEXAS order lock with predicates against same-millisecond lock races', () => {
    const source = readRepoFile('web/pages/api/v0/bet.ts')

    expectMarkersInOrder(source, [
      'function getMexasOrderLockPredicates',
      'data.mexasOrderLock === true',
      'data->>mexasOrderLockOwner.eq.${owner}',
      'data->>mexasOrderLockSince.eq.${since}',
      'data->>mexasOrderLock.is.null',
      'data->>mexasOrderLock.eq.false',
    ])
    expectMarkersInOrder(source, [
      'function getNoMexasResolutionLockPredicates',
      'data->>mexasResolving.is.null',
      'data->>mexasResolving.eq.false',
    ])
    expectMarkersInOrder(source, [
      'async function acquireMexasOrderLock',
      'combinePostgrestAndPredicates([',
      'getMexasOrderLockPredicates(contractData)',
      'getNoMexasResolutionLockPredicates()',
      '.eq(\'last_updated_time\', typedContractRow.last_updated_time)',
    ])
  })

  test('does not recursively acquire user locks during already-locked cleanup', () => {
    const source = readRepoFile('web/pages/api/v0/bet.ts')

    expect(
      countOccurrences(source, 'skipUserBalanceLock: true')
    ).toBeGreaterThanOrEqual(6)
  })

  test('wallet sync refetches the user row so it preserves active balance locks', () => {
    const source = readRepoFile('web/pages/api/v0/bet.ts')

    expectMarkersInOrder(source, [
      'async function syncMexasWalletBalance',
      ".from('users')",
      ".select('*')",
      ".eq('id', userRow.id)",
      '.single()',
      'const data = getUserData(freshUserRow)',
      "let latestUserRow = freshUserRow as Row<'users'>",
    ])
    expect(source).not.toContain('let latestUserRow = userRow')
  })

  test('cancels MEXAS orders and refunds reserved funds under the user balance lock', () => {
    const source = readRepoFile('web/pages/api/v0/bet/cancel/[betId].ts')
    const ordersSource = readRepoFile('web/lib/api/mexas-orders.ts')

    expectMarkersInOrder(source, [
      'const contract = convertContract(typedContractRow) as MarketContract',
      'if (!isMexasOrderBookOnlyContract(contract))',
      "throw new APIError(404, 'Order is not available on MEXAS.')",
      'if (contract.isResolved)',
    ])
    expectMarkersInOrder(source, [
      'const balanceLockOwner = await acquireMexasUserBalanceLock(db, userId)',
      'await releaseUnbackedMexasOrders(db',
      'const releasedBetRow = shouldReleaseMexasFunds',
      'await releaseCancelledMexasOrder(db, typedBetRow',
      'await releaseMexasUserBalanceLock(db, userId, balanceLockOwner)',
    ])
    expect(source).toContain('releaseCancelledMexasOrder')
    expect(source).toContain('skipUserBalanceLock: true')
    expect(source).not.toContain('async function releaseMexasCancelledOrderFunds')
    expect(source).not.toContain('updateMexasUserBalanceCas')
    expectMarkersInOrder(ordersSource, [
      'async function prepareOpenMexasOrderRelease',
      'mexasReleaseReason: releaseReason',
      ".eq('is_cancelled', false)",
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
    ])
    expectMarkersInOrder(ordersSource, [
      'async function prepareCancelledMexasOrderRelease',
      'const creditKey =',
      'getMexasOrderReleaseCreditKey(bet.id)',
      ".eq('is_cancelled', true)",
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
    ])
    expectMarkersInOrder(ordersSource, [
      'async function completePreparedMexasOrderRelease',
      'await updateMexasUserBalanceCas(db, bet.userId, refundAmount',
      'mexasFundsReleased: true',
      ".eq('is_cancelled', true)",
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
    ])
    expectMarkersInOrder(ordersSource, [
      'export async function releaseCancelledMexasOrder',
      'prepareAndCompleteMexasOrderRelease(',
      'bet.isCancelled',
      '? prepareCancelledMexasOrderRelease',
      ': prepareOpenMexasOrderRelease',
    ])
  })

  test('lists bets only after resolving MEXAS orderbook contract ids', () => {
    const source = readRepoFile('web/pages/api/v0/bets.ts')

    expectMarkersInOrder(source, [
      'async function getMexasContractIds',
      ".contains('data', { token: 'MEX' } as any)",
      'isMexasOrderBookOnlyContract(convertContract(row))',
      'const mexasContractIds = await getMexasContractIds(db, contractId)',
      'query = query.in',
    ])
    expect(source).toContain("query = query.in('contract_id', mexasContractIds)")
    expect(source).not.toContain("query.eq('contract_id', contractId)")
    expect(source).not.toContain("query.in('contract_id', contractId)")
  })

  test('releases expired and unbacked orders only when the order row has not changed', () => {
    const source = readRepoFile('web/lib/api/mexas-orders.ts')

    expect(source).toContain(".lte('expires_at', now)")
    expectMarkersInOrder(source, [
      'export async function releaseExpiredMexasOrders',
      ".lte('expires_at', now)",
      ".eq('data->>mexasFundsReserved', 'true')",
      ".eq('data->>mexasFundsReleased', 'false')",
    ])
    expectMarkersInOrder(source, [
      'async function prepareOpenMexasOrderRelease',
      'const { data: preparedRow, error } = await db',
      'mexasFundsReleased:',
      'refundAmount > 0',
      ".eq('is_cancelled', false)",
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
      'return preparedRow',
    ])
    expectMarkersInOrder(source, [
      'async function prepareAndCompleteMexasOrderRelease',
      'const preparedRow = await prepareRelease(db, row, releaseReason)',
      'if (!preparedRow) return',
      'if (data.mexasFundsReleased === true) return preparedRow',
      'return await completePreparedMexasOrderRelease(',
    ])
    expectMarkersInOrder(source, [
      'async function releaseOpenMexasOrder',
      'prepareAndCompleteMexasOrderRelease(',
      'prepareOpenMexasOrderRelease',
      'return releasedRow ? 1 : 0',
    ])
    expectMarkersInOrder(source, [
      'async function completePreparedMexasOrderRelease',
      'await updateMexasUserBalanceCas(db, bet.userId, refundAmount',
      'mexasFundsReleased: true',
      ".eq('is_cancelled', true)",
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
    ])
    expectMarkersInOrder(source, [
      'export async function releasePendingMexasOrderReleases',
      'const rows = await loadPendingMexasReleaseRows(db, options)',
      'completePreparedMexasOrderRelease(db, row',
    ])
    expectMarkersInOrder(source, [
      'export async function releaseUnbackedMexasOrders',
      'let released = await releasePendingMexasOrderReleases(db, options)',
      'const rows = await loadOpenReservedMexasOrderRows(db, options)',
    ])
    expectMarkersInOrder(source, [
      'async function loadOpenReservedMexasOrderRows',
      ".eq('data->>mexasFundsReserved', 'true')",
      ".eq('data->>mexasFundsReleased', 'false')",
      '.or(`expires_at.is.null,expires_at.gt.${now}`)',
    ])
    expectMarkersInOrder(source, [
      'async function cancelUnbackedMexasOrder',
      'const { data: updatedRow, error } = await db',
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
      'return updatedRow ? 1 : 0',
    ])
    expectMarkersInOrder(source, [
      'async function loadPendingMexasReleaseRows',
      ".eq('is_cancelled', true)",
      ".eq('data->>mexasFundsReserved', 'true')",
      'return data.mexasFundsReleased !== true',
    ])
  })

  test('generic backend limit-order expiry does not cancel reserved MEXAS orders', () => {
    const source = readRepoFile('backend/shared/src/expire-limit-orders.ts')

    expectMarkersInOrder(source, [
      'update contract_bets',
      'and expires_at < now()',
      'and not (',
      "coalesce(data, '{}'::jsonb)->>'mexasFundsReserved' = 'true'",
      'returning *',
    ])
    expect(source).not.toContain('mexasRefunds')
    expect(source).not.toContain('getMexasRemainingReservedAmount')
    expect(source).not.toContain('mexasReleaseCreditKey')
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
    expectMarkersInOrder(source, [
      'async function releaseOpenOrder',
      ".from('contract_bets')",
      ".eq('bet_id', entryBet.id)",
      'const currentBet = convertBet(typedCurrentRow)',
      'mexasReleaseCreditKey: getMexasOrderReleaseCreditKey(currentBet.id)',
      "mexasReleaseReason: 'resolution'",
      ".eq('updated_time', typedCurrentRow.updated_time)",
    ])
  })

  test('closes MEXAS resolution with predicates against concurrent order locks', () => {
    const source = readRepoFile(
      'web/pages/api/v0/market/[contractId]/resolve.ts'
    )

    expectMarkersInOrder(source, [
      'function getMexasOrderLockPredicates',
      'data.mexasOrderLock === true',
      'data->>mexasOrderLockOwner.eq.${owner}',
      'data->>mexasOrderLockSince.eq.${since}',
      'data->>mexasOrderLock.is.null',
      'data->>mexasOrderLock.eq.false',
    ])
    expectMarkersInOrder(source, [
      'function getMexasResolutionLockPredicates',
      'data.mexasResolving === true',
      'data->>mexasResolvingSince.eq.${since}',
      'data->>mexasResolvingOutcome.eq.${outcome}',
      'data->>mexasResolving.is.null',
      'data->>mexasResolving.eq.false',
    ])
    expectMarkersInOrder(source, [
      'async function closeContractForResolution',
      'combinePostgrestAndPredicates([',
      'getMexasOrderLockPredicates(contractData)',
      'getMexasResolutionLockPredicates(contractData)',
      ".eq('last_updated_time', contractRow.last_updated_time)",
    ])
  })

  test('syncs Privy wallet balances under the user balance lock', () => {
    const source = readRepoFile('web/pages/api/privy-user.ts')

    expectMarkersInOrder(source, [
      'const balanceLockOwner = await acquireMexasUserBalanceLock(db, userRow.id)',
      'const { data: lockedUserRow, error: lockedUserError } = await db',
      ".eq('id', userRow.id)",
      'let latestUserRow = lockedUserRow as Row',
      'const walletSync = await getMexasWalletSync',
      ".eq('balance', latestUserRow.balance)",
      'await releaseMexasUserBalanceLock(db, userRow.id, balanceLockOwner)',
    ])
    expectMarkersInOrder(source, [
      'async function getMexasWalletSync',
      'await releaseClosedMexasMarketOrders(db',
      'await releaseExpiredMexasOrders(db',
      'await releaseUnbackedMexasOrders(db',
      'const openReservedAmount = await getOpenReservedMexasAmount',
    ])
  })

  test('keeps logged-in balance UI on Privy/MEX instead of Firebase/MANA', () => {
    const authSource = readRepoFile('web/components/auth-context.tsx')
    const meSource = readRepoFile('web/pages/me.tsx')

    expectMarkersInOrder(authSource, [
      'const showToast',
      '<span>Recibido</span>',
      'coinType="MEX"',
    ])
    expect(authSource).not.toContain('Cha-ching! Received')
    expectMarkersInOrder(meSource, [
      "import { useIsAuthorized, useUser } from 'web/hooks/use-user'",
      'const isAuthorized = useIsAuthorized()',
      "router.replace('/wallet')",
    ])
    expect(meSource).not.toContain('redirectIfLoggedOut')
  })

  test('renders and validates MEX order amounts as MEX, not MANA or M$', () => {
    const amountSource = readRepoFile('web/components/widgets/amount-input.tsx')
    const limitSource = readRepoFile('web/components/bet/limit-order-panel.tsx')
    const betPanelSource = readRepoFile('web/components/bet/bet-panel.tsx')

    expectMarkersInOrder(amountSource, [
      "token === 'MEX' && user.balance < (amount ?? 0)",
      "token === 'MEX' ?",
      'MEX</span>',
      "allowFloat={token === 'CASH' || token === 'MEX'}",
    ])
    expectMarkersInOrder(limitSource, [
      "const displayToken = orderBookOnly ? 'MEX'",
      'token={displayToken}',
      '<MoneyDisplay',
      'token={displayToken}',
    ])
    expectMarkersInOrder(betPanelSource, [
      "const displayToken = orderBookOnly ? 'MEX'",
      "error === 'Saldo insuficiente' || error === 'Insufficient balance'",
      'token={displayToken}',
      'Tu saldo MEX',
      'token={displayToken}',
    ])
    expect(limitSource).not.toContain("token={isCashContract ? 'CASH' : 'M$'}")
    expect(betPanelSource).not.toContain(
      "token={isCashContract ? 'CASH' : 'M$'}"
    )
  })

  test('does not offer immediate expiration for MEXAS orderbook markets', () => {
    const source = readRepoFile('web/components/bet/limit-order-panel.tsx')

    expect(source).toContain("{ label: 'Expira inmediatamente', value: 1 }")
    expect(source).toContain('MEXAS_ONCHAIN_ESCROW_IMPLEMENTED')
    expect(source).toContain('getMexasCrossingOrders')
    expectMarkersInOrder(source, [
      'if (orderBookOnly && selectedExpiration === 1)',
      'setSelectedExpiration(0)',
      'const availableExpirationOptions = orderBookOnly',
      'expirationOptions.filter((option) => option.value !== 1)',
      'const expirationItems = availableExpirationOptions.map',
      'const selectedExpirationLabel =',
      'availableExpirationOptions.find',
    ])
    expectMarkersInOrder(source, [
      "error === 'Insufficient balance'",
      "error === 'Saldo insuficiente'",
      'mexasCrossingOrderBlocked',
    ])
    expectMarkersInOrder(source, [
      'const mexasBlockedCrossingOrders =',
      'orderBookOnly',
      '!MEXAS_ONCHAIN_ESCROW_IMPLEMENTED',
      'getMexasCrossingOrders',
      'takerUserId: user?.id',
      'const mexasCrossingOrderBlocked =',
      'displayedError',
      'El precio cruza el libro',
    ])
    expect(source).not.toContain('activar escrow on-chain')
  })

  test('does not overstate live MEXAS execution before escrow is implemented', () => {
    const checkoutSource = readRepoFile('web/pages/checkout.tsx')
    const aboutSource = readRepoFile('web/components/about-manifold.tsx')
    const explainerSource = readRepoFile('web/components/explainer-panel.tsx')

    expect(checkoutSource).toContain('Abre órdenes límite desde tu Wallet')
    expect(checkoutSource).toContain('Órdenes límite')
    expect(checkoutSource).not.toContain('Opera mercados desde tu Wallet')
    expect(checkoutSource).not.toContain('Libro de órdenes activo')
    expect(aboutSource).toContain('Abre órdenes límite con MEX')
    expect(explainerSource).toContain('órdenes límite abiertas')
    expect(explainerSource).not.toContain('Ver mercados activos')
    expect(explainerSource).not.toContain('compran y venden')
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
    const walletPageSource = readRepoFile('web/pages/wallet.tsx')
    const checkoutSource = readRepoFile('web/pages/checkout.tsx')

    expectMarkersInOrder(source, [
      'const withdrawableUnits =',
      'balanceUnits !== null && internalAvailableUnits !== null',
      '? minUnits(balanceUnits, internalAvailableUnits)',
      ': null',
    ])
    expectMarkersInOrder(source, [
      'if (withdrawableUnits === null)',
      'Espera a que se sincronicen tus saldos antes de retirar MEX.',
      'return',
      'if (parsedWithdrawAmount > withdrawableUnits)',
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
    expect(source).toContain('Disponible para retirar')
    expect(source).toContain('órdenes abiertas y los trades ejecutados')
    expect(source).toContain(
      'Cancela órdenes abiertas o espera la resolución de trades'
    )
    for (const pageSource of [source, walletPageSource, checkoutSource]) {
      expect(pageSource).not.toContain('permanecen en cadena y disponibles')
      expect(pageSource).not.toContain('permanece disponible')
    }
  })

  test('requires the RPC matching engine before live crossing matches can run', () => {
    const source = readRepoFile('common/src/mexas-settlement.ts')

    expectMarkersInOrder(source, [
      'export const MEXAS_ONCHAIN_ESCROW_CAPABILITIES',
      'captureOrderStake: false',
      'releaseOpenOrderStake: false',
      'payoutResolvedPositions: false',
      'export const MEXAS_ONCHAIN_ESCROW_IMPLEMENTED',
      'export function hasTransactionalMexasMatchingEngine',
      "return settings.matchingEngineMode === 'rpc'",
      'export function hasOperationalMexasEscrow',
      'MEXAS_ONCHAIN_ESCROW_IMPLEMENTED',
      "settings.escrowImplementation === 'onchain-transfer'",
      'export function canMexasMatchCrossingOrders',
      'hasOperationalMexasEscrow(settings)',
      'export function canMexasResolveFilledPositions',
      'return hasOperationalMexasEscrow(settings)',
    ])
    expect(source).not.toContain(
      "settings.allowUnescrowedMatching === 'true'"
    )
    expect(source).not.toContain(
      "settings.allowUnescrowedResolution === 'true'"
    )
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

  test('does not treat the taker own orders as crossing liquidity', () => {
    const apiSource = readRepoFile('web/pages/api/v0/bet.ts')
    const bookSource = readRepoFile('common/src/mexas-order-book.ts')
    const sqlSource = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )

    expectMarkersInOrder(apiSource, [
      'async function loadMexasCrossingOrderRows',
      'takerUserId: string',
      ".eq('data->>mexasFundsReserved', 'true')",
      ".eq('data->>mexasFundsReleased', 'false')",
      'bet.userId !== takerUserId',
      'isMexasCrossingOrder(outcome, limitProb, bet as LimitBet)',
    ])
    expect(apiSource).toContain('takerUserId: userId')
    expectMarkersInOrder(bookSource, [
      'takerUserId?: string',
      '(!takerUserId || maker.userId !== takerUserId)',
      'takerUserId,',
    ])
    expect(sqlSource).toContain('and b.user_id <> v_taker.user_id')
  })

  test('blocks pre-escrow MEXAS crossing orders without promising instant execution', () => {
    const source = readRepoFile('web/components/bet/limit-order-panel.tsx')

    expectMarkersInOrder(source, [
      'const mexasBlockedCrossingOrders =',
      '!MEXAS_ONCHAIN_ESCROW_IMPLEMENTED',
      'getMexasCrossingOrders',
      'const mexasCrossingOrderBlocked =',
      'const displayedError =',
      'El precio cruza el libro. Abre una orden que agregue liquidez.',
      'mexasCrossingOrderBlocked',
      'const displayedFilledAmount = mexasCrossingOrderBlocked ? 0 : filledAmount',
      'displayedFilledAmount > 0',
      'amount={displayedFilledAmount}',
    ])
    expectMarkersInOrder(source, [
      'async function submitBet()',
      'if (!user || betDisabled) return',
      'const bet = await api(',
      "'bet'",
    ])
    expect(source).not.toContain('activar escrow on-chain')
  })

  test('preflights MEXAS resolution exposure before the creator can resolve', () => {
    const apiSource = readRepoFile(
      'web/pages/api/v0/market/[contractId]/mexas-resolution-readiness.ts'
    )
    const panelSource = readRepoFile('web/components/resolution-panel.tsx')
    const selectorSource = readRepoFile(
      'web/components/bet/yes-no-selector.tsx'
    )
    const dangerSource = readRepoFile(
      'web/components/contract/danger-zone.tsx'
    )
    const proxySource = readRepoFile('web/proxy.ts')
    const confirmSource = readRepoFile(
      'web/components/buttons/confirmation-button.tsx'
    )

    expectMarkersInOrder(apiSource, [
      '.maybeSingle()',
      "throw new APIError(404, 'Contract not found.')",
      'getMexasSettlementAudit(',
      'await loadContractBets(db, contractId)',
      'audit.filledBetCount === 0',
      'canMexasResolveFilledPositions(getMexasSettlementSettings())',
      'const requiresEscrow = !canResolve && audit.filledBetCount > 0',
      'requiresEscrow,',
      'filledBetCount: audit.filledBetCount',
    ])
    expect(apiSource).toContain('Market is not available on MEXAS.')

    expectMarkersInOrder(panelSource, [
      'const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(contract)',
      '/mexas-resolution-readiness',
      'const mexasResolutionBlocked =',
      'mexasReadinessLoading',
      'mexasReadiness?.requiresEscrow === true',
      'const resolveDisabled = !outcome || mexasResolutionBlocked',
      'if (!outcome || mexasResolutionBlocked) return',
      'includeMkt={!isMexasOrderBookOnly}',
      'Este mercado tiene {readiness.filledBetCount} posiciones llenadas',
      'órdenes abiertas se cancelan y el MEX reservado se devuelve',
    ])
    expect(selectorSource).toContain('includeMkt?: boolean')
    expect(proxySource).toContain(
      '^v0\\/market\\/[^/]+\\/mexas-resolution-readiness$'
    )
    expect(dangerSource).toContain('Resolver')
    expect(confirmSource).toContain('Resolver a ${label}')
    expect(panelSource).not.toContain('comments section')
  })

  test('production smoke covers the local MEXAS resolution preflight endpoint', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-production-smoke.ts'
    )

    expectMarkersInOrder(source, [
      'async function checkResolutionReadiness',
      '/mexas-resolution-readiness',
      'typeof data.canResolve ===',
      'typeof data.requiresEscrow ===',
      'Number.isFinite(data.filledBetCount)',
      "results.push(await checkResolutionReadiness('mexwcwin26a'))",
      "results.push(await checkResolutionReadiness('ukrwarend26a'))",
      "results.push(await checkBlockedResolutionReadiness('not-a-mexas-market'))",
    ])
  })

  test('renders order book remaining sizes from canonical filled amount', () => {
    const panelSource = readRepoFile(
      'web/components/contract/order-book-panel.tsx'
    )
    const checkoutSource = readRepoFile('web/pages/checkout.tsx')
    const limitOrdersTableSource = readRepoFile(
      'web/components/bet/limit-orders-table.tsx'
    )

    expect(panelSource).toContain('getMexasOpenOrderAmount')
    expect(panelSource).not.toContain('sumBy(bet.fills')
    expectMarkersInOrder(checkoutSource, [
      'function remainingOrderAmount',
      '(order.orderAmount ?? 0) - (order.amount ?? 0)',
    ])
    expect(checkoutSource).not.toContain('fills?:')
    expect(checkoutSource).not.toContain('order.fills')
    expectMarkersInOrder(limitOrdersTableSource, [
      'isMexasOrderBookOnlyContract(contract)',
      'getMexasOpenOrderAmount(bet)',
      'bet.orderAmount -',
      'bet.fills.reduce',
    ])
  })

  test('serves public order book rows only for MEXAS orderbook markets', () => {
    const source = readRepoFile('web/pages/api/mexas-order-book.ts')

    expectMarkersInOrder(source, [
      ".from('contracts')",
      ".eq('id', contractId)",
      'if (!contractRow)',
      'return res.status(404)',
      'if (!isMexasOrderBookOnlyContract(convertContract(contractRow)))',
      'return res.status(404)',
      ".from('contract_bets')",
      ".eq('data->>mexasFundsReserved', 'true')",
      ".eq('data->>mexasFundsReleased', 'false')",
    ])
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

  test('indexes MEXAS maker lookup by side, price, and time priority', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/20260602153551_add_mexas_orderbook_indexes.sql'
    )

    expectMarkersInOrder(source, [
      'create index if not exists contract_bets_mexas_orderbook_no_asks_idx',
      'contract_id',
      "((data ->> 'limitProb')::numeric) asc",
      'created_time asc',
      'bet_id asc',
      "data ->> 'outcome' = 'NO'",
      'create index if not exists contract_bets_mexas_orderbook_yes_bids_idx',
      'contract_id',
      "((data ->> 'limitProb')::numeric) desc",
      'created_time asc',
      'bet_id asc',
      "data ->> 'outcome' = 'YES'",
    ])
    expect(source).toContain('coalesce(is_cancelled, false) = false')
    expect(source).toContain('coalesce(is_filled, false) = false')
    expect(source).toContain("data ->> 'answerId' is null")
    expect(source).toContain(
      "coalesce((data ->> 'mexasFundsReserved')::boolean, false) = true"
    )
    expect(source).toContain(
      "coalesce((data ->> 'mexasFundsReleased')::boolean, false) = false"
    )
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
      "Taker MEXAS funds are not reserved",
      "Taker MEXAS funds are already released",
      'while v_remaining_amount > v_epsilon',
      'select *',
      'into v_maker',
      "coalesce((b.data ->> 'mexasFundsReserved')::boolean, false) = true",
      "coalesce((b.data ->> 'mexasFundsReleased')::boolean, false) = false",
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
      "to_regprocedure('public.mexas_match_orderbook_limit_order(text,bigint,integer)') as matcher",
      "to_regprocedure('public.mexas_orderbook_matching_engine_ready()') as health",
      'when matcher is null or health is null then false',
      "has_function_privilege('service_role', matcher, 'execute')",
      "not has_function_privilege('anon', matcher, 'execute')",
      "to_regclass('public.contract_bets_mexas_orderbook_no_asks_idx') is not null",
      "to_regclass('public.contract_bets_mexas_orderbook_yes_bids_idx') is not null",
      'revoke execute on function public.mexas_orderbook_matching_engine_ready() from public, anon, authenticated',
      'grant execute on function public.mexas_orderbook_matching_engine_ready() to service_role',
    ])
  })

  test('continues RPC matching in batches instead of leaving crossed liquidity after one full batch', () => {
    const helper = readRepoFile('web/lib/api/mexas-rpc-matching.ts')

    expect(helper).toContain('const MAX_MATCHES_PER_RPC = 1000')
    expect(helper).toContain('const MAX_RPC_MATCH_PASSES = 20')
    expectMarkersInOrder(helper, [
      'for (let pass = 0; pass < MAX_RPC_MATCH_PASSES; pass++)',
      "db.rpc('mexas_match_orderbook_limit_order'",
      'p_max_matches: MAX_MATCHES_PER_RPC',
      'const matchCount = getMatchCount(data)',
      'if (latestTaker.isFilled || matchCount < MAX_MATCHES_PER_RPC)',
      'return latestTaker',
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
    expect(source).toContain(
      "to_regclass('public.contract_bets_mexas_orderbook_no_asks_idx') is null"
    )
    expect(source).toContain(
      "to_regclass('public.contract_bets_mexas_orderbook_yes_bids_idx') is null"
    )
    expect(source).toContain("'NO ask orderbook index missing'")
    expect(source).toContain("'YES bid orderbook index missing'")
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

  test('launch readiness reports how to apply missing Supabase launch SQL', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('const LAUNCH_SQL_APPLY_ENVS = [')
    expect(source).toContain("'MEXAS_SUPABASE_DB_URL'")
    expect(source).toContain("'SUPABASE_DB_PASSWORD'")
    expectMarkersInOrder(source, [
      'let needsLaunchSql = false',
      'if (contractFailures.length) needsLaunchSql = true',
      'if (matchingReadyError || matchingReady !== true) needsLaunchSql = true',
      'if (needsLaunchSql)',
      'Launch SQL is missing and no local Postgres connection env is set.',
      'apply:mexas-launch-sql --print-sql',
      'Service-role REST cannot apply this',
    ])
    expect(source).toContain(
      'contracts_token_check still needs the launch SQL'
    )
    expect(source).toContain('RPC/index DDL require Postgres SQL access')
  })

  test('launch readiness validates the MEXAS treasury wallet env pair', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('function checkTreasuryWalletEnv')
    expect(source).toContain('ZERO_EVM_ADDRESS')
    expect(source).toContain('MEXAS_TOKEN.address')
    expectMarkersInOrder(source, [
      'function checkTreasuryWalletEnv',
      "'MEXAS_TREASURY_WALLET_ADDRESS'",
      "'NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS'",
      'EVM_ADDRESS_PATTERN.test(address)',
      'normalizedAddress === ZERO_EVM_ADDRESS',
      'normalizedAddress === normalizeEvmAddress(MEXAS_TOKEN.address)',
      'server treasury',
      'does not match public treasury',
      "fail('treasury wallet env'",
      "pass(\n        'treasury wallet env'",
      'checks.push(checkTreasuryWalletEnv(vercelEnvValues))',
    ])
  })

  test('launch readiness checks open MEXAS order backing against Privy wallet balances', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('async function checkOpenMexasOrderBacking')
    expectMarkersInOrder(source, [
      'async function loadMexasOrderbookContractIds',
      ".contains('data', { token: 'MEX' } as any)",
      'isMexasOrderBookOnlyContract(contract)',
      'async function loadOpenReservedMexasOrders',
      ".eq('data->>mexasFundsReserved', 'true')",
      ".eq('data->>mexasFundsReleased', 'false')",
      'getMexasRemainingReservedAmount',
      'walletUnits < backing.requiredUnits',
      "checks.push(await checkOpenMexasOrderBacking(db))",
    ])
    expectMarkersInOrder(source, [
      'async function readMexasWalletBalanceUnits',
      "method: 'eth_call'",
      'encodeBalanceOfCall(address)',
      'return BigInt(payload.result)',
    ])
    expect(source).toContain('ERC20_BALANCE_OF_SELECTOR')
    expect(source).toContain('privyWalletAddress')
    expect(source).toContain('open order backing')
    expect(source).not.toContain('PRIVATE_KEY')
  })

  test('launch readiness fails visible MEXAS orders without active reserved funds', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('async function checkNoUnsafeOpenMexasOrders')
    expectMarkersInOrder(source, [
      'function getUnsafeOpenMexasOrderReasons',
      'bet.mexasFundsReserved !== true',
      'bet.mexasFundsReleased !== false',
      'no remaining reserved amount',
      'async function loadUnsafeOpenMexasLimitOrders',
      ".eq('is_filled', false)",
      ".eq('is_cancelled', false)",
      'const openAmount = getMexasOpenOrderAmount',
      'const reasons = getUnsafeOpenMexasOrderReasons',
      'async function checkNoUnsafeOpenMexasOrders',
      "fail(\n        'open order reservation flags'",
      "checks.push(await checkNoUnsafeOpenMexasOrders(db))",
      "checks.push(await checkOpenMexasOrderBacking(db))",
    ])
    expect(source).toContain('funds not reserved')
    expect(source).toContain('funds already released')
    expect(source).toContain('funds release flag missing')
  })

  test('launch readiness checks internal MEX balances against on-chain backing', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('async function checkInternalMexasBalanceBacking')
    expectMarkersInOrder(source, [
      'async function loadMexasWalletUsersWithPositiveBalance',
      ".from('users')",
      ".select('id,balance,data')",
      ".gt('balance', 0)",
      ".not('data->>privyWalletAddress', 'is', null)",
      'async function checkInternalMexasBalanceBacking',
      'const orders = await loadOpenReservedMexasOrders',
      'const reservedUnitsByUserId = new Map',
      'const internalUnits = mexasAmountToUnits(user.balance)',
      'const reservedUnits = reservedUnitsByUserId.get(user.id) ?? 0n',
      'const walletUnits = await readMexasWalletBalanceUnits(user.walletAddress)',
      'const availableWalletUnits = subtractUnitsFloorZero',
      'internalUnits <= availableWalletUnits',
      "fail('internal balance backing'",
      'checks.push(await checkInternalMexasBalanceBacking(db))',
    ])
  })

  test('launch readiness fails persistent crossed MEXAS order books', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('async function checkNoCrossedMexasOrderBooks')
    expect(source).toContain('getMexasOpenOrderAmount')
    expectMarkersInOrder(source, [
      'async function loadOpenMexasLimitOrders',
      ".eq('is_filled', false)",
      ".eq('is_cancelled', false)",
      ".eq('data->>mexasFundsReserved', 'true')",
      ".eq('data->>mexasFundsReleased', 'false')",
      '.or(`expires_at.is.null,expires_at.gt.${now}`)',
      'if (bet.answerId) continue',
      "bet.outcome !== 'YES' && bet.outcome !== 'NO'",
      "typeof bet.limitProb !== 'number'",
      'const openAmount = getMexasOpenOrderAmount',
      'async function checkNoCrossedMexasOrderBooks',
      'const yesBid = contractOrders',
      "order.outcome === 'YES'",
      'b.limitProb - a.limitProb',
      'const noAsk = contractOrders',
      "order.outcome === 'NO'",
      'a.limitProb - b.limitProb',
      'yesBid.limitProb + EPSILON < noAsk.limitProb',
      "fail('crossed order books'",
      'checks.push(await checkNoCrossedMexasOrderBooks(db))',
    ])
    expect(source).toContain("'crossed order books'")
  })

  test('launch readiness blocks filled MEXAS settlement exposure without operational escrow', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('async function checkMexasSettlementExposure')
    expectMarkersInOrder(source, [
      'async function loadOpenMexasOrderbookContractIds',
      'const contractIds = await loadMexasOrderbookContractIds(db)',
      ".is('resolution_time', null)",
      'async function checkMexasSettlementExposure',
      'getMexasSettlementAudit(rows.map((row) => convertBet(row)))',
      'const rowsByContractId = rows.reduce',
      'contractExposureDetails',
      'if (audit.filledBetCount === 0)',
      'if (!options.hasOperationalEscrow)',
      'filled MEXAS positions require escrow before resolution payouts',
      'Markets:',
      'await checkMexasSettlementExposure(supabaseDb, { hasOperationalEscrow })',
    ])
    expect(source).toContain('YES ${audit.yesPayout} MEX')
    expect(source).toContain('NO ${audit.noPayout} MEX')
    expect(source).toContain('CANCEL ${audit.cancelPayout} MEX')
  })

  test('provides a read-only MEXAS settlement exposure audit script', () => {
    const packageJson = readRepoFile('backend/scripts/package.json')
    const source = readRepoFile('backend/scripts/audit-mexas-settlement.ts')

    expect(packageJson).toContain('"audit:mexas-settlement"')
    expectMarkersInOrder(source, [
      'async function loadMexasOrderbookContracts',
      ".contains('data', { token: 'MEX' } as any)",
      ".is('resolution_time', null)",
      'async function loadContractBets',
      ".eq('is_cancelled', false)",
      'const filledBets = bets.filter(hasMexasFilledExposure)',
      'printTextReport(exposures)',
      'if (exposures.length) process.exitCode = 1',
    ])
    expect(source).toContain('Remediation options:')
    expect(source).toContain('Implement on-chain escrow')
    expect(source).toContain('manually unwind after reviewing the JSON report')
    expect(source).not.toContain(".update(")
    expect(source).not.toContain(".insert(")
    expect(source).not.toContain(".delete(")
    expect(source).not.toContain(".rpc(")
  })

  test('launch readiness cannot be passed by setting the escrow env before escrow code exists', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain(
      'getMissingMexasEscrowCapabilities'
    )
    expectMarkersInOrder(source, [
      'const hasOperationalEscrow = hasOperationalMexasEscrow',
      'escrowImplementation,',
      'settlementMode,',
      'const missingEscrowCapabilities = getMissingMexasEscrowCapabilities()',
      'hasOperationalEscrow',
      'MEXAS on-chain escrow implementation is enabled and implemented.',
      'escrow capabilities are missing:',
    ])

    const settlementSource = readRepoFile('common/src/mexas-settlement.ts')
    expect(settlementSource).toContain(
      'export const MEXAS_ONCHAIN_ESCROW_CAPABILITIES'
    )
    expect(settlementSource).toContain('captureOrderStake: false')
    expect(settlementSource).toContain('releaseOpenOrderStake: false')
    expect(settlementSource).toContain('payoutResolvedPositions: false')
  })

  test('MEXAS deposit receipt verification uses the shared ERC20 transfer parser', () => {
    const source = readRepoFile('backend/api/src/record-mexas-purchase.ts')

    expect(source).toContain(
      "from 'common/crypto/mexas-transfer'"
    )
    expectMarkersInOrder(source, [
      'getConfirmedMexasTransferUnits',
      'mexasUnitsToTokenAmount',
      'normalizeEvmAddress',
      'function getConfirmedMexasTreasuryTransferUnits',
      'return getConfirmedMexasTransferUnits',
    ])
    expect(source).not.toContain('const TRANSFER_TOPIC')
    expect(source).not.toContain('function addressTopic')
    expect(source).not.toContain('function parseTokenUnits')
  })
})
