import { API } from 'common/api/schema'
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getMexasBalanceChanges,
  getSupabaseAdminClient,
  normalizeQuery,
  sendMexasApiError,
} from 'web/lib/api/mexas-profile'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    const params = API['get-balance-changes'].props.parse(
      normalizeQuery(req.query)
    )
    const db = getSupabaseAdminClient()
    return res.status(200).json(await getMexasBalanceChanges(db, params))
  } catch (error) {
    return sendMexasApiError(res, error, 'Could not load MEXAS movements.')
  }
}
