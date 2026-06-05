import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { LimitBet } from 'common/bet'
import type { ContractMetric } from 'common/contract-metric'
import type { User } from 'common/user'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { usePrivyLogin } from 'web/components/crypto/privy-wallet-providers'

type MexasProfileContract = {
  id: string
  question: string
  creatorUsername: string
  slug: string
  closeTime?: number
  resolutionTime?: number
  isResolved?: boolean
  resolution?: string
  prob?: number
  volume24Hours?: number
  totalLiquidity?: number
}

type MexasMetricsResponse = {
  metricsByContract: Record<string, ContractMetric[]>
  contracts: MexasProfileContract[]
}

type MexasLimitOrdersResponse = {
  bets: LimitBet[]
  contracts: MexasProfileContract[]
}

type MexasBalanceChange = {
  key: string
  type: string
  amount: number
  createdTime: number
  token?: 'MEX'
  transferType?:
    | 'order-release'
    | 'resolution-payout'
    | 'resolution-cancel'
    | 'withdrawal'
  status?: string
  txHash?: string
  bet?: { outcome?: string; shares?: number }
  contract?: {
    question: string
    creatorUsername: string
    slug?: string
    token?: string
  }
}

type LoadState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: string }

const rowClass =
  'border-ink-200 hover:bg-canvas-50 flex flex-col gap-2 border-b py-3 transition-colors last:border-b-0 sm:flex-row sm:items-center sm:justify-between'

export function MexasPublicProfileSummary(props: {
  user: User
  hasCreatedQuestion: boolean
  isCurrentUser: boolean
}) {
  const { user, hasCreatedQuestion, isCurrentUser } = props
  const reserved = user.mexasWalletOpenReservedAmount ?? 0

  return (
    <Col className="border-ink-200 mt-4 gap-4 border-y py-4">
      <Row className="flex-wrap gap-3">
        <ProfileStat label="Wallet" value={`@${user.username}`} />
        <ProfileStat
          label="Mercados MEX"
          value={hasCreatedQuestion ? 'Activos' : 'Sin mercados creados'}
        />
        <ProfileStat
          label="Balance disponible"
          value={formatMex(Math.max(0, user.balance - reserved))}
        />
        <ProfileStat
          label="Acceso"
          value={isCurrentUser ? 'Tu perfil' : 'Perfil publico'}
        />
      </Row>
      <p className="text-ink-600 max-w-3xl text-sm">
        Las operaciones visibles en esta plataforma se liquidan en MEX sobre
        Arbitrum. Las ordenes abiertas reservan MEX hasta que se ejecutan,
        expiran o se cancelan.
      </p>
    </Col>
  )
}

export function MexasProfileOperations(props: {
  user: User
  isCurrentUser: boolean
}) {
  return (
    <Col className="gap-8">
      <MexasOpenOrders {...props} />
      <MexasPositions user={props.user} />
    </Col>
  )
}

export function MexasProfileMarkets(props: { user: User }) {
  const path = profileApiPath('/api/search-markets-full', {
    creatorId: props.user.id,
    contractType: 'BINARY',
    filter: 'all',
    sort: 'newest',
    limit: 50,
    mexasOnly: true,
  })
  const state = useProfileFetch<MexasProfileContract[]>(path)

  if (state.status !== 'ready') return <ProfileState state={state} />

  const markets = state.data
  if (markets.length === 0) {
    return <EmptyState text="Este perfil aun no tiene mercados MEXAS." />
  }

  return (
    <Col className="mt-4">
      {markets.map((contract) => (
        <Link
          key={contract.id}
          href={contractHref(contract)}
          className={rowClass}
        >
          <Col className="min-w-0 gap-1">
            <span className="text-ink-1000 line-clamp-2 font-semibold">
              {contract.question}
            </span>
            <span className="text-ink-500 text-sm">
              {contract.isResolved
                ? `Resuelto ${contract.resolution ?? ''}`.trim()
                : closeText(contract.closeTime)}
            </span>
          </Col>
          <Row className="shrink-0 gap-4 text-sm">
            <ProfileStat
              label="Precio"
              value={formatProbability(contract.prob)}
              compact
            />
            <ProfileStat
              label="Vol. 24h"
              value={formatMex(contract.volume24Hours ?? 0)}
              compact
            />
          </Row>
        </Link>
      ))}
    </Col>
  )
}

export function MexasProfileMovements(props: { user: User }) {
  const fourteenDaysAgo = startOfToday() - 14 * 24 * 60 * 60 * 1000
  const path = profileApiPath('/api/get-balance-changes', {
    userId: props.user.id,
    after: fourteenDaysAgo,
    mexasOnly: true,
  })
  const state = useProfileFetch<MexasBalanceChange[]>(path)

  if (state.status !== 'ready') return <ProfileState state={state} />

  const movements = state.data.filter((change) => {
    if (change.type === 'mexas_treasury_transfer') return true
    return change.contract?.token === 'MEX' || change.token === 'MEX'
  })

  return (
    <Col className="mt-4 gap-3">
      <Row className="text-ink-500 justify-between text-sm">
        <span>Ultimos 14 dias</span>
        <span>{movements.length} movimientos</span>
      </Row>
      {movements.length === 0 ? (
        <EmptyState text="No hay movimientos MEX recientes." />
      ) : (
        movements.map((change) => (
          <Row
            key={change.key}
            className="border-ink-200 items-start justify-between gap-4 border-b py-3 last:border-b-0"
          >
            <Col className="min-w-0 gap-1">
              <span className="text-ink-1000 font-medium">
                {movementTitle(change)}
              </span>
              <span className="text-ink-500 line-clamp-1 text-sm">
                {change.contract?.question ?? formatDate(change.createdTime)}
              </span>
            </Col>
            <Col className="shrink-0 items-end gap-1 text-right">
              <span
                className={
                  change.amount >= 0 ? 'text-teal-700' : 'text-scarlet-600'
                }
              >
                {change.amount >= 0 ? '+' : ''}
                {formatMex(change.amount)}
              </span>
              <span className="text-ink-500 text-xs">
                {formatDate(change.createdTime)}
              </span>
            </Col>
          </Row>
        ))
      )}
    </Col>
  )
}

export function MexasProfileWallet(props: {
  user: User
  isCurrentUser: boolean
}) {
  const privy = usePrivyLogin()
  const reserved = props.user.mexasWalletOpenReservedAmount ?? 0

  return (
    <Col className="mt-4 gap-4">
      <Row className="border-ink-200 flex-wrap justify-between gap-3 border-y py-4">
        <ProfileStat
          label="Balance interno"
          value={formatMex(props.user.balance)}
        />
        <ProfileStat label="Reservado en ordenes" value={formatMex(reserved)} />
        <ProfileStat
          label="Disponible"
          value={formatMex(Math.max(0, props.user.balance - reserved))}
        />
      </Row>

      {props.isCurrentUser ? (
        <Col className="gap-3">
          <div className="text-ink-600 text-sm">
            {privy.walletAddress
              ? `Wallet Privy ${shortAddress(privy.walletAddress)}`
              : 'Conecta Privy para ver tu direccion de deposito.'}
          </div>
          <Row className="flex-wrap gap-2">
            {!privy.authenticated && (
              <button className={buttonClass} onClick={privy.login}>
                Conectar Privy
              </button>
            )}
            <Link className={buttonClass} href="/wallet">
              Depositar o retirar
            </Link>
          </Row>
        </Col>
      ) : (
        <EmptyState text="La direccion de Wallet solo esta visible para el titular." />
      )}
    </Col>
  )
}

function MexasOpenOrders(props: { user: User; isCurrentUser: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const path = useMemo(
    () =>
      profileApiPath('/api/get-user-limit-orders-with-contracts', {
        userId: props.user.id,
        count: 100,
        includeExpired: false,
        includeCancelled: false,
        includeFilled: false,
        mexasOnly: true,
        refreshKey,
      }),
    [props.user.id, refreshKey]
  )
  const state = useProfileFetch<MexasLimitOrdersResponse>(path)
  const privy = usePrivyLogin()

  const cancelOrder = async (betId: string) => {
    const token = await privy.getAccessToken()
    if (!token) {
      privy.login()
      return
    }

    const response = await fetch(`/api/v0/bet/cancel/${betId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => undefined)
      throw new Error(data?.message ?? 'No se pudo cancelar la orden.')
    }
    setRefreshKey((key) => key + 1)
  }

  return (
    <Col className="mt-4 gap-3">
      <SectionHeader
        title="Ordenes abiertas"
        action={
          <button
            className="text-primary-600 hover:underline"
            onClick={() => setRefreshKey((key) => key + 1)}
          >
            Actualizar
          </button>
        }
      />
      {state.status !== 'ready' ? (
        <ProfileState state={state} />
      ) : state.data.bets.length === 0 ? (
        <EmptyState text="No hay ordenes abiertas." />
      ) : (
        <Col>
          {state.data.bets.map((bet) => {
            const contract = state.data.contracts.find(
              (candidate) => candidate.id === bet.contractId
            )
            return (
              <OrderRow
                key={bet.id}
                bet={bet}
                contract={contract}
                canCancel={props.isCurrentUser}
                onCancel={cancelOrder}
              />
            )
          })}
        </Col>
      )}
    </Col>
  )
}

function MexasPositions(props: { user: User }) {
  const path = profileApiPath(
    '/api/v0/get-user-contract-metrics-with-contracts',
    {
      userId: props.user.id,
      limit: 50,
      offset: 0,
      order: 'lastBetTime',
      mexasOnly: true,
    }
  )
  const state = useProfileFetch<MexasMetricsResponse>(path)

  return (
    <Col className="gap-3">
      <SectionHeader title="Posiciones" />
      {state.status !== 'ready' ? (
        <ProfileState state={state} />
      ) : state.data.contracts.length === 0 ? (
        <EmptyState text="No hay posiciones MEXAS." />
      ) : (
        <Col>
          {state.data.contracts.map((contract) => {
            const metric = state.data.metricsByContract[contract.id]?.[0]
            return (
              <Link
                key={contract.id}
                href={contractHref(contract)}
                className={rowClass}
              >
                <Col className="min-w-0 gap-1">
                  <span className="text-ink-1000 line-clamp-2 font-semibold">
                    {contract.question}
                  </span>
                  <span className="text-ink-500 text-sm">
                    Posicion {positionLabel(metric)}
                  </span>
                </Col>
                <Row className="shrink-0 gap-4 text-sm">
                  <ProfileStat
                    label="Invertido"
                    value={formatMex(metric?.totalAmountInvested ?? 0)}
                    compact
                  />
                  <ProfileStat
                    label="Valor"
                    value={formatMex(metric?.payout ?? 0)}
                    compact
                  />
                  <ProfileStat
                    label="P/L"
                    value={formatSignedMex(metric?.profit ?? 0)}
                    compact
                  />
                </Row>
              </Link>
            )
          })}
        </Col>
      )}
    </Col>
  )
}

function OrderRow(props: {
  bet: LimitBet
  contract?: MexasProfileContract
  canCancel: boolean
  onCancel: (betId: string) => Promise<void>
}) {
  const { bet, contract, canCancel, onCancel } = props
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const remaining = getRemainingOrderAmount(bet)

  return (
    <Row className="border-ink-200 flex-wrap items-start justify-between gap-4 border-b py-3 last:border-b-0">
      <Col className="min-w-0 flex-1 gap-1">
        {contract ? (
          <Link
            href={contractHref(contract)}
            className="text-ink-1000 line-clamp-2 font-semibold hover:underline"
          >
            {contract.question}
          </Link>
        ) : (
          <span className="text-ink-1000 font-semibold">Mercado MEXAS</span>
        )}
        <span className="text-ink-500 text-sm">
          {bet.outcome === 'YES' ? 'SI' : 'NO'} a{' '}
          {formatProbability(bet.limitProb)} · {formatDate(bet.createdTime)}
        </span>
        {error && <span className="text-scarlet-600 text-sm">{error}</span>}
      </Col>
      <Row className="shrink-0 items-center gap-4">
        <ProfileStat label="Restante" value={formatMex(remaining)} compact />
        {canCancel && (
          <button
            className="text-scarlet-600 disabled:text-ink-400 hover:underline"
            disabled={loading}
            onClick={async () => {
              setLoading(true)
              setError(undefined)
              try {
                await onCancel(bet.id)
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Error')
              } finally {
                setLoading(false)
              }
            }}
          >
            {loading ? 'Cancelando' : 'Cancelar'}
          </button>
        )}
      </Row>
    </Row>
  )
}

function SectionHeader(props: { title: string; action?: React.ReactNode }) {
  return (
    <Row className="border-ink-200 items-center justify-between border-b pb-2">
      <h2 className="text-ink-1000 text-lg font-semibold">{props.title}</h2>
      {props.action && <div className="text-sm">{props.action}</div>}
    </Row>
  )
}

function ProfileStat(props: {
  label: string
  value: string
  compact?: boolean
}) {
  return (
    <Col className={props.compact ? 'items-end gap-0' : 'min-w-[150px] gap-1'}>
      <span className="text-ink-500 text-xs font-semibold uppercase">
        {props.label}
      </span>
      <span className="text-ink-1000 font-semibold">{props.value}</span>
    </Col>
  )
}

function ProfileState<T>(props: { state: LoadState<T> }) {
  if (props.state.status === 'loading') {
    return <EmptyState text="Cargando..." />
  }
  if (props.state.status === 'error') {
    return <EmptyState text={props.state.error} danger />
  }
  return null
}

function EmptyState(props: { text: string; danger?: boolean }) {
  return (
    <div
      className={
        props.danger
          ? 'text-scarlet-600 border-scarlet-200 rounded border p-4 text-sm'
          : 'text-ink-500 border-ink-200 rounded border p-4 text-sm'
      }
    >
      {props.text}
    </div>
  )
}

function useProfileFetch<T>(path: string): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    fetch(path)
      .then(async (response) => {
        const data = await response.json().catch(() => undefined)
        if (!response.ok) {
          throw new Error(data?.message ?? 'No se pudo cargar la informacion.')
        }
        return data as T
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'No se pudo cargar la informacion.',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [path])

  return state
}

function profileApiPath(path: string, params: Record<string, unknown>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.set(key, String(value))
  }
  return `${path}?${search.toString()}`
}

function contractHref(contract: MexasProfileContract) {
  return `/${contract.creatorUsername}/${contract.slug}`
}

function getRemainingOrderAmount(bet: LimitBet) {
  const filled = (bet.fills ?? []).reduce((sum, fill) => sum + fill.amount, 0)
  return Math.max(0, (bet.orderAmount ?? 0) - filled)
}

function positionLabel(metric: ContractMetric | undefined) {
  if (!metric) return '-'
  if (metric.maxSharesOutcome)
    return metric.maxSharesOutcome === 'YES' ? 'SI' : 'NO'
  if (metric.hasYesShares) return 'SI'
  if (metric.hasNoShares) return 'NO'
  return '-'
}

function movementTitle(change: MexasBalanceChange) {
  if (change.type === 'create_bet') {
    return `Orden ${change.bet?.outcome === 'YES' ? 'SI' : 'NO'} abierta`
  }
  if (change.type === 'mexas_treasury_transfer') {
    switch (change.transferType) {
      case 'order-release':
        return 'Orden liberada'
      case 'resolution-payout':
        return 'Pago de resolucion'
      case 'resolution-cancel':
        return 'Cancelacion por resolucion'
      case 'withdrawal':
        return 'Retiro'
      default:
        return 'Movimiento de tesoreria'
    }
  }
  return 'Movimiento MEX'
}

function closeText(closeTime: number | undefined) {
  if (!closeTime) return 'Sin cierre programado'
  return `Cierra ${formatDate(closeTime)}`
}

function formatProbability(prob: number | undefined) {
  if (prob === undefined || prob === null || Number.isNaN(prob)) {
    return 'Sin precio'
  }
  return `${Math.round(prob * 1000) / 10}%`
}

function formatMex(amount: number) {
  const value = Number.isFinite(amount) ? amount : 0
  return `MEX ${new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
  }).format(value)}`
}

function formatSignedMex(amount: number) {
  return `${amount >= 0 ? '+' : ''}${formatMex(amount)}`
}

function formatDate(time: number) {
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(time))
}

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.valueOf()
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

const buttonClass =
  'bg-primary-600 text-ink-0 hover:bg-primary-700 rounded px-4 py-2 text-sm font-semibold'
