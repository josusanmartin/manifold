import { existsSync, readFileSync } from 'fs'
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
    const balanceSource = readRepoFile('web/lib/api/mexas-balance.ts')

    expect(source).toContain('const ORDER_LOCK_TIMEOUT_MS = 2 * 60 * 1000')
    expect(balanceSource).toContain(
      'const BALANCE_LOCK_TIMEOUT_MS = 2 * 60 * 1000'
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
      'function getNoMexasResolutionLockPredicates',
      'data->>mexasResolving.is.null',
      'data->>mexasResolving.eq.false',
    ])
    expectMarkersInOrder(source, [
      'async function acquireMexasOrderLock',
      'combinePostgrestAndPredicates([',
      'getMexasOrderLockPredicates(contractData)',
      'getNoMexasResolutionLockPredicates()',
      ".eq('last_updated_time', typedContractRow.last_updated_time)",
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
    expectMarkersInOrder(source, [
      'const openReservedAmount = await getOpenReservedMexasAmount',
      '[MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]: openReservedAmount',
    ])
    expect(source).toContain(
      "const MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY = 'mexasWalletOpenReservedAmount'"
    )
    expect(source).not.toContain('let latestUserRow = userRow')
  })

  test('MEXAS user balance writes CAS against balance and user data', () => {
    const balanceSource = readRepoFile('web/lib/api/mexas-balance.ts')
    const betSource = readRepoFile('web/pages/api/v0/bet.ts')
    const privySource = readRepoFile('web/pages/api/privy-user.ts')

    expectMarkersInOrder(balanceSource, [
      'async function acquireMexasUserBalanceLock',
      '.update({ data: lockedData as any })',
      ".eq('id', userId)",
      ".filter('data', 'eq', JSON.stringify(userRow.data))",
    ])
    expectMarkersInOrder(balanceSource, [
      'export async function updateMexasUserBalanceCas',
      ".eq('balance', userRow.balance)",
      ".filter('data', 'eq', JSON.stringify(userRow.data))",
    ])
    expectMarkersInOrder(balanceSource, [
      'export async function setMexasUserBalanceCas',
      ".eq('balance', userRow.balance)",
      ".filter('data', 'eq', JSON.stringify(userRow.data))",
    ])
    expectMarkersInOrder(betSource, [
      'async function syncMexasWalletBalance',
      ".eq('balance', latestUserRow.balance)",
      ".filter('data', 'eq', JSON.stringify(latestUserRow.data))",
    ])
    expectMarkersInOrder(betSource, [
      'async function updateUserBalanceCas',
      ".eq('balance', userRow.balance)",
      ".filter('data', 'eq', JSON.stringify(userRow.data))",
    ])
    expectMarkersInOrder(privySource, [
      'async function updateExistingUser',
      ".eq('balance', latestUserRow.balance)",
      ".filter('data', 'eq', JSON.stringify(latestUserRow.data))",
    ])
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
    expect(source).not.toContain(
      'async function releaseMexasCancelledOrderFunds'
    )
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
      'async function getUserIdFromUsername',
      ".from('users')",
      ".select('id')",
      ".ilike('username', username)",
      '.maybeSingle()',
      "throw new APIError(404, 'User not found.')",
      'const userId = params.username',
      '? await getUserIdFromUsername(db, params.username)',
    ])
    expectMarkersInOrder(source, [
      'async function getMexasContractIds',
      ".contains('data', { token: 'MEX' } as any)",
      'isMexasOrderBookOnlyContract(convertContract(row))',
      'const mexasContractIds = await getMexasContractIds(db, contractId)',
      'query = query.in',
    ])
    expect(source).toContain(
      "query = query.in('contract_id', mexasContractIds)"
    )
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
      'async function syncAvailableBalanceFromBacking',
      ".from('users')",
      ".select('balance')",
      'getMexasSyncedAvailableBalance({',
      'currentBalance: userRow.balance',
    ])
    expectMarkersInOrder(source, [
      'async function completePreparedMexasOrderRelease',
      'await updateMexasUserBalanceCas(db, bet.userId, refundAmount',
      'dataPatch: await getOpenReservedMexasDataPatch(db, bet.userId)',
      'mexasFundsReleased: true',
      ".eq('is_cancelled', true)",
      ".eq('is_filled', false)",
      ".eq('updated_time', row.updated_time)",
    ])
    expectMarkersInOrder(source, [
      'async function getOpenReservedMexasDataPatch',
      '[MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]:',
      'await getOpenReservedMexasAmount(db, { userId })',
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
      'const releasedMexasOrders = await pg.tx',
      'releaseExpiredMexasReservedOrders(tx)',
      'update contract_bets',
      'and expires_at < now()',
      'and not (',
      "coalesce(data, '{}'::jsonb)->>'mexasFundsReserved' = 'true'",
      'returning *',
    ])
    expect(source).not.toContain('mexasRefunds')
    expect(source).not.toContain('getMexasRemainingReservedAmount')
  })

  test('scheduler releases expired or closed MEXAS reserved orders without user traffic', () => {
    const source = readRepoFile('backend/shared/src/expire-limit-orders.ts')

    expectMarkersInOrder(source, [
      'async function releaseExpiredMexasReservedOrders',
      'from contract_bets b',
      'join contracts c on c.id = b.contract_id',
      'join users u on u.id = b.user_id',
      "coalesce((b.data->>'mexasFundsReserved')::boolean, false) = true",
      "coalesce((b.data->>'mexasFundsReleased')::boolean, false) = false",
      "coalesce((u.data->>'mexasBalanceLock')::boolean, false) = true",
      "coalesce((u.data->>'mexasBalanceLockSince')::bigint, 0) > $1::bigint - 120000",
      "and (c.token = 'MEX' or c.data->>'token' = 'MEX')",
      "and c.data->>'mechanism' = 'cpmm-1'",
      "and c.data->>'outcomeType' = 'BINARY'",
      'coalesce(b.is_cancelled, false) = true',
      'or b.expires_at < now()',
      'or (c.close_time is not null and c.close_time <= now())',
      'for update of b, u skip locked',
    ])
    expectMarkersInOrder(source, [
      'update contract_bets b',
      'is_cancelled = true',
      "'mexasFundsReleased', true",
      "'mexasReleaseCreditKey', e.credit_key",
      "'mexasReleaseReason', e.release_reason",
      "'mexasReleasedAt', e.released_at",
      'returning',
      'e.refund_amount',
    ])
    expectMarkersInOrder(source, [
      'user_credit_events as',
      'mexasBalanceCreditKeys',
      '? e.credit_key',
      'credit_updates as',
      'round(sum(refund_amount), 8) as credit_amount',
      'jsonb_agg(credit_key order by credit_key) as credit_keys',
      'update users u',
      'balance = round(u.balance + cu.credit_amount, 8)',
      "'{mexasBalanceCreditKeys}'",
    ])
    expectMarkersInOrder(source, [
      'open_reserved as',
      'left join contract_bets b',
      "coalesce((b.data->>'mexasFundsReserved')::boolean, false) = true",
      "coalesce((b.data->>'mexasFundsReleased')::boolean, false) = false",
      "'{mexasWalletOpenReservedAmount}'",
      'to_jsonb(open_reserved.amount)',
    ])
  })

  test('treats market close time as an inclusive trading cutoff', () => {
    const betSource = readRepoFile('web/pages/api/v0/bet.ts')
    const ordersSource = readRepoFile('web/lib/api/mexas-orders.ts')

    expect(
      countOccurrences(betSource, 'Date.now() >= contract.closeTime')
    ).toBeGreaterThanOrEqual(2)
    expectMarkersInOrder(betSource, [
      'const lockedContract = lock.contract',
      'const latestSyncedUserRow = await syncMexasWalletBalance(',
      'lockedContract.closeTime &&',
      'Date.now() >= lockedContract.closeTime',
      "throw new APIError(403, 'Trading is closed.')",
      'if (lockedContract.isResolved)',
      "throw new APIError(403, 'Market is resolved.')",
      'bet = createMexasOpenLimitBet(',
    ])
    expect(ordersSource).toContain(".lte('close_time', now)")
  })

  test('resolves markets by locking each participant while crediting and releasing orders', () => {
    const source = readRepoFile(
      'web/pages/api/v0/market/[contractId]/resolve.ts'
    )

    expect(source).toContain('applyMexasResolutionCreditsAndReleases')
    expect(source).toContain('getOpenReservedMexasAmount')
    expectMarkersInOrder(source, [
      'const balanceLockOwner = await acquireMexasUserBalanceLock(db, eventUserId)',
      'await updateMexasUserBalanceCas(db, event.userId, event.amount',
      'await releaseOpenOrder(db, entry)',
      'await refreshMexasOpenReservedAmount(db, eventUserId)',
      'await releaseMexasUserBalanceLock(db, eventUserId, balanceLockOwner)',
    ])
    expectMarkersInOrder(source, [
      'async function refreshMexasOpenReservedAmount',
      '[MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]:',
      'await getOpenReservedMexasAmount(db, { userId })',
    ])
    expectMarkersInOrder(source, [
      'async function releaseOpenOrder',
      ".from('contract_bets')",
      ".eq('bet_id', entryBet.id)",
      'const currentBet = convertBet(typedCurrentRow)',
      'mexasReleaseCreditKey: getMexasOrderReleaseCreditKey(currentBet.id)',
      "mexasReleaseReason: 'resolution'",
      ".eq('updated_time', typedCurrentRow.updated_time)",
      ".select('bet_id')",
      '.maybeSingle()',
      'if (!updatedRow)',
      'Order changed during resolution. Please retry resolution.',
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

  test('uses a consistent fresh order-lock timeout across order, cancel, and resolve flows', () => {
    const betSource = readRepoFile('web/pages/api/v0/bet.ts')
    const cancelSource = readRepoFile('web/pages/api/v0/bet/cancel/[betId].ts')
    const resolveSource = readRepoFile(
      'web/pages/api/v0/market/[contractId]/resolve.ts'
    )

    for (const source of [betSource, cancelSource, resolveSource]) {
      expect(source).toContain('const ORDER_LOCK_TIMEOUT_MS = 2 * 60 * 1000')
      expect(source).toContain('Date.now() - since < ORDER_LOCK_TIMEOUT_MS')
    }
  })

  test('syncs Privy wallet balances under the user balance lock', () => {
    const source = readRepoFile('web/pages/api/privy-user.ts')
    const userSource = readRepoFile('common/src/user.ts')

    expectMarkersInOrder(source, [
      'async function readMexasWalletBalance',
      'await getMexasBalanceUnits(walletAddress as Address)',
      'throw new APIError(\n      503',
      'No se pudo leer el balance MEXAS de tu Wallet.',
    ])
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
      'const walletBalance = await readMexasWalletBalance(',
      "'existing-user'",
      'await releaseClosedMexasMarketOrders(db',
      'await releaseExpiredMexasOrders(db',
      'await releaseUnbackedMexasOrders(db',
      'const openReservedAmount = await getOpenReservedMexasAmount',
      '[MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]: openReservedAmount',
    ])
    expect(source).toContain(
      "const MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY = 'mexasWalletOpenReservedAmount'"
    )
    expect(userSource).toContain('mexasWalletOpenReservedAmount?: number')
    expectMarkersInOrder(source, [
      'async function getNewUserMexasWalletBalance',
      "return readMexasWalletBalance(walletAddress, 'new-user')",
    ])
    expect(source).not.toContain('Failed to sync MEXAS wallet balance')
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

  test('keeps profile tabs and wallet payments on the Spanish MEXAS surface', () => {
    const profileSource = readRepoFile('web/pages/[username]/index.tsx')
    const paymentsSource = readRepoFile('web/pages/payments.tsx')
    const smokeSource = readRepoFile(
      'backend/scripts/check-mexas-production-smoke.ts'
    )
    const dropdownSource = readRepoFile(
      'web/components/widgets/dropdown-menu.tsx'
    )
    const checkedDropdownSource = readRepoFile(
      'web/components/widgets/checked-dropdown.tsx'
    )
    const settingsSource = readRepoFile('web/components/profile/settings.tsx')

    expectMarkersInOrder(profileSource, [
      "title: 'Resumen'",
      "title: 'Operaciones'",
      "title: 'Mercados'",
      "title: 'Movimientos'",
      "title: 'Wallet'",
    ])
    expect(profileSource).toContain('Puesto {leagueInfo.rank}')
    expect(profileSource).toContain("title: 'Siguiendo'")
    expect(profileSource).toContain("title: 'Seguidores'")
    expect(profileSource).not.toContain("title: 'Following'")
    expect(profileSource).not.toContain("title: 'Followers'")
    expect(profileSource).not.toContain('Rank {leagueInfo.rank}')
    expect(profileSource).not.toContain("title: 'Comments'")
    expect(profileSource).not.toContain("title: 'Achievements'")
    expect(profileSource).toContain(
      "tab !== 'achievements' && tab !== 'comments'"
    )
    expect(profileSource).toContain("tab: 'summary'")
    expect(profileSource).toContain('shouldIgnoreUser: false')
    expect(profileSource).not.toContain("unauthedApi('bets'")
    expect(profileSource).not.toContain('getUserRating')
    expect(profileSource).not.toContain('getAverageUserRating')
    expect(profileSource).not.toContain('isUserLikelySpammer')
    expectMarkersInOrder(smokeSource, [
      "path: '/josusanmartin?tab=comments'",
      "destination: '/josusanmartin?tab=summary'",
      "path: '/josusanmartin?tab=achievements'",
      "destination: '/josusanmartin?tab=summary'",
      "destination.includes('?')",
      '`${locationUrl.pathname}${locationUrl.search}`',
    ])

    expectMarkersInOrder(paymentsSource, [
      'Los controles de la Wallet son privados',
      '<MexasWalletSummary className="w-full" />',
      '<h2',
      'Wallet MEX',
      'Deposita {MEXAS_TOKEN.symbol} en tu Wallet Privy',
    ])
    expect(paymentsSource).not.toContain('Receive Mana')
    expect(paymentsSource).not.toContain('Send Mana')
    expect(paymentsSource).not.toContain('Default Amount')
    expect(paymentsSource).not.toContain('Default Message')
    expect(dropdownSource).toContain('Abrir opciones')
    expect(checkedDropdownSource).toContain('Abrir opciones')
    expect(dropdownSource).not.toContain('Open options')
    expect(checkedDropdownSource).not.toContain('Open options')
    expect(settingsSource).toContain('Alertas de operación')
    expect(settingsSource).toContain('Notificaciones y correos')
    expect(settingsSource).toContain('Clave API')
    expect(settingsSource).toContain('Estado de bot')
    expect(settingsSource).toContain('Eliminar cuenta')
    expect(settingsSource).not.toContain('Identity Verification')
    expect(settingsSource).not.toContain('Verify your identity')
    expect(settingsSource).not.toContain('cash prize raffles')
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
    expect(limitSource).toContain('Error al enviar la orden')
    expect(limitSource).toContain('Participaciones')
    expect(limitSource).toContain("              de{' '}")
    expect(limitSource).not.toContain(
      'Order will expire immediately after placement'
    )
    expect(limitSource).not.toContain('Error placing ${TRADE_TERM}')
    expect(limitSource).not.toContain("              of{' '}")
    expect(limitSource).not.toContain("'Shares'")
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

  test('uses Privy login for MEXAS order entry instead of Firebase signup', () => {
    const source = readRepoFile('web/components/bet/limit-order-panel.tsx')
    const compact = compactWhitespace(source)

    expect(source).toContain(
      "import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'"
    )
    expectMarkersInOrder(source, [
      'const orderBookOnly = isMexasOrderBookOnlyContract(contract)',
      'const privy = usePrivyLogin()',
      'orderBookOnly ? privy.login : firebaseLogin',
    ])
    expect(compact).toContain(
      "orderBookOnly ? 'privy login from bet panel' : 'login from bet panel'"
    )
    expect(compact).toContain(
      "orderBookOnly ? 'Conectar Wallet Privy' : 'Inicia sesión para operar'"
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

  test('does not expose legacy CPMM sell controls on MEXAS markets', () => {
    const summarySource = readRepoFile(
      'web/components/bet/user-bet-summary.tsx'
    )
    const sellRowSource = readRepoFile('web/components/bet/sell-row.tsx')
    const sellPanelSource = readRepoFile('web/components/bet/sell-panel.tsx')
    const apiSurfaceSource = readRepoFile('common/src/mexas-api-surface.ts')
    const smokeSource = readRepoFile(
      'backend/scripts/check-mexas-production-smoke.ts'
    )

    expectMarkersInOrder(summarySource, [
      'const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(contract)',
      'includeSellButton &&',
      '!isMexasOrderBookOnly',
      '<SellRow',
    ])
    expectMarkersInOrder(summarySource, [
      'isAdmin &&',
      '!isMexasOrderBookOnly',
      '<SellSharesModal',
    ])
    expectMarkersInOrder(sellRowSource, [
      'const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(contract)',
      'if (isMexasOrderBookOnly) return null',
      'if (sharesOutcome && user && mechanism ===',
    ])
    expectMarkersInOrder(sellRowSource, [
      'if (isMexasOrderBookOnlyContract(contract))',
      'Venta no disponible',
      'No se usa el flujo legacy de venta CPMM.',
    ])
    expectMarkersInOrder(sellPanelSource, [
      'const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(contract)',
      'const betDisabled =',
      'isMexasOrderBookOnly',
      'async function submitSell()',
      'if (isMexasOrderBookOnly)',
      'Las ventas legacy no están disponibles en mercados MEX.',
      "await api('market/:contractId/sell'",
    ])
    expect(apiSurfaceSource).toContain('/^v0\\/market\\/[^/]+\\/sell$/')
    expect(apiSurfaceSource).toContain("'v0/market/mexwcwin26a/sell'")
    expect(smokeSource).toContain('MEXAS_BLOCKED_API_SMOKE_PATHS')
  })

  test('does not overstate live MEXAS execution before escrow is implemented', () => {
    const checkoutSource = readRepoFile('web/pages/checkout.tsx')
    const aboutSource = readRepoFile('web/components/about-manifold.tsx')
    const explainerSource = readRepoFile('web/components/explainer-panel.tsx')

    expect(checkoutSource).toContain('Abre órdenes límite desde tu Wallet')
    expect(checkoutSource).toContain('Órdenes límite')
    expect(checkoutSource).toContain('Vol.</span> MEX 0')
    expect(checkoutSource).not.toContain('MEX 1.39B')
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
    expectMarkersInOrder(betSource, [
      'async function syncMexasWalletBalance',
      'if (!walletAddress || !isAddress(walletAddress))',
      'Conecta una Wallet Privy antes de abrir órdenes MEX.',
    ])
    expect(betSource).toContain('currentBalance: latestUserRow.balance')
    expect(betSource).toContain('onChainDeltaAmount: deltaAmount')
    expectMarkersInOrder(betSource, [
      'async function refundMexasReservation',
      'dataPatch: await getOpenReservedMexasDataPatch(db, userId)',
    ])
    expectMarkersInOrder(betSource, [
      'async function getOpenReservedMexasDataPatch',
      '[MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]:',
      'async function refreshMexasOpenReservedAmount',
      'await updateUserBalanceCas(',
    ])
    expectMarkersInOrder(betSource, [
      ".from('contract_bets')",
      '.insert(betToRow(bet))',
      'inserted = true',
      'if (!hasCrossingOrders)',
      'await refreshMexasOpenReservedAmount(db, userId)',
      'const matchedBet = hasCrossingOrders',
    ])
    expect(ordersSource).toContain(".select('id,balance,data')")
    expectMarkersInOrder(ordersSource, [
      'async function syncAvailableBalanceFromBacking',
      ".select('balance')",
      'currentBalance: userRow.balance',
    ])
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
      'const syncInternalWalletBalance = useCallback(async (options?:',
      'throwOnError?: boolean',
      'throw new Error(body?.message ??',
      'if (options?.throwOnError) throw error',
    ])
    expectMarkersInOrder(source, [
      'setWithdrawing(true)',
      'const latestBalanceUnits = await getMexasBalanceUnits(walletAddress)',
      'setBalanceUnits(latestBalanceUnits)',
      'const syncedUser = await syncInternalWalletBalance({ throwOnError: true })',
      'No se pudo sincronizar tu Wallet antes del retiro.',
      'const latestWithdrawableUnits = minUnits(',
      'latestBalanceUnits',
      'mexasAmountToUnits(syncedUser.user.balance)',
      'if (parsedWithdrawAmount > latestWithdrawableUnits)',
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
    expect(source).toContain('Reservado en órdenes abiertas')
    expect(source).toContain('setOpenReservedAmount')
    expect(source).toContain('órdenes abiertas descuentan MEX disponible')
    expect(source).toContain('los trades ejecutados')
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
      'export function canMexasAcceptLimitOrders',
      'return true',
      'export function canMexasMatchCrossingOrders',
      'hasOperationalMexasEscrow(settings)',
      'export function canMexasResolveFilledPositions',
      'return hasOperationalMexasEscrow(settings)',
    ])
    expect(source).not.toContain("settings.allowUnescrowedMatching === 'true'")
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
    const dangerSource = readRepoFile('web/components/contract/danger-zone.tsx')
    const proxySource = readRepoFile('web/proxy.ts')
    const confirmSource = readRepoFile(
      'web/components/buttons/confirmation-button.tsx'
    )

    expectMarkersInOrder(apiSource, [
      '.maybeSingle()',
      "throw new APIError(404, 'Contract not found.')",
      'await releaseClosedMexasMarketOrders(db, { contractId })',
      'await releaseExpiredMexasOrders(db, { contractId })',
      'await releaseUnbackedMexasOrders(db, {',
      'requireBalanceRead: true',
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

  test('disables market comments at the shared user permission helper', () => {
    const source = readRepoFile('common/src/user.ts')

    expect(source).toContain('MEXAS disables market comments entirely.')
    expect(source).toContain(
      'export const canCommentOnMarket = (_user: User) => false'
    )
    expect(source).not.toContain(
      'MEXAS markets do not require identity verification or a prior purchase to comment.'
    )
  })

  test('rechecks MEXAS settlement exposure after closing but before credits', () => {
    const source = readRepoFile(
      'web/pages/api/v0/market/[contractId]/resolve.ts'
    )

    expect(
      countOccurrences(source, 'assertMexasCanResolveFilledPositions(')
    ).toBe(2)
    expectMarkersInOrder(source, [
      'const preflightBets = await loadContractBets(db, contractId)',
      'assertMexasCanResolveFilledPositions(',
      'const closedContractRow = await closeContractForResolution(',
      'const bets = await loadContractBets(db, contractId)',
      'assertMexasCanResolveFilledPositions(',
      'const creditEvents = getMexasResolutionCreditEvents(',
    ])
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

  test('production smoke wraps every request with a per-request timeout', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-production-smoke.ts'
    )

    expectMarkersInOrder(source, [
      'const SMOKE_FETCH_TIMEOUT_MS = Number(',
      'process.env.MEXAS_SMOKE_FETCH_TIMEOUT_MS ?? 15_000',
      'async function smokeFetch',
      'signal: AbortSignal.timeout(SMOKE_FETCH_TIMEOUT_MS)',
      'Fetch ${path} failed after ${SMOKE_FETCH_TIMEOUT_MS}ms',
      'async function fetchText',
      'const response = await smokeFetch(path',
      'async function fetchManual',
      'const response = await smokeFetch(path',
      'async function checkRedirect',
      "const response = await smokeFetch(path, { redirect: 'manual' })",
      'async function checkBlockedApi',
      "const response = await smokeFetch(path, { redirect: 'manual' })",
    ])
    expect(countOccurrences(source, 'fetch(`${SITE_URL}${path}`')).toBe(1)
  })

  test('MEXAS market static props bypass legacy comments and related-market prefetches', () => {
    const source = readRepoFile('common/src/contract-params.ts')

    expect(source).toContain('import { isMexasOrderBookOnlyContract }')
    expectMarkersInOrder(source, [
      'function getMexasContractParams',
      'comments: []',
      'totalComments: 0',
      'relatedContracts: []',
      'chartAnnotations: []',
      'dashboards: []',
      'export async function getContractParams',
      'if (isMexasOrderBookOnlyContract(contract))',
      'return getMexasContractParams(contract)',
      'const contractSlug = contract.slug',
      'await Promise.all',
    ])
  })

  test('production smoke covers allowed MEXAS API endpoints and method guards', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-production-smoke.ts'
    )

    expectMarkersInOrder(source, [
      'async function checkBetsArray',
      '/api/v0/bets?contractId=mexwcwin26a&kinds=open-limit',
      'bets mexwcwin26a open-limit',
      '/api/v0/bets?contractSlug=ganara-mexico-la-copa-mundial-2026&kinds=open-limit',
      'bets mexico slug open-limit',
      'blocked bets unknown username',
      '/api/v0/bets?username=__mexas_missing_user__',
      'unknown api fail closed',
      '/api/v0/not-a-real-mexas-api',
    ])
    expectMarkersInOrder(source, [
      'async function checkExpectedStatus',
      'method bets POST',
      '/api/v0/bets',
      'method orderbook POST',
      '/api/mexas-order-book?contractId=mexwcwin26a',
      'method resolution readiness POST',
      '/api/v0/market/mexwcwin26a/mexas-resolution-readiness',
      'method bet GET',
      '/api/v0/bet',
      'method privy-user GET',
      '/api/privy-user',
      'auth privy-user POST',
      '/api/privy-user',
      'auth bet POST',
      'auth cancel POST',
      '/api/v0/bet/cancel/__missing_bet__',
      'auth resolve POST',
      '/api/v0/market/mexwcwin26a/resolve',
    ])
    expect(source).toContain("'Open options'")
  })

  test('production smoke covers public static discovery files', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-production-smoke.ts'
    )
    const sitemap = readRepoFile('web/public/sitemap.xml')
    const robots = readRepoFile('web/public/robots.txt')
    const opensearch = readRepoFile('web/public/opensearch.xml')
    const serverSitemap = readRepoFile('web/pages/server-sitemap.xml.tsx')
    const proxySource = readRepoFile('web/proxy.ts')
    const publicSurfaceSource = readRepoFile(
      'common/src/mexas-public-surface.ts'
    )

    expectMarkersInOrder(source, [
      'const STATIC_FILES = [',
      "path: '/sitemap.xml'",
      'https://mexas-manifold.vercel.app/checkout',
      "path: '/robots.txt'",
      'Host: https://mexas-manifold.vercel.app',
      "path: '/opensearch.xml'",
      '<ShortName>MEXAS</ShortName>',
      "path: '/testimonials/testimonials.json'",
      '"testimonials": []',
      'const BLOCKED_STATIC_PATHS = [...MEXAS_BLOCKED_PUBLIC_PATHS]',
      'async function checkStaticFile',
      'static legacy copy',
      'async function checkBlockedStaticFile',
      'blocked static',
      'for (const file of STATIC_FILES)',
      'await checkStaticFile(file.path, file.required)',
      'for (const path of BLOCKED_STATIC_PATHS)',
      'await checkBlockedStaticFile(path)',
    ])
    expect(proxySource).toContain("from 'common/mexas-public-surface'")
    expect(proxySource).toContain('isBlockedMexasPublicPath(url.pathname)')
    expect(proxySource).toContain('status: 404')
    expect(proxySource).toContain(
      "'/((?!_next/static|_next/image|favicon.ico).*)'"
    )
    for (const blockedPath of [
      "'/pairs-trader.html'",
      "'/mtg/index.html'",
      "'/custom-components/manaCoin.tsx'",
      "'/mana.svg'",
      "'/predictle-logo.png'",
    ]) {
      expect(publicSurfaceSource).toContain(blockedPath)
    }
    for (const file of [sitemap, robots, opensearch]) {
      expect(file).toContain('mexas-manifold.vercel.app')
      expect(file).not.toContain('manifold.markets')
      expect(file).not.toContain('Predictle')
      expect(file).not.toContain('Manifold')
    }
    expect(readRepoFile('web/public/testimonials/testimonials.json')).toBe(
      '{\n  "testimonials": []\n}\n'
    )
    for (const path of [
      'web/public/pairs-trader.html',
      'web/public/rps.html',
      'web/public/mtg/index.html',
      'web/public/mtg/jsons/set.json',
      'web/public/custom-components/manaCoin.tsx',
      'web/public/custom-components/manaFlatCoin.tsx',
      'web/public/mana.svg',
      'web/public/manaFlat.svg',
      'web/public/predictle-logo.png',
      'web/public/prize-drawing-og.png',
      'web/public/manachan.png',
      'web/public/buy-mana-graphics/10k.png',
      'web/public/welcome/manifold-example.gif',
    ]) {
      expect(existsSync(join(__dirname, '..', '..', path))).toBe(false)
    }
    expect(serverSitemap).toContain('import { MEXAS_SITE_URL }')
    expect(serverSitemap).toContain('loc: `${MEXAS_SITE_URL}/')
    expect(serverSitemap).not.toContain('https://manifold.markets/')
  })

  test('production smoke covers broad legacy API blockers', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-production-smoke.ts'
    )
    const apiSurfaceSource = readRepoFile('common/src/mexas-api-surface.ts')

    expect(source).toContain('MEXAS_BLOCKED_API_SMOKE_PATHS')
    expect(source).toContain(
      '...MEXAS_BLOCKED_API_SMOKE_PATHS.map((path) => `/api/${path}`)'
    )
    for (const path of [
      'v0/comment',
      'v0/comments',
      'v0/create-post-comment',
      'v0/purchase-boost',
      'v0/get-mana-supply',
      'v0/get-mana-summary-stats',
      'v0/manalink',
      'v0/claimmanalink',
      'v0/create-idenfy-session',
      'v0/get-verification-status-gidx',
      'v0/get-market-loan-max',
      'v0/market/mexwcwin26a/add-liquidity',
      'v0/market/mexwcwin26a/add-bounty',
      'v0/get-predictle-result',
      'v0/admin-create-sweepstakes',
      'v0/buy-sweepstakes-tickets',
      'v0/shop-purchase',
    ]) {
      expect(apiSurfaceSource).toContain(`'${path}'`)
    }
    expect(source).toContain(
      'Promise.all(BLOCKED_API_PATHS.map(checkBlockedApi))'
    )
  })

  test('renders order book remaining sizes from canonical filled amount', () => {
    const panelSource = readRepoFile(
      'web/components/contract/order-book-panel.tsx'
    )
    const checkoutSource = readRepoFile('web/pages/checkout.tsx')
    const midPriceHookSource = readRepoFile(
      'web/hooks/use-mexas-order-book-mid-price.ts'
    )
    const contractPriceSource = readRepoFile(
      'web/components/contract/contract-price.tsx'
    )
    const limitOrdersTableSource = readRepoFile(
      'web/components/bet/limit-orders-table.tsx'
    )
    const orderBookSource = readRepoFile('web/components/bet/order-book.tsx')
    const depthChartSource = readRepoFile(
      'web/components/charts/contract/depth-chart.tsx'
    )

    expect(panelSource).toContain('getMexasOpenOrderAmount')
    expect(panelSource).toContain("isBid ? 'Compras SÍ' : 'Ventas SÍ'")
    expect(panelSource).toContain("isBid ? 'Compra' : 'Venta'")
    expect(panelSource).not.toContain('sumBy(bet.fills')
    expectMarkersInOrder(midPriceHookSource, [
      'function remainingOrderAmount',
      '(order.orderAmount ?? 0) - (order.amount ?? 0)',
      'export function getMexasOrderBookMidPrice',
      "order.outcome === 'YES'",
      "order.outcome === 'NO'",
    ])
    expect(midPriceHookSource).not.toContain('fills?:')
    expect(midPriceHookSource).not.toContain('order.fills')
    expect(checkoutSource).toContain('useMexasOrderBookMidPrice')
    expect(contractPriceSource).toContain('useMexasOrderBookMidPrice')
    expect(contractPriceSource).toContain("'precio medio'")
    expectMarkersInOrder(limitOrdersTableSource, [
      'isMexasOrderBookOnlyContract(contract)',
      'getMexasOpenOrderAmount(bet)',
      'bet.orderAmount -',
      'bet.fills.reduce',
    ])
    expectMarkersInOrder(orderBookSource, [
      'isMexasOrderBookOnlyContract(contract)',
      'getMexasOpenOrderAmount(bet)',
      "displayToken = isMexasOrderBookOnlyContract(contract)\n    ? 'MEX'",
      'const filled = bet.isFilled || openAmount <= 1e-9',
      'amount={openAmount}',
      'token={displayToken}',
    ])
    expect(orderBookSource).toContain('const getOpenAmount = (bet: LimitBet)')
    expect(orderBookSource).toContain(
      'const total = sumBy(bets, getOpenAmount)'
    )
    expect(orderBookSource).toContain('amount={getOpenAmount(b)}')
    expectMarkersInOrder(depthChartSource, [
      "import { isMexasOrderBookOnlyContract } from 'common/mexas-market'",
      "import { getMexasOpenOrderAmount } from 'common/mexas-order-book'",
      'const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(contract)',
      'const yesData = cumulative(yesBets, isMexasOrderBookOnly)',
      'const openAmount = isMexasOrderBookOnly',
      '? getMexasOpenOrderAmount(bet)',
      ': bet.orderAmount - bet.amount',
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
      'await runOrderBookMaintenance(db, contractId)',
      ".from('contract_bets')",
      ".eq('data->>mexasFundsReserved', 'true')",
      ".eq('data->>mexasFundsReleased', 'false')",
    ])
    expect(source).toContain('const ORDER_BOOK_MAINTENANCE_TIMEOUT_MS = 750')
    expect(source).toContain('Promise.race')
    expect(source).toContain(
      'releaseClosedMexasMarketOrders(db, { contractId })'
    )
    expect(source).toContain('releaseExpiredMexasOrders(db, { contractId })')
    expect(source).toContain('releaseUnbackedMexasOrders(db, { contractId })')
  })

  test('serves public order book rows by best price-time per side, not newest rows', () => {
    const source = readRepoFile('web/pages/api/mexas-order-book.ts')

    expectMarkersInOrder(source, [
      'const ORDER_BOOK_PAGE_SIZE = 1000',
      'const MAX_ORDER_BOOK_ROWS = 5000',
      'function sortMexasSidePriceTime',
      "side === 'YES'",
      '(b.limitProb ?? 0) - (a.limitProb ?? 0)',
      ': (a.limitProb ?? 0) - (b.limitProb ?? 0)',
      'const timeDiff = (a.createdTime ?? 0) - (b.createdTime ?? 0)',
      'return a.id.localeCompare(b.id)',
      'function getBestOpenMexasOrders',
      "orders.filter((order) => order.outcome === 'YES')",
      "orders.filter((order) => order.outcome === 'NO')",
      'rows.map((row) => convertBet(row)).filter(isVisibleMexasLimitOrder)',
    ])
    expect(source).toContain(".order('created_time', { ascending: true })")
    expect(source).toContain(".order('bet_id', { ascending: true })")
    expect(source).not.toContain(".order('created_time', { ascending: false })")
    expect(source).not.toContain('.limit(limit)')
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
      'Taker MEXAS funds are not reserved',
      'Taker MEXAS funds are already released',
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

  test('SQL matcher idempotently credits any unused reserved MEX before marking filled order funds released', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )

    expectMarkersInOrder(source, [
      'v_taker_reserved_amount := coalesce',
      'v_taker_unused_refund := case',
      "v_taker_refund_credit_key := 'mexas-order-price-improvement:' || v_taker.bet_id",
      'select',
      'jsonb_typeof',
      "-> 'mexasBalanceCreditKeys'",
      "else '[]'::jsonb",
      'into v_taker_user_data, v_taker_user_credit_keys',
      'from public.users',
      'where id = v_taker.user_id',
      'for update',
      '? v_taker_refund_credit_key',
      'update public.users',
      'balance = round(balance + v_taker_unused_refund, 8)',
      'jsonb_set(',
      "'{mexasBalanceCreditKeys}'",
      'v_taker_user_credit_keys || to_jsonb(v_taker_refund_credit_key)',
      "'mexasReleaseCreditKey'",
      'v_taker_refund_credit_key',
      "'mexasReleaseReason'",
      "'price-improvement'",
      'update public.contract_bets',
      'amount = v_taker_amount',
    ])
    expectMarkersInOrder(source, [
      'v_maker_reserved_amount := coalesce',
      'v_maker_unused_refund := case',
      "v_maker_refund_credit_key := 'mexas-order-price-improvement:' || v_maker.bet_id",
      'select',
      'jsonb_typeof',
      "-> 'mexasBalanceCreditKeys'",
      "else '[]'::jsonb",
      'into v_maker_user_data, v_maker_user_credit_keys',
      'from public.users',
      'where id = v_maker.user_id',
      'for update',
      '? v_maker_refund_credit_key',
      'update public.users',
      'balance = round(balance + v_maker_unused_refund, 8)',
      'jsonb_set(',
      "'{mexasBalanceCreditKeys}'",
      'v_maker_user_credit_keys || to_jsonb(v_maker_refund_credit_key)',
      'v_maker_refund_credit_key',
      'update public.contract_bets',
      'amount = v_maker_amount',
    ])
    expect(source).not.toContain(
      'set balance = round(balance + v_taker_unused_refund, 8)'
    )
    expect(source).not.toContain(
      'set balance = round(balance + v_maker_unused_refund, 8)'
    )
  })

  test('SQL matcher refreshes wallet open reserved amounts after maker and taker fills', () => {
    const source = readRepoFile(
      'backend/supabase/migrations/2026060202_add_mexas_rpc_matching.sql'
    )

    expectMarkersInOrder(source, [
      'v_taker_open_reserved_amount numeric',
      'v_maker_open_reserved_amount numeric',
      'update public.contract_bets',
      'returning *',
      'into v_maker',
      'into v_maker_open_reserved_amount',
      'where\n      b.user_id = v_maker.user_id',
      "'{mexasWalletOpenReservedAmount}'",
      'to_jsonb(v_maker_open_reserved_amount)',
      'where id = v_maker.user_id',
    ])
    expectMarkersInOrder(source, [
      'update public.contract_bets',
      'returning *',
      'into v_taker',
      'into v_taker_open_reserved_amount',
      'where\n    b.user_id = v_taker.user_id',
      "'{mexasWalletOpenReservedAmount}'",
      'to_jsonb(v_taker_open_reserved_amount)',
      'where id = v_taker.user_id',
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

  test('preflights the MEXAS matching RPC before live orders can debit funds', () => {
    const source = readRepoFile('web/lib/api/mexas-settlement.ts')
    const apiSource = readRepoFile('web/pages/api/v0/bet.ts')
    const readinessSource = readRepoFile(
      'web/pages/api/v0/market/[contractId]/mexas-order-readiness.ts'
    )
    const panelSource = readRepoFile('web/components/bet/limit-order-panel.tsx')
    const hookSource = readRepoFile('web/hooks/use-mexas-order-readiness.ts')
    const orderBookPanelSource = readRepoFile(
      'web/components/contract/order-book-panel.tsx'
    )
    const proxySource = readRepoFile('web/proxy.ts')
    const smokeSource = readRepoFile(
      'backend/scripts/check-mexas-production-smoke.ts'
    )
    const helper = readRepoFile('web/lib/api/mexas-rpc-matching.ts')
    const migration = readRepoFile(
      'backend/supabase/migrations/2026060203_add_mexas_matching_health.sql'
    )

    expectMarkersInOrder(source, [
      'export async function assertMexasCanAcceptLimitOrders',
      'canMexasAcceptLimitOrders(getMexasSettlementSettings())',
      'No se pueden abrir órdenes MEXAS en este momento.',
    ])
    expectMarkersInOrder(source, [
      'export async function assertMexasCanMatchCrossingOrders',
      'canMexasMatchCrossingOrders(getMexasSettlementSettings())',
      'await assertMexasOrderbookMatchingEngineReady(db)',
    ])
    expectMarkersInOrder(apiSource, [
      'if (params.dryRun)',
      'return res.status(200).json',
      'await assertMexasCanAcceptLimitOrders(db)',
      'reservedAmount = getMexasRemainingReservedAmount(bet)',
      'await updateUserBalanceCas(db, userId, -reservedAmount',
    ])
    expectMarkersInOrder(readinessSource, [
      'type MexasOrderReadinessResponse',
      'canPlaceOrders: boolean',
      'matchingEngineReady: boolean',
      'escrowImplementation: process.env.MEXAS_ESCROW_IMPLEMENTATION',
      'matchingEngineMode: process.env.MEXAS_MATCHING_ENGINE_MODE',
      'settlementMode: process.env.MEXAS_SETTLEMENT_MODE',
      'if (!isMexasOrderBookOnlyContract(contract))',
      'const settings = getMexasSettlementSettings()',
      'canMexasAcceptLimitOrders(settings)',
      'canMexasMatchCrossingOrders(settings)',
      'await assertMexasOrderbookMatchingEngineReady(db)',
      'canPlaceOrders: true',
      'matchingEngineReady: true',
      'canPlaceOrders: true',
      'matchingEngineReady: false',
      'Puedes abrir órdenes límite que agreguen liquidez.',
    ])
    expectMarkersInOrder(panelSource, [
      'const mexasOrderReadiness = useMexasOrderReadiness(',
      'contract.id',
      'const mexasOrderReadinessLoading =',
      'const mexasOrderReadinessBlocked =',
      'mexasOrderReadinessBlocked',
      'Las nuevas órdenes están pausadas mientras se completa la liquidación MEXAS.',
      'mexasOrderReadinessLoading',
      'Verificando libro...',
      'mexasOrderReadinessBlocked',
      'Órdenes pausadas',
    ])
    expectMarkersInOrder(hookSource, [
      'export type MexasOrderReadiness',
      'MEXAS_ORDER_READINESS_FALLBACK',
      'mexas-order-readiness',
      'canPlaceOrders: false',
      'matchingEngineReady: false',
    ])
    expectMarkersInOrder(orderBookPanelSource, [
      'useMexasOrderReadiness(contract.id, orderBookOnly)',
      'const ordersPaused =',
      'const matchingPaused =',
      'Nuevas órdenes pausadas mientras se completa la liquidación MEXAS.',
      'no se',
      'reservará MEX nuevo.',
      'Puedes abrir órdenes límite que agreguen liquidez.',
      'cruzan el libro están pausadas',
    ])
    expect(proxySource).toContain(
      '^v0\\/market\\/[^/]+\\/mexas-order-readiness$'
    )
    expectMarkersInOrder(smokeSource, [
      'async function checkOrderReadiness',
      '/mexas-order-readiness',
      'typeof data.canPlaceOrders ===',
      'typeof data.matchingEngineReady ===',
      "results.push(await checkOrderReadiness('mexwcwin26a'))",
      "results.push(await checkOrderReadiness('ukrwarend26a'))",
      "results.push(await checkBlockedOrderReadiness('not-a-mexas-market'))",
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
      'if (latestTaker) return latestTaker',
    ])
    expect(helper).not.toContain(
      'MEXAS matching engine reached the maximum matching passes for one order.'
    )
  })

  test('prints self-verifying launch SQL for manual Supabase SQL Editor runs', () => {
    const source = readRepoFile('backend/scripts/apply-mexas-launch-sql.ts')
    const compact = compactWhitespace(source)

    expect(source).toContain('function wrapSqlForManualRun')
    expect(source).toContain('verification errors roll back all DDL')
    expect(source).toContain('begin;')
    expect(source).toContain('commit;')
    expectMarkersInOrder(source, [
      "if (process.argv.includes('--print-sql'))",
      'console.log(wrapSqlForManualRun(sql))',
      'return',
      "await client.query('begin')",
      'await client.query(sql)',
      "await client.query('commit')",
    ])
    expect(source).toContain(
      '-- Verification block for manual Supabase SQL Editor runs'
    )
    expect(source).toContain(
      "raise exception 'MEXAS launch SQL verification failed: %'"
    )
    expect(source).toContain("where token = 'MEX'")
    expect(source).toContain("or data ->> 'token' = 'MEX'")
    expect(source).toContain("'contract token mismatch '")
    expect(source).toContain(
      '-- MEX. Keep every data-tokened MEX row and normalized SQL column aligned.'
    )
    expectMarkersInOrder(source, [
      'update public.contracts',
      "set token = 'MEX'",
      "where data ->> 'token' = 'MEX'",
      "and token <> 'MEX'",
    ])
    expect(source).toContain(
      "raise notice 'PASS MEXAS launch SQL applied and verified.'"
    )
    expect(source).toContain(
      'public.mexas_orderbook_matching_engine_ready() is distinct from true'
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

    expect(source).toContain("'/((?!_next/static|_next/image|favicon.ico).*)'")
    expect(source).not.toContain("'/api/v0/:path*'")
    expectMarkersInOrder(source, [
      'if (isBlockedMexasPublicPath(url.pathname))',
      'return NextResponse.json(MEXAS_API_UNAVAILABLE_RESPONSE, { status: 404 })',
      "if (url.pathname.startsWith('/api/'))",
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

  test('launch readiness runs the backend API compile gate', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expectMarkersInOrder(source, [
      'function checkBackendApiCompile',
      "'corepack'",
      "'yarn'",
      "'--cwd'",
      "'backend/api'",
      "'compile'",
      "COREPACK_ENABLE_STRICT: '0'",
      "return pass('backend API compile'",
      "return fail(\n      'backend API compile'",
      'checks.push(checkBackendApiCompile())',
    ])
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
    expect(source).toContain('contracts_token_check still needs the launch SQL')
    expect(source).toContain('RPC/index DDL require Postgres SQL access')
  })

  test('launch readiness fails any MEXAS contract token mismatch', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('type MexasContractTokenAlignmentRow')
    expect(source).toContain(
      'async function loadMexasContractTokenAlignmentRows'
    )
    expect(source).toContain('async function checkMexasContractTokenAlignment')
    expectMarkersInOrder(source, [
      'async function loadMexasContractTokenAlignmentRows',
      ".contains('data', { token: 'MEX' } as any)",
      ".eq('token', 'MEX')",
      'const mismatches = rows.filter',
      "fail(\n          'MEXAS contract token alignment'",
      'Run apply:mexas-launch-sql so every data-tokened MEX contract has contracts.token=MEX.',
    ])
    expectMarkersInOrder(source, [
      'const tokenAlignment = await checkMexasContractTokenAlignment(db)',
      'if (tokenAlignment.needsLaunchSql) needsLaunchSql = true',
      'checks.push(tokenAlignment.result)',
      'checks.push(await checkNoUnsafeOpenMexasOrders(db))',
    ])
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
      'checks.push(await checkOpenMexasOrderBacking(db))',
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
      'checks.push(await checkNoUnsafeOpenMexasOrders(db))',
      'checks.push(await checkNoMexasMarketLocks(db))',
      'checks.push(await checkOpenMexasOrderBacking(db))',
    ])
    expect(source).toContain('funds not reserved')
    expect(source).toContain('funds already released')
    expect(source).toContain('funds release flag missing')
  })

  test('launch readiness fails unresolved MEXAS markets with lock residue', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('type MexasMarketLockIssue')
    expect(source).toContain('const ORDER_LOCK_TIMEOUT_MS = 2 * 60 * 1000')
    expect(source).toContain(
      'const RESOLUTION_LOCK_TIMEOUT_MS = 10 * 60 * 1000'
    )
    expectMarkersInOrder(source, [
      'async function loadOpenMexasContractRows',
      'const contractIds = await loadOpenMexasOrderbookContractIds(db)',
      ".from('contracts')",
      ".select('*')",
      'function getMexasMarketLockIssues',
      'data.mexasOrderLock === true',
      'data.mexasResolving === true',
      'async function checkNoMexasMarketLocks',
      'const issues = rows.flatMap(getMexasMarketLockIssues)',
      "fail(\n        'market lock residue'",
      "pass(\n      'market lock residue'",
      'checks.push(await checkNoMexasMarketLocks(db))',
    ])
    expect(source).toContain('formatLockAge')
    expect(source).toContain('fresh')
    expect(source).toContain('stale')
    expect(source).toContain('mexasOrderLockOwner')
    expect(source).toContain('mexasResolvingOutcome')
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
    const compact = compactWhitespace(source)

    expect(source).toContain('async function checkMexasSettlementExposure')
    expectMarkersInOrder(source, [
      'async function loadOpenMexasOrderbookContractIds',
      'const contractIds = await loadMexasOrderbookContractIds(db)',
      ".is('resolution_time', null)",
      'async function checkMexasSettlementExposure',
      'const rowsByContractId = rows.reduce',
      'const audit = getMexasSettlementAudit(rows.map((row) => convertBet(row)))',
      'filledContractAudit',
      'contractExposureDetails',
      'if (audit.filledBetCount === 0)',
      'if (!options.hasOperationalEscrow)',
      'filled MEXAS positions require escrow before resolution payouts',
      'Filled-market credit exposure',
      'Open reservation refunds across all unresolved MEXAS markets',
      'Markets:',
      'await checkMexasSettlementExposure(supabaseDb, { hasOperationalEscrow })',
    ])
    expect(source).toContain('YES ${filledContractAudit.yesCredit} MEX')
    expect(source).toContain('NO ${filledContractAudit.noCredit} MEX')
    expect(source).toContain('CANCEL ${filledContractAudit.cancelCredit} MEX')
    expect(compact).toContain(
      'Open reservation refunds across all unresolved MEXAS markets: ${ audit.openReservationRefund } MEX'
    )
    expect(source).toContain(
      'COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts audit:mexas-settlement'
    )
    expect(source).toContain(
      'COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts audit:mexas-test-unwind'
    )
    expect(source).toContain(
      'COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts print:mexas-test-unwind-sql > /tmp/mexas-test-unwind.sql'
    )
    expect(source).toContain('transaction-wrapped SQL path')
    expect(source).toContain('change rollback to commit only after review')
    expect(source).toContain('REST unwind script remains available for dry-run')
  })

  test('provides read-only and confirmed test-unwind MEXAS settlement scripts', () => {
    const packageJson = readRepoFile('backend/scripts/package.json')
    const source = readRepoFile('backend/scripts/audit-mexas-settlement.ts')
    const unwindSource = readRepoFile(
      'backend/scripts/unwind-mexas-test-exposure.ts'
    )

    expect(packageJson).toContain('"audit:mexas-settlement"')
    expect(packageJson).toContain('"audit:mexas-test-unwind"')
    expect(packageJson).toContain('"apply:mexas-test-unwind"')
    expect(packageJson).toContain('"print:mexas-test-unwind-sql"')
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
    expect(source).toContain('Commands:')
    expect(source).toContain(
      'COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts audit:mexas-settlement'
    )
    expect(source).toContain(
      'COREPACK_ENABLE_STRICT=0 corepack yarn --cwd backend/scripts print:mexas-test-unwind-sql > /tmp/mexas-test-unwind.sql'
    )
    expect(source).toContain(
      'It ends with rollback; change that to commit only after manual review.'
    )
    expect(source).toContain('-- MEXAS TEST-ONLY FILLED EXPOSURE UNWIND SQL')
    expect(source).toContain('The transaction ends with ROLLBACK by default')
    expect(source).toContain(
      'v_credit_amount numeric := ${sqlNumber(bet.cancelCredit)}'
    )
    expect(source).toContain(
      "when jsonb_typeof(v_user_data -> 'mexasBalanceCreditKeys') = 'array'"
    )
    expect(source).toContain("'mexasBalanceCreditKeys'")
    expect(source).toContain("'mexasTestUnwound', true")
    expect(source).toContain('rollback;')
    expect(source).not.toContain('.update(')
    expect(source).not.toContain('.insert(')
    expect(source).not.toContain('.delete(')
    expect(source).not.toContain('.rpc(')
    expectMarkersInOrder(source, [
      'if (printUnwindSql)',
      'printTestUnwindSql(exposures)',
      'return',
      '} else if (json)',
      'if (exposures.length) process.exitCode = 1',
    ])
    expectMarkersInOrder(unwindSource, [
      "const TEST_UNWIND_CONTRACT_IDS = ['ukrwarend26a'] as const",
      "const apply = process.argv.includes('--apply')",
      "const confirmed = process.argv.includes('--confirm-test-unwind')",
      'printPlan(exposures)',
      'if (!apply)',
      'Dry run only. Pass --apply --confirm-test-unwind to modify data.',
      'if (!confirmed)',
      "throw new Error('Refusing to apply without --confirm-test-unwind.')",
    ])
    expectMarkersInOrder(unwindSource, [
      'await updateMexasUserBalanceCas(db, exposure.userId, exposure.cancelCredit',
      'creditKey',
      ".from('contract_bets')",
      '.update({',
      'mexasTestUnwound: true',
      ".eq('updated_time', current.row.updated_time)",
    ])
    expect(unwindSource).not.toContain('delete()')
    expect(unwindSource).not.toContain('rpc(')
  })

  test('launch readiness cannot be passed by setting the escrow env before escrow code exists', () => {
    const source = readRepoFile(
      'backend/scripts/check-mexas-launch-readiness.ts'
    )

    expect(source).toContain('getMissingMexasEscrowCapabilities')
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

  test('legacy MEXAS treasury purchase endpoint fails closed', () => {
    const source = readRepoFile('backend/api/src/record-mexas-purchase.ts')
    const tokenSource = readRepoFile('common/src/crypto/mexas.ts')

    expectMarkersInOrder(source, [
      "export const recordMexasPurchase: APIHandler<'record-mexas-purchase'>",
      'throw new APIError(',
      '404',
      'Deposit MEX directly to your Privy Wallet.',
    ])
    expect(source).not.toContain('runTxnInBetQueue')
    expect(source).not.toContain('MANA_PURCHASE')
    expect(source).not.toContain('purchasedMana')
    expect(source).not.toContain('crypto_payment_intents')
    expect(tokenSource).not.toContain('MEXAS_ACCOUNT_CREDIT_PER_TOKEN')
    expect(tokenSource).not.toContain('getMexasPurchaseMessage')
    expect(tokenSource).not.toContain('Authorize MEXAS account credit')
  })

  test('backend API Privy auth does not depend on broken SDK declaration files', () => {
    const source = readRepoFile('backend/api/src/helpers/endpoint.ts')

    expect(source).not.toContain("import { PrivyClient } from '@privy-io/node'")
    expectMarkersInOrder(source, [
      'type PrivyVerifiedAccessToken =',
      'type PrivyClientLike =',
      'type PrivyClientConstructor =',
      "const { PrivyClient } = require('@privy-io/node') as",
      'let privyClient: PrivyClientLike | undefined',
      'verifyAccessToken(payload)',
    ])
  })
})
