import { APIError, APIHandler } from 'api/helpers/endpoint'
import { getActiveUserBans } from 'api/helpers/rate-limit'
import { isUserBanned } from 'common/ban-utils'
import {
  getMexasPurchaseMessage,
  MEXAS_ACCOUNT_CREDIT_PER_TOKEN,
  MEXAS_PUBLIC_RPC_URL,
  MEXAS_TOKEN,
} from 'common/crypto/mexas'
import { trackPublicEvent } from 'shared/analytics'
import { createSupabaseDirectClient } from 'shared/supabase/init'
import { updateUser } from 'shared/supabase/users'
import { runTxnInBetQueue } from 'shared/txn/run-txn'
import { getUser, log } from 'shared/utils'
import { verifyMessage, type Address, type Hex } from 'viem'

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

type RpcResponse<T> = {
  result?: T
  error?: { code: number; message: string }
}

type TransactionReceipt = {
  transactionHash: string
  status?: string
  logs: Array<{
    address: string
    topics: string[]
    data: string
  }>
}

function normalizeAddress(address: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new APIError(400, 'Invalid address')
  }
  return address.toLowerCase()
}

function addressTopic(address: string) {
  return `0x${'0'.repeat(24)}${normalizeAddress(address).slice(2)}`
}

function unitsToTokenAmount(units: number) {
  return units / 10 ** MEXAS_TOKEN.decimals
}

function parseTokenUnits(data: string) {
  const units = parseInt(data, 16)
  if (!Number.isSafeInteger(units)) {
    throw new APIError(400, 'MEXAS transfer amount is too large')
  }
  return units
}

async function arbitrumRpc<T>(method: string, params: unknown[]): Promise<T> {
  const rpcUrl = process.env.ARBITRUM_RPC_URL ?? MEXAS_PUBLIC_RPC_URL
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  })

  if (!response.ok) {
    log.error('Arbitrum RPC request failed', {
      status: response.status,
      statusText: response.statusText,
    })
    throw new APIError(500, 'Arbitrum RPC request failed')
  }

  const json = (await response.json()) as RpcResponse<T>
  if (json.error) {
    log.error('Arbitrum RPC returned an error', json.error)
    throw new APIError(500, 'Arbitrum RPC returned an error')
  }

  return json.result as T
}

async function getTransactionReceipt(txHash: string) {
  return arbitrumRpc<TransactionReceipt | null>('eth_getTransactionReceipt', [
    txHash,
  ])
}

function getMexasTransferUnits(
  receipt: TransactionReceipt,
  payerAddress: string,
  treasuryAddress: string
) {
  const tokenAddress = normalizeAddress(MEXAS_TOKEN.address)
  const fromTopic = addressTopic(payerAddress)
  const toTopic = addressTopic(treasuryAddress)

  return receipt.logs.reduce((sum, event) => {
    if (normalizeAddress(event.address) !== tokenAddress) return sum
    if ((event.topics[0] ?? '').toLowerCase() !== TRANSFER_TOPIC) return sum
    if ((event.topics[1] ?? '').toLowerCase() !== fromTopic) return sum
    if ((event.topics[2] ?? '').toLowerCase() !== toTopic) return sum
    if (!/^0x[a-fA-F0-9]+$/.test(event.data)) return sum

    return sum + parseTokenUnits(event.data)
  }, 0)
}

export const recordMexasPurchase: APIHandler<'record-mexas-purchase'> = async (
  props,
  auth
) => {
  const pg = createSupabaseDirectClient()
  const userId = auth.uid

  const user = await getUser(userId)
  if (!user) {
    throw new APIError(404, 'User not found')
  }

  const activeBans = await getActiveUserBans(userId, pg)
  if (isUserBanned(activeBans, 'purchase')) {
    throw new APIError(403, 'User is banned from making purchases')
  }

  const treasuryAddress = process.env.MEXAS_TREASURY_WALLET_ADDRESS
  if (!treasuryAddress) {
    log.error('MEXAS_TREASURY_WALLET_ADDRESS not configured')
    throw new APIError(500, 'MEXAS treasury wallet not configured')
  }

  const normalizedPayer = normalizeAddress(props.payerAddress)
  const normalizedTreasury = normalizeAddress(treasuryAddress)
  const txHash = props.txHash.toLowerCase()
  const signature = props.signature.toLowerCase()

  let signatureValid = false
  try {
    signatureValid = await verifyMessage({
      address: normalizedPayer as Address,
      message: getMexasPurchaseMessage(userId, txHash, normalizedPayer),
      signature: signature as Hex,
    })
  } catch {
    signatureValid = false
  }

  if (!signatureValid) {
    throw new APIError(403, 'MEXAS payer wallet signature is invalid')
  }

  const receipt = await getTransactionReceipt(txHash)

  if (!receipt) {
    throw new APIError(
      400,
      'MEXAS transaction is not confirmed yet. Wait for Arbitrum confirmation and try again.'
    )
  }

  if (receipt.status !== '0x1') {
    throw new APIError(400, 'MEXAS transaction failed on-chain')
  }

  const mexasUnits = getMexasTransferUnits(
    receipt,
    normalizedPayer,
    normalizedTreasury
  )

  if (mexasUnits <= 0) {
    throw new APIError(
      400,
      'Transaction does not contain a MEXAS transfer from this wallet to the configured treasury.'
    )
  }

  let mexasAmount = unitsToTokenAmount(mexasUnits)
  let creditAmount = 0
  let alreadyProcessed = false

  const paidInCents = Math.round(mexasAmount * 100)
  const intentId = `mexas:${txHash}`

  await pg.tx(async (tx) => {
    const existingIntent = await tx.oneOrNone<{
      mana_amount: number | null
      usdc_amount: string | null
    }>(
      `SELECT mana_amount, usdc_amount FROM crypto_payment_intents WHERE intent_id = $1`,
      [intentId]
    )

    if (existingIntent) {
      alreadyProcessed = true
      creditAmount = existingIntent.mana_amount ?? 0
      mexasAmount = existingIntent.usdc_amount
        ? Number(existingIntent.usdc_amount)
        : mexasAmount
      return
    }

    creditAmount = Math.floor(mexasAmount * MEXAS_ACCOUNT_CREDIT_PER_TOKEN)
    if (creditAmount <= 0) {
      throw new APIError(400, 'MEXAS transfer must be at least 1 MEX')
    }

    const insertResult = await tx.oneOrNone(
      `INSERT INTO crypto_payment_intents (intent_id, user_id, mana_amount, usdc_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (intent_id) DO NOTHING
       RETURNING id`,
      [intentId, userId, creditAmount, mexasAmount]
    )

    if (!insertResult) {
      alreadyProcessed = true
      return
    }

    const mexasCreditTxn = {
      fromId: 'EXTERNAL',
      fromType: 'BANK',
      toId: userId,
      toType: 'USER',
      amount: creditAmount,
      token: 'M$',
      category: 'MANA_PURCHASE',
      data: {
        mexasTxHash: txHash,
        payerAddress: normalizedPayer,
        tokenAddress: MEXAS_TOKEN.address,
        chainId: MEXAS_TOKEN.chainId,
        mexasAmount,
        creditAmount,
        type: 'mexas',
        paidInCents,
      },
      description: 'Deposit MEXAS account credit',
    } as const

    await runTxnInBetQueue(tx, mexasCreditTxn)
    await updateUser(tx, userId, {
      purchasedMana: true,
    })
  })

  if (!alreadyProcessed) {
    log('MEXAS payment processed:', userId, 'MEX', creditAmount, {
      txHash,
      mexasAmount,
    })

    await trackPublicEvent(
      userId,
      'MEXAS purchase',
      {
        amount: creditAmount,
        mexasAmount,
        txHash,
        paymentType: 'mexas',
      },
      { revenue: mexasAmount }
    )
  }

  return {
    status: alreadyProcessed ? 'already-processed' : 'credited',
    txHash,
    mexasAmount,
    creditAmount,
  }
}
