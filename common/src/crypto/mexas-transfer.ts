import { MEXAS_TOKEN } from './mexas'

export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export type MexasTransferReceiptLog = {
  address: string
  data: string
  topics: string[]
}

export type MexasTransferReceipt = {
  logs: MexasTransferReceiptLog[]
  status?: string
  transactionHash?: string
}

export function normalizeEvmAddress(address: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Invalid EVM address.')
  }
  return address.toLowerCase()
}

export function evmAddressTopic(address: string) {
  return `0x${'0'.repeat(24)}${normalizeEvmAddress(address).slice(2)}`
}

export function parseErc20TransferUnits(data: string) {
  if (!/^0x[a-fA-F0-9]{1,64}$/.test(data)) {
    throw new Error('Invalid ERC20 transfer amount data.')
  }
  return BigInt(data)
}

export function mexasUnitsToTokenAmount(units: bigint) {
  return Number(units) / 10 ** MEXAS_TOKEN.decimals
}

export function getMexasTransferUnits(
  receipt: MexasTransferReceipt,
  payerAddress: string,
  treasuryAddress: string
) {
  const tokenAddress = normalizeEvmAddress(MEXAS_TOKEN.address)
  const fromTopic = evmAddressTopic(payerAddress)
  const toTopic = evmAddressTopic(treasuryAddress)

  return receipt.logs.reduce((sum, event) => {
    if (normalizeEvmAddress(event.address) !== tokenAddress) return sum
    if ((event.topics[0] ?? '').toLowerCase() !== ERC20_TRANSFER_TOPIC) {
      return sum
    }
    if ((event.topics[1] ?? '').toLowerCase() !== fromTopic) return sum
    if ((event.topics[2] ?? '').toLowerCase() !== toTopic) return sum

    return sum + parseErc20TransferUnits(event.data)
  }, 0n)
}

export function getConfirmedMexasTransferUnits(
  receipt: MexasTransferReceipt,
  payerAddress: string,
  treasuryAddress: string
) {
  if (receipt.status !== '0x1') return 0n
  return getMexasTransferUnits(receipt, payerAddress, treasuryAddress)
}
