import { useEffect, useState } from 'react'

export type MexasOrderReadiness = {
  canPlaceOrders: boolean
  escrowCaptureEnabled: boolean
  matchingEngineReady: boolean
  message?: string
}

const MEXAS_ORDER_READINESS_FALLBACK =
  'No se pudo verificar el estado del libro de órdenes MEXAS.'

export function useMexasOrderReadiness(contractId: string, enabled: boolean) {
  const [readiness, setReadiness] = useState<MexasOrderReadiness | undefined>()

  useEffect(() => {
    if (!enabled) {
      setReadiness(undefined)
      return
    }

    let cancelled = false
    setReadiness(undefined)

    fetch(
      `/api/v0/market/${encodeURIComponent(contractId)}/mexas-order-readiness`
    )
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.message ?? MEXAS_ORDER_READINESS_FALLBACK)
        }
        return data as MexasOrderReadiness
      })
      .then((data) => {
        if (!cancelled) setReadiness(data)
      })
      .catch((error) => {
        if (cancelled) return
        setReadiness({
          canPlaceOrders: false,
          escrowCaptureEnabled: false,
          matchingEngineReady: false,
          message:
            error instanceof Error
              ? error.message
              : MEXAS_ORDER_READINESS_FALLBACK,
        })
      })

    return () => {
      cancelled = true
    }
  }, [contractId, enabled])

  return readiness
}
