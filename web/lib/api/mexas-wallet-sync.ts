import { getMexasTotalDepositsAfterWalletSync } from 'common/mexas-wallet'
import type { SupabaseClient } from 'common/supabase/utils'
import { normalizeEvmAddress } from 'common/crypto/mexas-transfer'

type MexasWalletSyncDepositParams = {
  currentTotalDeposits: number
  db: SupabaseClient
  previousSyncTimeMs?: number
  walletAddress: string
  walletDeltaAmount: number
}

export function getMexasWalletSyncTimeMs(data: Record<string, unknown>) {
  const raw = data.mexasWalletBalanceSyncedTime
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)
  return undefined
}

function roundMexasAmount(amount: number) {
  return Math.round(amount * 1e8) / 1e8
}

function getConfirmedAfterIso(previousSyncTimeMs: number | undefined) {
  if (
    previousSyncTimeMs === undefined ||
    !Number.isFinite(previousSyncTimeMs) ||
    previousSyncTimeMs <= 0
  ) {
    return undefined
  }

  return new Date(previousSyncTimeMs).toISOString()
}

async function getConfirmedTreasuryWalletInflowAmount(params: {
  db: SupabaseClient
  previousSyncTimeMs?: number
  walletAddress: string
}) {
  let recipientAddress: string
  try {
    recipientAddress = normalizeEvmAddress(params.walletAddress)
  } catch {
    return 0
  }

  let query = params.db
    .from('mexas_treasury_transfers')
    .select('amount')
    .eq('status', 'confirmed')
    .eq('recipient_address', recipientAddress)
    .not('confirmed_time', 'is', null)

  const confirmedAfterIso = getConfirmedAfterIso(params.previousSyncTimeMs)
  if (confirmedAfterIso) {
    query = query.gt('confirmed_time', confirmedAfterIso)
  }

  const { data, error } = await query
  if (error) throw error

  return roundMexasAmount(
    (data ?? []).reduce((total, row) => total + (row.amount ?? 0), 0)
  )
}

export async function getMexasTotalDepositsAfterObservedWalletSync(
  params: MexasWalletSyncDepositParams
) {
  if (params.walletDeltaAmount <= 0) return params.currentTotalDeposits

  const treasuryWalletInflowAmount =
    await getConfirmedTreasuryWalletInflowAmount({
      db: params.db,
      previousSyncTimeMs: params.previousSyncTimeMs,
      walletAddress: params.walletAddress,
    })

  return getMexasTotalDepositsAfterWalletSync({
    currentTotalDeposits: params.currentTotalDeposits,
    treasuryWalletInflowAmount,
    walletDeltaAmount: params.walletDeltaAmount,
  })
}
