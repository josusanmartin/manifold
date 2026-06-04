import { API } from 'common/api/schema'
import type { NextApiRequest, NextApiResponse } from 'next'
import { normalizeQuery, sendMexasApiError } from 'web/lib/api/mexas-profile'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    API['get-user-portfolio-history'].props.parse(normalizeQuery(req.query))
    return res.status(200).json([])
  } catch (error) {
    return sendMexasApiError(
      res,
      error,
      'Could not load MEXAS portfolio history.'
    )
  }
}
