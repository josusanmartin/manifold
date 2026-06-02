import { createClient } from 'common/supabase/utils'

let currentToken: string | undefined

export function getSupabaseInstanceId() {
  const instanceIdOrUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_INSTANCE_ID ||
    process.env.SUPABASE_INSTANCE_ID

  if (!instanceIdOrUrl) {
    throw new Error(
      'MEXAS Supabase requires NEXT_PUBLIC_SUPABASE_URL or SUPABASE_INSTANCE_ID.'
    )
  }

  return instanceIdOrUrl
}

export function initSupabaseClient() {
  const publicUrlOrInstanceId =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_INSTANCE_ID
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_KEY

  if (
    process.env.LOCAL_ONLY === 'true' ||
    process.env.NEXT_PUBLIC_LOCAL_ONLY === 'true'
  ) {
    if (publicUrlOrInstanceId && publicKey) {
      return createClient(publicUrlOrInstanceId, publicKey)
    } else {
      throw new Error(
        'LOCAL_ONLY mode requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to be set'
      )
    }
  }

  if (!publicUrlOrInstanceId || !publicKey) {
    throw new Error(
      'MEXAS Supabase client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
    )
  }

  return createClient(publicUrlOrInstanceId, publicKey)
}

export function updateSupabaseAuth(token?: string) {
  if (currentToken != token) {
    currentToken = token
    if (token == null) {
      delete db['rest'].headers['Authorization']
      db['realtime'].setAuth(null)
    } else {
      db['rest'].headers['Authorization'] = `Bearer ${token}`
      db['realtime'].setAuth(token)
    }
  }
}

export const db = initSupabaseClient()
