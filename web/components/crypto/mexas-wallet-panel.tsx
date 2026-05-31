'use client'

import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  RefreshIcon,
} from '@heroicons/react/outline'
import { useCreateWallet, usePrivy, useWallets } from '@privy-io/react-auth'
import { MEXAS_TOKEN } from 'common/crypto/mexas'
import { useCallback, useEffect, useState } from 'react'
import { type Address } from 'viem'
import { Button } from 'web/components/buttons/button'
import { usePrivyWalletConfig } from 'web/components/crypto/privy-wallet-providers'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { LoadingIndicator } from 'web/components/widgets/loading-indicator'
import {
  formatMexasUnits,
  getArbiscanAddressUrl,
  getMexasBalanceUnits,
} from 'web/lib/crypto/mexas'

function MissingPrivyConfig(props: { missingEnv: string[] }) {
  return (
    <Col className="border-ink-200 bg-canvas-50 text-ink-600 gap-2 rounded-md border p-3 text-sm">
      <div className="font-semibold">Privy wallet is not configured.</div>
      <div>Set {props.missingEnv.join(', ')} before deploying this rail.</div>
    </Col>
  )
}

export function MexasWalletPanel() {
  const config = usePrivyWalletConfig()
  if (!config.configured) {
    return <MissingPrivyConfig missingEnv={config.missingEnv} />
  }

  return <MexasWalletPanelInner />
}

function MexasWalletPanelInner() {
  const { ready, authenticated, login } = usePrivy()
  const { createWallet } = useCreateWallet()
  const { wallets, ready: walletsReady } = useWallets()
  const [loadingWallet, setLoadingWallet] = useState(false)
  const [copied, setCopied] = useState(false)
  const [balanceUnits, setBalanceUnits] = useState<bigint | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)

  const wallet = wallets.find((wallet) => wallet.walletClientType === 'privy')
  const walletAddress = wallet?.address as Address | undefined

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return
    setBalanceError(null)
    try {
      setBalanceUnits(await getMexasBalanceUnits(walletAddress))
    } catch (error) {
      console.error('Failed to read MEXAS balance', error)
      setBalanceError('Could not load MEX balance.')
    }
  }, [walletAddress])

  useEffect(() => {
    refreshBalance()
  }, [refreshBalance])

  const createPrivyWallet = async () => {
    setLoadingWallet(true)
    setBalanceError(null)
    try {
      await createWallet()
    } catch (error) {
      console.error('Failed to create Privy wallet', error)
      setBalanceError('Could not create wallet. Please try again.')
    } finally {
      setLoadingWallet(false)
    }
  }

  const copyAddress = async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  if (!ready || !walletsReady) {
    return (
      <Button
        className="disabled:bg-ink-300 w-full bg-slate-950 text-white"
        color="none"
        size="lg"
        disabled
      >
        <LoadingIndicator size="sm" className="mr-2 !text-white" />
        Loading wallet...
      </Button>
    )
  }

  if (!authenticated) {
    return (
      <Button
        className="disabled:bg-ink-300 w-full bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        color="none"
        size="lg"
        onClick={() => login()}
      >
        Connect Privy wallet
      </Button>
    )
  }

  if (!walletAddress) {
    return (
      <Col className="gap-3">
        <Button
          className="disabled:bg-ink-300 w-full bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          color="none"
          size="lg"
          loading={loadingWallet}
          onClick={createPrivyWallet}
        >
          Create Privy wallet
        </Button>
        {balanceError && (
          <div className="text-scarlet-600 text-xs">{balanceError}</div>
        )}
      </Col>
    )
  }

  return (
    <Col className="border-ink-200 gap-4 rounded-md border p-3">
      <Col className="gap-1">
        <div className="text-ink-500 text-xs font-medium uppercase">
          Available MEX
        </div>
        <Row className="items-baseline gap-2">
          <span className="text-ink-1000 text-3xl font-semibold tracking-normal">
            {balanceUnits === null ? '--' : formatMexasUnits(balanceUnits)}
          </span>
          <span className="text-ink-500 text-sm font-semibold">
            {MEXAS_TOKEN.symbol}
          </span>
        </Row>
      </Col>

      <Col className="border-ink-200 bg-canvas-50 gap-2 rounded-md border p-3">
        <div className="text-ink-500 text-xs font-medium uppercase">
          Deposit wallet
        </div>
        <div className="text-ink-900 break-all font-mono text-xs">
          {walletAddress}
        </div>
        <Row className="flex-wrap gap-2">
          <Button color="gray-white" size="sm" onClick={copyAddress}>
            <ClipboardCopyIcon className="mr-1 h-4 w-4" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button color="gray-white" size="sm" onClick={refreshBalance}>
            <RefreshIcon className="mr-1 h-4 w-4" />
            Refresh
          </Button>
          <a
            href={getArbiscanAddressUrl(walletAddress)}
            target="_blank"
            rel="noreferrer"
            className="border-ink-300 bg-canvas-0 text-ink-700 hover:bg-canvas-50 inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            Arbiscan
            <ExternalLinkIcon className="ml-1 h-4 w-4" />
          </a>
        </Row>
      </Col>

      <div className="text-ink-600 border-ink-200 rounded-md border bg-teal-50/70 p-3 text-sm dark:bg-teal-950/20">
        Deposit {MEXAS_TOKEN.symbol} directly to this Privy wallet on{' '}
        {MEXAS_TOKEN.chainName}. The full on-chain balance remains available;
        there is no account-credit checkout or conversion step.
      </div>

      {balanceError && (
        <div className="text-scarlet-600 text-xs">{balanceError}</div>
      )}
    </Col>
  )
}
