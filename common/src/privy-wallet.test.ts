import {
  getPrivyEmbeddedEthereumWalletAddresses,
  getStablePrivyEmbeddedEthereumWallet,
  getVerifiedPrivyEmbeddedEthereumWallet,
  type PrivyLinkedAccountLike,
} from './privy-wallet'

const embeddedWallet = (
  address: string,
  props: Partial<PrivyLinkedAccountLike> = {}
): PrivyLinkedAccountLike => ({
  type: 'wallet',
  chain_type: 'ethereum',
  wallet_client_type: 'privy',
  address,
  ...props,
})

describe('Privy wallet selection', () => {
  test('lists only embedded Privy Ethereum wallets', () => {
    const linkedAccounts: PrivyLinkedAccountLike[] = [
      embeddedWallet('0x1111111111111111111111111111111111111111'),
      embeddedWallet('0x2222222222222222222222222222222222222222', {
        wallet_client_type: 'metamask',
      }),
      embeddedWallet('0x3333333333333333333333333333333333333333', {
        chain_type: 'solana',
      }),
      { type: 'email', address: 'user@example.com' },
      { type: 'wallet', chain_type: 'ethereum', wallet_client_type: 'privy' },
    ]

    expect(getPrivyEmbeddedEthereumWalletAddresses(linkedAccounts)).toEqual([
      '0x1111111111111111111111111111111111111111',
    ])
  })

  test('selects the first embedded wallet when no wallet is requested', () => {
    expect(
      getVerifiedPrivyEmbeddedEthereumWallet([
        embeddedWallet('0x1111111111111111111111111111111111111111'),
        embeddedWallet('0x2222222222222222222222222222222222222222'),
      ])
    ).toBe('0x1111111111111111111111111111111111111111')
  })

  test('matches a requested embedded wallet case-insensitively', () => {
    expect(
      getVerifiedPrivyEmbeddedEthereumWallet(
        [embeddedWallet('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa')],
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      )
    ).toBe('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa')
  })

  test('does not accept unlinked or external requested wallets', () => {
    const linkedAccounts = [
      embeddedWallet('0x1111111111111111111111111111111111111111'),
      embeddedWallet('0x2222222222222222222222222222222222222222', {
        wallet_client_type: 'metamask',
      }),
    ]

    expect(
      getVerifiedPrivyEmbeddedEthereumWallet(
        linkedAccounts,
        '0x2222222222222222222222222222222222222222'
      )
    ).toBeUndefined()
    expect(
      getVerifiedPrivyEmbeddedEthereumWallet(
        linkedAccounts,
        '0x3333333333333333333333333333333333333333'
      )
    ).toBeUndefined()
  })

  test('preserves an existing embedded wallet when no wallet is requested', () => {
    expect(
      getStablePrivyEmbeddedEthereumWallet(
        [
          embeddedWallet('0x1111111111111111111111111111111111111111'),
          embeddedWallet('0x2222222222222222222222222222222222222222'),
        ],
        undefined,
        '0x2222222222222222222222222222222222222222'
      )
    ).toBe('0x2222222222222222222222222222222222222222')
  })

  test('lets an explicitly requested embedded wallet replace the existing wallet', () => {
    expect(
      getStablePrivyEmbeddedEthereumWallet(
        [
          embeddedWallet('0x1111111111111111111111111111111111111111'),
          embeddedWallet('0x2222222222222222222222222222222222222222'),
        ],
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222'
      )
    ).toBe('0x1111111111111111111111111111111111111111')
  })

  test('falls back to the first embedded wallet when the existing wallet is no longer linked', () => {
    expect(
      getStablePrivyEmbeddedEthereumWallet(
        [embeddedWallet('0x1111111111111111111111111111111111111111')],
        undefined,
        '0x2222222222222222222222222222222222222222'
      )
    ).toBe('0x1111111111111111111111111111111111111111')
  })
})
