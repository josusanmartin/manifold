import { ChartBarIcon, UserIcon } from '@heroicons/react/solid'
import { Contract } from 'common/contract'
import { formatWithToken, shortFormatNumber } from 'common/util/format'
import { Row } from 'web/components/layout/row'
import { MoneyDisplay } from '../bet/money-display'
import { LiquidityTooltip } from '../tiers/liquidity-tooltip'
import { Tooltip } from '../widgets/tooltip'
import { BountyLeft } from './bountied-question'
import { CloseOrResolveTime } from './contract-details'

export function ContractSummaryStats(props: {
  contractId: string
  creatorId: string
  question: string
  financeContract: Contract
  editable?: boolean
  isCashContract?: boolean
}) {
  const { financeContract: contract, editable, isCashContract } = props
  const { outcomeType } = contract
  return (
    <>
      {outcomeType == 'BOUNTIED_QUESTION' ? (
        <BountyLeft
          bountyLeft={contract.bountyLeft}
          totalBounty={contract.totalBounty}
          inEmbed={true}
        />
      ) : (
        <Row className="ml-auto gap-4">
          <Tooltip
            text={outcomeType == 'POLL' ? 'Votantes' : 'Operadores'}
            placement="bottom"
            className="flex flex-row items-center gap-0.5"
            tooltipClassName="z-40"
          >
            <UserIcon className="text-ink-500 h-4 w-4" />
            <div>{shortFormatNumber(contract.uniqueBettorCount ?? 0)}</div>
          </Tooltip>
          <LiquidityTooltip contract={contract} iconClassName="text-ink-500" />
          {!!contract.volume && (
            <Tooltip
              text={`Volumen total operado: ${formatWithToken({
                amount: contract.volume,
                token: isCashContract ? 'CASH' : 'M$',
              })}`}
              placement="bottom"
              className="flex flex-row items-center gap-0.5"
              tooltipClassName="z-40"
            >
              <ChartBarIcon className="text-ink-500 h-4 w-4" />
              <MoneyDisplay
                amount={contract.volume}
                isCashContract={!!isCashContract}
                numberType="short"
              />
            </Tooltip>
          )}

          {/* {isCreator && contract.mechanism !== 'none' && (
            <CreatorFeesDisplay contract={contract} />
          )} */}
          <CloseOrResolveTime contract={contract} editable={editable} />
        </Row>
      )}
    </>
  )
}
