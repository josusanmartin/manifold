import { readFileSync } from 'fs'
import { join } from 'path'

function readRepoFile(path: string) {
  return readFileSync(join(__dirname, '..', '..', path), 'utf8')
}

function countOccurrences(source: string, marker: string) {
  return source.split(marker).length - 1
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

  test('keeps live crossing matches blocked until a transactional MEXAS engine exists', () => {
    const source = readRepoFile('common/src/mexas-settlement.ts')

    expectMarkersInOrder(source, [
      'export function hasTransactionalMexasMatchingEngine',
      'return false',
      'export function canMexasMatchCrossingOrders',
    ])
  })
})
