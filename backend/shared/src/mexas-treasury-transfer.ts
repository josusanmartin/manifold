import { getNewBetId } from 'common/bet'
import { MEXAS_PUBLIC_RPC_URL, MEXAS_TOKEN } from 'common/crypto/mexas'
import {
  getConfirmedMexasTransferUnits,
  normalizeEvmAddress,
} from 'common/crypto/mexas-transfer'
import { mexasAmountToUnits } from 'common/mexas-escrow'
import { SupabaseDirectClient } from 'shared/supabase/init'

// Static viem imports break backend/shared's ES2017 build on viem's current types.
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
} = require('viem')
const { privateKeyToAccount } = require('viem/accounts')
const { arbitrum } = require('viem/chains')
/* eslint-enable @typescript-eslint/no-require-imports */

const TREASURY_SIGNER_SECRET_PATTERN = /^0x[0-9a-fA-F]{64}$/
const TRANSFER_PROCESSING_TIMEOUT_MS = 2 * 60 * 1000

type Address = `0x${string}`
type Hex = `0x${string}`

type MexasTreasuryTransferType =
  | 'order-release'
  | 'resolution-payout'
  | 'resolution-cancel'
  | 'withdrawal'

export type MexasDirectTreasuryTransferParams = {
  amount: number
  betId?: string
  contractId?: string
  idempotencyKey: string
  metadata?: Record<string, unknown>
  outcome?: 'YES' | 'NO' | 'CANCEL'
  recipientAddress: string
  transferType: MexasTreasuryTransferType
  userId: string
}

export type MexasDirectTreasuryTransferRow = {
  id: string
  idempotency_key: string
  transfer_type: MexasTreasuryTransferType
  status:
    | 'pending'
    | 'processing'
    | 'submitted'
    | 'confirmed'
    | 'failed'
    | 'cancelled'
  user_id: string
  contract_id: string | null
  bet_id: string | null
  outcome: 'YES' | 'NO' | 'CANCEL' | null
  amount: number
  token_address: string
  chain_id: number
  treasury_address: string
  recipient_address: string
  metadata: Record<string, unknown>
  tx_hash: string | null
  error: string | null
  submitted_time: string | null
  confirmed_time: string | null
  updated_time: string
}

type ClaimedTransfer = {
  inserted: boolean
  row: MexasDirectTreasuryTransferRow
}

function normalizeRecipientAddress(address: string) {
  try {
    return normalizeEvmAddress(address) as Address
  } catch {
    throw new Error('Recipient wallet is not a valid EVM address.')
  }
}

function getTreasurySignerSecret() {
  const secret = process.env.MEXAS_TREASURY_SIGNER_SECRET
  if (!secret || !TREASURY_SIGNER_SECRET_PATTERN.test(secret)) {
    throw new Error('MEXAS treasury signer is not configured.')
  }
  return secret as Hex
}

export function getMexasDirectTreasuryAddress() {
  const serverTreasury = process.env.MEXAS_TREASURY_WALLET_ADDRESS
  const publicTreasury = process.env.NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS

  if (!serverTreasury) {
    throw new Error('MEXAS_TREASURY_WALLET_ADDRESS is not configured.')
  }

  const normalizedServer = normalizeRecipientAddress(serverTreasury)
  if (publicTreasury) {
    const normalizedPublic = normalizeRecipientAddress(publicTreasury)
    if (normalizedPublic !== normalizedServer) {
      throw new Error('MEXAS treasury wallet env values do not match.')
    }
  }
  if (normalizedServer === normalizeEvmAddress(MEXAS_TOKEN.address)) {
    throw new Error('MEXAS treasury wallet cannot be the token contract.')
  }

  return normalizedServer
}

function getTreasurySignerAccount(treasuryAddress: Address) {
  const account = privateKeyToAccount(getTreasurySignerSecret())
  if (normalizeEvmAddress(account.address) !== treasuryAddress) {
    throw new Error('MEXAS treasury signer does not match treasury wallet.')
  }
  return account
}

function getRpcUrl() {
  return process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL ?? MEXAS_PUBLIC_RPC_URL
}

function getTreasuryPublicClient() {
  return createPublicClient({
    chain: arbitrum,
    transport: http(getRpcUrl()),
  })
}

function getTreasuryWalletClient() {
  return createWalletClient({
    chain: arbitrum,
    transport: http(getRpcUrl()),
  })
}

function isFreshProcessing(row: MexasDirectTreasuryTransferRow) {
  return (
    row.status === 'processing' &&
    Date.now() - Date.parse(row.updated_time) < TRANSFER_PROCESSING_TIMEOUT_MS
  )
}

function assertEqualTreasuryTransferField(
  mismatches: string[],
  field: string,
  actual: unknown,
  expected: unknown
) {
  if (actual !== expected) mismatches.push(field)
}

function assertTreasuryTransferMatchesParams(
  params: MexasDirectTreasuryTransferParams,
  row: MexasDirectTreasuryTransferRow,
  treasuryAddress: Address,
  recipientAddress: Address
) {
  const mismatches: string[] = []
  assertEqualTreasuryTransferField(
    mismatches,
    'idempotency_key',
    row.idempotency_key,
    params.idempotencyKey
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'transfer_type',
    row.transfer_type,
    params.transferType
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'user_id',
    row.user_id,
    params.userId
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'contract_id',
    row.contract_id,
    params.contractId ?? null
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'bet_id',
    row.bet_id,
    params.betId ?? null
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'outcome',
    row.outcome,
    params.outcome ?? null
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'amount',
    mexasAmountToUnits(row.amount).toString(),
    mexasAmountToUnits(params.amount).toString()
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'token_address',
    normalizeEvmAddress(row.token_address),
    normalizeEvmAddress(MEXAS_TOKEN.address)
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'chain_id',
    row.chain_id,
    MEXAS_TOKEN.chainId
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'treasury_address',
    normalizeEvmAddress(row.treasury_address),
    treasuryAddress
  )
  assertEqualTreasuryTransferField(
    mismatches,
    'recipient_address',
    normalizeEvmAddress(row.recipient_address),
    recipientAddress
  )

  if (mismatches.length) {
    throw new Error(
      `MEXAS treasury transfer idempotency conflict: ${mismatches.join(', ')}.`
    )
  }
}

async function loadTransferByIdempotencyKey(
  pg: SupabaseDirectClient,
  idempotencyKey: string
) {
  return await pg.oneOrNone<MexasDirectTreasuryTransferRow>(
    'select * from mexas_treasury_transfers where idempotency_key = $1',
    [idempotencyKey]
  )
}

async function loadTransferById(pg: SupabaseDirectClient, transferId: string) {
  return await pg.oneOrNone<MexasDirectTreasuryTransferRow>(
    'select * from mexas_treasury_transfers where id = $1',
    [transferId]
  )
}

async function insertProcessingTransfer(
  pg: SupabaseDirectClient,
  params: MexasDirectTreasuryTransferParams,
  treasuryAddress: Address,
  recipientAddress: Address
): Promise<ClaimedTransfer | undefined> {
  const now = new Date().toISOString()
  const row = await pg.oneOrNone<MexasDirectTreasuryTransferRow>(
    `
    insert into mexas_treasury_transfers (
      id,
      idempotency_key,
      transfer_type,
      status,
      user_id,
      contract_id,
      bet_id,
      outcome,
      amount,
      token_address,
      chain_id,
      treasury_address,
      recipient_address,
      metadata,
      updated_time
    )
    values (
      $1,
      $2,
      $3,
      'processing',
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13::jsonb,
      $14
    )
    on conflict (idempotency_key) do nothing
    returning *
    `,
    [
      getNewBetId(),
      params.idempotencyKey,
      params.transferType,
      params.userId,
      params.contractId ?? null,
      params.betId ?? null,
      params.outcome ?? null,
      params.amount,
      normalizeEvmAddress(MEXAS_TOKEN.address),
      MEXAS_TOKEN.chainId,
      treasuryAddress,
      recipientAddress,
      JSON.stringify(params.metadata ?? {}),
      now,
    ]
  )

  return row ? { inserted: true, row } : undefined
}

async function claimExistingPendingTransfer(
  pg: SupabaseDirectClient,
  row: MexasDirectTreasuryTransferRow
) {
  if (row.status === 'pending') {
    const now = new Date().toISOString()
    return await pg.oneOrNone<MexasDirectTreasuryTransferRow>(
      `
      update mexas_treasury_transfers
      set status = 'processing', error = null, updated_time = $1
      where id = $2
        and status = 'pending'
        and updated_time = $3
      returning *
      `,
      [now, row.id, row.updated_time]
    )
  }

  if (isFreshProcessing(row)) {
    throw new Error('MEXAS treasury transfer is already processing.')
  }
  if (row.status === 'processing') {
    throw new Error(
      'MEXAS treasury transfer requires manual reconciliation before retry.'
    )
  }

  return undefined
}

async function claimTreasuryTransfer(
  pg: SupabaseDirectClient,
  params: MexasDirectTreasuryTransferParams,
  treasuryAddress: Address,
  recipientAddress: Address
): Promise<ClaimedTransfer> {
  const inserted = await insertProcessingTransfer(
    pg,
    params,
    treasuryAddress,
    recipientAddress
  )
  if (inserted) return inserted

  const existing = await loadTransferByIdempotencyKey(pg, params.idempotencyKey)
  if (!existing) {
    throw new Error('MEXAS treasury transfer changed. Please retry.')
  }
  assertTreasuryTransferMatchesParams(
    params,
    existing,
    treasuryAddress,
    recipientAddress
  )
  if (existing.status === 'confirmed') return { inserted: false, row: existing }
  if (existing.status === 'submitted' && existing.tx_hash) {
    return { inserted: false, row: existing }
  }
  if (existing.status === 'failed' || existing.status === 'cancelled') {
    throw new Error(`MEXAS treasury transfer is ${existing.status}.`)
  }

  const claimed = await claimExistingPendingTransfer(pg, existing)
  if (!claimed) {
    throw new Error('MEXAS treasury transfer changed. Please retry.')
  }

  return { inserted: false, row: claimed }
}

async function markTreasuryTransferSubmitted(
  pg: SupabaseDirectClient,
  row: MexasDirectTreasuryTransferRow,
  txHash: Hex
) {
  const now = new Date().toISOString()
  const submitted = await pg.oneOrNone<MexasDirectTreasuryTransferRow>(
    `
    update mexas_treasury_transfers
    set
      status = 'submitted',
      tx_hash = $1,
      submitted_time = $2,
      updated_time = $2
    where id = $3
      and status = 'processing'
      and updated_time = $4
      and tx_hash is null
    returning *
    `,
    [txHash, now, row.id, row.updated_time]
  )
  if (submitted) return submitted

  const latest = await loadTransferById(pg, row.id)
  if (latest?.tx_hash === txHash) return latest
  if (latest?.tx_hash) {
    throw new Error('MEXAS treasury transfer changed after signing.')
  }

  const recovered = await pg.oneOrNone<MexasDirectTreasuryTransferRow>(
    `
    update mexas_treasury_transfers
    set
      status = 'submitted',
      tx_hash = $1,
      submitted_time = $2,
      updated_time = $2
    where id = $3
      and status = 'processing'
      and tx_hash is null
    returning *
    `,
    [txHash, now, row.id]
  )
  if (recovered) return recovered

  const final = await loadTransferById(pg, row.id)
  if (final?.tx_hash === txHash) return final
  throw new Error('MEXAS treasury transfer could not record transaction hash.')
}

async function markTreasuryTransferFailed(
  pg: SupabaseDirectClient,
  row: MexasDirectTreasuryTransferRow,
  errorMessage: string
) {
  await pg.none(
    `
    update mexas_treasury_transfers
    set status = 'failed', error = $1, updated_time = $2
    where id = $3
      and status in ('processing', 'submitted')
    `,
    [errorMessage, new Date().toISOString(), row.id]
  )
}

async function confirmSubmittedTransfer(
  pg: SupabaseDirectClient,
  row: MexasDirectTreasuryTransferRow
) {
  if (!row.tx_hash) {
    throw new Error('MEXAS treasury transfer has no transaction hash.')
  }

  const receipt = await getTreasuryPublicClient().waitForTransactionReceipt({
    hash: row.tx_hash as Hex,
  })
  const transferredUnits = getConfirmedMexasTransferUnits(
    {
      logs: receipt.logs.map(
        (log: { address: string; data: string; topics: string[] }) => ({
          address: log.address,
          data: log.data,
          topics: Array.from(log.topics),
        })
      ),
      status: receipt.status === 'success' ? '0x1' : '0x0',
      transactionHash: receipt.transactionHash,
    },
    row.treasury_address,
    row.recipient_address
  )
  const requiredUnits = mexasAmountToUnits(row.amount)
  if (transferredUnits < requiredUnits) {
    await markTreasuryTransferFailed(
      pg,
      row,
      'Confirmed transaction did not transfer enough MEXAS.'
    )
    throw new Error('Confirmed MEXAS treasury transaction was insufficient.')
  }

  const now = new Date().toISOString()
  const confirmed = await pg.oneOrNone<MexasDirectTreasuryTransferRow>(
    `
    update mexas_treasury_transfers
    set status = 'confirmed', confirmed_time = $1, updated_time = $1
    where id = $2
      and tx_hash = $3
      and status in ('submitted', 'confirmed')
    returning *
    `,
    [now, row.id, row.tx_hash]
  )

  return confirmed ?? row
}

async function getTreasuryMexasBalanceUnits(treasuryAddress: Address) {
  return await getTreasuryPublicClient().readContract({
    address: MEXAS_TOKEN.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [treasuryAddress],
  })
}

export async function submitMexasDirectTreasuryTransfer(
  pg: SupabaseDirectClient,
  params: MexasDirectTreasuryTransferParams
) {
  if (!Number.isFinite(params.amount) || params.amount <= 0) return undefined
  const treasuryAddress = getMexasDirectTreasuryAddress()
  const recipientAddress = normalizeRecipientAddress(params.recipientAddress)
  const amountUnits = mexasAmountToUnits(params.amount)
  const claimed = await claimTreasuryTransfer(
    pg,
    params,
    treasuryAddress,
    recipientAddress
  )

  if (claimed.row.status === 'confirmed') return claimed.row
  if (claimed.row.status === 'submitted') {
    return await confirmSubmittedTransfer(pg, claimed.row)
  }

  const account = getTreasurySignerAccount(treasuryAddress)
  const treasuryBalance = await getTreasuryMexasBalanceUnits(treasuryAddress)
  if (treasuryBalance < amountUnits) {
    await markTreasuryTransferFailed(
      pg,
      claimed.row,
      'Treasury MEXAS balance is insufficient.'
    )
    throw new Error('MEXAS treasury balance is insufficient.')
  }

  let hash: Hex
  try {
    hash = await getTreasuryWalletClient().sendTransaction({
      account,
      chain: arbitrum,
      to: MEXAS_TOKEN.address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [recipientAddress, amountUnits],
      }),
      value: BigInt(0),
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Could not submit MEXAS treasury transfer.'
    await markTreasuryTransferFailed(pg, claimed.row, message)
    throw error
  }

  const submitted = await markTreasuryTransferSubmitted(pg, claimed.row, hash)
  return await confirmSubmittedTransfer(pg, submitted)
}
