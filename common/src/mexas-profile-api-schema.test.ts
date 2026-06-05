import { API } from './api/schema'

describe('MEXAS profile API schema', () => {
  test('accepts Privy creator ids on MEXAS market search requests', () => {
    const props = API['search-markets-full'].props.parse({
      creatorId: 'did:privy:cmpu5pabd00040cl429wyvwgc',
      contractType: 'BINARY',
      filter: 'all',
      limit: '50',
      mexasOnly: 'true',
      sort: 'newest',
    })

    expect(props.creatorId).toBe('did:privy:cmpu5pabd00040cl429wyvwgc')
    expect(props.mexasOnly).toBe(true)
  })

  test('accepts MEXAS open-order profile refresh cache keys', () => {
    const props = API['get-user-limit-orders-with-contracts'].props.parse({
      count: '100',
      includeCancelled: 'false',
      includeExpired: 'false',
      includeFilled: 'false',
      mexasOnly: 'true',
      refreshKey: '3',
      userId: 'did:privy:cmpu5pabd00040cl429wyvwgc',
    })

    expect(props.mexasOnly).toBe(true)
    expect(props.refreshKey).toBe(3)
  })

  test('accepts MEXAS profile position query parameters', () => {
    const props = API['get-user-contract-metrics-with-contracts'].props.parse({
      limit: '50',
      mexasOnly: 'true',
      offset: '0',
      order: 'lastBetTime',
      userId: 'did:privy:cmpu5pabd00040cl429wyvwgc',
    })

    expect(props.mexasOnly).toBe(true)
    expect(props.userId).toBe('did:privy:cmpu5pabd00040cl429wyvwgc')
  })
})
