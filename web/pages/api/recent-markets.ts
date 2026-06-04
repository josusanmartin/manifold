import { API } from 'common/api/schema'
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getSupabaseAdminClient,
  normalizeQuery,
  searchMexasContracts,
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
    const params = API['recent-markets'].props.parse(normalizeQuery(req.query))
    const db = getSupabaseAdminClient()
    const contracts = await searchMexasContracts(db, {
      ...params,
      sort: 'newest',
    })
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
    return res.status(200).json(contracts)
  } catch (error) {
    return sendMexasApiError(res, error, 'Could not load recent MEXAS markets.')
  }
}
