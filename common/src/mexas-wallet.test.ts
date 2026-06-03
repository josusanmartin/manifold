import {
  getMexasWithdrawButtonLabel,
  getMexasWithdrawDisabledReason,
} from './mexas-wallet'

describe('MEXAS wallet withdraw validation', () => {
  test('requires a connected wallet before allowing withdrawal', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      hasWallet: false,
      isDestinationAddressValid: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('missing-wallet')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Wallet no conectada')
  })

  test('requires a valid destination address', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      hasWallet: true,
      isDestinationAddressValid: false,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('invalid-destination')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Ingresa destino')
  })

  test('requires a positive amount', () => {
    expect(
      getMexasWithdrawDisabledReason({
        amountUnits: undefined,
        hasWallet: true,
        isDestinationAddressValid: true,
        withdrawing: false,
        withdrawableUnits: 1n,
      })
    ).toBe('missing-amount')

    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 0n,
      hasWallet: true,
      isDestinationAddressValid: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('missing-amount')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Ingresa cantidad')
  })

  test('waits for synced withdrawable balance', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      hasWallet: true,
      isDestinationAddressValid: true,
      withdrawing: false,
      withdrawableUnits: null,
    })

    expect(reason).toBe('syncing-balance')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Actualizando saldo')
  })

  test('blocks amounts above available MEX', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 2n,
      hasWallet: true,
      isDestinationAddressValid: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('amount-exceeds-available')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Saldo insuficiente')
  })

  test('allows a valid withdrawal request', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      hasWallet: true,
      isDestinationAddressValid: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBeUndefined()
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Retirar MEX')
  })
})
