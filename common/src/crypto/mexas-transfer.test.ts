import { MEXAS_TOKEN } from './mexas'
import {
  ERC20_TRANSFER_TOPIC,
  evmAddressTopic,
  getConfirmedMexasTransferUnits,
  getMexasTransferUnits,
  mexasUnitsToTokenAmount,
  normalizeEvmAddress,
  parseErc20TransferUnits,
  type MexasTransferReceipt,
} from './mexas-transfer'

const payer = '0x1111111111111111111111111111111111111111'
const treasury = '0x2222222222222222222222222222222222222222'
const other = '0x3333333333333333333333333333333333333333'

function transferLog(props: {
  amount: bigint
  from?: string
  to?: string
  token?: string
}) {
  return {
    address: props.token ?? MEXAS_TOKEN.address,
    topics: [
      ERC20_TRANSFER_TOPIC,
      evmAddressTopic(props.from ?? payer),
      evmAddressTopic(props.to ?? treasury),
    ],
    data: `0x${props.amount.toString(16)}`,
  }
}

describe('MEXAS ERC20 transfer parsing', () => {
  test('normalizes EVM addresses and topics', () => {
    expect(normalizeEvmAddress(payer.toUpperCase().replace('X', 'x'))).toBe(
      payer
    )
    expect(evmAddressTopic(payer)).toBe(`0x${'0'.repeat(24)}${payer.slice(2)}`)
  })

  test('sums only confirmed MEXAS transfers from payer to treasury', () => {
    const receipt: MexasTransferReceipt = {
      status: '0x1',
      logs: [
        transferLog({ amount: 2_000_000n }),
        transferLog({ amount: 3_500_000n }),
        transferLog({ amount: 9_000_000n, from: other }),
        transferLog({ amount: 9_000_000n, to: other }),
        transferLog({
          amount: 9_000_000n,
          token: '0x4444444444444444444444444444444444444444',
        }),
      ],
    }

    expect(getMexasTransferUnits(receipt, payer, treasury)).toBe(5_500_000n)
    expect(getConfirmedMexasTransferUnits(receipt, payer, treasury)).toBe(
      5_500_000n
    )
    expect(mexasUnitsToTokenAmount(5_500_000n)).toBe(5.5)
  })

  test('returns zero for failed receipts', () => {
    expect(
      getConfirmedMexasTransferUnits(
        {
          status: '0x0',
          logs: [transferLog({ amount: 1_000_000n })],
        },
        payer,
        treasury
      )
    ).toBe(0n)
  })

  test('rejects malformed addresses and ERC20 amount data', () => {
    expect(() => normalizeEvmAddress('0x123')).toThrow('Invalid EVM address')
    expect(() => evmAddressTopic('not-an-address')).toThrow(
      'Invalid EVM address'
    )
    expect(() => parseErc20TransferUnits('nope')).toThrow(
      'Invalid ERC20 transfer amount data'
    )
    expect(() => mexasUnitsToTokenAmount(10_000_000_000_000_000n)).toThrow(
      'MEXAS transfer amount is too large'
    )
  })
})
