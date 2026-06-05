import { useEffect } from 'react'
import { getWebsocketUrl, isMexasBrowserHostname } from 'common/api/utils'
import { ServerMessage } from 'common/api/websockets'
import { APIRealtimeClient } from 'common/api/websocket-client'

function isMexasHostUrl(url: string) {
  try {
    const normalized = /^(https?|wss?):\/\//.test(url) ? url : `https://${url}`
    return isMexasBrowserHostname(new URL(normalized).hostname)
  } catch {
    return false
  }
}

function isMexasConfiguredApiUrl() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  return apiUrl ? isMexasHostUrl(apiUrl) : false
}

function isMexasWebsocketUrl() {
  return isMexasHostUrl(getWebsocketUrl())
}

const shouldDisableRealtimeClient =
  typeof window !== 'undefined' &&
  (isMexasBrowserHostname(window.location.hostname) ||
    isMexasConfiguredApiUrl() ||
    isMexasWebsocketUrl())

const client =
  typeof window !== 'undefined' && !shouldDisableRealtimeClient
    ? new APIRealtimeClient(getWebsocketUrl())
    : undefined

export type SubscriptionOptions = {
  topics: string[]
  onBroadcast: (msg: ServerMessage<'broadcast'>) => void
  onError?: (err: Error) => void
  enabled?: boolean
}

export function useApiSubscription(opts: SubscriptionOptions) {
  useEffect(() => {
    const ws = client
    if (ws != null && (opts.enabled ?? true)) {
      ws.subscribe(opts.topics, opts.onBroadcast).catch(opts.onError)
      return () => {
        ws.unsubscribe(opts.topics, opts.onBroadcast).catch(opts.onError)
      }
    }
  }, [opts.enabled, JSON.stringify(opts.topics)])
}
