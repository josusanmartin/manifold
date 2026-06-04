import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/outline'
import { usePersistentInMemoryState } from 'client-common/hooks/use-persistent-in-memory-state'
import { getCountdownString } from 'client-common/lib/time'
import clsx from 'clsx'
import { Answer } from 'common/answer'
import { DisplayUser } from 'common/api/user-types'
import { LimitBet } from 'common/bet'
import {
  BinaryContract,
  CPMMMultiContract,
  getBinaryMCProb,
  isBinaryMulti,
  MultiContract,
  PseudoNumericContract,
  StonkContract,
} from 'common/contract'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import { getMexasOpenOrderAmount } from 'common/mexas-order-book'
import { getFormattedMappedValue } from 'common/pseudo-numeric'
import { formatPercent } from 'common/util/format'
import { groupBy, keyBy, sortBy, sumBy, uniq } from 'lodash'
import { useState } from 'react'
import { useUser } from 'web/hooks/use-user'
import { useDisplayUserById, useUsers } from 'web/hooks/use-user-supabase'
import { api } from 'web/lib/api/api'
import { Button } from '../buttons/button'
import { getPseudonym } from '../charts/contract/choice'
import { DepthChart } from '../charts/contract/depth-chart'
import { Col } from '../layout/col'
import { Modal } from '../layout/modal'
import { Row } from '../layout/row'
import { MultipleOrSingleAvatars } from '../multiple-or-single-avatars'
import {
  BinaryOutcomeLabel,
  NoLabel,
  OutcomeLabel,
  PseudoNumericOutcomeLabel,
  YesLabel,
} from '../outcome-label'
import { SizedContainer } from '../sized-container'
import { UserHovercard } from '../user/user-hovercard'
import { Avatar } from '../widgets/avatar'
import { InfoTooltip } from '../widgets/info-tooltip'
import { Subtitle } from '../widgets/subtitle'
import { Table } from '../widgets/table'
import { Tooltip } from '../widgets/tooltip'
import { UserLink } from '../widgets/user-link'
import { MoneyDisplay } from './money-display'

export function YourOrders(props: {
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | MultiContract
  bets: LimitBet[]
  deemphasizedHeader?: boolean
  className?: string
  title?: string
  showEmptyState?: boolean
  onOrderCancelled?: (bet: LimitBet) => void
}) {
  const {
    contract,
    bets,
    deemphasizedHeader,
    className,
    title = 'Tus órdenes',
    showEmptyState,
    onOrderCancelled,
  } = props
  const user = useUser()

  const yourBets = sortBy(
    bets.filter((bet) => bet.userId === user?.id && !bet.silent),
    (bet) => -1 * bet.limitProb,
    (bet) => -1 * bet.createdTime
  )

  if (!user) return null

  const maxShownNotExpanded = 3
  const [isExpanded, setIsExpanded] = usePersistentInMemoryState(
    false,
    `${contract.id}-your-orderbook-expanded`
  )

  if (yourBets.length === 0) {
    if (!showEmptyState) return null

    return (
      <Col className={clsx(className, 'bg-canvas-0 overflow-hidden')}>
        <div className="px-4 pb-1 pt-3">
          <span className="text-ink-900 text-base font-semibold">{title}</span>
        </div>
        <div className="text-ink-500 px-4 pb-4 text-sm">
          No tienes órdenes abiertas en este mercado.
        </div>
      </Col>
    )
  }

  const moreOrders = yourBets.length - maxShownNotExpanded

  return (
    <Col className={clsx(className, 'bg-canvas-0 overflow-hidden')}>
      {/* Header */}
      <div className="px-4 pb-1 pt-3">
        {deemphasizedHeader ? (
          <span className="text-ink-700 text-base font-medium">{title}</span>
        ) : (
          <span className="text-ink-900 text-base font-semibold">{title}</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto px-4 pb-2">
        <OrderTable
          limitBets={yourBets.slice(
            0,
            isExpanded ? yourBets.length : maxShownNotExpanded
          )}
          contract={contract}
          isYou
          onOrderCancelled={onOrderCancelled}
        />
      </div>

      {/* Show More */}
      {yourBets.length > maxShownNotExpanded && (
        <button
          className="text-ink-600 hover:text-ink-900 border-ink-200 w-full border-t px-4 py-2 text-sm font-medium transition-colors"
          onClick={() => setIsExpanded((b) => !b)}
        >
          <Row className="items-center justify-center gap-1">
            {isExpanded ? (
              <ChevronUpIcon className="h-4 w-4" />
            ) : (
              <ChevronDownIcon className="h-4 w-4" />
            )}
            {isExpanded
              ? 'Mostrar menos órdenes'
              : `Mostrar ${moreOrders} orden${
                  moreOrders === 1 ? '' : 'es'
                } más`}
          </Row>
        </button>
      )}
    </Col>
  )
}

export function OrderTable(props: {
  limitBets: LimitBet[]
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | MultiContract
  isYou?: boolean
  showAnswers?: boolean
  onOrderCancelled?: (bet: LimitBet) => void
}) {
  const { limitBets, contract, isYou, showAnswers, onOrderCancelled } = props
  const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(contract)
  const getOpenAmount = (bet: LimitBet) =>
    isMexasOrderBookOnly
      ? getMexasOpenOrderAmount(bet)
      : bet.orderAmount - bet.amount
  const answers =
    showAnswers && contract.mechanism === 'cpmm-multi-1'
      ? contract.answers.filter((a) =>
          limitBets.map((b) => b.answerId).includes(a.id)
        )
      : undefined
  const isPseudoNumeric = contract.outcomeType === 'PSEUDO_NUMERIC'
  const [isCancelling, setIsCancelling] = useState(false)
  const onCancel = async () => {
    if (isCancelling) return

    setIsCancelling(true)
    try {
      const cancellableBets = limitBets.filter(
        (b) => !b.isCancelled && getOpenAmount(b) > 0
      )

      for (const bet of cancellableBets) {
        const cancelledBet = await api('bet/cancel/:betId', { betId: bet.id })
        onOrderCancelled?.(cancelledBet)
      }
    } finally {
      setIsCancelling(false)
    }
  }

  // If showAnswers is true and we have answers, group bets by answerId
  if (showAnswers && answers && answers.length > 0) {
    const betsByAnswerId = groupBy(limitBets, 'answerId')

    return (
      <Col className="gap-4">
        {answers.map((answer) => {
          const answerBets = betsByAnswerId[answer.id] || []
          if (answerBets.length === 0) return null

          return (
            <Col
              key={answer.id}
              className="bg-canvas-0 border-ink-200 overflow-hidden border-y"
            >
              <div className="px-4 pb-1 pt-3">
                <span className="text-ink-900 font-semibold">
                  {answer.text}
                </span>
              </div>
              <div className="px-4 pb-2">
                <Table>
                  <thead>
                    <tr className="text-ink-500 text-xs uppercase tracking-wide">
                      {!isYou && <th className="pb-2 font-medium"></th>}
                      <th className="pb-2 font-medium">Resultado</th>
                      <th className="pb-2 font-medium">
                        {isPseudoNumeric ? 'Valor' : 'Prob.'}
                      </th>
                      <th className="pb-2 font-medium">Cantidad</th>
                      <th className="pb-2 font-medium">
                        <Row className="items-center justify-between gap-2">
                          <span>Expira</span>
                          {isYou &&
                            answerBets.length > 1 &&
                            answerBets.some(
                              (b) => !b.isCancelled && getOpenAmount(b) > 0
                            ) && (
                              <Button
                                loading={isCancelling}
                                size="2xs"
                                color="gray-outline"
                                onClick={onCancel}
                              >
                                Cancelar todas
                              </Button>
                            )}
                        </Row>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-ink-100 divide-y">
                    {answerBets.map((bet) => (
                      <OrderRow
                        key={bet.id}
                        bet={bet}
                        contract={contract}
                        isYou={!!isYou}
                        onOrderCancelled={onOrderCancelled}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
            </Col>
          )
        })}
      </Col>
    )
  }

  // Original behavior when showAnswers is false or no answers found
  return (
    <Table>
      <thead>
        <tr className="text-ink-500 text-xs uppercase tracking-wide">
          {!isYou && <th className="pb-2 font-medium"></th>}
          <th className="pb-2 font-medium">Resultado</th>
          <th className="pb-2 font-medium">
            {isPseudoNumeric ? 'Valor' : 'Prob.'}
          </th>
          <th className="pb-2 font-medium">Cantidad</th>
          <th className="pb-2 font-medium">
            <Row className="items-center justify-between gap-2">
              <span>Expira</span>
              {isYou &&
                limitBets.length > 1 &&
                limitBets.some(
                  (b) => !b.isCancelled && getOpenAmount(b) > 0
                ) && (
                  <Button
                    loading={isCancelling}
                    size="2xs"
                    color="gray-outline"
                    onClick={onCancel}
                  >
                    Cancelar todas
                  </Button>
                )}
            </Row>
          </th>
        </tr>
      </thead>
      <tbody className="divide-ink-100 divide-y">
        {limitBets.map((bet) => (
          <OrderRow
            key={bet.id}
            bet={bet}
            contract={contract}
            isYou={!!isYou}
            onOrderCancelled={onOrderCancelled}
          />
        ))}
      </tbody>
    </Table>
  )
}

function OrderRow(props: {
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | CPMMMultiContract
    | MultiContract
  bet: LimitBet
  isYou: boolean
  onOrderCancelled?: (bet: LimitBet) => void
}) {
  const { contract, bet, isYou, onOrderCancelled } = props
  const { orderAmount, amount, limitProb, outcome } = bet
  const isPseudoNumeric = contract.outcomeType === 'PSEUDO_NUMERIC'
  const isBinaryMC = isBinaryMulti(contract)
  const openAmount = isMexasOrderBookOnlyContract(contract)
    ? getMexasOpenOrderAmount(bet)
    : orderAmount - amount
  const user = useDisplayUserById(bet.userId)

  const [isCancelling, setIsCancelling] = useState(false)

  const onCancel = async () => {
    setIsCancelling(true)
    try {
      const cancelledBet = await api('bet/cancel/:betId', { betId: bet.id })
      onOrderCancelled?.(cancelledBet)
    } finally {
      setIsCancelling(false)
    }
  }
  const isCashContract = contract.token === 'CASH'
  const displayToken = isMexasOrderBookOnlyContract(contract)
    ? 'MEX'
    : isCashContract
    ? 'CASH'
    : undefined
  const expired = bet.expiresAt && bet.expiresAt < Date.now()
  const filled = bet.isFilled || openAmount <= 1e-9
  const cancelled = bet.isCancelled
  const isInactive = expired || filled || cancelled

  return (
    <tr className={clsx(isInactive && 'opacity-50')}>
      {!isYou && user && (
        <td className="py-3">
          <a href={`/${user.username}`}>
            <UserHovercard userId={bet.userId}>
              <Avatar
                size="xs"
                avatarUrl={user.avatarUrl}
                username={user.username}
                noLink={true}
              />
            </UserHovercard>
          </a>
        </td>
      )}
      <td className="py-3">
        {isPseudoNumeric ? (
          <PseudoNumericOutcomeLabel outcome={outcome as 'YES' | 'NO'} />
        ) : isBinaryMC ? (
          <OutcomeLabel
            pseudonym={getPseudonym(contract)}
            contract={contract}
            outcome={outcome}
            truncate={'short'}
          />
        ) : (
          <BinaryOutcomeLabel outcome={outcome as 'YES' | 'NO'} />
        )}
      </td>
      <td className="text-ink-600 py-3">
        {isPseudoNumeric
          ? getFormattedMappedValue(contract, limitProb)
          : isBinaryMC
          ? formatPercent(getBinaryMCProb(limitProb, outcome))
          : formatPercent(limitProb)}
      </td>
      <td className="text-ink-900 py-3 font-medium">
        <MoneyDisplay
          amount={openAmount}
          isCashContract={isCashContract}
          token={displayToken}
        />
      </td>
      {isYou && (
        <td className="py-3">
          <Row className="items-center justify-between gap-2">
            <span className="text-ink-500">
              {expired ? (
                'Expirada'
              ) : filled ? (
                'Ejecutada'
              ) : cancelled ? (
                'Cancelada'
              ) : bet.expiresAt ? (
                <Tooltip
                  text={`${new Date(
                    bet.expiresAt
                  ).toLocaleDateString()} ${new Date(
                    bet.expiresAt
                  ).toLocaleTimeString()}`}
                >
                  {getCountdownString(new Date(bet.expiresAt))}
                </Tooltip>
              ) : (
                'Nunca'
              )}
            </span>
            {!filled && !cancelled && (
              <Button
                loading={isCancelling}
                size="2xs"
                color="gray-outline"
                onClick={onCancel}
              >
                Cancelar
              </Button>
            )}
          </Row>
        </td>
      )}
    </tr>
  )
}

export type OrderClickData = {
  outcome: 'YES' | 'NO'
  limitProb: number
  amount: number // unfilled amount in MEX
}

export function calculateOrderFillParams(clickedOrder: OrderClickData) {
  const { outcome, limitProb, amount } = clickedOrder
  const oppositeOutcome = outcome === 'YES' ? 'NO' : 'YES'

  // Calculate shares from clicked order based on outcome
  // YES shares = amount / limitProb, NO shares = amount / (1 - limitProb)
  const clickedShares =
    outcome === 'YES' ? amount / limitProb : amount / (1 - limitProb)

  // To fill with opposite outcome at same limitProb, calculate amount needed for same shares
  const fillAmount =
    oppositeOutcome === 'YES'
      ? clickedShares * limitProb
      : clickedShares * (1 - limitProb)

  // Round to 2 decimal places to avoid floating point precision issues
  return {
    outcome: oppositeOutcome as 'YES' | 'NO',
    limitProb, // same probability
    amount: Math.round(fillAmount * 100) / 100,
  }
}

export function CollatedOrderTable(props: {
  limitBets: LimitBet[]
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | CPMMMultiContract
    | MultiContract
  side: 'YES' | 'NO'
  pseudonym?: {
    YES: {
      pseudonymName: string
      pseudonymColor: string
    }
    NO: {
      pseudonymName: string
      pseudonymColor: string
    }
  }
  onOrderClick?: (data: OrderClickData) => void
}) {
  const { contract, side, pseudonym, onOrderClick } = props
  const limitBets = props.limitBets.filter(
    (b) => !b.expiresAt || b.expiresAt > Date.now()
  )
  const isBinaryMC = isBinaryMulti(contract)
  const groupedBets = groupBy(limitBets, (b) => b.limitProb)

  return (
    <div>
      <Row>
        <span className="mr-2">Comprar</span>
        {isBinaryMC || !!pseudonym ? (
          <OutcomeLabel
            contract={contract}
            outcome={side}
            truncate={'short'}
            pseudonym={pseudonym}
          />
        ) : side === 'YES' ? (
          <YesLabel />
        ) : (
          <NoLabel />
        )}
      </Row>

      <div className="grid grid-cols-[32px_auto_1fr] gap-1">
        {Object.entries(groupedBets).map(([prob, bets]) => (
          <CollapsedOrderRow
            contract={contract}
            key={prob}
            limitProb={Number(prob)}
            bets={bets}
            onOrderClick={onOrderClick}
          />
        ))}
      </div>
    </div>
  )
}

function CollapsedOrderRow(props: {
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | CPMMMultiContract
    | MultiContract
  limitProb: number
  bets: LimitBet[]
  onOrderClick?: (data: OrderClickData) => void
}) {
  const { contract, limitProb, bets, onOrderClick } = props
  const { outcome } = bets[0]
  const isPseudoNumeric = contract.outcomeType === 'PSEUDO_NUMERIC'
  const isBinaryMC = isBinaryMulti(contract)
  const getOpenAmount = (bet: LimitBet) =>
    isMexasOrderBookOnlyContract(contract)
      ? getMexasOpenOrderAmount(bet)
      : bet.orderAmount - bet.amount

  const total = sumBy(bets, getOpenAmount)

  const allUsers = useUsers(uniq(bets.map((b) => b.userId)))?.filter(
    (a) => a != null
  ) as DisplayUser[] | undefined
  const usersById = keyBy(allUsers, (u) => u.id)

  // find 3 largest users
  const userBets = groupBy(bets, (b) => b.userId)
  const userSums = Object.entries(userBets).map(
    ([userId, bets]) => [userId, sumBy(bets, getOpenAmount)] as const
  )
  const largest = sortBy(userSums, ([, sum]) => -sum)
    .slice(0, 3)
    .map(([userId]) => usersById[userId])
    .filter((u) => u != null)
    .reverse()

  const [collapsed, setCollapsed] = useState(true)

  const handleOrderClick = () => {
    if (onOrderClick) {
      onOrderClick({
        outcome: outcome as 'YES' | 'NO',
        limitProb,
        amount: total,
      })
    }
  }

  const isClickable = !!onOrderClick

  return (
    <>
      <div className="self-center">
        {isPseudoNumeric
          ? getFormattedMappedValue(contract, limitProb)
          : isBinaryMC
          ? formatPercent(getBinaryMCProb(limitProb, outcome))
          : formatPercent(limitProb)}
      </div>

      <div className="relative justify-start p-1">
        <MultipleOrSingleAvatars
          className="!items-end"
          avatars={largest}
          total={userSums.length}
          size="xs"
          spacing={0.3}
          startLeft={0.6}
          onClick={() => setCollapsed((c) => !c)}
        />
      </div>

      <div
        className={clsx(
          'self-center pr-1 text-right',
          isClickable &&
            'hover:bg-primary-100 cursor-pointer rounded px-1 py-0.5'
        )}
        onClick={handleOrderClick}
      >
        <MoneyDisplay
          amount={total}
          numberType="short"
          isCashContract={contract.token === 'CASH'}
        />
      </div>

      {!collapsed &&
        bets.map((b) => {
          const u = usersById[b.userId] as DisplayUser | undefined
          return (
            <div
              className="bg-canvas-50 col-span-3 flex justify-between p-1"
              key={b.id}
            >
              <div className="flex items-center gap-2">
                <Avatar
                  avatarUrl={u?.avatarUrl}
                  username={u?.username}
                  size="xs"
                />
                <UserLink user={u} short />
              </div>
              <div className="text-right">
                <MoneyDisplay
                  amount={getOpenAmount(b)}
                  isCashContract={contract.token === 'CASH'}
                />
              </div>
            </div>
          )
        })}
    </>
  )
}

export function OrderBookButton(props: {
  limitBets: LimitBet[]
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | CPMMMultiContract
    | MultiContract
  answer?: Answer
  label?: React.ReactNode
}) {
  const { limitBets, contract, answer, label } = props
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={limitBets.length === 0}>
        {label || getOrderBookButtonLabel(limitBets)}
      </button>

      <Modal open={open} setOpen={setOpen} size="md">
        <OrderBookPanel
          limitBets={limitBets}
          contract={contract}
          answer={answer}
          showTitle
        />
      </Modal>
    </>
  )
}

export function getOrderBookButtonLabel(limitBets: LimitBet[]) {
  return `${limitBets.length === 0 ? 'Actualmente' : 'Ver'} ${
    limitBets.length
  } orden${limitBets.length === 1 ? '' : 'es'}`
}

export function OrderBookPanel(props: {
  limitBets: LimitBet[]
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | CPMMMultiContract
    | MultiContract
  answer?: Answer
  showTitle?: boolean
  pseudonym?: {
    YES: {
      pseudonymName: string
      pseudonymColor: string
    }
    NO: {
      pseudonymName: string
      pseudonymColor: string
    }
  }
  onOrderClick?: (data: OrderClickData) => void
}) {
  const { contract, answer, showTitle, pseudonym, onOrderClick } = props
  const limitBets = props.limitBets.filter(
    (b) => (!b.expiresAt || b.expiresAt > Date.now()) && !b.silent
  )

  const yesBets = sortBy(
    limitBets.filter((bet) => bet.outcome === 'YES'),
    (bet) => -1 * bet.limitProb,
    (bet) => bet.createdTime
  )
  const noBets = sortBy(
    limitBets.filter((bet) => bet.outcome === 'NO'),
    (bet) => bet.limitProb,
    (bet) => bet.createdTime
  )

  const isCPMMMulti = contract.mechanism === 'cpmm-multi-1'
  const isPseudoNumeric = contract.outcomeType === 'PSEUDO_NUMERIC'

  if (limitBets.length === 0) return <></>

  return (
    <Col className="text-ink-900 bg-canvas-0 border-ink-200 overflow-hidden border-y">
      {/* Header */}
      <div className="border-ink-200 border-b px-5 py-4">
        <Row className="items-center gap-2">
          <h2 className="text-lg font-semibold">Libro de órdenes</h2>
          <InfoTooltip
            text="Órdenes límite activas de operadores que esperan comprar a precios específicos"
            className="text-ink-400"
          />
        </Row>
        {showTitle && isCPMMMulti && answer && (
          <p className="text-ink-600 mt-1 text-sm">{answer.text}</p>
        )}
      </div>

      {/* Order Tables */}
      <div className="border-ink-200 divide-ink-200 grid grid-cols-2 divide-x">
        <div className="bg-canvas-0 p-4">
          <OrderBookSide
            limitBets={yesBets}
            contract={contract}
            side="YES"
            pseudonym={pseudonym}
            onOrderClick={onOrderClick}
          />
        </div>
        <div className="bg-canvas-0 p-4">
          <OrderBookSide
            limitBets={noBets}
            contract={contract}
            side="NO"
            pseudonym={pseudonym}
            onOrderClick={onOrderClick}
          />
        </div>
      </div>

      {/* Depth Chart */}
      {!isPseudoNumeric && yesBets.length >= 2 && noBets.length >= 2 && (
        <div className="border-ink-200 border-t px-5 py-4">
          <h3 className="text-ink-600 mb-3 text-center text-xs font-medium uppercase tracking-wide">
            Profundidad de mercado
          </h3>
          <SizedContainer className="h-[140px] w-full sm:h-[180px]">
            {(w, h) => (
              <DepthChart
                contract={contract as any}
                answer={answer}
                yesBets={yesBets}
                noBets={noBets}
                width={w}
                height={h}
                pseudonym={pseudonym}
              />
            )}
          </SizedContainer>
        </div>
      )}
    </Col>
  )
}

function OrderBookSide(props: {
  limitBets: LimitBet[]
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | CPMMMultiContract
    | MultiContract
  side: 'YES' | 'NO'
  pseudonym?: {
    YES: { pseudonymName: string; pseudonymColor: string }
    NO: { pseudonymName: string; pseudonymColor: string }
  }
  onOrderClick?: (data: OrderClickData) => void
}) {
  const { contract, side, pseudonym, onOrderClick } = props
  const limitBets = props.limitBets.filter(
    (b) => !b.expiresAt || b.expiresAt > Date.now()
  )
  const isBinaryMC = isBinaryMulti(contract)
  const groupedBets = groupBy(limitBets, (b) => b.limitProb)

  const sideColor = side === 'YES' ? 'text-teal-600' : 'text-scarlet-600'
  const sideBgHover =
    side === 'YES' ? 'hover:bg-teal-500/10' : 'hover:bg-scarlet-500/10'

  return (
    <div>
      <Row className="mb-3 items-center gap-1.5">
        <span className="text-ink-500 text-sm font-medium">Comprar</span>
        {isBinaryMC || !!pseudonym ? (
          <OutcomeLabel
            contract={contract}
            outcome={side}
            truncate={'short'}
            pseudonym={pseudonym}
          />
        ) : (
          <span className={clsx('text-sm font-semibold', sideColor)}>
            {side === 'YES' ? 'SÍ' : 'NO'}
          </span>
        )}
      </Row>

      {limitBets.length === 0 ? (
        <div className="text-ink-400 py-4 text-center text-sm">Sin órdenes</div>
      ) : (
        <div className="space-y-1">
          {Object.entries(groupedBets).map(([prob, bets]) => (
            <OrderBookRow
              key={prob}
              contract={contract}
              limitProb={Number(prob)}
              bets={bets}
              onOrderClick={onOrderClick}
              sideBgHover={sideBgHover}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OrderBookRow(props: {
  contract:
    | BinaryContract
    | PseudoNumericContract
    | StonkContract
    | CPMMMultiContract
    | MultiContract
  limitProb: number
  bets: LimitBet[]
  onOrderClick?: (data: OrderClickData) => void
  sideBgHover: string
}) {
  const { contract, limitProb, bets, onOrderClick, sideBgHover } = props
  const { outcome } = bets[0]
  const isPseudoNumeric = contract.outcomeType === 'PSEUDO_NUMERIC'
  const isBinaryMC = isBinaryMulti(contract)
  const getOpenAmount = (bet: LimitBet) =>
    isMexasOrderBookOnlyContract(contract)
      ? getMexasOpenOrderAmount(bet)
      : bet.orderAmount - bet.amount

  const total = sumBy(bets, getOpenAmount)

  const allUsers = useUsers(uniq(bets.map((b) => b.userId)))?.filter(
    (a) => a != null
  ) as DisplayUser[] | undefined
  const usersById = keyBy(allUsers, (u) => u.id)

  const userBets = groupBy(bets, (b) => b.userId)
  const userSums = Object.entries(userBets).map(
    ([userId, bets]) => [userId, sumBy(bets, getOpenAmount)] as const
  )
  const largest = sortBy(userSums, ([, sum]) => -sum)
    .slice(0, 3)
    .map(([userId]) => usersById[userId])
    .filter((u) => u != null)
    .reverse()

  const [expanded, setExpanded] = useState(false)

  const handleOrderClick = () => {
    if (onOrderClick) {
      onOrderClick({
        outcome: outcome as 'YES' | 'NO',
        limitProb,
        amount: total,
      })
    }
  }

  const isClickable = !!onOrderClick

  return (
    <div>
      <Row
        className={clsx(
          'items-center justify-between rounded-lg px-2 py-1.5 transition-colors',
          isClickable && sideBgHover,
          isClickable && 'cursor-pointer'
        )}
        onClick={isClickable ? handleOrderClick : undefined}
      >
        <Row className="items-center gap-2">
          <span className="text-ink-600 w-10 text-sm font-medium">
            {isPseudoNumeric
              ? getFormattedMappedValue(contract, limitProb)
              : isBinaryMC
              ? formatPercent(getBinaryMCProb(limitProb, outcome))
              : formatPercent(limitProb)}
          </span>
          <div
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((c) => !c)
            }}
            className="cursor-pointer"
          >
            <MultipleOrSingleAvatars
              className="!items-end"
              avatars={largest}
              total={userSums.length}
              size="xs"
              spacing={0.3}
              startLeft={0.6}
            />
          </div>
        </Row>
        <span className="text-ink-900 text-sm font-semibold">
          <MoneyDisplay
            amount={total}
            numberType="short"
            isCashContract={contract.token === 'CASH'}
          />
        </span>
      </Row>

      {expanded && (
        <div className="bg-ink-50 mb-1 ml-2 space-y-1 rounded-lg p-2">
          {bets.map((b) => {
            const u = usersById[b.userId] as DisplayUser | undefined
            return (
              <Row key={b.id} className="items-center justify-between text-sm">
                <Row className="items-center gap-2">
                  <Avatar
                    avatarUrl={u?.avatarUrl}
                    username={u?.username}
                    size="2xs"
                  />
                  <UserLink user={u} short className="text-ink-600" />
                </Row>
                <span className="text-ink-600">
                  <MoneyDisplay
                    amount={getOpenAmount(b)}
                    isCashContract={contract.token === 'CASH'}
                  />
                </span>
              </Row>
            )
          })}
        </div>
      )}
    </div>
  )
}
