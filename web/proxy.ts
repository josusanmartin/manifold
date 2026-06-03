import { PROD_CONFIG } from 'common/envs/prod'
import {
  isAllowedMexasApiProxyPath,
  isBlockedMexasApiProxyPath,
} from 'common/mexas-api-surface'
import { NextResponse, type NextRequest } from 'next/server'

const MEXAS_API_UNAVAILABLE_RESPONSE = {
  message: 'Endpoint not available on MEXAS Markets.',
}

export async function proxy(req: NextRequest) {
  const url = req.nextUrl

  // Handle play parameter removal for all requests
  if (url.searchParams.has('play')) {
    const playValue = url.searchParams.get('play')
    url.searchParams.delete('play')

    if (playValue === 'false') {
      // Redirect to path with --cash suffix and no query parameters
      const newUrl = new URL(url.pathname + '--cash', url.origin)
      return NextResponse.redirect(newUrl, 308)
    } else {
      return NextResponse.redirect(url, 308)
    }
  }

  // Only run API proxy logic for API requests
  if (url.pathname.startsWith('/api/')) {
    const path = req.nextUrl.pathname.replace('/api/', '')

    if (shouldSkipProxy(path)) {
      return NextResponse.next()
    }

    if (isBlockedMexasApiProxyPath(path)) {
      return NextResponse.json(MEXAS_API_UNAVAILABLE_RESPONSE, { status: 404 })
    }

    if (!isAllowedMexasApiProxyPath(path)) {
      return NextResponse.json(MEXAS_API_UNAVAILABLE_RESPONSE, { status: 404 })
    }

    return new Response('Permanent Redirect', {
      status: 308,
      headers: {
        location: getProxiedRequestUrl(req, path),
      },
    })
  }

  // For non-API requests, just continue normally
  return NextResponse.next()
}

export const config = {
  matcher: [
    // API proxy
    '/api/:path*',
    // Contract pages - be specific about the format
    // This matches /username/contract-slug but not / or /browse etc
    '/([^/]+)/([^/]+)',
    // Embed pages
    '/embed/([^/]+)/([^/]+)',
  ],
}

const pathsToSkip = [
  'mexas-order-book',
  'privy-user',
  'v0/bet',
  'v0/bets',
  'v0/revalidate',
]

function shouldSkipProxy(path: string) {
  if (/^v0\/market\/[^/]+\/resolve$/.test(path)) return true
  if (/^v0\/market\/[^/]+\/mexas-resolution-readiness$/.test(path)) {
    return true
  }
  if (/^v0\/market\/[^/]+\/mexas-order-readiness$/.test(path)) {
    return true
  }

  return pathsToSkip.some((skipPath) => {
    return path === skipPath || path.startsWith(`${skipPath}/`)
  })
}

function getProxiedRequestUrl(req: NextRequest, path: string) {
  const baseUrl = getApiUrl(path)
  const [_prefix, qs] = req.url!.split('?', 2)
  if (qs) {
    return baseUrl + '?' + qs
  } else {
    return baseUrl
  }
}

// copied from common/src/utils/api. TODO the right thing
function getApiUrl(path: string) {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return `${formatApiBaseUrl(process.env.NEXT_PUBLIC_API_URL)}/${path}`
  } else {
    const { apiEndpoint } = PROD_CONFIG
    return `https://${apiEndpoint}/${path}`
  }
}

function formatApiBaseUrl(apiUrl: string) {
  const trimmed = apiUrl.replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return `http://${trimmed}`
}
