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
import { type UserAndPrivateUser } from 'common/user'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  encodeFunctionData,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { Button } from 'web/components/buttons/button'
import {
  usePrivyLogin,
  usePrivyWalletConfig,
} from 'web/components/crypto/privy-wallet-providers'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { LoadingIndicator } from 'web/components/widgets/loading-indicator'
import { useUser } from 'web/hooks/use-user'
import { QRCode } from 'web/components/widgets/qr-code'
import {
  formatMexasUnits,
  getArbiscanAddressUrl,
  getArbiscanTxUrl,
  getMexasBalanceUnits,
  mexasErc20Abi,
  mexasPublicClient,
} from 'web/lib/crypto/mexas'

function MissingPrivyConfig(props: { missingEnv: string[] }) {
  return (
    <Col className="border-ink-200 bg-canvas-50 text-ink-600 gap-2 rounded-md border p-3 text-sm">
      <div className="font-semibold">La Wallet Privy no está configurada.</div>
      <div>Configura {props.missingEnv.join(', ')} antes de desplegar.</div>
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

function getDisplayAmount(amount: number | undefined) {
  if (amount === undefined) return '--'
  return amount.toLocaleString('es-MX', {
    maximumFractionDigits: 4,
  })
}

function mexasAmountToUnits(amount: number) {
  return parseUnits(
    Math.max(0, amount).toFixed(MEXAS_TOKEN.decimals),
    MEXAS_TOKEN.decimals
  )
}

function mexasUnitsToAmount(units: bigint) {
  return Number(formatMexasUnits(units))
}

function minUnits(a: bigint, b: bigint) {
  return a < b ? a : b
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

export function MexasWalletSummary(props: { className?: string }) {
  const config = usePrivyWalletConfig()
  const privy = usePrivyLogin()
  const [creatingWallet, setCreatingWallet] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)

  if (!config.configured) {
    return <MissingPrivyConfig missingEnv={config.missingEnv} />
  }

  const createWallet = async () => {
    setCreatingWallet(true)
    setWalletError(null)
    try {
      await privy.ensureEmbeddedWallet()
    } catch (error) {
      console.error('Failed to create Privy wallet', error)
      setWalletError('No se pudo crear la Wallet. Inténtalo de nuevo.')
    } finally {
      setCreatingWallet(false)
    }
  }

  return (
    <Col
      className={`border-ink-200 bg-canvas-0 gap-3 rounded-md border p-4 ${
        props.className ?? ''
      }`}
    >
      <Col className="gap-1">
        <div className="text-ink-500 text-xs font-medium uppercase">
          Dirección de la Wallet
        </div>
        <div className="text-ink-900 break-all font-mono text-xs">
          {!privy.ready
            ? 'Cargando Wallet...'
            : privy.walletAddress ?? 'No conectada'}
        </div>
      </Col>

      {!privy.ready ? (
        <Button
          className="disabled:bg-ink-300 w-full bg-slate-950 text-white"
          color="none"
          size="md"
          disabled
        >
          <LoadingIndicator size="sm" className="mr-2 !text-white" />
          Cargando Wallet...
        </Button>
      ) : !privy.authenticated ? (
        <Button
          className="disabled:bg-ink-300 w-full bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          color="none"
          size="md"
          onClick={privy.login}
        >
          Conectar Wallet
        </Button>
      ) : !privy.walletAddress ? (
        <Button
          className="disabled:bg-ink-300 w-full bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          color="none"
          size="md"
          loading={creatingWallet}
          onClick={createWallet}
        >
          Crear Wallet
        </Button>
      ) : (
        <Link
          href="/wallet"
          className="inline-flex w-full items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          Depositar
        </Link>
      )}

      {walletError && (
        <div className="text-scarlet-600 text-xs">{walletError}</div>
      )}
    </Col>
  )
}

function MexasWalletPanelInner() {
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const { createWallet } = useCreateWallet()
  const { wallets, ready: walletsReady } = useWallets()
  const user = useUser()
  const [loadingWallet, setLoadingWallet] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [balanceUnits, setBalanceUnits] = useState<bigint | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [withdrawHash, setWithdrawHash] = useState<Hex | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [internalAvailableAmount, setInternalAvailableAmount] = useState<
    number | undefined
  >(user?.balance)

  const wallet = wallets.find(
    (wallet) => wallet.walletClientType === 'privy'
  ) as ConnectedWallet | undefined
  const walletAddress = wallet?.address as Address | undefined

  useEffect(() => {
    setInternalAvailableAmount(user?.balance)
  }, [user?.balance])

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return
    setBalanceError(null)
    try {
      setBalanceUnits(await getMexasBalanceUnits(walletAddress))
    } catch (error) {
      console.error('Failed to read MEXAS balance', error)
      setBalanceError('No se pudo cargar el saldo MEX.')
    }
  }, [walletAddress])

  useEffect(() => {
    refreshBalance()
  }, [refreshBalance])

  const syncInternalWalletBalance = useCallback(async () => {
    if (!walletAddress) return

    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch('/api/privy-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ walletAddress }),
      })
      if (!response.ok) return

      const syncedUser = (await response.json()) as UserAndPrivateUser
      setInternalAvailableAmount(syncedUser.user.balance)
    } catch (error) {
      console.error('Failed to sync internal MEX balance', error)
    }
  }, [getAccessToken, walletAddress])

  const refreshWalletState = useCallback(async () => {
    await Promise.all([refreshBalance(), syncInternalWalletBalance()])
  }, [refreshBalance, syncInternalWalletBalance])

  const createPrivyWallet = async () => {
    setLoadingWallet(true)
    setBalanceError(null)
    try {
      await createWallet()
    } catch (error) {
      console.error('Failed to create Privy wallet', error)
      setBalanceError('No se pudo crear la Wallet. Inténtalo de nuevo.')
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

  const internalAvailableUnits = useMemo(() => {
    return internalAvailableAmount === undefined
      ? null
      : mexasAmountToUnits(internalAvailableAmount)
  }, [internalAvailableAmount])
  const withdrawableUnits =
    balanceUnits !== null && internalAvailableUnits !== null
      ? minUnits(balanceUnits, internalAvailableUnits)
      : balanceUnits ?? internalAvailableUnits

  const setMaxWithdraw = () => {
    if (withdrawableUnits !== null) {
      setWithdrawAmount(formatMexasUnits(withdrawableUnits))
    }
  }

  const withdraw = async () => {
    if (!wallet || !walletAddress) return

    setWithdrawError(null)
    setWithdrawHash(null)

    if (!isAddress(withdrawAddress)) {
      setWithdrawError('Ingresa una dirección de destino válida.')
      return
    }
    if (!parsedWithdrawAmount || parsedWithdrawAmount <= 0n) {
      setWithdrawError('Ingresa una cantidad mayor que 0 MEX.')
      return
    }
    if (
      withdrawableUnits !== null &&
      parsedWithdrawAmount > withdrawableUnits
    ) {
      setWithdrawError(
        'La cantidad supera tu MEX disponible. Cancela órdenes abiertas antes de retirar MEX comprometido.'
      )
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
      setBalanceUnits((units) =>
        units === null
          ? units
          : units > parsedWithdrawAmount
          ? units - parsedWithdrawAmount
          : 0n
      )
      setInternalAvailableAmount((amount) =>
        amount === undefined
          ? amount
          : Math.max(0, amount - mexasUnitsToAmount(parsedWithdrawAmount))
      )
      setWithdrawAmount('')
      setWithdrawAddress('')
      mexasPublicClient
        .waitForTransactionReceipt({ hash })
        .then(refreshWalletState)
        .catch(() => setTimeout(refreshWalletState, 4000))
    } catch (error) {
      console.error('Failed to withdraw MEX', error)
      setWithdrawError(
        error instanceof Error
          ? error.message
          : 'No se pudo enviar la transacción de retiro.'
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
        Cargando Wallet...
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
        Conectar Wallet Privy
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
          Crear Wallet Privy
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
            MEX on-chain
          </div>
          <Row className="items-baseline gap-2">
            <span className="text-ink-1000 text-4xl font-semibold tracking-normal">
              {getDisplayBalance(balanceUnits)}
            </span>
            <span className="text-ink-500 text-sm font-semibold">
              {MEXAS_TOKEN.symbol}
            </span>
          </Row>
          <div className="text-ink-500 text-sm">
            Disponible para órdenes: {getDisplayAmount(internalAvailableAmount)}{' '}
            {MEXAS_TOKEN.symbol}
          </div>
        </Col>
        <Button color="gray-white" size="sm" onClick={refreshWalletState}>
          <RefreshIcon className="mr-1 h-4 w-4" />
          Actualizar
        </Button>
      </Row>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Col className="border-ink-200 bg-canvas-50 items-center gap-3 rounded-md border p-3">
          <Row className="text-ink-600 items-center gap-1 text-xs font-medium uppercase">
            <QrcodeIcon className="h-4 w-4" />
            QR de depósito
          </Row>
          <QRCode
            url={walletAddress}
            width={180}
            height={180}
            className="rounded-md"
          />
          <div className="text-ink-500 text-center text-xs">
            Escanea para usar tu dirección de Arbitrum.
          </div>
        </Col>

        <Col className="gap-3">
          <Col className="border-ink-200 bg-canvas-50 gap-2 rounded-md border p-3">
            <div className="text-ink-500 text-xs font-medium uppercase">
              Dirección de depósito
            </div>
            <div className="text-ink-900 break-all font-mono text-xs">
              {walletAddress}
            </div>
            <Row className="flex-wrap gap-2">
              <Button
                color="gray-white"
                size="sm"
                onClick={() => copyToClipboard(walletAddress, setCopiedAddress)}
              >
                <ClipboardCopyIcon className="mr-1 h-4 w-4" />
                {copiedAddress ? 'Copiada' : 'Copiar dirección'}
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
        </Col>
      </div>

      <Col className="border-ink-200 gap-3 rounded-md border p-3">
        <Col className="gap-1">
          <div className="text-ink-1000 text-base font-semibold">
            Retirar MEX
          </div>
          <div className="text-ink-500 text-xs">
            Envía {MEXAS_TOKEN.symbol} desde tu Wallet Privy en{' '}
            {MEXAS_TOKEN.chainName}. Necesitas una pequeña cantidad de ETH en
            Arbitrum para el gas.
          </div>
        </Col>

        <Col className="gap-2">
          <label className="text-ink-600 text-sm font-medium">
            Dirección de destino
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
            <label className="text-ink-600 text-sm font-medium">Cantidad</label>
            <button
              type="button"
              onClick={setMaxWithdraw}
              className="text-primary-600 hover:text-primary-700 text-xs font-semibold"
            >
              Máx.
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
            Retiro enviado: {compactAddress(withdrawHash)}
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
          Retirar MEX
        </Button>
      </Col>

      <div className="text-ink-600 border-ink-200 rounded-md border bg-teal-50/70 p-3 text-sm dark:bg-teal-950/20">
        Deposita {MEXAS_TOKEN.symbol} directamente en esta Wallet en{' '}
        {MEXAS_TOKEN.chainName}. No hay conversión ni saldo interno separado.
      </div>

      {balanceError && (
        <div className="text-scarlet-600 text-xs">{balanceError}</div>
      )}
    </Col>
  )
}
