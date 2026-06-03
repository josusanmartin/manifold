import {
  findReusableMexasEscrowPendingOrderTx,
  getMexasEscrowPendingOrderIntent,
  makeMexasEscrowPendingOrderTx,
  MEXAS_ESCROW_PENDING_ORDER_TX_TTL_MS,
  removeMexasEscrowPendingOrderTx,
  upsertMexasEscrowPendingOrderTx,
} from './mexas-escrow-pending'

const now = 1_780_000_000_000
const txHash =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const intent = getMexasEscrowPendingOrderIntent({
  amount: 50,
  contractId: 'mexwcwin26a',
  limitProb: 0.3,
  outcome: 'YES',
  treasuryAddress: '0x2222222222222222222222222222222222222222',
  walletAddress: '0x1111111111111111111111111111111111111111',
})!

describe('MEXAS pending escrow order transactions', () => {
  test('normalizes a valid order intent for exact retry matching', () => {
    expect(
      getMexasEscrowPendingOrderIntent({
        amount: 1.2345674,
        contractId: ' mexwcwin26a ',
        limitProb: 0.3000004,
        outcome: 'NO',
        treasuryAddress: ' 0x2222222222222222222222222222222222222222 ',
        walletAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      })
    ).toEqual({
      amount: 1.234567,
      contractId: 'mexwcwin26a',
      limitProb: 0.3,
      outcome: 'NO',
      treasuryAddress: '0x2222222222222222222222222222222222222222',
      walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
  })

  test('rejects incomplete or non-limit retry intents', () => {
    expect(
      getMexasEscrowPendingOrderIntent({
        ...intent,
        amount: 0,
      })
    ).toBeUndefined()
    expect(
      getMexasEscrowPendingOrderIntent({
        ...intent,
        limitProb: undefined,
      })
    ).toBeUndefined()
    expect(
      getMexasEscrowPendingOrderIntent({
        ...intent,
        outcome: undefined,
      })
    ).toBeUndefined()
  })

  test('reuses only fresh pending transactions for the same order intent', () => {
    const pending = makeMexasEscrowPendingOrderTx(intent, {
      createdTime: now,
      txHash,
    })

    expect(
      findReusableMexasEscrowPendingOrderTx([pending], intent, now + 1_000)
    ).toEqual(pending)
    expect(
      findReusableMexasEscrowPendingOrderTx(
        [pending],
        { ...intent, outcome: 'NO' },
        now + 1_000
      )
    ).toBeUndefined()
    expect(
      findReusableMexasEscrowPendingOrderTx(
        [pending],
        intent,
        now + MEXAS_ESCROW_PENDING_ORDER_TX_TTL_MS + 1
      )
    ).toBeUndefined()
  })

  test('upserts recent pending transactions and removes registered hashes', () => {
    const stale = makeMexasEscrowPendingOrderTx(intent, {
      createdTime: now - MEXAS_ESCROW_PENDING_ORDER_TX_TTL_MS - 1,
      txHash:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    const pending = makeMexasEscrowPendingOrderTx(intent, {
      createdTime: now,
      txHash,
    })

    expect(upsertMexasEscrowPendingOrderTx([stale], pending, now)).toEqual([
      pending,
    ])
    expect(removeMexasEscrowPendingOrderTx([pending], txHash)).toEqual([])
  })
})
