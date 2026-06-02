import { useEffect, useState } from 'react'
import { YesNoCancelSelector } from './bet/yes-no-selector'
import { Spacer } from './layout/spacer'
import { ResolveConfirmationButton } from './buttons/confirmation-button'
import { APIError, api } from 'web/lib/api/api'
import { getAnswerProbability, getProbability } from 'common/calculate'
import {
  BinaryContract,
  Contract,
  MultiContract,
  resolution,
} from 'common/contract'
import { Row } from 'web/components/layout/row'
import { ProbabilityInput } from './widgets/probability-input'
import { Button } from './buttons/button'
import { Answer } from 'common/answer'
import { Col } from './layout/col'
import { removeUndefinedProps } from 'common/util/object'
import { useUser } from 'web/hooks/use-user'
import { EditCloseTimeModal } from 'web/components/contract/contract-details'
import clsx from 'clsx'
import { linkClass } from 'web/components/widgets/site-link'
import Link from 'next/link'
import { XIcon } from '@heroicons/react/solid'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'

type MexasResolutionReadiness = {
  canResolve: boolean
  requiresEscrow: boolean
  filledBetCount: number
  filledStake: number
  openReservationRefund: number
  yesPayout: number
  noPayout: number
  cancelPayout: number
  message?: string
}

function getResolveButtonColor(outcome: resolution | undefined) {
  return outcome === 'YES'
    ? 'green'
    : outcome === 'NO'
    ? 'red'
    : outcome === 'CANCEL'
    ? 'yellow'
    : outcome === 'MKT'
    ? 'blue'
    : 'indigo'
}

function getResolveButtonLabel(
  outcome: resolution | undefined,
  prob: number | undefined
) {
  return outcome === 'CANCEL'
    ? 'N/A'
    : outcome === 'MKT'
    ? `${prob ?? ''}%`
    : outcome === 'YES'
    ? 'SÍ'
    : outcome ?? ''
}

export function ResolutionPanel(props: {
  contract: BinaryContract
  inModal?: boolean
  onClose: () => void
}) {
  const { contract, inModal, onClose } = props
  const isCreator = useUser()?.id === contract.creatorId
  const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(contract)

  const [outcome, setOutcome] = useState<resolution | undefined>()

  const [prob, setProb] = useState<number | undefined>(
    Math.round(getProbability(contract) * 100)
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [mexasReadiness, setMexasReadiness] = useState<
    MexasResolutionReadiness | undefined
  >()
  const [mexasReadinessError, setMexasReadinessError] = useState<
    string | undefined
  >()

  useEffect(() => {
    if (!isMexasOrderBookOnly) return

    let cancelled = false
    setMexasReadiness(undefined)
    setMexasReadinessError(undefined)

    fetch(
      `/api/v0/market/${encodeURIComponent(
        contract.id
      )}/mexas-resolution-readiness`
    )
      .then(async (res) => {
        const body = await res.json().catch(() => undefined)
        if (!res.ok) {
          throw new Error(
            body?.message ?? 'No se pudo verificar la resolución MEXAS.'
          )
        }
        return body as MexasResolutionReadiness
      })
      .then((readiness) => {
        if (!cancelled) setMexasReadiness(readiness)
      })
      .catch((e) => {
        if (cancelled) return
        const message =
          e instanceof Error
            ? e.message
            : 'No se pudo verificar la resolución MEXAS.'
        setMexasReadinessError(message)
      })

    return () => {
      cancelled = true
    }
  }, [contract.id, isMexasOrderBookOnly])

  const mexasReadinessLoading =
    isMexasOrderBookOnly && !mexasReadiness && !mexasReadinessError
  const mexasResolutionBlocked =
    isMexasOrderBookOnly &&
    (mexasReadinessLoading ||
      !!mexasReadinessError ||
      mexasReadiness?.requiresEscrow === true)
  const resolveDisabled = !outcome || mexasResolutionBlocked

  const resolve = async () => {
    if (!outcome || mexasResolutionBlocked) return

    setIsSubmitting(true)

    try {
      await api('market/:contractId/resolve', {
        outcome,
        contractId: contract.id,
        probabilityInt: prob,
      })
      onClose()
    } catch (e) {
      if (e instanceof APIError) {
        const message = e.message.toString()
        // Check for serialization errors and display friendly message
        if (
          message.toLowerCase().includes('could not serialize access') ||
          message
            .toLowerCase()
            .includes('serialize access due to read/write dependencies')
        ) {
          setError(
            'El servidor está ocupado. Intenta resolver de nuevo en un momento.'
          )
        } else {
          setError(message)
        }
      } else {
        // Also check non-APIError cases (raw database errors)
        const errorMessage = String(e)
        if (
          errorMessage.toLowerCase().includes('could not serialize access') ||
          errorMessage
            .toLowerCase()
            .includes('serialize access due to read/write dependencies')
        ) {
          setError(
            'El servidor está ocupado. Intenta resolver de nuevo en un momento.'
          )
        } else {
          console.error(e)
          setError('Error al resolver la pregunta')
        }
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <ResolveHeader
        contract={contract}
        isCreator={isCreator}
        onClose={onClose}
        fullTitle={inModal}
      />

      <YesNoCancelSelector
        selected={outcome}
        onSelect={setOutcome}
        includeMkt={!isMexasOrderBookOnly}
      />

      <Spacer h={4} />
      {!!error && <div className="text-scarlet-500">{error}</div>}
      {isMexasOrderBookOnly && (
        <MexasResolutionReadinessNotice
          readiness={mexasReadiness}
          error={mexasReadinessError}
          loading={mexasReadinessLoading}
        />
      )}

      <Row className={'items-center justify-between gap-3'}>
        <div className="text-sm">
          {outcome === 'YES' ? (
            <>Paga a quienes compraron SÍ.</>
          ) : outcome === 'NO' ? (
            <>Paga a quienes compraron NO.</>
          ) : outcome === 'CANCEL' ? (
            <>
              Cancela el mercado y devuelve el MEX reservado en órdenes
              abiertas.
            </>
          ) : outcome === 'MKT' ? (
            <Col className="gap-2">
              <Col className=" gap-2">
                <span>Pagar con esta probabilidad:</span>{' '}
                <ProbabilityInput
                  prob={prob}
                  onChange={setProb}
                  className="!h-11 w-28"
                />
              </Col>
              <div className="text-ink-500">
                Quienes tengan SÍ reciben este porcentaje del pago y NO recibe
                el resto.
              </div>
            </Col>
          ) : (
            <ResolutionExplainer />
          )}
        </div>
        {!inModal && (
          <ResolveConfirmationButton
            size="xl"
            color={getResolveButtonColor(outcome)}
            label={getResolveButtonLabel(outcome, prob)}
            marketTitle={contract.question}
            disabled={resolveDisabled}
            onResolve={resolve}
            isSubmitting={isSubmitting}
          />
        )}
        {inModal && (
          <Button
            color={getResolveButtonColor(outcome)}
            disabled={resolveDisabled || isSubmitting}
            loading={isSubmitting}
            onClick={resolve}
          >
            Resolver a {getResolveButtonLabel(outcome, prob)}
          </Button>
        )}
      </Row>
    </>
  )
}

export function ResolveHeader(props: {
  fullTitle?: boolean
  contract: Contract
  isCreator: boolean
  onClose: () => void
}) {
  const { fullTitle, contract, isCreator, onClose } = props
  const { closeTime } = contract
  const [isEditingCloseTime, setIsEditingCloseTime] = useState(false)
  const setNewCloseTime = (newCloseTime: number) => {
    if (newCloseTime > Date.now()) onClose()
  }
  return (
    <Col>
      <Row className="justify-end">
        <Button onClick={onClose} color="gray-white">
          <XIcon className="mr-2 h-4 w-4" />
          Cerrar
        </Button>
      </Row>
      <Row className="mb-6 items-start justify-between">
        {closeTime && closeTime < Date.now() ? (
          <Col>
            <span className="mb-2 text-lg">
              {!isCreator && (
                <span className="mr-2 rounded bg-purple-100 p-1 align-baseline text-xs uppercase text-purple-600 dark:bg-purple-900 dark:text-purple-300">
                  Mod
                </span>
              )}
              Si {isCreator ? 'tu' : 'esta'} pregunta cerró demasiado pronto{' '}
            </span>
            <Button color={'gray'} onClick={() => setIsEditingCloseTime(true)}>
              Extender cierre
            </Button>
          </Col>
        ) : (
          <div />
        )}
      </Row>
      <div className="mb-2 text-lg">
        {!isCreator && (
          <span className="mr-2 rounded bg-purple-100 p-1 align-baseline text-xs uppercase text-purple-600 dark:bg-purple-900 dark:text-purple-300">
            Mod
          </span>
        )}
        Si ya sabes el resultado, resuelve{' '}
        {fullTitle
          ? `"${contract.question}"`
          : isCreator
          ? 'tu pregunta'
          : `la pregunta de ${contract.creatorName}`}
      </div>
      <EditCloseTimeModal
        contract={contract}
        isOpen={isEditingCloseTime}
        setOpen={setIsEditingCloseTime}
        setNewCloseTime={setNewCloseTime}
      />
    </Col>
  )
}

export function MiniResolutionPanel(props: {
  contract: MultiContract
  answer: Answer
  isAdmin: boolean
  isCreator: boolean
  modalSetOpen?: (open: boolean) => void
}) {
  const { contract, answer, isAdmin, isCreator, modalSetOpen } = props

  const [outcome, setOutcome] = useState<resolution | undefined>()
  const toggleOutcome = (newOutcome: resolution | undefined) => {
    if (newOutcome === outcome) {
      setOutcome(undefined)
    } else {
      setOutcome(newOutcome)
    }
  }

  const [prob, setProb] = useState<number | undefined>(
    Math.round(getAnswerProbability(contract, answer.id) * 100)
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const resolve = async () => {
    if (!outcome) return

    setIsSubmitting(true)

    try {
      await api(
        'market/:contractId/resolve',
        removeUndefinedProps({
          outcome,
          contractId: contract.id,
          probabilityInt: prob,
          answerId: answer.id,
        })
      )
    } catch (e) {
      if (e instanceof APIError) {
        const message = e.message.toString()
        // Check for serialization errors and display friendly message
        if (
          message.toLowerCase().includes('could not serialize access') ||
          message
            .toLowerCase()
            .includes('serialize access due to read/write dependencies')
        ) {
          setError(
            'El servidor está ocupado. Intenta resolver de nuevo en un momento.'
          )
        } else {
          setError(message)
        }
      } else {
        // Also check non-APIError cases (raw database errors)
        const errorMessage = String(e)
        if (
          errorMessage.toLowerCase().includes('could not serialize access') ||
          errorMessage
            .toLowerCase()
            .includes('serialize access due to read/write dependencies')
        ) {
          setError(
            'El servidor está ocupado. Intenta resolver de nuevo en un momento.'
          )
        } else {
          console.error(e)
          setError('Error al resolver la pregunta')
        }
      }
    }

    setIsSubmitting(false)
    if (modalSetOpen) {
      modalSetOpen(false)
    }
  }

  return (
    <Row className="mt-2 flex-wrap gap-4">
      {isAdmin && !isCreator && (
        <div className="bg-scarlet-50 text-scarlet-500 self-start rounded p-1 text-xs">
          ADMIN
        </div>
      )}
      <Col className="gap-1">
        <YesNoCancelSelector selected={outcome} onSelect={toggleOutcome} />
        {outcome === 'MKT' && (
          <Col className="gap-2">
            <Row className="flex-wrap items-center gap-1">
              Resolver a
              <ProbabilityInput
                prob={prob}
                onChange={setProb}
                className="w-28"
                inputClassName=""
              />
            </Row>
            <div className="text-ink-500">
              Quienes tengan SÍ reciben este porcentaje del pago y NO recibe el
              resto.
            </div>
          </Col>
        )}
        {outcome === 'CANCEL' && (
          <div className="text-warning">
            Cancelar operaciones y devolver MEX
          </div>
        )}
        {error && (
          <div className="text-scarlet-500 self-start rounded p-1 text-xs">
            {error}
          </div>
        )}
      </Col>
      <ResolveConfirmationButton
        size="sm"
        color={getResolveButtonColor(outcome)}
        label={getResolveButtonLabel(outcome, prob)}
        marketTitle={`${contract.question} - ${answer.text}`}
        disabled={!outcome}
        onResolve={resolve}
        isSubmitting={isSubmitting}
      />
    </Row>
  )
}

export const ResolutionExplainer = (props: {
  independentMulti?: boolean
  pseudoNumeric?: boolean
}) => {
  const { independentMulti, pseudoNumeric } = props
  return (
    <div className="text-ink-500 text-sm">
      {!pseudoNumeric && (
        <>
          Resuelve {independentMulti ? 'la respuesta' : 'la pregunta'} y paga a
          quienes acertaron. <br />{' '}
        </>
      )}
      Si necesitas ayuda, revisa las reglas del mercado o pregunta en nuestro{' '}
      <Link
        onClick={(e) => {
          e.stopPropagation()
        }}
        href="https://discord.gg/eHQBNBqXuh"
        className={clsx(linkClass, 'underline')}
      >
        Discord
      </Link>
      !
    </div>
  )
}

function MexasResolutionReadinessNotice(props: {
  readiness: MexasResolutionReadiness | undefined
  error: string | undefined
  loading: boolean
}) {
  const { readiness, error, loading } = props

  if (loading) {
    return (
      <div className="bg-canvas-50 text-ink-600 rounded-md p-3 text-sm">
        Verificando liquidación MEXAS...
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-scarlet-50 text-scarlet-600 rounded-md p-3 text-sm">
        No se pudo verificar la exposición MEXAS. Recarga antes de resolver.
      </div>
    )
  }

  if (readiness?.requiresEscrow) {
    return (
      <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
        Este mercado tiene {readiness.filledBetCount} posiciones llenadas y la
        resolución queda bloqueada hasta activar escrow on-chain. Esto evita
        crear saldos internos MEX sin respaldo.
      </div>
    )
  }

  return (
    <div className="bg-canvas-50 text-ink-600 rounded-md p-3 text-sm">
      No hay posiciones llenadas pendientes de settlement. Al resolver, las
      órdenes abiertas se cancelan y el MEX reservado se devuelve.
    </div>
  )
}
