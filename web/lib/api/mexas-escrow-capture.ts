import { APIError } from 'common/api/utils'
import { MEXAS_TOKEN } from 'common/crypto/mexas'
import { normalizeEvmAddress } from 'common/crypto/mexas-transfer'
import { getMexasEscrowCaptureCheck } from 'common/mexas-escrow'
import type { SupabaseClient } from 'common/supabase/utils'
import { type Address, type Hex } from 'viem'
import { mexasPublicClient } from 'web/lib/crypto/mexas'

export const MEXAS_ESCROW_TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

type VerifiedMexasEscrowCapture = {
  capturedAmount: number
  capturedUnits: bigint
  payerAddress: Address
  requiredAmount: number
  treasuryAddress: Address
  txHash: Hex
}

function normalizeAddressForApi(address: string, label: string) {
  try {
    return normalizeEvmAddress(address) as Address
  } catch {
    throw new APIError(500, `${label} is not a valid EVM address.`)
  }
}

function normalizeTxHash(txHash: string) {
  if (!MEXAS_ESCROW_TX_HASH_PATTERN.test(txHash)) {
    throw new APIError(400, 'Invalid MEXAS escrow transaction hash.')
  }
  return txHash.toLowerCase() as Hex
}

export function getMexasEscrowTreasuryAddress() {
  const serverTreasury = process.env.MEXAS_TREASURY_WALLET_ADDRESS
  const publicTreasury = process.env.NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS
  if (!serverTreasury || !publicTreasury) {
    throw new APIError(500, 'MEXAS treasury wallet is not configured.')
  }

  const normalizedServer = normalizeAddressForApi(
    serverTreasury,
    'MEXAS_TREASURY_WALLET_ADDRESS'
  )
  const normalizedPublic = normalizeAddressForApi(
    publicTreasury,
    'NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS'
  )
  if (normalizedServer !== normalizedPublic) {
    throw new APIError(500, 'MEXAS treasury wallet env values do not match.')
  }
  if (
    normalizedServer === '0x0000000000000000000000000000000000000000' ||
    normalizedServer === normalizeEvmAddress(MEXAS_TOKEN.address)
  ) {
    throw new APIError(500, 'MEXAS treasury wallet is not usable.')
  }

  return normalizedServer
}

export async function assertMexasEscrowTxUnused(
  db: SupabaseClient,
  txHash: Hex
) {
  const { data, error } = await db
    .from('contract_bets')
    .select('bet_id')
    .ilike('data->>mexasEscrowTxHash', txHash)
    .limit(1)

  if (error) throw error
  if ((data ?? []).length > 0) {
    throw new APIError(
      403,
      'This MEXAS escrow transaction is already attached to an order.'
    )
  }
}

export async function verifyMexasEscrowCapture(params: {
  db: SupabaseClient
  payerAddress: string
  requiredAmount: number
  txHash: string
}): Promise<VerifiedMexasEscrowCapture> {
  if (!Number.isFinite(params.requiredAmount) || params.requiredAmount <= 0) {
    throw new APIError(400, 'Invalid MEXAS escrow amount.')
  }

  const txHash = normalizeTxHash(params.txHash)
  const payerAddress = normalizeAddressForApi(params.payerAddress, 'payer')
  const treasuryAddress = getMexasEscrowTreasuryAddress()

  await assertMexasEscrowTxUnused(params.db, txHash)

  const receipt = await mexasPublicClient
    .getTransactionReceipt({ hash: txHash })
    .catch((error) => {
      throw new APIError(
        404,
        error instanceof Error
          ? `MEXAS escrow transaction not found: ${error.message}`
          : 'MEXAS escrow transaction not found.'
      )
    })
  const capture = getMexasEscrowCaptureCheck({
    payerAddress,
    requiredAmount: params.requiredAmount,
    treasuryAddress,
    receipt: {
      logs: receipt.logs.map((log) => ({
        address: log.address,
        data: log.data,
        topics: Array.from(log.topics),
      })),
      status: receipt.status === 'success' ? '0x1' : '0x0',
      transactionHash: receipt.transactionHash,
    },
  })

  if (!capture.sufficient) {
    throw new APIError(
      403,
      `MEXAS escrow transfer captured ${capture.capturedAmount} MEX, below required ${capture.requiredAmount} MEX.`
    )
  }

  await assertMexasEscrowTxUnused(params.db, txHash)

  return {
    capturedAmount: capture.capturedAmount,
    capturedUnits: capture.capturedUnits,
    payerAddress,
    requiredAmount: capture.requiredAmount,
    treasuryAddress,
    txHash,
  }
}

export async function assertMexasEscrowCaptureReady(db: SupabaseClient) {
  const { data, error } = await db.rpc('mexas_escrow_capture_ready')

  if (error || data !== true) {
    throw new APIError(
      503,
      'La captura on-chain MEXAS no está lista en Supabase.'
    )
  }
}
