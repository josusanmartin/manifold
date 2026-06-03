import { APIError } from 'common/api/utils'
import { getNewBetId } from 'common/bet'
import { MEXAS_PUBLIC_RPC_URL, MEXAS_TOKEN } from 'common/crypto/mexas'
import {
  getConfirmedMexasTransferUnits,
  normalizeEvmAddress,
} from 'common/crypto/mexas-transfer'
import { mexasAmountToUnits } from 'common/mexas-escrow'
import {
  millisToTs,
  type Row,
  type SupabaseClient,
  type Tables,
} from 'common/supabase/utils'
import {
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum } from 'viem/chains'
import {
  getMexasBalanceUnits,
  mexasErc20Abi,
  mexasPublicClient,
} from 'web/lib/crypto/mexas'
import { getMexasEscrowTreasuryAddress } from './mexas-escrow-capture'

const TREASURY_SIGNER_SECRET_PATTERN = /^0x[0-9a-fA-F]{64}$/
const TRANSFER_PROCESSING_TIMEOUT_MS = 2 * 60 * 1000

type MexasTreasuryTransferType =
  | 'order-release'
  | 'resolution-payout'
  | 'resolution-cancel'
  | 'withdrawal'

type MexasTreasuryTransferStatus =
  | 'pending'
  | 'processing'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'cancelled'

type MexasTreasuryTransferParams = {
  amount: number
  betId?: string
  contractId?: string
  db: SupabaseClient
  idempotencyKey: string
  metadata?: Record<string, unknown>
  outcome?: 'YES' | 'NO' | 'CANCEL'
  recipientAddress: string
  transferType: MexasTreasuryTransferType
  userId: string
}

type ClaimedTransfer = {
  inserted: boolean
  row: Row<'mexas_treasury_transfers'>
}

function normalizeRecipientAddress(address: string) {
  try {
    return normalizeEvmAddress(address) as Address
  } catch {
    throw new APIError(400, 'Recipient wallet is not a valid EVM address.')
  }
}

function getTreasurySignerSecret() {
  const secret = process.env.MEXAS_TREASURY_SIGNER_SECRET
  if (!secret || !TREASURY_SIGNER_SECRET_PATTERN.test(secret)) {
    throw new APIError(
      500,
      'MEXAS treasury signer is not configured for outgoing transfers.'
    )
  }
  return secret as Hex
}

function getTreasurySignerAccount(treasuryAddress: Address) {
  const account = privateKeyToAccount(getTreasurySignerSecret())
  if (normalizeEvmAddress(account.address) !== treasuryAddress) {
    throw new APIError(
      500,
      'MEXAS treasury signer does not match the configured treasury wallet.'
    )
  }
  return account
}

export function assertMexasTreasurySignerReady() {
  getTreasurySignerAccount(getMexasEscrowTreasuryAddress())
}

export async function assertMexasTreasurySettlementLedgerReady(
  db: SupabaseClient
) {
  const { data, error } = await db.rpc('mexas_treasury_settlement_ledger_ready')

  if (error || data !== true) {
    throw new APIError(
      503,
      'El ledger de tesorería MEXAS no está listo en Supabase.'
    )
  }
}

export async function assertMexasTreasuryTransferRuntimeReady(
  db: SupabaseClient
) {
  assertMexasTreasurySignerReady()
  await assertMexasTreasurySettlementLedgerReady(db)
}

function getTreasuryWalletClient() {
  return createWalletClient({
    chain: arbitrum,
    transport: http(
      process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL ?? MEXAS_PUBLIC_RPC_URL
    ),
  })
}

function getUserData(row: Row<'users'> | null) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

export async function getUserPrivyWalletAddress(
  db: SupabaseClient,
  userId: string
) {
  const { data, error } = await db
    .from('users')
    .select('id,data')
    .eq('id', userId)
    .single()

  if (error) throw error
  const walletAddress = getUserData(data as Row<'users'>).privyWalletAddress
  if (typeof walletAddress !== 'string') {
    throw new APIError(403, 'User has no Privy wallet for MEXAS payout.')
  }

  return normalizeRecipientAddress(walletAddress)
}

function isFreshProcessing(row: Row<'mexas_treasury_transfers'>) {
  return (
    row.status === 'processing' &&
    Date.now() - Date.parse(row.updated_time) < TRANSFER_PROCESSING_TIMEOUT_MS
  )
}

async function loadTransferByIdempotencyKey(
  db: SupabaseClient,
  idempotencyKey: string
) {
  const { data, error } = await db
    .from('mexas_treasury_transfers')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (error) throw error
  return data as Row<'mexas_treasury_transfers'> | null
}

async function loadTransferById(db: SupabaseClient, transferId: string) {
  const { data, error } = await db
    .from('mexas_treasury_transfers')
    .select('*')
    .eq('id', transferId)
    .maybeSingle()

  if (error) throw error
  return data as Row<'mexas_treasury_transfers'> | null
}

async function insertProcessingTransfer(
  params: MexasTreasuryTransferParams,
  treasuryAddress: Address,
  recipientAddress: Address
): Promise<ClaimedTransfer | undefined> {
  const now = millisToTs(Date.now())
  const row = {
    id: getNewBetId(),
    idempotency_key: params.idempotencyKey,
    transfer_type: params.transferType,
    status: 'processing',
    user_id: params.userId,
    contract_id: params.contractId ?? null,
    bet_id: params.betId ?? null,
    outcome: params.outcome ?? null,
    amount: params.amount,
    token_address: normalizeEvmAddress(MEXAS_TOKEN.address),
    chain_id: MEXAS_TOKEN.chainId,
    treasury_address: treasuryAddress,
    recipient_address: recipientAddress,
    metadata: (params.metadata ?? {}) as any,
    updated_time: now,
  } satisfies Tables['mexas_treasury_transfers']['Insert']

  const { data, error } = await params.db
    .from('mexas_treasury_transfers')
    .insert(row)
    .select()
    .maybeSingle()

  if (error) {
    if (error.code === '23505') return undefined
    throw error
  }
  if (!data) return undefined
  return { inserted: true, row: data as Row<'mexas_treasury_transfers'> }
}

async function claimExistingPendingTransfer(
  db: SupabaseClient,
  row: Row<'mexas_treasury_transfers'>
): Promise<Row<'mexas_treasury_transfers'> | undefined> {
  if (row.status === 'pending') {
    const now = millisToTs(Date.now())
    const { data, error } = await db
      .from('mexas_treasury_transfers')
      .update({
        status: 'processing',
        error: null,
        updated_time: now,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .eq('updated_time', row.updated_time)
      .select()
      .maybeSingle()

    if (error) throw error
    return data as Row<'mexas_treasury_transfers'> | undefined
  }

  if (isFreshProcessing(row)) {
    throw new APIError(503, 'MEXAS treasury transfer is already processing.')
  }

  if (row.status === 'processing') {
    throw new APIError(
      503,
      'MEXAS treasury transfer requires manual reconciliation before retry.'
    )
  }

  return undefined
}

async function claimTreasuryTransfer(
  params: MexasTreasuryTransferParams,
  treasuryAddress: Address,
  recipientAddress: Address
): Promise<ClaimedTransfer> {
  const inserted = await insertProcessingTransfer(
    params,
    treasuryAddress,
    recipientAddress
  )
  if (inserted) return inserted

  const existing = await loadTransferByIdempotencyKey(
    params.db,
    params.idempotencyKey
  )
  if (!existing) {
    throw new APIError(503, 'MEXAS treasury transfer changed. Please retry.')
  }
  if (existing.status === 'confirmed') return { inserted: false, row: existing }
  if (existing.status === 'submitted' && existing.tx_hash) {
    return { inserted: false, row: existing }
  }
  if (existing.status === 'failed' || existing.status === 'cancelled') {
    throw new APIError(503, `MEXAS treasury transfer is ${existing.status}.`)
  }

  const claimed = await claimExistingPendingTransfer(params.db, existing)
  if (!claimed) {
    throw new APIError(503, 'MEXAS treasury transfer changed. Please retry.')
  }

  return { inserted: false, row: claimed }
}

async function markTreasuryTransferSubmitted(
  db: SupabaseClient,
  row: Row<'mexas_treasury_transfers'>,
  txHash: Hex
) {
  const now = millisToTs(Date.now())
  const submittedPatch = {
    status: 'submitted',
    tx_hash: txHash,
    submitted_time: now,
    updated_time: now,
  }
  const { data, error } = await db
    .from('mexas_treasury_transfers')
    .update(submittedPatch)
    .eq('id', row.id)
    .eq('status', 'processing')
    .eq('updated_time', row.updated_time)
    .is('tx_hash', null)
    .select()
    .maybeSingle()

  if (error) throw error
  if (data) return data as Row<'mexas_treasury_transfers'>

  const latest = await loadTransferById(db, row.id)
  if (latest?.tx_hash === txHash) return latest
  if (latest?.tx_hash) {
    throw new APIError(503, 'MEXAS treasury transfer changed after signing.')
  }

  const { data: recovered, error: recoveryError } = await db
    .from('mexas_treasury_transfers')
    .update(submittedPatch)
    .eq('id', row.id)
    .eq('status', 'processing')
    .is('tx_hash', null)
    .select()
    .maybeSingle()

  if (recoveryError) throw recoveryError
  if (recovered) return recovered as Row<'mexas_treasury_transfers'>

  const final = await loadTransferById(db, row.id)
  if (final?.tx_hash === txHash) return final
  throw new APIError(
    503,
    'MEXAS treasury transfer could not record submitted transaction hash.'
  )
}

async function markTreasuryTransferFailed(
  db: SupabaseClient,
  row: Row<'mexas_treasury_transfers'>,
  errorMessage: string
) {
  const now = millisToTs(Date.now())
  await db
    .from('mexas_treasury_transfers')
    .update({
      status: 'failed',
      error: errorMessage,
      updated_time: now,
    })
    .eq('id', row.id)
    .in('status', ['processing', 'submitted'])
}

async function confirmSubmittedTransfer(
  db: SupabaseClient,
  row: Row<'mexas_treasury_transfers'>
) {
  if (!row.tx_hash) {
    throw new APIError(503, 'MEXAS treasury transfer has no transaction hash.')
  }

  const receipt = await mexasPublicClient.waitForTransactionReceipt({
    hash: row.tx_hash as Hex,
  })
  const transferredUnits = getConfirmedMexasTransferUnits(
    {
      logs: receipt.logs.map((log) => ({
        address: log.address,
        data: log.data,
        topics: Array.from(log.topics),
      })),
      status: receipt.status === 'success' ? '0x1' : '0x0',
      transactionHash: receipt.transactionHash,
    },
    row.treasury_address,
    row.recipient_address
  )
  const requiredUnits = mexasAmountToUnits(row.amount)
  if (transferredUnits < requiredUnits) {
    await markTreasuryTransferFailed(
      db,
      row,
      'Confirmed transaction did not transfer enough MEXAS.'
    )
    throw new APIError(
      503,
      'Confirmed MEXAS treasury transaction did not transfer enough MEX.'
    )
  }

  const now = millisToTs(Date.now())
  const { data, error } = await db
    .from('mexas_treasury_transfers')
    .update({
      status: 'confirmed',
      confirmed_time: now,
      updated_time: now,
    })
    .eq('id', row.id)
    .eq('tx_hash', row.tx_hash)
    .in('status', ['submitted', 'confirmed'])
    .select()
    .maybeSingle()

  if (error) throw error
  return (data ?? row) as Row<'mexas_treasury_transfers'>
}

export async function submitMexasTreasuryTransfer(
  params: MexasTreasuryTransferParams
) {
  if (!Number.isFinite(params.amount) || params.amount <= 0) return undefined
  const treasuryAddress = getMexasEscrowTreasuryAddress()
  const recipientAddress = normalizeRecipientAddress(params.recipientAddress)
  const amountUnits = mexasAmountToUnits(params.amount)
  const claimed = await claimTreasuryTransfer(
    params,
    treasuryAddress,
    recipientAddress
  )

  if (claimed.row.status === 'confirmed') return claimed.row
  if (claimed.row.status === 'submitted') {
    return await confirmSubmittedTransfer(params.db, claimed.row)
  }

  const account = getTreasurySignerAccount(treasuryAddress)
  const treasuryBalance = await getMexasBalanceUnits(treasuryAddress)
  if (treasuryBalance < amountUnits) {
    await markTreasuryTransferFailed(
      params.db,
      claimed.row,
      'Treasury MEXAS balance is insufficient.'
    )
    throw new APIError(503, 'MEXAS treasury balance is insufficient.')
  }

  let hash: Hex
  try {
    hash = await getTreasuryWalletClient().sendTransaction({
      account,
      chain: arbitrum,
      to: MEXAS_TOKEN.address as Address,
      data: encodeFunctionData({
        abi: mexasErc20Abi,
        functionName: 'transfer',
        args: [recipientAddress, amountUnits],
      }),
      value: 0n,
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Could not submit MEXAS treasury transfer.'
    await markTreasuryTransferFailed(params.db, claimed.row, message)
    throw error
  }

  const submitted = await markTreasuryTransferSubmitted(
    params.db,
    claimed.row,
    hash
  )
  return await confirmSubmittedTransfer(params.db, submitted)
}
