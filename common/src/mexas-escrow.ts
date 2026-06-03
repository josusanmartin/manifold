import { MEXAS_TOKEN } from './crypto/mexas'
import {
  getConfirmedMexasTransferUnits,
  mexasUnitsToTokenAmount,
  type MexasTransferReceipt,
} from './crypto/mexas-transfer'

export type MexasEscrowCaptureCheck = {
  capturedAmount: number
  capturedUnits: bigint
  requiredAmount: number
  requiredUnits: bigint
  sufficient: boolean
}

export function mexasAmountToUnits(amount: number) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Invalid MEXAS amount.')
  }

  return BigInt(Math.round(amount * 10 ** MEXAS_TOKEN.decimals))
}

export function getMexasEscrowCaptureCheck(params: {
  payerAddress: string
  receipt: MexasTransferReceipt
  requiredAmount: number
  treasuryAddress: string
}): MexasEscrowCaptureCheck {
  const requiredUnits = mexasAmountToUnits(params.requiredAmount)
  const capturedUnits = getConfirmedMexasTransferUnits(
    params.receipt,
    params.payerAddress,
    params.treasuryAddress
  )

  return {
    capturedAmount: mexasUnitsToTokenAmount(capturedUnits),
    capturedUnits,
    requiredAmount: mexasUnitsToTokenAmount(requiredUnits),
    requiredUnits,
    sufficient: capturedUnits >= requiredUnits,
  }
}
