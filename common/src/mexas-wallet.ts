import { MEXAS_TOKEN } from './crypto/mexas'
import { normalizeEvmAddress } from './crypto/mexas-transfer'

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000'

export type MexasWithdrawDestinationIssue =
  | 'invalid-destination'
  | 'same-wallet'
  | 'token-contract'
  | 'zero-address'

export type MexasWithdrawDisabledReason =
  | 'amount-exceeds-available'
  | MexasWithdrawDestinationIssue
  | 'missing-amount'
  | 'missing-wallet'
  | 'syncing-balance'
  | 'withdrawing'

export function getMexasWithdrawDestinationIssue(params: {
  destinationAddress: string
  sourceWalletAddress?: string | null
}): MexasWithdrawDestinationIssue | undefined {
  let destination: string
  try {
    destination = normalizeEvmAddress(params.destinationAddress.trim())
  } catch {
    return 'invalid-destination'
  }

  if (destination === ZERO_EVM_ADDRESS) return 'zero-address'
  if (destination === normalizeEvmAddress(MEXAS_TOKEN.address)) {
    return 'token-contract'
  }

  if (params.sourceWalletAddress) {
    try {
      if (destination === normalizeEvmAddress(params.sourceWalletAddress)) {
        return 'same-wallet'
      }
    } catch {
      return 'invalid-destination'
    }
  }

  return undefined
}

export function getMexasWithdrawDisabledReason(params: {
  amountUnits: bigint | undefined
  destinationIssue: MexasWithdrawDestinationIssue | undefined
  hasWallet: boolean
  withdrawing: boolean
  withdrawableUnits: bigint | null
}) {
  if (!params.hasWallet) return 'missing-wallet'
  if (params.withdrawing) return 'withdrawing'
  if (params.destinationIssue) return params.destinationIssue
  if (!params.amountUnits || params.amountUnits <= 0n) return 'missing-amount'
  if (params.withdrawableUnits === null) return 'syncing-balance'
  if (params.amountUnits > params.withdrawableUnits) {
    return 'amount-exceeds-available'
  }

  return undefined
}

export function getMexasWithdrawButtonLabel(
  reason: MexasWithdrawDisabledReason | undefined
) {
  switch (reason) {
    case 'amount-exceeds-available':
      return 'Saldo insuficiente'
    case 'invalid-destination':
      return 'Ingresa destino'
    case 'same-wallet':
      return 'Usa otro destino'
    case 'token-contract':
      return 'Destino inválido'
    case 'zero-address':
      return 'Destino inválido'
    case 'missing-amount':
      return 'Ingresa cantidad'
    case 'missing-wallet':
      return 'Wallet no conectada'
    case 'syncing-balance':
      return 'Actualizando saldo'
    case 'withdrawing':
      return 'Retirando...'
    default:
      return 'Retirar MEX'
  }
}
