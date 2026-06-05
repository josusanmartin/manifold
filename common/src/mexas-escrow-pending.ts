export const MEXAS_ESCROW_PENDING_ORDER_TX_TTL_MS = 60 * 60 * 1000

export type MexasEscrowPendingOrderIntent = {
  amount: number
  contractId: string
  limitProb: number
  outcome: 'YES' | 'NO'
  treasuryAddress: string
  walletAddress: string
}

export type MexasEscrowPendingOrderTx = MexasEscrowPendingOrderIntent & {
  createdTime: number
  txHash: string
}

function normalizeMexasAmount(amount: number) {
  return Math.round(amount * 1_000_000) / 1_000_000
}

function normalizeLimitProb(limitProb: number) {
  return Math.round(limitProb * 1_000_000) / 1_000_000
}

function normalizeAddress(address: string) {
  return address.trim().toLowerCase()
}

function normalizeTxHash(txHash: string) {
  return txHash.trim().toLowerCase()
}

export function getMexasEscrowPendingOrderIntent(params: {
  amount: number
  contractId: string
  limitProb: number | undefined
  outcome: 'YES' | 'NO' | undefined
  treasuryAddress: string
  walletAddress: string
}): MexasEscrowPendingOrderIntent | undefined {
  if (
    !params.contractId ||
    !params.outcome ||
    params.limitProb === undefined ||
    !Number.isFinite(params.amount) ||
    params.amount <= 0 ||
    !Number.isFinite(params.limitProb) ||
    params.limitProb <= 0 ||
    params.limitProb >= 1
  ) {
    return undefined
  }

  return {
    amount: normalizeMexasAmount(params.amount),
    contractId: params.contractId.trim(),
    limitProb: normalizeLimitProb(params.limitProb),
    outcome: params.outcome,
    treasuryAddress: normalizeAddress(params.treasuryAddress),
    walletAddress: normalizeAddress(params.walletAddress),
  }
}

export function makeMexasEscrowPendingOrderTx(
  intent: MexasEscrowPendingOrderIntent,
  params: { createdTime: number; txHash: string }
): MexasEscrowPendingOrderTx {
  return {
    ...intent,
    createdTime: params.createdTime,
    txHash: normalizeTxHash(params.txHash),
  }
}

export function isFreshMexasEscrowPendingOrderTx(
  pending: MexasEscrowPendingOrderTx,
  now = Date.now()
) {
  return (
    Number.isFinite(pending.createdTime) &&
    pending.createdTime > 0 &&
    now - pending.createdTime <= MEXAS_ESCROW_PENDING_ORDER_TX_TTL_MS
  )
}

export function matchesMexasEscrowPendingOrderIntent(
  pending: MexasEscrowPendingOrderTx,
  intent: MexasEscrowPendingOrderIntent
) {
  return (
    pending.contractId === intent.contractId &&
    pending.outcome === intent.outcome &&
    normalizeMexasAmount(pending.amount) === intent.amount &&
    normalizeLimitProb(pending.limitProb) === intent.limitProb &&
    normalizeAddress(pending.treasuryAddress) === intent.treasuryAddress &&
    normalizeAddress(pending.walletAddress) === intent.walletAddress
  )
}

export function findReusableMexasEscrowPendingOrderTx(
  pendingTxs: MexasEscrowPendingOrderTx[],
  intent: MexasEscrowPendingOrderIntent,
  now = Date.now()
) {
  return pendingTxs.find(
    (pending) =>
      isFreshMexasEscrowPendingOrderTx(pending, now) &&
      matchesMexasEscrowPendingOrderIntent(pending, intent)
  )
}

export function pruneMexasEscrowPendingOrderTxs(
  pendingTxs: MexasEscrowPendingOrderTx[],
  now = Date.now()
) {
  return pendingTxs.filter((pending) =>
    isFreshMexasEscrowPendingOrderTx(pending, now)
  )
}

export function upsertMexasEscrowPendingOrderTx(
  pendingTxs: MexasEscrowPendingOrderTx[],
  pendingTx: MexasEscrowPendingOrderTx,
  now = Date.now()
) {
  return [
    pendingTx,
    ...pruneMexasEscrowPendingOrderTxs(pendingTxs, now).filter(
      (candidate) =>
        normalizeTxHash(candidate.txHash) !== normalizeTxHash(pendingTx.txHash)
    ),
  ].slice(0, 10)
}

export function removeMexasEscrowPendingOrderTx(
  pendingTxs: MexasEscrowPendingOrderTx[],
  txHash: string
) {
  const normalizedTxHash = normalizeTxHash(txHash)
  return pendingTxs.filter(
    (pending) => normalizeTxHash(pending.txHash) !== normalizedTxHash
  )
}

export function shouldClearMexasEscrowPendingOrderTxAfterError(
  message: string
) {
  const normalizedMessage = message.toLowerCase()
  return (
    normalizedMessage.includes('already attached to an order') ||
    normalizedMessage.includes('already refunded') ||
    normalizedMessage.includes('queued for refund') ||
    normalizedMessage.includes('fue devuelta') ||
    normalizedMessage.includes('invalid mexas escrow transaction hash') ||
    normalizedMessage.includes('below required') ||
    normalizedMessage.includes('expected exactly')
  )
}
