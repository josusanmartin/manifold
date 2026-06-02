import { isBlockedMexasApiProxyPath } from './mexas-api-surface'

describe('MEXAS public API surface', () => {
  test.each([
    'v0/comment',
    'v0/comments',
    'v0/comment-thread',
    'v0/comment-threads',
    'v0/comment-reactions',
    'v0/create-post-comment',
    'v0/edit-comment',
    'v0/hide-comment',
    'v0/pin-comment',
    'v0/record-comment-view',
    'v0/user-comments',
    'v0/purchase-boost',
    'v0/remove-boost',
    'v0/get-boost-history',
    'v0/get-boost-analytics',
    'v0/managram',
    'v0/managrams',
    'v0/manalink',
    'v0/claimmanalink',
    'v0/get-mana-supply',
    'v0/get-mana-summary-stats',
    'v0/get-active-user-mana-stats',
    'v0/convert-cash-to-mana',
    'v0/convert-sp-to-mana',
    'v0/create-idenfy-session',
    'v0/get-idenfy-status',
    'v0/get-verification-status-gidx',
    'v0/get-verification-documents-gidx',
    'v0/get-monitor-status-gidx',
    'v0/register-gidx',
    'v0/upload-document-gidx',
    'v0/get-predictle-result',
    'v0/save-predictle-result',
    'v0/admin-create-sweepstakes',
    'v0/buy-sweepstakes-tickets',
    'v0/claim-free-sweepstakes-ticket',
    'v0/claim-sweepstakes-prize',
    'v0/select-sweepstakes-winners',
    'v0/shop-purchase',
  ])('blocks legacy endpoint %s', (path) => {
    expect(isBlockedMexasApiProxyPath(path)).toBe(true)
  })

  test.each([
    'v0/bet',
    'v0/bets',
    'v0/deployment-id',
    'v0/market/mexwcwin26a/resolve',
    'v0/revalidate',
    'v0/user/by-id/example',
    'v0/search-markets-full',
    'v0/txns',
  ])('allows non-legacy endpoint %s', (path) => {
    expect(isBlockedMexasApiProxyPath(path)).toBe(false)
  })
})
