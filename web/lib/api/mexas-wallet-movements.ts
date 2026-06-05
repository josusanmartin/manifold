import { getNewBetId } from 'common/bet'
import { MEXAS_TOKEN } from 'common/crypto/mexas'
import type { SupabaseClient, Tables } from 'common/supabase/utils'
import { isAddress } from 'viem'

type MovementType = 'deposit' | 'withdrawal'

type RecordMexasWalletMovementParams = {
  amount: number
  deltaUnits: bigint
  idempotencyKey: string
  internalBalanceAfter: number
  internalBalanceBefore: number
  metadata?: Record<string, unknown>
  newWalletAmount: number
  newWalletUnits: bigint
  openReservedAmount: number
  previousWalletAmount: number
  previousWalletUnits: bigint
  userId: string
  walletAddress: string
}

function normalizeAddress(address: string) {
  return address.toLowerCase()
}

function getMovementType(deltaUnits: bigint): MovementType {
  return deltaUnits < 0n ? 'withdrawal' : 'deposit'
}

function isUniqueViolation(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

export async function recordMexasWalletMovement(
  db: SupabaseClient,
  params: RecordMexasWalletMovementParams
) {
  if (params.deltaUnits === 0n || params.amount <= 0) return
  if (!isAddress(params.walletAddress)) return

  const row = {
    id: getNewBetId(),
    idempotency_key: params.idempotencyKey,
    movement_type: getMovementType(params.deltaUnits),
    user_id: params.userId,
    wallet_address: normalizeAddress(params.walletAddress),
    amount: params.amount,
    delta_units: params.deltaUnits.toString(),
    previous_wallet_units: params.previousWalletUnits.toString(),
    new_wallet_units: params.newWalletUnits.toString(),
    previous_wallet_amount: params.previousWalletAmount,
    new_wallet_amount: params.newWalletAmount,
    internal_balance_before: params.internalBalanceBefore,
    internal_balance_after: params.internalBalanceAfter,
    open_reserved_amount: params.openReservedAmount,
    token_address: normalizeAddress(MEXAS_TOKEN.address),
    chain_id: MEXAS_TOKEN.chainId,
    metadata: {
      source: 'privy-wallet-sync',
      ...(params.metadata ?? {}),
    },
  } satisfies Tables['mexas_wallet_movements']['Insert']

  const { error } = await db.from('mexas_wallet_movements').insert(row)
  if (!error || isUniqueViolation(error)) return
  throw error
}
