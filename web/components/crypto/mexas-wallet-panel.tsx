'use client'

import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  PaperAirplaneIcon,
  QrcodeIcon,
  RefreshIcon,
} from '@heroicons/react/outline'
import {
  useCreateWallet,
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from '@privy-io/react-auth'
import { MEXAS_TOKEN } from 'common/crypto/mexas'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  encodeFunctionData,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { Button } from 'web/components/buttons/button'
import { usePrivyWalletConfig } from 'web/components/crypto/privy-wallet-providers'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { LoadingIndicator } from 'web/components/widgets/loading-indicator'
import { QRCode } from 'web/components/widgets/qr-code'
import {
  formatMexasUnits,
  getArbiscanAddressUrl,
  getArbiscanTxUrl,
  getMexasBalanceUnits,
  mexasErc20Abi,
} from 'web/lib/crypto/mexas'

function MissingPrivyConfig(props: { missingEnv: string[] }) {
  return (
    <Col className="border-ink-200 bg-canvas-50 text-ink-600 gap-2 rounded-md border p-3 text-sm">
      <div className="font-semibold">Privy wallet is not configured.</div>
      <div>Set {props.missingEnv.join(', ')} before deploying this rail.</div>
    </Col>
  )
}

function compactAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getDisplayBalance(units: bigint | null) {
  if (units === null) return '--'
  const formatted = formatMexasUnits(units)
  if (!formatted.includes('.')) return formatted
  return formatted.replace(/(\.\d{0,4})\d*$/, '$1').replace(/\.?0+$/, '')
}

async function copyToClipboard(
  value: string,
  setCopied: (copied: boolean) => void
) {
  await navigator.clipboard.writeText(value)
  setCopied(true)
  setTimeout(() => setCopied(false), 1400)
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
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)
  const [balanceUnits, setBalanceUnits] = useState<bigint | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [withdrawHash, setWithdrawHash] = useState<Hex | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)

  const wallet = wallets.find(
    (wallet) => wallet.walletClientType === 'privy'
  ) as ConnectedWallet | undefined
  const walletAddress = wallet?.address as Address | undefined
  const depositQrValue = walletAddress ?? MEXAS_TOKEN.address

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

  const parsedWithdrawAmount = useMemo(() => {
    if (!withdrawAmount.trim()) return undefined
    try {
      return parseUnits(withdrawAmount.trim(), MEXAS_TOKEN.decimals)
    } catch {
      return undefined
    }
  }, [withdrawAmount])

  const setMaxWithdraw = () => {
    if (balanceUnits !== null) setWithdrawAmount(formatMexasUnits(balanceUnits))
  }

  const withdraw = async () => {
    if (!wallet || !walletAddress) return

    setWithdrawError(null)
    setWithdrawHash(null)

    if (!isAddress(withdrawAddress)) {
      setWithdrawError('Enter a valid destination wallet address.')
      return
    }
    if (!parsedWithdrawAmount || parsedWithdrawAmount <= 0n) {
      setWithdrawError('Enter an amount greater than 0 MEX.')
      return
    }
    if (balanceUnits !== null && parsedWithdrawAmount > balanceUnits) {
      setWithdrawError('Amount exceeds your available MEX balance.')
      return
    }

    setWithdrawing(true)
    try {
      await wallet.switchChain(MEXAS_TOKEN.chainId)
      const provider = await wallet.getEthereumProvider()
      const data = encodeFunctionData({
        abi: mexasErc20Abi,
        functionName: 'transfer',
        args: [withdrawAddress, parsedWithdrawAmount],
      })
      const hash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: walletAddress,
            to: MEXAS_TOKEN.address,
            data,
            value: '0x0',
          },
        ],
      })) as Hex

      setWithdrawHash(hash)
      setWithdrawAmount('')
      setWithdrawAddress('')
      setTimeout(refreshBalance, 4000)
    } catch (error) {
      console.error('Failed to withdraw MEX', error)
      setWithdrawError(
        error instanceof Error
          ? error.message
          : 'Could not submit withdrawal transaction.'
      )
    } finally {
      setWithdrawing(false)
    }
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
    <Col className="border-ink-200 bg-canvas-0 gap-4 rounded-md border p-4">
      <Row className="flex-wrap items-start justify-between gap-4">
        <Col className="gap-1">
          <div className="text-ink-500 text-xs font-medium uppercase">
            Available MEX
          </div>
          <Row className="items-baseline gap-2">
            <span className="text-ink-1000 text-4xl font-semibold tracking-normal">
              {getDisplayBalance(balanceUnits)}
            </span>
            <span className="text-ink-500 text-sm font-semibold">
              {MEXAS_TOKEN.symbol}
            </span>
          </Row>
        </Col>
        <Button color="gray-white" size="sm" onClick={refreshBalance}>
          <RefreshIcon className="mr-1 h-4 w-4" />
          Refresh
        </Button>
      </Row>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Col className="border-ink-200 bg-canvas-50 items-center gap-3 rounded-md border p-3">
          <Row className="text-ink-600 items-center gap-1 text-xs font-medium uppercase">
            <QrcodeIcon className="h-4 w-4" />
            Deposit QR
          </Row>
          <QRCode
            url={depositQrValue}
            width={180}
            height={180}
            className="rounded-md"
          />
          <div className="text-ink-500 text-center text-xs">
            Scan to use your Arbitrum wallet address.
          </div>
        </Col>

        <Col className="gap-3">
          <Col className="border-ink-200 bg-canvas-50 gap-2 rounded-md border p-3">
            <div className="text-ink-500 text-xs font-medium uppercase">
              Deposit address
            </div>
            <div className="text-ink-900 break-all font-mono text-xs">
              {walletAddress}
            </div>
            <Row className="flex-wrap gap-2">
              <Button
                color="gray-white"
                size="sm"
                onClick={() =>
                  copyToClipboard(walletAddress, setCopiedAddress)
                }
              >
                <ClipboardCopyIcon className="mr-1 h-4 w-4" />
                {copiedAddress ? 'Copied' : 'Copy address'}
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

          <Col className="border-ink-200 bg-canvas-50 gap-2 rounded-md border p-3">
            <div className="text-ink-500 text-xs font-medium uppercase">
              Token contract
            </div>
            <div className="text-ink-900 break-all font-mono text-xs">
              {MEXAS_TOKEN.address}
            </div>
            <Row className="flex-wrap gap-2">
              <Button
                color="gray-white"
                size="sm"
                onClick={() =>
                  copyToClipboard(MEXAS_TOKEN.address, setCopiedToken)
                }
              >
                <ClipboardCopyIcon className="mr-1 h-4 w-4" />
                {copiedToken ? 'Copied' : 'Copy token'}
              </Button>
              <a
                href={MEXAS_TOKEN.arbiscanUrl}
                target="_blank"
                rel="noreferrer"
                className="border-ink-300 bg-canvas-0 text-ink-700 hover:bg-canvas-50 inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium"
              >
                Token page
                <ExternalLinkIcon className="ml-1 h-4 w-4" />
              </a>
            </Row>
          </Col>
        </Col>
      </div>

      <Col className="border-ink-200 gap-3 rounded-md border p-3">
        <Col className="gap-1">
          <div className="text-ink-1000 text-base font-semibold">
            Withdraw MEX
          </div>
          <div className="text-ink-500 text-xs">
            Sends {MEXAS_TOKEN.symbol} from your Privy wallet on{' '}
            {MEXAS_TOKEN.chainName}. You need a small amount of Arbitrum ETH for
            gas.
          </div>
        </Col>

        <Col className="gap-2">
          <label className="text-ink-600 text-sm font-medium">
            Destination address
          </label>
          <input
            value={withdrawAddress}
            onChange={(event) => setWithdrawAddress(event.target.value)}
            placeholder="0x..."
            className="border-ink-300 bg-canvas-0 text-ink-900 placeholder:text-ink-400 w-full rounded-md border px-3 py-2 font-mono text-sm"
          />
        </Col>

        <Col className="gap-2">
          <Row className="items-center justify-between">
            <label className="text-ink-600 text-sm font-medium">Amount</label>
            <button
              type="button"
              onClick={setMaxWithdraw}
              className="text-primary-600 hover:text-primary-700 text-xs font-semibold"
            >
              Max
            </button>
          </Row>
          <div className="relative">
            <input
              value={withdrawAmount}
              onChange={(event) => setWithdrawAmount(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="border-ink-300 bg-canvas-0 text-ink-900 placeholder:text-ink-400 w-full rounded-md border py-2 pl-3 pr-14 text-sm"
            />
            <span className="text-ink-500 absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold">
              MEX
            </span>
          </div>
        </Col>

        {withdrawError && (
          <div className="text-scarlet-600 text-sm">{withdrawError}</div>
        )}
        {withdrawHash && (
          <a
            href={getArbiscanTxUrl(withdrawHash)}
            target="_blank"
            rel="noreferrer"
            className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 text-sm font-semibold"
          >
            Withdrawal submitted: {compactAddress(withdrawHash)}
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
        )}

        <Button
          color="none"
          size="lg"
          className="bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          disabled={withdrawing}
          loading={withdrawing}
          onClick={withdraw}
        >
          <PaperAirplaneIcon className="mr-2 h-4 w-4 rotate-45" />
          Withdraw MEX
        </Button>
      </Col>

      <div className="text-ink-600 border-ink-200 rounded-md border bg-teal-50/70 p-3 text-sm dark:bg-teal-950/20">
        Deposit {MEXAS_TOKEN.symbol} directly to this wallet on{' '}
        {MEXAS_TOKEN.chainName}. There is no account-credit checkout or
        conversion step.
      </div>

      {balanceError && (
        <div className="text-scarlet-600 text-xs">{balanceError}</div>
      )}
    </Col>
  )
}
