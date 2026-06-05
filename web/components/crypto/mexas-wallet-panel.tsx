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
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import {
  getMexasWithdrawButtonLabel,
  getMexasWithdrawDestinationIssue,
  getMexasWithdrawDisabledReason,
} from 'common/mexas-wallet'
import { normalizeEvmAddress } from 'common/crypto/mexas-transfer'
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
  const [openReservedAmount, setOpenReservedAmount] = useState<
    number | undefined
  >(user?.mexasWalletOpenReservedAmount)

  const wallet = wallets.find(
    (wallet) => wallet.walletClientType === 'privy'
  ) as ConnectedWallet | undefined
  const walletAddress = wallet?.address as Address | undefined

  useEffect(() => {
    setInternalAvailableAmount(user?.balance)
    setOpenReservedAmount(user?.mexasWalletOpenReservedAmount)
  }, [user?.balance, user?.mexasWalletOpenReservedAmount])

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return undefined
    setBalanceError(null)
    try {
      const units = await getMexasBalanceUnits(walletAddress)
      setBalanceUnits(units)
      return units
    } catch (error) {
      console.error('Failed to read MEXAS balance', error)
      setBalanceError('No se pudo cargar el saldo MEX.')
      return undefined
    }
  }, [walletAddress])

  useEffect(() => {
    refreshBalance()
  }, [refreshBalance])

  const syncInternalWalletBalance = useCallback(
    async (options?: { throwOnError?: boolean }) => {
      if (!walletAddress) return undefined

      try {
        const token = await getAccessToken()
        if (!token) {
          throw new Error('No se pudo autenticar la Wallet.')
        }

        const response = await fetch('/api/privy-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ walletAddress }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => undefined)
          throw new Error(body?.message ?? 'No se pudo sincronizar la Wallet.')
        }

        const syncedUser = (await response.json()) as UserAndPrivateUser
        setInternalAvailableAmount(syncedUser.user.balance)
        setOpenReservedAmount(syncedUser.user.mexasWalletOpenReservedAmount)
        return syncedUser
      } catch (error) {
        if (options?.throwOnError) throw error
        console.error('Failed to sync internal MEX balance', error)
        return undefined
      }
    },
    [getAccessToken, walletAddress]
  )

  const refreshWalletState = useCallback(async () => {
    const [chainUnits, syncedUser] = await Promise.all([
      refreshBalance(),
      syncInternalWalletBalance(),
    ])
    return { chainUnits, syncedUser }
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
      : null
  const withdrawDestinationIssue = getMexasWithdrawDestinationIssue({
    destinationAddress: withdrawAddress,
    sourceWalletAddress: walletAddress,
  })
  const withdrawDisabledReason = getMexasWithdrawDisabledReason({
    amountUnits: parsedWithdrawAmount,
    destinationIssue: withdrawDestinationIssue,
    hasWallet: !!wallet && !!walletAddress,
    withdrawing,
    withdrawableUnits,
  })
  const withdrawButtonLabel = getMexasWithdrawButtonLabel(
    withdrawDisabledReason
  )

  const setMaxWithdraw = () => {
    if (withdrawableUnits !== null) {
      setWithdrawAmount(formatMexasUnits(withdrawableUnits))
    }
  }

  const withdraw = async () => {
    if (!wallet || !walletAddress) return
    if (withdrawDisabledReason) return

    setWithdrawError(null)
    setWithdrawHash(null)

    if (withdrawDestinationIssue) {
      setWithdrawError('Ingresa una dirección de destino válida.')
      return
    }
    const normalizedWithdrawAddress = normalizeEvmAddress(
      withdrawAddress.trim()
    ) as Address
    if (!parsedWithdrawAmount || parsedWithdrawAmount <= 0n) {
      setWithdrawError('Ingresa una cantidad mayor que 0 MEX.')
      return
    }
    setWithdrawing(true)
    let submittedHash: Hex | undefined
    try {
      const latestBalanceUnits = await getMexasBalanceUnits(walletAddress)
      setBalanceUnits(latestBalanceUnits)
      const syncedUser = await syncInternalWalletBalance({ throwOnError: true })
      if (!syncedUser) {
        throw new Error('No se pudo sincronizar tu Wallet antes del retiro.')
      }
      const latestWithdrawableUnits = minUnits(
        latestBalanceUnits,
        mexasAmountToUnits(syncedUser.user.balance)
      )

      if (parsedWithdrawAmount > latestWithdrawableUnits) {
        setWithdrawError(
          'La cantidad supera tu MEX disponible. Cancela órdenes abiertas o espera la resolución de operaciones antes de retirar MEX comprometido.'
        )
        return
      }

      await wallet.switchChain(MEXAS_TOKEN.chainId)
      const provider = await wallet.getEthereumProvider()
      const data = encodeFunctionData({
        abi: mexasErc20Abi,
        functionName: 'transfer',
        args: [normalizedWithdrawAddress, parsedWithdrawAmount],
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

      submittedHash = hash
      setWithdrawHash(hash)
      const receipt = await mexasPublicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        throw new Error('La transacción de retiro no se confirmó.')
      }
      await refreshWalletState()
      setWithdrawAmount('')
      setWithdrawAddress('')
    } catch (error) {
      console.error('Failed to withdraw MEX', error)
      if (submittedHash) setTimeout(refreshWalletState, 4000)
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
            MEX en cadena
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
          <div className="text-ink-500 text-sm">
            Reservado en órdenes abiertas:{' '}
            {getDisplayAmount(openReservedAmount)} {MEXAS_TOKEN.symbol}
          </div>
          <div className="text-ink-500 text-sm">
            Disponible para retirar: {getDisplayBalance(withdrawableUnits)}{' '}
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
          disabled={!!withdrawDisabledReason}
          loading={withdrawing}
          onClick={withdraw}
        >
          <PaperAirplaneIcon className="mr-2 h-4 w-4 rotate-45" />
          {withdrawButtonLabel}
        </Button>
      </Col>

      <div className="text-ink-600 border-ink-200 rounded-md border bg-teal-50/70 p-3 text-sm dark:bg-teal-950/20">
        Deposita {MEXAS_TOKEN.symbol} directamente en esta Wallet en{' '}
        {MEXAS_TOKEN.chainName}. No hay compra de fondos ni conversión; las
        órdenes abiertas descuentan MEX disponible y las operaciones ejecutadas
        comprometen MEX hasta que se cancela, expira o se resuelve el mercado.
      </div>

      {balanceError && (
        <div className="text-scarlet-600 text-xs">{balanceError}</div>
      )}
    </Col>
  )
}
