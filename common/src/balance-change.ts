import { Bet } from 'common/bet'
import { User } from 'common/user'
import { ContractToken, Visibility } from 'common/contract'
import { QuestType } from 'common/quest'
import { Answer } from 'common/answer'
import { AnyTxnCategory, Txn } from './txn'

export type AnyBalanceChangeType =
  | BetBalanceChange
  | TxnBalanceChange
  | MexasTreasuryBalanceChange
  | MexasWalletBalanceChange

export type BalanceChange = {
  type: string
  key: string
  amount: number
  createdTime: number
}

type MinimalContract = {
  question: string
  slug?: string
  visibility: Visibility
  creatorUsername: string
  token: ContractToken
}

export const BET_BALANCE_CHANGE_TYPES = [
  'create_bet',
  'sell_shares',
  'redeem_shares',
  'fill_bet',
  'loan_payment',
] as const

export type BetBalanceChange = BalanceChange & {
  type: (typeof BET_BALANCE_CHANGE_TYPES)[number]
  bet: Pick<Bet, 'outcome' | 'shares'>
  answer: Pick<Answer, 'text' | 'id'> | undefined
  contract: MinimalContract
}

export type TxnBalanceChange = BalanceChange & {
  type: AnyTxnCategory
  token: Txn['token']
  contract?: MinimalContract
  questType?: QuestType
  user?: Pick<User, 'username' | 'name'>
  charity?: { name: string; slug: string }
  description?: string
  answerText?: string
}

export type MexasTreasuryBalanceChange = BalanceChange & {
  type: 'mexas_treasury_transfer'
  token: 'MEX'
  transferType:
    | 'order-release'
    | 'resolution-payout'
    | 'resolution-cancel'
    | 'withdrawal'
  status: 'pending' | 'processing' | 'submitted' | 'confirmed'
  txHash?: string
  contract?: MinimalContract
}

export type MexasWalletBalanceChange = BalanceChange & {
  type: 'mexas_wallet_movement'
  token: 'MEX'
  movementType: 'deposit' | 'withdrawal'
  walletAddress: string
  previousWalletAmount: number
  newWalletAmount: number
  openReservedAmount: number
}

export const isBetChange = (
  change: AnyBalanceChangeType
): change is BetBalanceChange =>
  BET_BALANCE_CHANGE_TYPES.includes(change.type as any)

export const isMexasTreasuryChange = (
  change: AnyBalanceChangeType
): change is MexasTreasuryBalanceChange =>
  change.type === 'mexas_treasury_transfer'

export const isMexasWalletChange = (
  change: AnyBalanceChangeType
): change is MexasWalletBalanceChange =>
  change.type === 'mexas_wallet_movement'

export const isTxnChange = (
  change: AnyBalanceChangeType
): change is TxnBalanceChange =>
  !('bet' in change) &&
  !isMexasTreasuryChange(change) &&
  !isMexasWalletChange(change)
