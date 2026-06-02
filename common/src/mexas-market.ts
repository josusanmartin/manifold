type MexasOrderBookCandidate = {
  mechanism?: string
  outcomeType?: string
  takerAPIOrdersDisabled?: boolean
  token?: string
}

export function isMexasOrderBookOnlyContract(
  contract: MexasOrderBookCandidate
) {
  if (contract.takerAPIOrdersDisabled) return true

  return (
    contract.token !== 'CASH' &&
    contract.mechanism === 'cpmm-1' &&
    contract.outcomeType === 'BINARY'
  )
}
