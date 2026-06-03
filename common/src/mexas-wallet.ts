export type MexasWithdrawDisabledReason =
  | 'amount-exceeds-available'
  | 'invalid-destination'
  | 'missing-amount'
  | 'missing-wallet'
  | 'syncing-balance'
  | 'withdrawing'

export function getMexasWithdrawDisabledReason(params: {
  amountUnits: bigint | undefined
  hasWallet: boolean
  isDestinationAddressValid: boolean
  withdrawing: boolean
  withdrawableUnits: bigint | null
}) {
  if (!params.hasWallet) return 'missing-wallet'
  if (params.withdrawing) return 'withdrawing'
  if (!params.isDestinationAddressValid) return 'invalid-destination'
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
