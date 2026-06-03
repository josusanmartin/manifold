import { MEXAS_TOKEN } from './crypto/mexas'
import { ERC20_TRANSFER_TOPIC, evmAddressTopic } from './crypto/mexas-transfer'
import { getMexasEscrowCaptureCheck, mexasAmountToUnits } from './mexas-escrow'

const payer = '0x1111111111111111111111111111111111111111'
const treasury = '0x2222222222222222222222222222222222222222'

function transferLog(amount: bigint) {
  return {
    address: MEXAS_TOKEN.address,
    topics: [
      ERC20_TRANSFER_TOPIC,
      evmAddressTopic(payer),
      evmAddressTopic(treasury),
    ],
    data: `0x${amount.toString(16)}`,
  }
}

describe('MEXAS escrow capture checks', () => {
  test('converts decimal MEX amounts to token units', () => {
    expect(mexasAmountToUnits(1)).toBe(1_000_000n)
    expect(mexasAmountToUnits(1.234567)).toBe(1_234_567n)
    expect(mexasAmountToUnits(0.000001)).toBe(1n)
  })

  test('accepts confirmed payer-to-treasury transfer covering required stake', () => {
    const check = getMexasEscrowCaptureCheck({
      payerAddress: payer,
      receipt: {
        status: '0x1',
        logs: [transferLog(5_000_000n)],
      },
      requiredAmount: 5,
      treasuryAddress: treasury,
    })

    expect(check).toEqual({
      capturedAmount: 5,
      capturedUnits: 5_000_000n,
      exact: true,
      requiredAmount: 5,
      requiredUnits: 5_000_000n,
      sufficient: true,
    })
  })

  test('rejects insufficient or failed escrow capture receipts', () => {
    expect(
      getMexasEscrowCaptureCheck({
        payerAddress: payer,
        receipt: {
          status: '0x1',
          logs: [transferLog(4_999_999n)],
        },
        requiredAmount: 5,
        treasuryAddress: treasury,
      }).sufficient
    ).toBe(false)

    expect(
      getMexasEscrowCaptureCheck({
        payerAddress: payer,
        receipt: {
          status: '0x1',
          logs: [transferLog(5_000_001n)],
        },
        requiredAmount: 5,
        treasuryAddress: treasury,
      }).exact
    ).toBe(false)

    expect(
      getMexasEscrowCaptureCheck({
        payerAddress: payer,
        receipt: {
          status: '0x0',
          logs: [transferLog(5_000_000n)],
        },
        requiredAmount: 5,
        treasuryAddress: treasury,
      }).capturedUnits
    ).toBe(0n)
  })
})
