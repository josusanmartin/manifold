import { useEffect } from 'react'
import { track } from 'web/lib/service/analytics'
import { inIframe } from './use-is-iframe'
import { useIsAuthorized } from './use-user'

export const useTracking = (
  eventName: string,
  eventProperties?: any,
  excludeIframe?: boolean,
  extraDeps?: any[],
  enabled = true
) => {
  const isAuthed = useIsAuthorized()
  useEffect(() => {
    if (!enabled) return
    if (isAuthed === undefined) return
    if (excludeIframe && inIframe()) return
    track(eventName, eventProperties)
  }, [enabled, isAuthed, eventName, excludeIframe, ...(extraDeps ?? [])])
}
