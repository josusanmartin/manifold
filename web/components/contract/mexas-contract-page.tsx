import { useWallets, type ConnectedWallet } from '@privy-io/react-auth'
import clsx from 'clsx'
import { Bet, LimitBet } from 'common/bet'
import {
  MarketContract,
  type resolution,
  tradingAllowed,
  type ContractParams,
} from 'common/contract'
import { MEXAS_TOKEN } from 'common/crypto/mexas'
import {
  findReusableMexasEscrowPendingOrderTx,
  getMexasEscrowPendingOrderIntent,
  makeMexasEscrowPendingOrderTx,
  pruneMexasEscrowPendingOrderTxs,
  removeMexasEscrowPendingOrderTx,
  upsertMexasEscrowPendingOrderTx,
  type MexasEscrowPendingOrderIntent,
  type MexasEscrowPendingOrderTx,
} from 'common/mexas-escrow-pending'
import { getMexasOpenOrderAmount } from 'common/mexas-order-book'
import {
  getMexasCrossingOrders,
  getMexasOrderPrice,
  getMexasOrderShares,
  type MexasOrderExecutionMode,
  type MexasOutcome,
} from 'common/mexas-order-book'
import {
  formatPercent,
  formatWithToken,
  shortFormatNumber,
} from 'common/util/format'
import dayjs from 'dayjs'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isAddress, parseUnits, encodeFunctionData, type Hex } from 'viem'
import { Button } from 'web/components/buttons/button'
import { SignUpButton } from 'web/components/buttons/sign-up-button'
import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import {
  fetchMexasOrderReadiness,
  useMexasOrderReadiness,
} from 'web/hooks/use-mexas-order-readiness'
import {
  mexasOrderBookPriceLabel,
  useMexasOrderBookMidPrice,
} from 'web/hooks/use-mexas-order-book-mid-price'
import { mexasErc20Abi } from 'web/lib/crypto/mexas'
import { Input } from '../widgets/input'
import { MarketOrderBookPanel } from './order-book-panel'

const MEXAS_ESCROW_PENDING_TX_STORAGE_KEY = 'mexas-pending-escrow-order-txs'

function isOpenMexasLimitBet(bet: Bet): bet is LimitBet {
  return (
    bet.limitProb !== undefined &&
    bet.orderAmount !== undefined &&
    !bet.isFilled &&
    !bet.isCancelled &&
    getMexasOpenOrderAmount(bet as LimitBet) > 0
  )
}

function priceLabel(limitProb: number) {
  return `${Math.round(limitProb * 100)}%`
}

function formatMex(amount: number) {
  return formatWithToken({ amount, token: 'MEX' })
}

function outcomeLabel(outcome: resolution | undefined) {
  return outcome === 'YES'
    ? 'SÍ'
    : outcome === 'NO'
    ? 'NO'
    : outcome === 'CANCEL'
    ? 'CANCELAR'
    : ''
}

async function authedMexasFetch(
  path: string,
  params: {
    getAccessToken: () => Promise<string | null>
    login: () => void
    body?: unknown
    method?: 'GET' | 'POST'
  }
) {
  const token = await params.getAccessToken()
  if (!token) {
    params.login()
    throw new Error('Conecta Privy para continuar.')
  }

  const response = await fetch(path, {
    method: params.method ?? (params.body === undefined ? 'GET' : 'POST'),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(params.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
  })
  const data = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(data?.message ?? 'No se pudo completar la operacion.')
  }
  return data
}

function mexasAmountToUnits(amount: number) {
  return parseUnits(
    Math.max(0, amount).toFixed(MEXAS_TOKEN.decimals),
    MEXAS_TOKEN.decimals
  )
}

function shortenTxHash(txHash: string) {
  return `${txHash.slice(0, 8)}...${txHash.slice(-6)}`
}

function readStoredMexasPendingEscrowOrderTxs() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(MEXAS_ESCROW_PENDING_TX_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return pruneMexasEscrowPendingOrderTxs(
      parsed.filter(
        (entry): entry is MexasEscrowPendingOrderTx =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof entry.txHash === 'string' &&
          typeof entry.contractId === 'string' &&
          (entry.outcome === 'YES' || entry.outcome === 'NO') &&
          typeof entry.amount === 'number' &&
          typeof entry.limitProb === 'number' &&
          typeof entry.treasuryAddress === 'string' &&
          typeof entry.walletAddress === 'string' &&
          typeof entry.createdTime === 'number'
      )
    )
  } catch {
    return []
  }
}

function writeStoredMexasPendingEscrowOrderTxs(
  pendingTxs: MexasEscrowPendingOrderTx[]
) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      MEXAS_ESCROW_PENDING_TX_STORAGE_KEY,
      JSON.stringify(pendingTxs)
    )
  } catch {
    // Best-effort cache; server-side tx uniqueness is authoritative.
  }
}

function findStoredMexasPendingEscrowOrderTx(
  intent: MexasEscrowPendingOrderIntent
) {
  const pendingTxs = readStoredMexasPendingEscrowOrderTxs()
  const reusable = findReusableMexasEscrowPendingOrderTx(pendingTxs, intent)
  writeStoredMexasPendingEscrowOrderTxs(pendingTxs)
  return reusable
}

function upsertStoredMexasPendingEscrowOrderTx(
  pendingTx: MexasEscrowPendingOrderTx
) {
  writeStoredMexasPendingEscrowOrderTxs(
    upsertMexasEscrowPendingOrderTx(
      readStoredMexasPendingEscrowOrderTxs(),
      pendingTx
    )
  )
}

function clearStoredMexasPendingEscrowOrderTx(txHash: string) {
  writeStoredMexasPendingEscrowOrderTxs(
    removeMexasEscrowPendingOrderTx(
      readStoredMexasPendingEscrowOrderTxs(),
      txHash
    )
  )
}

function closeTimeLabel(closeTime: number | undefined) {
  if (!closeTime) return 'Sin cierre'
  return dayjs(closeTime).format('D MMM YYYY')
}

function useMexasOpenOrders(contractId: string) {
  const [orders, setOrders] = useState<LimitBet[]>([])
  const [loading, setLoading] = useState(true)

  const loadOrders = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true)
      try {
        const response = await fetch(
          `/api/mexas-order-book?contractId=${encodeURIComponent(
            contractId
          )}&limit=500`
        )
        if (!response.ok) {
          throw new Error(`No se pudo cargar el libro: ${response.status}`)
        }
        const data = ((await response.json()) as Bet[]).filter(
          isOpenMexasLimitBet
        )
        setOrders(data)
      } catch (error) {
        console.error(error)
        setOrders([])
      } finally {
        setLoading(false)
      }
    },
    [contractId]
  )

  useEffect(() => {
    let cancelled = false

    const load = async (showLoading = false) => {
      if (cancelled) return
      await loadOrders(showLoading)
    }

    load(true)
    const interval = setInterval(() => load(false), 10_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [loadOrders])

  return { loading, orders, reload: () => loadOrders(false) }
}

export function MexasContractPageContent(props: ContractParams) {
  const liveContract = props.contract as MarketContract
  const privy = usePrivyLogin()
  const userId = privy.user?.id
  const isCreator = userId === liveContract.creatorId
  const midPrice = useMexasOrderBookMidPrice(
    liveContract.id,
    !liveContract.isResolved
  )
  const { orders, loading, reload } = useMexasOpenOrders(liveContract.id)
  const [outcome, setOutcome] = useState<'YES' | 'NO' | undefined>()
  const [showResolver, setShowResolver] = useState(false)

  const canResolve =
    liveContract.outcomeType === 'BINARY' &&
    !liveContract.isResolved &&
    isCreator

  return (
    <>
      {!privy.authenticated && (
        <Row className="border-ink-200 bg-canvas-0 sticky top-0 z-50 items-center justify-between border-b px-4 py-2 md:hidden">
          <Link
            href="/checkout"
            className="text-ink-1000 flex items-center gap-2"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-950 text-xs font-bold text-white dark:bg-white dark:text-slate-950">
              M
            </span>
            <span className="text-sm font-semibold">MEXAS</span>
          </Link>
          <SignUpButton />
        </Row>
      )}

      <div className="min-h-screen bg-[#f7f8fa] px-0 dark:bg-slate-950 lg:px-4">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Col className="border-ink-200 bg-canvas-0 min-h-screen border-x px-4 py-4 md:px-8 md:py-6">
            <Link
              href="/checkout"
              className="text-ink-500 hover:text-ink-800 mb-4 text-sm"
            >
              Mercados
            </Link>

            <Col className="gap-4">
              <div>
                <h1 className="text-ink-1000 text-2xl font-semibold leading-tight md:text-3xl">
                  {liveContract.question}
                </h1>
                <Row className="text-ink-500 mt-3 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Link
                    href={`/${liveContract.creatorUsername}`}
                    className="hover:text-ink-800 font-medium"
                  >
                    {liveContract.creatorName}
                  </Link>
                  <span>MEX</span>
                  <span>Cierra {closeTimeLabel(liveContract.closeTime)}</span>
                </Row>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Metric
                  label="Precio"
                  value={mexasOrderBookPriceLabel(midPrice)}
                  sublabel={midPrice == null ? 'solo ordenes limite' : 'medio'}
                />
                <Metric
                  label="Volumen"
                  value={formatMex(liveContract.volume ?? 0)}
                  sublabel="total"
                />
                <Metric
                  label="Operadores"
                  value={shortFormatNumber(liveContract.uniqueBettorCount ?? 0)}
                  sublabel="unicos"
                />
                <Metric
                  label="Libro"
                  value={loading ? '...' : shortFormatNumber(orders.length)}
                  sublabel="ordenes abiertas"
                />
              </div>

              {liveContract.isResolved && (
                <div className="border-ink-200 bg-canvas-50 rounded-md border px-4 py-3 text-sm">
                  Mercado resuelto como {liveContract.resolution}.
                </div>
              )}

              <MarketOrderBookPanel contract={liveContract as any} />

              <MexasUserOrders
                contract={liveContract}
                orders={orders}
                userId={userId}
                onOrderCancelled={reload}
              />

              {canResolve && (
                <Col className="border-ink-200 bg-canvas-0 rounded-md border p-4">
                  <Row className="items-center justify-between gap-3">
                    <Col>
                      <span className="text-ink-1000 font-semibold">
                        Resolucion
                      </span>
                      <span className="text-ink-500 text-sm">
                        Cierra el mercado y liquida MEX desde tesoreria.
                      </span>
                    </Col>
                    <Button
                      color="indigo"
                      size="sm"
                      onClick={() => setShowResolver((value) => !value)}
                    >
                      {showResolver ? 'Ocultar' : 'Resolver'}
                    </Button>
                  </Row>
                  {showResolver && (
                    <div className="mt-4">
                      <MexasResolutionControl
                        contract={liveContract}
                        onClose={() => setShowResolver(false)}
                      />
                    </div>
                  )}
                </Col>
              )}

              <MexasDescription description={liveContract.description} />
            </Col>
          </Col>

          <aside className="lg:py-4">
            <Col className="border-ink-200 bg-canvas-0 sticky top-4 gap-4 border px-4 py-4 md:rounded-md">
              <Row className="items-center justify-between gap-3">
                <Col>
                  <span className="text-ink-1000 font-semibold">
                    Operar con MEX
                  </span>
                  <span className="text-ink-500 text-sm">
                    Solo ordenes limite
                  </span>
                </Col>
                {privy.walletAddress ? (
                  <Link
                    href="/wallet"
                    className="text-ink-700 hover:text-ink-1000 text-xs"
                  >
                    {privy.walletAddress.slice(0, 6)}...
                    {privy.walletAddress.slice(-4)}
                  </Link>
                ) : (
                  <SignUpButton />
                )}
              </Row>

              <Row className="gap-2">
                <OutcomeButton
                  active={outcome === 'YES'}
                  label="Orden SÍ"
                  color="green"
                  onClick={() => setOutcome('YES')}
                />
                <OutcomeButton
                  active={outcome === 'NO'}
                  label="Orden NO"
                  color="red"
                  onClick={() => setOutcome('NO')}
                />
              </Row>

              {tradingAllowed(liveContract) ? (
                <MexasLimitOrderPanel
                  contract={liveContract}
                  userId={userId}
                  unfilledBets={orders}
                  outcome={outcome}
                  onBuySuccess={reload}
                />
              ) : (
                <div className="text-ink-500 border-ink-200 rounded-md border px-3 py-4 text-sm">
                  Este mercado no acepta ordenes nuevas.
                </div>
              )}
            </Col>
          </aside>
        </div>
      </div>
    </>
  )
}

function Metric(props: { label: string; value: string; sublabel: string }) {
  const { label, value, sublabel } = props
  return (
    <Col className="border-ink-200 bg-canvas-0 rounded-md border p-3">
      <span className="text-ink-500 text-xs uppercase">{label}</span>
      <span className="text-ink-1000 mt-1 text-lg font-semibold">{value}</span>
      <span className="text-ink-500 text-xs">{sublabel}</span>
    </Col>
  )
}

function MexasDescription(props: { description: unknown }) {
  const paragraphs = getDescriptionParagraphs(props.description)
  if (paragraphs.length === 0) return null

  return (
    <Col className="mt-6 gap-3 text-base leading-7">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="text-ink-800">
          {paragraph}
        </p>
      ))}
    </Col>
  )
}

function getDescriptionParagraphs(description: unknown) {
  if (typeof description === 'string') {
    return description
      .split(/\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
  }

  if (!description || typeof description !== 'object') return []
  const root = description as { content?: unknown[] }
  if (!Array.isArray(root.content)) return []

  return root.content
    .map((node) => extractText(node).trim())
    .filter(Boolean)
}

function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const typed = node as { text?: unknown; content?: unknown[] }
  const ownText = typeof typed.text === 'string' ? typed.text : ''
  const childText = Array.isArray(typed.content)
    ? typed.content.map(extractText).join(' ')
    : ''
  return [ownText, childText].filter(Boolean).join(' ')
}

type MexasResolutionReadiness = {
  canResolve: boolean
  requiresEscrow: boolean
  filledBetCount: number
  filledStake: number
  escrowedOpenReservationRefund: number
  openReservationRefund: number
  walletOpenReservationRefund: number
  yesPayout: number
  noPayout: number
  cancelPayout: number
  message?: string
}

function MexasResolutionControl(props: {
  contract: MarketContract
  onClose: () => void
}) {
  const { contract, onClose } = props
  const { getAccessToken, login } = usePrivyLogin()
  const [outcome, setOutcome] = useState<resolution | undefined>()
  const [readiness, setReadiness] = useState<
    MexasResolutionReadiness | undefined
  >()
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReadiness(undefined)
    setError(undefined)

    authedMexasFetch(
      `/api/v0/market/${encodeURIComponent(
        contract.id
      )}/mexas-resolution-readiness`,
      { getAccessToken, login }
    )
      .then((data) => {
        if (!cancelled) setReadiness(data as MexasResolutionReadiness)
      })
      .catch((e) => {
        if (cancelled) return
        setError(
          e instanceof Error
            ? e.message
            : 'No se pudo verificar la resolucion.'
        )
      })

    return () => {
      cancelled = true
    }
  }, [contract.id, getAccessToken, login])

  const disabled =
    submitting || !outcome || !readiness?.canResolve || readiness.requiresEscrow

  const resolve = async () => {
    if (disabled || !outcome) return

    setSubmitting(true)
    setError(undefined)
    try {
      await authedMexasFetch(
        `/api/v0/market/${encodeURIComponent(contract.id)}/resolve`,
        {
          body: { outcome },
          getAccessToken,
          login,
          method: 'POST',
        }
      )
      onClose()
      window.location.reload()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'No se pudo resolver el mercado.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Col className="gap-3">
      <Row className="gap-2">
        {(['YES', 'NO', 'CANCEL'] as const).map((candidate) => (
          <OutcomeButton
            key={candidate}
            active={outcome === candidate}
            color={candidate === 'YES' ? 'green' : 'red'}
            label={outcomeLabel(candidate)}
            onClick={() => setOutcome(candidate)}
          />
        ))}
      </Row>

      <div className="border-ink-200 bg-canvas-50 rounded-md border px-3 py-2 text-sm">
        {!readiness && !error ? (
          <span className="text-ink-500">Verificando liquidacion...</span>
        ) : readiness ? (
          <Col className="gap-1">
            <span>
              Posiciones ejecutadas: {shortFormatNumber(readiness.filledBetCount)}
            </span>
            <span>Pago SÍ: {formatMex(readiness.yesPayout)}</span>
            <span>Pago NO: {formatMex(readiness.noPayout)}</span>
            <span>Reembolso por cancelar: {formatMex(readiness.cancelPayout)}</span>
            {readiness.openReservationRefund > 0 && (
              <span>
                Reservas abiertas a liberar:{' '}
                {formatMex(readiness.openReservationRefund)}
              </span>
            )}
            {readiness.escrowedOpenReservationRefund > 0 && (
              <span>
                Reservas en tesorería:{' '}
                {formatMex(readiness.escrowedOpenReservationRefund)}
              </span>
            )}
            {readiness.message && (
              <span className="text-scarlet-600">{readiness.message}</span>
            )}
          </Col>
        ) : null}
      </div>

      {error && <div className="text-scarlet-600 text-sm">{error}</div>}

      <Row className="justify-end gap-2">
        <Button color="gray-outline" size="sm" onClick={onClose}>
          Cerrar
        </Button>
        <Button color="indigo" size="sm" disabled={disabled} loading={submitting} onClick={resolve}>
          Resolver {outcomeLabel(outcome)}
        </Button>
      </Row>
    </Col>
  )
}

function MexasLimitOrderPanel(props: {
  contract: MarketContract
  userId: string | undefined
  unfilledBets: LimitBet[]
  outcome: 'YES' | 'NO' | undefined
  onBuySuccess?: () => void
}) {
  const { contract, userId, unfilledBets, outcome, onBuySuccess } = props
  const privy = usePrivyLogin()
  const { wallets } = useWallets()
  const readiness = useMexasOrderReadiness(contract.id, true)
  const [amount, setAmount] = useState<number | undefined>()
  const [limitProbInt, setLimitProbInt] = useState<number | undefined>()
  const [pendingTx, setPendingTx] = useState<
    MexasEscrowPendingOrderTx | undefined
  >()
  const [error, setError] = useState<string | undefined>()
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const limitProb =
    limitProbInt === undefined ? undefined : limitProbInt / 100
  const amountValue = amount ?? 0
  const mexasTreasuryAddress =
    process.env.NEXT_PUBLIC_MEXAS_TREASURY_WALLET_ADDRESS
  const executionMode: MexasOrderExecutionMode =
    readiness?.escrowCaptureEnabled === true
      ? 'treasury-escrowed'
      : 'wallet-reserved'
  const pendingIntent = useMemo(
    () =>
      mexasTreasuryAddress &&
      isAddress(mexasTreasuryAddress) &&
      privy.walletAddress &&
      isAddress(privy.walletAddress)
        ? getMexasEscrowPendingOrderIntent({
            amount: amountValue,
            contractId: contract.id,
            limitProb,
            outcome,
            treasuryAddress: mexasTreasuryAddress,
            walletAddress: privy.walletAddress,
          })
        : undefined,
    [
      amountValue,
      contract.id,
      limitProb,
      mexasTreasuryAddress,
      outcome,
      privy.walletAddress,
    ]
  )

  useEffect(() => {
    setPendingTx(
      pendingIntent ? findStoredMexasPendingEscrowOrderTx(pendingIntent) : undefined
    )
  }, [pendingIntent])

  const matchingReady = readiness?.matchingEngineReady === true
  const crossingOrders =
    !matchingReady && outcome && limitProb !== undefined
      ? getMexasCrossingOrders({
          executionMode,
          limitProb,
          makers: unfilledBets,
          outcome: outcome as MexasOutcome,
          takerUserId: userId,
        })
      : []
  const crossingBlocked = crossingOrders.length > 0
  const ordersPaused = readiness?.canPlaceOrders === false
  const readinessLoading = readiness === undefined
  const price =
    outcome && limitProb !== undefined
      ? getMexasOrderPrice(outcome, limitProb)
      : undefined
  const shares =
    outcome && limitProb !== undefined && amountValue > 0
      ? getMexasOrderShares(outcome, limitProb, amountValue)
      : 0
  const disabled =
    isSubmitting ||
    !userId ||
    !outcome ||
    amountValue <= 0 ||
    limitProb === undefined ||
    readinessLoading ||
    ordersPaused ||
    crossingBlocked
  const displayedError =
    error ??
    (ordersPaused
      ? readiness?.message ??
        'Las nuevas ordenes estan pausadas mientras se completa MEXAS.'
      : undefined) ??
    (crossingBlocked
      ? 'El precio cruza el libro. Abre una orden que agregue liquidez.'
      : undefined)

  function setAmountInput(value: string) {
    const parsed = Number(value)
    setAmount(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined)
    setError(undefined)
    setSubmitted(false)
  }

  function setProbInput(value: string) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      setLimitProbInt(undefined)
      return
    }
    setLimitProbInt(Math.min(99, Math.max(1, Math.round(parsed))))
    setError(undefined)
    setSubmitted(false)
  }

  async function captureMexasEscrowStake() {
    if (!readiness?.escrowCaptureEnabled) return undefined

    const latestReadiness = await fetchMexasOrderReadiness(contract.id)
    if (
      !latestReadiness.canPlaceOrders ||
      !latestReadiness.escrowCaptureEnabled ||
      !latestReadiness.matchingEngineReady
    ) {
      throw new Error(
        latestReadiness.message ??
          'Las ordenes MEXAS estan pausadas hasta completar la liquidacion on-chain.'
      )
    }
    if (!mexasTreasuryAddress || !isAddress(mexasTreasuryAddress)) {
      throw new Error('La tesoreria MEXAS no esta configurada.')
    }

    const walletAddress =
      privy.walletAddress ?? (await privy.ensureEmbeddedWallet())
    if (!walletAddress || !isAddress(walletAddress)) {
      throw new Error('Conecta una Wallet Privy para operar MEX.')
    }

    const intent = getMexasEscrowPendingOrderIntent({
      amount: amountValue,
      contractId: contract.id,
      limitProb,
      outcome,
      treasuryAddress: mexasTreasuryAddress,
      walletAddress,
    })
    if (!intent) {
      throw new Error('Completa lado, cantidad y probabilidad.')
    }

    const storedPendingTx = findStoredMexasPendingEscrowOrderTx(intent)
    if (storedPendingTx) {
      setPendingTx(storedPendingTx)
      return storedPendingTx.txHash as Hex
    }

    const wallet = wallets.find(
      (candidate) =>
        candidate.walletClientType === 'privy' &&
        candidate.address.toLowerCase() === walletAddress.toLowerCase()
    ) as ConnectedWallet | undefined
    if (!wallet) throw new Error('No se pudo abrir la Wallet Privy.')

    await wallet.switchChain(MEXAS_TOKEN.chainId)
    const provider = await wallet.getEthereumProvider()
    const txHash = (await provider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: walletAddress,
          to: MEXAS_TOKEN.address,
          data: encodeFunctionData({
            abi: mexasErc20Abi,
            functionName: 'transfer',
            args: [mexasTreasuryAddress, mexasAmountToUnits(amountValue)],
          }),
          value: '0x0',
        },
      ],
    })) as Hex
    const nextPendingTx = makeMexasEscrowPendingOrderTx(intent, {
      createdTime: Date.now(),
      txHash,
    })
    upsertStoredMexasPendingEscrowOrderTx(nextPendingTx)
    setPendingTx(nextPendingTx)
    return txHash
  }

  async function submitOrder() {
    if (disabled || !outcome || limitProb === undefined) return

    setError(undefined)
    setSubmitted(false)
    setIsSubmitting(true)
    let mexasEscrowTxHash: Hex | undefined

    try {
      mexasEscrowTxHash = await captureMexasEscrowStake()
      await authedMexasFetch('/api/v0/bet', {
        body: {
          amount: amountValue,
          contractId: contract.id,
          limitProb,
          mexasEscrowTxHash,
          outcome,
        },
        getAccessToken: privy.getAccessToken,
        login: privy.login,
        method: 'POST',
      })
      if (mexasEscrowTxHash) {
        clearStoredMexasPendingEscrowOrderTx(mexasEscrowTxHash)
        setPendingTx(undefined)
      }
      setSubmitted(true)
      setAmount(undefined)
      onBuySuccess?.()
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'No se pudo abrir la orden.'
      if (mexasEscrowTxHash && message.includes('already attached to an order')) {
        clearStoredMexasPendingEscrowOrderTx(mexasEscrowTxHash)
        setPendingTx(undefined)
        setError(
          'La transferencia MEX ya esta asociada a una orden. Actualiza el mercado para verla.'
        )
      } else if (mexasEscrowTxHash) {
        setError(
          `Transferencia MEX enviada (${shortenTxHash(
            mexasEscrowTxHash
          )}). Reintenta la misma orden para registrarla sin otra transferencia. ${message}`
        )
      } else {
        setError(message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!userId) {
    return (
      <Button color="green" size="xl" onClick={privy.login}>
        Conectar Wallet Privy
      </Button>
    )
  }

  return (
    <Col className="gap-4">
      <Col className="gap-1">
        <span className="text-ink-600 text-sm">Cantidad</span>
        <Input
          type="number"
          min={0}
          step={1}
          className="h-12 w-full !text-lg"
          value={amount ?? ''}
          onChange={(e) => setAmountInput(e.target.value)}
          disabled={isSubmitting}
        />
        <Row className="gap-2">
          {[1, 5, 10, 50].map((value) => (
            <button
              key={value}
              className="bg-canvas-50 text-ink-700 hover:bg-ink-100 rounded-md px-2 py-1 text-xs"
              onClick={() => setAmountInput(String((amount ?? 0) + value))}
            >
              +{value}
            </button>
          ))}
        </Row>
      </Col>

      <Col className="gap-1">
        <span className="text-ink-600 text-sm">Precio SÍ (%)</span>
        <Input
          type="number"
          min={1}
          max={99}
          step={1}
          className="h-12 w-full !text-lg"
          value={limitProbInt ?? ''}
          onChange={(e) => setProbInput(e.target.value)}
          disabled={isSubmitting}
        />
        <Row className="gap-2">
          {[-5, -1, 1, 5].map((delta) => (
            <button
              key={delta}
              className="bg-canvas-50 text-ink-700 hover:bg-ink-100 rounded-md px-2 py-1 text-xs"
              onClick={() => setProbInput(String((limitProbInt ?? 50) + delta))}
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </Row>
      </Col>

      {outcome && amountValue > 0 && limitProb !== undefined && (
        <Col className="border-ink-200 bg-canvas-50 gap-1 rounded-md border px-3 py-2 text-sm">
          <Row className="justify-between">
            <span className="text-ink-500">Precio efectivo</span>
            <span>{price === undefined ? '--' : formatPercent(price)}</span>
          </Row>
          <Row className="justify-between">
            <span className="text-ink-500">Pago maximo</span>
            <span>{formatMex(shares)}</span>
          </Row>
          <Row className="justify-between">
            <span className="text-ink-500">Expira</span>
            <span>Nunca</span>
          </Row>
        </Col>
      )}

      {pendingTx && (
        <div className="border-ink-200 bg-canvas-50 text-ink-700 rounded-md border px-3 py-2 text-sm">
          Transferencia MEX pendiente {shortenTxHash(pendingTx.txHash)}.
          Reintenta esta orden para registrarla sin enviar otra transferencia.
        </div>
      )}

      {displayedError && (
        <div className="text-scarlet-600 text-sm">{displayedError}</div>
      )}
      {submitted && (
        <div className="text-teal-700 text-sm">Orden enviada.</div>
      )}

      <Button
        size="xl"
        color={outcome === 'NO' ? 'red' : 'green'}
        disabled={disabled}
        loading={isSubmitting}
        onClick={submitOrder}
      >
        {isSubmitting
          ? 'Enviando...'
          : !outcome
          ? 'Elige SÍ o NO'
          : !amount
          ? 'Ingresa una cantidad'
          : limitProb === undefined
          ? 'Ingresa un precio'
          : readinessLoading
          ? 'Verificando libro...'
          : ordersPaused
          ? 'Ordenes pausadas'
          : crossingBlocked
          ? 'El precio cruza el libro'
          : pendingTx
          ? 'Registrar orden MEX pendiente'
          : `Abrir orden ${outcome === 'YES' ? 'SÍ' : 'NO'}`}
      </Button>
    </Col>
  )
}

function OutcomeButton(props: {
  active: boolean
  color: 'green' | 'red'
  label: string
  onClick: () => void
}) {
  const { active, color, label, onClick } = props
  const activeClass =
    color === 'green'
      ? 'border-teal-600 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-200'
      : 'border-scarlet-600 bg-scarlet-50 text-scarlet-700 dark:bg-scarlet-950 dark:text-scarlet-200'

  return (
    <button
      className={clsx(
        'border-ink-200 text-ink-800 hover:bg-canvas-50 flex-1 rounded-md border px-3 py-2 text-sm font-semibold',
        active && activeClass
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function MexasUserOrders(props: {
  contract: MarketContract
  orders: LimitBet[]
  userId: string | undefined
  onOrderCancelled: () => void
}) {
  const { orders, userId, onOrderCancelled } = props
  const privy = usePrivyLogin()
  const [cancellingId, setCancellingId] = useState<string>()

  if (!userId) return null

  const userOrders = orders.filter((order) => order.userId === userId)

  return (
    <Col className="border-ink-200 bg-canvas-0 overflow-hidden rounded-md border">
      <Row className="border-ink-200 items-center justify-between border-b px-4 py-3">
        <Col>
          <span className="text-ink-1000 font-semibold">
            Tus ordenes abiertas
          </span>
          <span className="text-ink-500 text-xs">
            Puedes cancelar cualquier orden sin ejecutar.
          </span>
        </Col>
        <span className="text-ink-500 text-xs">
          {shortFormatNumber(userOrders.length)}
        </span>
      </Row>

      {userOrders.length === 0 ? (
        <div className="text-ink-500 px-4 py-4 text-sm">
          No tienes ordenes abiertas en este mercado.
        </div>
      ) : (
        <div className="overflow-x-auto px-4 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-500 border-ink-100 border-b text-left text-xs uppercase">
                <th className="py-2 font-medium">Resultado</th>
                <th className="py-2 font-medium">Precio</th>
                <th className="py-2 font-medium">Tamano</th>
                <th className="py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-ink-100 divide-y">
              {userOrders.map((order) => (
                <tr key={order.id}>
                  <td className="py-3 font-semibold">
                    {order.outcome === 'YES' ? 'SÍ' : 'NO'}
                  </td>
                  <td className="py-3">{priceLabel(order.limitProb)}</td>
                  <td className="py-3">
                    {formatMex(getMexasOpenOrderAmount(order))}
                  </td>
                  <td className="py-3 text-right">
                    <Button
                      color="gray-outline"
                      size="2xs"
                      loading={cancellingId === order.id}
                      onClick={async () => {
                        setCancellingId(order.id)
                        try {
                          await authedMexasFetch(
                            `/api/v0/bet/cancel/${encodeURIComponent(
                              order.id
                            )}`,
                            {
                              getAccessToken: privy.getAccessToken,
                              login: privy.login,
                              method: 'POST',
                            }
                          )
                          onOrderCancelled()
                        } finally {
                          setCancellingId(undefined)
                        }
                      }}
                    >
                      Cancelar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Col>
  )
}
