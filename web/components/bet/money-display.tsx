import { formatWithToken, InputTokenType } from 'common/util/format'
import { NumberDisplayType } from '../widgets/token-number'

export function MoneyDisplay(props: {
  amount: number
  isCashContract?: boolean
  numberType?: NumberDisplayType
  token?: InputTokenType
}) {
  const { amount, isCashContract = false, numberType, token } = props

  const toDecimal =
    numberType === 'toDecimal' ? (isCashContract ? 4 : 2) : undefined

  return (
    <>
      {formatWithToken({
        amount: amount,
        token: token ?? (isCashContract ? 'CASH' : 'M$'),
        toDecimal: toDecimal,
        short: numberType === 'short',
      })}
    </>
  )
}
