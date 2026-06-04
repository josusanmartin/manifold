import { useEffect, useState } from 'react'

export type MexasOrderReadiness = {
  canPlaceOrders: boolean
  escrowCaptureEnabled: boolean
  matchingEngineReady: boolean
  message?: string
}

const MEXAS_ORDER_READINESS_FALLBACK =
  'No se pudo verificar el estado del libro de órdenes MEXAS.'

export async function fetchMexasOrderReadiness(contractId: string) {
  const response = await fetch(
    `/api/v0/market/${encodeURIComponent(contractId)}/mexas-order-readiness`
  )
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.message ?? MEXAS_ORDER_READINESS_FALLBACK)
  }
  return data as MexasOrderReadiness
}

export function useMexasOrderReadiness(contractId: string, enabled: boolean) {
  const [readiness, setReadiness] = useState<
    | {
        contractId: string
        value: MexasOrderReadiness
      }
    | undefined
  >()

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    fetchMexasOrderReadiness(contractId)
      .then((data) => {
        if (!cancelled) setReadiness({ contractId, value: data })
      })
      .catch((error) => {
        if (cancelled) return
        setReadiness({
          contractId,
          value: {
            canPlaceOrders: false,
            escrowCaptureEnabled: false,
            matchingEngineReady: false,
            message:
              error instanceof Error
                ? error.message
                : MEXAS_ORDER_READINESS_FALLBACK,
          },
        })
      })

    return () => {
      cancelled = true
    }
  }, [contractId, enabled])

  return enabled && readiness?.contractId === contractId
    ? readiness.value
    : undefined
}
