import clsx from 'clsx'

import { getProbability } from 'common/calculate'
import {
  Contract,
  CPMMContract,
  CPMMMultiContract,
  getMainBinaryMCAnswer,
  isBinaryMulti,
} from 'common/contract'
import { ContractMetric, getMaxSharesOutcome } from 'common/contract-metric'
import { noFees } from 'common/fees'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'
import { User } from 'common/user'
import { useState } from 'react'
import { BinaryMultiSellRow } from 'web/components/answers/answer-components'
import { MultiNumericSellPanel } from 'web/components/answers/numeric-sell-panel'
import { SellRow } from 'web/components/bet/sell-row'
import { useAdmin } from 'web/hooks/use-admin'
import { useSavedContractMetrics } from 'web/hooks/use-saved-contract-metrics'
import { useUser } from 'web/hooks/use-user'
import { useDisplayUserById } from 'web/hooks/use-user-supabase'
import { Button } from '../buttons/button'
import { Col } from '../layout/col'
import { Row } from '../layout/row'
import { NoLabel, YesLabel } from '../outcome-label'
import { ProfitBadge } from '../profit-badge'
import { InfoTooltip } from '../widgets/info-tooltip'
import { MoneyDisplay } from './money-display'
import { SellSharesModal } from './sell-row'

export function UserBetsSummary(props: {
  contract: Contract
  initialMetrics?: ContractMetric
  className?: string
  includeSellButton?: User | null | undefined
}) {
  const { contract, className, includeSellButton } = props
  const metrics = useSavedContractMetrics(contract) ?? props.initialMetrics

  if (!metrics) return <></>
  return (
    <BetsSummary
      contract={contract}
      metric={metrics}
      className={className}
      includeSellButton={includeSellButton}
      areYourBets
    />
  )
}

export function BetsSummary(props: {
  contract: Contract
  metric: ContractMetric
  areYourBets: boolean
  className?: string
  includeSellButton?: User | null | undefined
}) {
  const { contract, metric, className, includeSellButton, areYourBets } = props
  const { resolution, outcomeType } = contract
  const [showAdminSellModal, setShowAdminSellModal] = useState(false)

  const { payout, invested, totalShares = {}, profit, profitPercent } = metric

  const maxSharesOutcome = getMaxSharesOutcome(metric)
  const yesWinnings = totalShares.YES ?? 0
  const noWinnings = totalShares.NO ?? 0

  const position = yesWinnings - noWinnings
  const exampleOutcome = position < 0 ? 'NO' : 'YES'

  const isBinary = outcomeType === 'BINARY'
  const isStonk = outcomeType === 'STONK'
  const isMexasOrderBookOnly = isMexasOrderBookOnlyContract(contract)
  const mainBinaryMCAnswer = getMainBinaryMCAnswer(contract)
  const prob = contract.mechanism === 'cpmm-1' ? getProbability(contract) : 0
  const expectation = prob * yesWinnings + (1 - prob) * noWinnings
  const user = useUser()
  const isAdmin = useAdmin()
  const bettor = useDisplayUserById(metric.userId)
  const isCashContract = contract.token === 'CASH'

  if (metric.invested === 0 && metric.profit === 0) return null

  return (
    <Col className={clsx(className)}>
      <Row className={clsx('flex-wrap items-center gap-4 sm:gap-6')}>
        {resolution ? (
          <Col>
            <div className="text-ink-500 text-sm">Pago</div>
            <div className="whitespace-nowrap">
              <MoneyDisplay amount={payout} isCashContract={isCashContract} />{' '}
              <ProfitBadge profitPercent={profitPercent} />
            </div>
          </Col>
        ) : (
          <Row className={'items-end gap-1'}>
            {isStonk ? (
              <Col>
                <Col>
                  <div className="text-ink-500 whitespace-nowrap text-sm">
                    Valor
                    <InfoTooltip
                      text={`Valor actual de ${
                        areYourBets ? 'tu' : 'su'
                      } posición según el precio actual.`}
                    />
                  </div>
                  <div className="whitespace-nowrap">
                    <MoneyDisplay
                      amount={expectation}
                      isCashContract={isCashContract}
                    />
                  </div>
                </Col>
              </Col>
            ) : isBinary ? (
              <Col>
                <div className="text-ink-500 whitespace-nowrap text-sm">
                  Pago{' '}
                  <InfoTooltip
                    text={
                      <>
                        {areYourBets ? 'Recibirás ' : 'Recibirá '}
                        <MoneyDisplay
                          amount={Math.abs(position)}
                          isCashContract={isCashContract}
                        />{' '}
                        si este mercado resuelve{' '}
                        {exampleOutcome === 'YES' ? 'SÍ' : 'NO'} (y{' '}
                        <MoneyDisplay
                          amount={0}
                          isCashContract={isCashContract}
                        />{' '}
                        si resuelve lo contrario).
                      </>
                    }
                  />
                </div>
                <div className="whitespace-nowrap">
                  {position > 1e-7 ? (
                    <>
                      <MoneyDisplay
                        amount={position}
                        isCashContract={isCashContract}
                      />{' '}
                      en <YesLabel />
                    </>
                  ) : position < -1e-7 ? (
                    <>
                      <MoneyDisplay
                        amount={-position}
                        isCashContract={isCashContract}
                      />{' '}
                      en <NoLabel />
                    </>
                  ) : (
                    '——'
                  )}
                </div>
              </Col>
            ) : (
              <Col className="hidden sm:inline">
                <div className="text-ink-500 whitespace-nowrap text-sm">
                  Valor esperado{' '}
                  <InfoTooltip
                    text={`Valor actual de ${
                      areYourBets ? 'tu' : 'su'
                    } posición según la probabilidad actual.`}
                  />
                </div>
                <div className="whitespace-nowrap">
                  <MoneyDisplay
                    amount={payout}
                    isCashContract={isCashContract}
                  />
                </div>
              </Col>
            )}
          </Row>
        )}

        <Row className="gap-4 sm:contents">
          <Col>
            <div className="text-ink-500 whitespace-nowrap text-sm">
              Usado{' '}
              <InfoTooltip text="Coste base. MEX usado originalmente en este mercado, con contabilidad de coste promedio." />
            </div>
            <div className="whitespace-nowrap">
              <MoneyDisplay amount={invested} isCashContract={isCashContract} />
            </div>
          </Col>

          <Col>
            <div className="text-ink-500 whitespace-nowrap text-sm">
              Ganancia{' '}
              <InfoTooltip
                text={`Cuánto ${
                  areYourBets ? 'has' : 'ha'
                } ganado o perdido en este mercado, incluyendo ganancias realizadas y no realizadas.`}
              />
            </div>
            <div className="whitespace-nowrap">
              <MoneyDisplay amount={profit} isCashContract={isCashContract} />
              <ProfitBadge profitPercent={profitPercent} round={true} />
            </div>
          </Col>
        </Row>

        {isBinary && !resolution && (
          <Col className="hidden sm:inline">
            <div className="text-ink-500 whitespace-nowrap text-sm">
              Valor esperado{' '}
              <InfoTooltip
                text={`Valor actual de ${
                  areYourBets ? 'tu' : 'su'
                } posición según la probabilidad actual.`}
              />
            </div>
            <div className="whitespace-nowrap">
              <MoneyDisplay
                amount={expectation}
                isCashContract={isCashContract}
              />
            </div>
          </Col>
        )}

        {includeSellButton &&
          !isMexasOrderBookOnly &&
          !resolution &&
          (contract.mechanism !== 'cpmm-multi-1' ||
            isBinaryMulti(contract)) && (
            <Row className="items-center gap-2">
              <SellRow
                contract={contract as CPMMContract}
                user={includeSellButton}
                hideStatus={true}
              />
            </Row>
          )}
        {/* Admin sell button - only show for admins viewing other users' bets */}
        {isAdmin &&
          user &&
          bettor &&
          !areYourBets &&
          !resolution &&
          !isMexasOrderBookOnly &&
          maxSharesOutcome &&
          (yesWinnings > 1 || noWinnings > 1) &&
          contract.mechanism === 'cpmm-1' && (
            <>
              <Button
                className="h-10"
                size={'lg'}
                color={'red-outline'}
                onClick={() => setShowAdminSellModal(true)}
              >
                Venta admin
              </Button>
              {showAdminSellModal && (
                <SellSharesModal
                  contract={{
                    ...(contract as CPMMContract),
                    collectedFees:
                      (contract as CPMMContract).collectedFees ?? noFees,
                  }}
                  metric={metric}
                  user={user}
                  shares={Math.abs(position)}
                  sharesOutcome={maxSharesOutcome as 'YES' | 'NO'}
                  setOpen={setShowAdminSellModal}
                  sellForUserId={metric.userId}
                />
              )}
            </>
          )}
      </Row>
      {mainBinaryMCAnswer && (
        <BinaryMultiSellRow
          answer={mainBinaryMCAnswer}
          contract={contract as CPMMMultiContract}
        />
      )}
      {includeSellButton && contract.outcomeType === 'NUMBER' && (
        <MultiNumericSellPanel contract={contract} userId={metric.userId} />
      )}
    </Col>
  )
}
