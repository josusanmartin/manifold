'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { usePrivy } from '@privy-io/react-auth'
import { createContext, ReactNode, useContext } from 'react'
import { arbitrum } from 'viem/chains'

type PrivyWalletConfig = {
  configured: boolean
  missingEnv: string[]
}

const PrivyWalletConfigContext = createContext<PrivyWalletConfig>({
  configured: false,
  missingEnv: ['NEXT_PUBLIC_PRIVY_APP_ID'],
})

const PrivyLoginContext = createContext<{
  configured: boolean
  ready: boolean
  login: () => void
}>({
  configured: false,
  ready: false,
  login: () => undefined,
})

export function usePrivyWalletConfig() {
  return useContext(PrivyWalletConfigContext)
}

export function usePrivyLogin() {
  return useContext(PrivyLoginContext)
}

function PrivyLoginProvider({ children }: { children: ReactNode }) {
  const { ready, login } = usePrivy()

  return (
    <PrivyLoginContext.Provider
      value={{ configured: true, ready, login: () => login() }}
    >
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
        <PrivyLoginContext.Provider
          value={{ configured: false, ready: false, login: () => undefined }}
        >
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
              createOnLogin: 'users-without-wallets',
            },
          },
        }}
      >
        <PrivyLoginProvider>{children}</PrivyLoginProvider>
      </PrivyProvider>
    </PrivyWalletConfigContext.Provider>
  )
}
