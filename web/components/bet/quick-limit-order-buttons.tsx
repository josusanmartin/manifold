import clsx from 'clsx'
import { useState } from 'react'
import toast from 'react-hot-toast'

import { Answer } from 'common/answer'
import { APIError } from 'common/api/utils'
import { CPMMContract, MultiContract } from 'common/contract'
import { formatPercent, formatWithToken } from 'common/util/format'
import { removeUndefinedProps } from 'common/util/object'
import { DAY_MS } from 'common/util/time'
import Link from 'next/link'
import { useUser } from 'web/hooks/use-user'
import { api } from 'web/lib/api/api'
import { track } from 'web/lib/service/analytics'
import { Button } from '../buttons/button'
import { Col } from '../layout/col'
import { Row } from '../layout/row'
import { InfoTooltip } from '../widgets/info-tooltip'
import { MoneyDisplay } from './money-display'

export const QuickLimitOrderButtons = (props: {
  contract: CPMMContract | MultiContract
  answer?: Answer
  className?: string
}) => {
  const { contract, answer, className } = props
  if (!answer && contract.mechanism === 'cpmm-multi-1') {
    throw new Error('Answer must be provided for multi contracts')
  }

  const isCashContract = contract.token === 'CASH'

  const unroundedProb = answer ? answer.prob : (contract as CPMMContract).prob
  const prob = Math.round(unroundedProb * 100) / 100
  const amount = 100

  const user = useUser()
  const [error, setError] = useState<string | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<'YES' | 'NO'>('YES')
  const [showBuyMore, setShowBuyMore] = useState(false)

  async function submitBet(outcome: 'YES' | 'NO') {
    if (!user) return
    if (user.balance < amount) {
      setError('Saldo insuficiente')
      setShowBuyMore(true)
      return
    }

    setError(undefined)
    setIsSubmitting(true)
    setOutcome(outcome)

    // const answerId = multiProps?.answerToBuy.id
    const expiresAt = Date.now() + DAY_MS

    await api(
      'bet',
      removeUndefinedProps({
        outcome,
        amount,
        contractId: contract.id,
        limitProb: prob,
        expiresAt,
        answerId: answer?.id,
      })
    )
      .then((r) => {
        console.log('placed order. Result:', r)
        setIsSubmitting(false)
        toast.success(
          `Orden enviada por ${formatWithToken({
            amount: amount,
            token: isCashContract ? 'CASH' : 'M$',
          })} ${outcome === 'YES' ? 'SÍ' : 'NO'} a ${formatPercent(prob)}`
        )
      })
      .catch((e) => {
        if (e instanceof APIError) {
          setError(e.message.toString())
        } else {
          console.error(e)
          setError('Error al enviar la orden')
        }
        setIsSubmitting(false)
      })

    await track(
      'bet',
      removeUndefinedProps({
        location: 'quick bet panel',
        outcomeType: contract.outcomeType,
        token: contract.token,
        slug: contract.slug,
        contractId: contract.id,
        amount,
        outcome,
        limitProb: prob,
        isLimitOrder: true,
        answerId: answer?.id,
      })
    )
  }

  return (
    <Col
      className={clsx(className, 'border-ink-200 my-2 gap-2 rounded-lg py-2')}
    >
      <Row className="items-center gap-2">
        <div className="text-ink-600">
          Orden límite rápida{' '}
          <InfoTooltip
            text={`Oferta para comprar ${formatWithToken({
              amount: amount,
              token: isCashContract ? 'CASH' : 'M$',
            })} SÍ o NO al precio actual de mercado de ${formatPercent(
              prob
            )}. Si nadie toma tu orden, expirará en 24 horas.`}
          />
        </div>
        <Button
          size="xs"
          color="gray-outline"
          loading={outcome === 'YES' && isSubmitting}
          className="w-24 whitespace-nowrap font-semibold"
          onClick={() => submitBet('YES')}
        >
          <MoneyDisplay amount={amount} isCashContract={isCashContract} /> SÍ
        </Button>
        <Button
          size="xs"
          color="gray-outline"
          loading={outcome === 'NO' && isSubmitting}
          className="w-24 whitespace-nowrap font-semibold"
          onClick={() => submitBet('NO')}
        >
          <MoneyDisplay amount={amount} isCashContract={isCashContract} /> NO
        </Button>
      </Row>
      {error && (
        <Row className="items-center gap-2 text-red-500">
          {error}
          {showBuyMore && (
            <Link href="/wallet" className="text-primary-500 hover:underline">
              Abrir Wallet
            </Link>
          )}
        </Row>
      )}
    </Col>
  )
}
