import {
  getMexasWithdrawButtonLabel,
  getMexasWithdrawDestinationIssue,
  getMexasWithdrawDisabledReason,
} from './mexas-wallet'
import { MEXAS_TOKEN } from './crypto/mexas'

const walletAddress = '0x1111111111111111111111111111111111111111'
const recipientAddress = '0x2222222222222222222222222222222222222222'

describe('MEXAS wallet withdraw validation', () => {
  test('requires a connected wallet before allowing withdrawal', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      destinationIssue: undefined,
      hasWallet: false,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('missing-wallet')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Wallet no conectada')
  })

  test('requires a valid destination address', () => {
    const destinationIssue = getMexasWithdrawDestinationIssue({
      destinationAddress: 'not-an-address',
      sourceWalletAddress: walletAddress,
    })
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      destinationIssue,
      hasWallet: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('invalid-destination')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Ingresa destino')
  })

  test('blocks unsafe destination addresses', () => {
    expect(
      getMexasWithdrawDestinationIssue({
        destinationAddress: '0x0000000000000000000000000000000000000000',
        sourceWalletAddress: walletAddress,
      })
    ).toBe('zero-address')

    expect(
      getMexasWithdrawDestinationIssue({
        destinationAddress: MEXAS_TOKEN.address,
        sourceWalletAddress: walletAddress,
      })
    ).toBe('token-contract')

    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      destinationIssue: getMexasWithdrawDestinationIssue({
        destinationAddress: walletAddress.toUpperCase().replace('X', 'x'),
        sourceWalletAddress: walletAddress,
      }),
      hasWallet: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('same-wallet')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Usa otro destino')
  })

  test('requires a positive amount', () => {
    expect(
      getMexasWithdrawDisabledReason({
        amountUnits: undefined,
        destinationIssue: undefined,
        hasWallet: true,
        withdrawing: false,
        withdrawableUnits: 1n,
      })
    ).toBe('missing-amount')

    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 0n,
      destinationIssue: undefined,
      hasWallet: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('missing-amount')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Ingresa cantidad')
  })

  test('waits for synced withdrawable balance', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      destinationIssue: undefined,
      hasWallet: true,
      withdrawing: false,
      withdrawableUnits: null,
    })

    expect(reason).toBe('syncing-balance')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Actualizando saldo')
  })

  test('blocks amounts above available MEX', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 2n,
      destinationIssue: undefined,
      hasWallet: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBe('amount-exceeds-available')
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Saldo insuficiente')
  })

  test('allows a valid withdrawal request', () => {
    const reason = getMexasWithdrawDisabledReason({
      amountUnits: 1n,
      destinationIssue: getMexasWithdrawDestinationIssue({
        destinationAddress: recipientAddress,
        sourceWalletAddress: walletAddress,
      }),
      hasWallet: true,
      withdrawing: false,
      withdrawableUnits: 1n,
    })

    expect(reason).toBeUndefined()
    expect(getMexasWithdrawButtonLabel(reason)).toBe('Retirar MEX')
  })
})
