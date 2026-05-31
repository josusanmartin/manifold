'use client'

import {
  PrivyProvider,
  useCreateWallet,
  usePrivy,
  useWallets,
  type User as PrivyUser,
} from '@privy-io/react-auth'
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import { arbitrum } from 'viem/chains'

type PrivyWalletConfig = {
  configured: boolean
  missingEnv: string[]
}

const PrivyWalletConfigContext = createContext<PrivyWalletConfig>({
  configured: false,
  missingEnv: ['NEXT_PUBLIC_PRIVY_APP_ID'],
})

type PrivyLoginContextValue = {
  configured: boolean
  ready: boolean
  authenticated: boolean
  user: PrivyUser | null
  login: () => void
  logout: () => Promise<void>
  getAccessToken: () => Promise<string | null>
  walletAddress?: string
  ensureEmbeddedWallet: () => Promise<string | undefined>
}

const emptyPrivyLoginContext: PrivyLoginContextValue = {
  configured: false,
  ready: false,
  authenticated: false,
  user: null,
  login: () => undefined,
  logout: async () => undefined,
  getAccessToken: async () => null,
  ensureEmbeddedWallet: async () => undefined,
}

const PrivyLoginContext = createContext<PrivyLoginContextValue>(
  emptyPrivyLoginContext
)

export function usePrivyWalletConfig() {
  return useContext(PrivyWalletConfigContext)
}

export function usePrivyLogin() {
  return useContext(PrivyLoginContext)
}

function PrivyLoginProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken } =
    usePrivy()
  const { createWallet } = useCreateWallet()
  const { wallets, ready: walletsReady } = useWallets()
  const embeddedWallet = wallets.find(
    (wallet) => wallet.walletClientType === 'privy'
  )
  const walletAddress = embeddedWallet?.address
  const ensureEmbeddedWallet = useCallback(async () => {
    if (walletAddress) return walletAddress
    if (!ready || !authenticated || !walletsReady) return undefined

    const wallet = await createWallet()
    return wallet.address
  }, [authenticated, createWallet, ready, walletAddress, walletsReady])

  const value = useMemo(
    () => ({
      configured: true,
      ready: ready && walletsReady,
      authenticated,
      user,
      login: () => login(),
      logout,
      getAccessToken,
      walletAddress,
      ensureEmbeddedWallet,
    }),
    [
      authenticated,
      ensureEmbeddedWallet,
      getAccessToken,
      login,
      logout,
      ready,
      user,
      walletAddress,
      walletsReady,
    ]
  )

  return (
    <PrivyLoginContext.Provider value={value}>
      {children}
    </PrivyLoginContext.Provider>
  )
}

export function PrivyWalletProviders({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const missingEnv = appId ? [] : ['NEXT_PUBLIC_PRIVY_APP_ID']
  const config = {
    configured: missingEnv.length === 0,
    missingEnv,
  }

  if (!appId) {
    return (
      <PrivyWalletConfigContext.Provider value={config}>
        <PrivyLoginContext.Provider value={emptyPrivyLoginContext}>
          {children}
        </PrivyLoginContext.Provider>
      </PrivyWalletConfigContext.Provider>
    )
  }

  return (
    <PrivyWalletConfigContext.Provider value={config}>
      <PrivyProvider
        appId={appId}
        config={{
          defaultChain: arbitrum,
          supportedChains: [arbitrum],
          loginMethods: ['email', 'wallet'],
          embeddedWallets: {
            ethereum: {
              createOnLogin: 'all-users',
            },
          },
        }}
      >
        <PrivyLoginProvider>{children}</PrivyLoginProvider>
      </PrivyProvider>
    </PrivyWalletConfigContext.Provider>
  )
}
