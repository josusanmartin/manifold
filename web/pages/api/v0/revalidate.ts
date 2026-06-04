import type { NextApiRequest, NextApiResponse } from 'next'
import { validate } from 'web/lib/api/validator'
import { ValidationError } from 'web/lib/api/validator-types'
import { z } from 'zod'

const bodyParams = z
  .object({
    // This secret is stored in both Firebase and Vercel's environment variables, as API_SECRET.
    apiSecret: z.string(),
    // Path after domain: e.g. "/JamesGrugett/will-pete-buttigieg-ever-be-us-pres"
    pathToRevalidate: z.string(),
  })
  .strict()

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  let params: z.infer<typeof bodyParams>
  try {
    params = validate(bodyParams, req.body)
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json(e)
    }
    console.error(`Unknown error during validation: ${e}`)
    return res.status(500).json({
      error: e,
      message:
        typeof e === 'object' && e && 'message' in e
          ? e.message
          : 'Unknown error revalidating',
    })
  }

  const { apiSecret, pathToRevalidate } = params

  if (apiSecret !== process.env.API_SECRET) {
    return res.status(401).json({ message: 'Invalid api secret' })
  }

  return await res
    .revalidate(pathToRevalidate)
    .then(() => {
      return res.json({ revalidated: true })
    })
    .catch((err) => {
      console.error('Error revalidating:', err)
      return res.status(500).json({
        error: err,
        message:
          typeof err === 'object' && err && 'message' in err
            ? err.message
            : 'Unknown error revalidating',
      })
    })
}
