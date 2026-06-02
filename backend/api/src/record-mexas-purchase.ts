import { APIError, APIHandler } from 'api/helpers/endpoint'

export const recordMexasPurchase: APIHandler<'record-mexas-purchase'> =
  async () => {
    throw new APIError(
      404,
      'Endpoint not available on MEXAS Markets. Deposit MEX directly to your Privy Wallet.'
    )
  }
