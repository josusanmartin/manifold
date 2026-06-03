import {
  getApiUrl,
  getWebsocketUrl,
  isMexasBrowserHostname,
} from './api/utils'

describe('MEXAS API URL routing', () => {
  const originalWindow = globalThis.window
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as any).window
    } else {
      ;(globalThis as any).window = originalWindow
    }
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl
    }
  })

  test('recognizes production and preview MEXAS Vercel hosts', () => {
    expect(isMexasBrowserHostname('mexas-manifold.vercel.app')).toBe(true)
    expect(
      isMexasBrowserHostname(
        'mexas-manifold-k57uluuie-james-altertop-s-projects.vercel.app'
      )
    ).toBe(true)
    expect(isMexasBrowserHostname('manifold.markets')).toBe(false)
    expect(isMexasBrowserHostname('api.manifold.markets')).toBe(false)
  })

  test('routes MEXAS browser API calls to the local Next API surface', () => {
    delete process.env.NEXT_PUBLIC_API_URL
    ;(globalThis as any).window = {
      location: {
        hostname:
          'mexas-manifold-k57uluuie-james-altertop-s-projects.vercel.app',
        origin:
          'https://mexas-manifold-k57uluuie-james-altertop-s-projects.vercel.app',
      },
    }

    expect(getApiUrl('bets')).toBe(
      'https://mexas-manifold-k57uluuie-james-altertop-s-projects.vercel.app/api/v0/bets'
    )
    expect(getWebsocketUrl()).toBe(
      'wss://mexas-manifold-k57uluuie-james-altertop-s-projects.vercel.app/ws'
    )
  })

  test('does not override an explicit local API URL', () => {
    process.env.NEXT_PUBLIC_API_URL = 'localhost:8088'
    ;(globalThis as any).window = {
      location: {
        hostname: 'mexas-manifold.vercel.app',
        origin: 'https://mexas-manifold.vercel.app',
      },
    }

    expect(getApiUrl('bets')).toBe('http://localhost:8088/v0/bets')
    expect(getWebsocketUrl()).toBe('ws://localhost:8088/ws')
  })
})
