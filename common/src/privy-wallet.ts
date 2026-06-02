export type PrivyLinkedAccountLike = {
  type?: string
  address?: string
  chain_type?: string
  wallet_client_type?: string
}

function normalizeAddress(address?: string) {
  return address?.trim().toLowerCase()
}

export function getPrivyEmbeddedEthereumWalletAddresses(
  linkedAccounts: PrivyLinkedAccountLike[]
) {
  return linkedAccounts
    .filter((account) => {
      return (
        account.type === 'wallet' &&
        account.chain_type === 'ethereum' &&
        account.wallet_client_type === 'privy' &&
        typeof account.address === 'string' &&
        account.address.length > 0
      )
    })
    .map((account) => account.address as string)
}

export function getVerifiedPrivyEmbeddedEthereumWallet(
  linkedAccounts: PrivyLinkedAccountLike[],
  requestedWalletAddress?: string | null
) {
  const wallets = getPrivyEmbeddedEthereumWalletAddresses(linkedAccounts)
  const requested = normalizeAddress(requestedWalletAddress ?? undefined)

  if (requested) {
    return wallets.find((address) => normalizeAddress(address) === requested)
  }

  return wallets[0]
}
