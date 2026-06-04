import { getUser, log } from 'shared/utils'
import { APIError } from 'common/api/utils'
import { createSupabaseDirectClient } from 'shared/supabase/init'
import { first, groupBy } from 'lodash'
import { CPMMMultiContract } from 'common/contract'
import { getPortfolioHistory } from 'shared/supabase/portfolio-metrics'
import { DAY_MS } from 'common/util/time'
import { LivePortfolioMetrics } from 'common/portfolio-metrics'
import {
  calculateNewPortfolioMetricsWithContractMetrics,
  getUnresolvedContractMetricsContractsAnswers,
} from './update-user-portfolio-histories-core'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'

export const getUserPortfolioInternal = async (
  userId: string,
  mexasOnly = false
) => {
  const user = await getUser(userId)
  if (!user) {
    throw new APIError(404, 'User not found')
  }

  const pg = createSupabaseDirectClient()
  const startTime = Date.now()
  const {
    metrics: allMetrics,
    contracts: allContracts,
    answers: allAnswers,
  } =
    await getUnresolvedContractMetricsContractsAnswers(pg, [userId])
  const mexasContractIds = new Set(
    allContracts
      .filter((contract) => isMexasOrderBookOnlyContract(contract))
      .map((contract) => contract.id)
  )
  const contracts = mexasOnly
    ? allContracts.filter((contract) => mexasContractIds.has(contract.id))
    : allContracts
  const metrics = mexasOnly
    ? allMetrics.filter((metric) => mexasContractIds.has(metric.contractId))
    : allMetrics
  const answers = mexasOnly
    ? allAnswers.filter((answer) => mexasContractIds.has(answer.contractId))
    : allAnswers
  log(`Loaded ${metrics.length} metrics.`)
  log(`Loaded ${contracts.length} contracts and ${answers.length} answers.`)

  const contractsById = Object.fromEntries(contracts.map((c) => [c.id, c]))
  const answersByContractId = groupBy(answers, (a) => a.contractId)
  for (const [contractId, answers] of Object.entries(answersByContractId)) {
    // Denormalize answers onto the contract.
    // eslint-disable-next-line no-extra-semi
    ;(contractsById[contractId] as CPMMMultiContract).answers = answers
  }

  const newPortfolio = calculateNewPortfolioMetricsWithContractMetrics(
    user,
    contractsById,
    metrics
  )
  const { investmentValue, cashInvestmentValue, loanTotal } = newPortfolio

  const dayAgoPortfolio = first(
    await getPortfolioHistory(userId, Date.now() - DAY_MS, 1, pg)
  )

  const dayAgoProfit = dayAgoPortfolio
    ? dayAgoPortfolio.spiceBalance +
      dayAgoPortfolio.balance +
      dayAgoPortfolio.investmentValue -
      dayAgoPortfolio.totalDeposits
    : 0

  log(
    'time',
    Date.now() - startTime,
    'metrics',
    metrics.length,
    'contracts',
    contracts.length,
    'answers',
    answers.length
  )

  const {
    totalDeposits,
    spiceBalance,
    balance,
    cashBalance,
    totalCashDeposits,
  } = user
  return {
    userId,
    loanTotal,
    investmentValue,
    cashInvestmentValue,
    balance,
    cashBalance,
    spiceBalance,
    totalDeposits,
    totalCashDeposits,
    dailyProfit: investmentValue + balance - totalDeposits - dayAgoProfit,
    timestamp: Date.now(),
  } as LivePortfolioMetrics
}
