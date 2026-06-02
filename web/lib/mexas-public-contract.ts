import { Contract, ContractParams } from 'common/contract'
import { isMexasOrderBookOnlyContract } from 'common/mexas-market'

export function toPublicMexasContract<T extends Contract>(contract: T): T {
  if (!isMexasOrderBookOnlyContract(contract)) return contract

  return {
    ...contract,
    token: 'MEX',
  } as T
}

export function toPublicMexasContractParams(
  params: Omit<ContractParams, 'cash'>
): Omit<ContractParams, 'cash'> {
  return {
    ...params,
    contract: toPublicMexasContract(params.contract),
    relatedContracts: params.relatedContracts.map(toPublicMexasContract),
  }
}
