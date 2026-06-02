import { APIError } from 'common/api/utils'
import type { SupabaseClient } from 'common/supabase/utils'

const BALANCE_UPDATE_ATTEMPTS = 5
const EPSILON = 1e-9
const MEXAS_BALANCE_CREDIT_KEYS = 'mexasBalanceCreditKeys'

function getUserData(row: { data: unknown } | null) {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function getMexasBalanceCreditKeys(data: Record<string, unknown>) {
  const raw = data[MEXAS_BALANCE_CREDIT_KEYS]
  return Array.isArray(raw)
    ? raw.filter((key): key is string => typeof key === 'string')
    : []
}

export async function updateMexasUserBalanceCas(
  db: SupabaseClient,
  userId: string,
  delta: number,
  options?: {
    creditKey?: string
    dataPatch?: Record<string, unknown>
  }
) {
  for (let attempt = 0; attempt < BALANCE_UPDATE_ATTEMPTS; attempt++) {
    const { data: userRow, error: readError } = await db
      .from('users')
      .select('id,balance,data')
      .eq('id', userId)
      .single()

    if (readError) throw readError
    if (!userRow) throw new APIError(404, 'User not found.')

    const userData = getUserData(userRow)
    const creditKeys = getMexasBalanceCreditKeys(userData)
    if (options?.creditKey && creditKeys.includes(options.creditKey)) {
      return { credited: false, user: userRow }
    }

    const nextBalance = userRow.balance + delta
    if (nextBalance < -EPSILON) {
      throw new APIError(403, 'Insufficient balance.')
    }

    const nextData: Record<string, unknown> = {
      ...userData,
      ...(options?.dataPatch ?? {}),
    }
    if (options?.creditKey) {
      nextData[MEXAS_BALANCE_CREDIT_KEYS] = [...creditKeys, options.creditKey]
    }

    const { data: updatedUserRow, error: updateError } = await db
      .from('users')
      .update({
        balance: Math.max(0, nextBalance),
        data: nextData as any,
      })
      .eq('id', userId)
      .eq('balance', userRow.balance)
      .select('id,balance,data')
      .maybeSingle()

    if (updateError) throw updateError
    if (updatedUserRow) return { credited: true, user: updatedUserRow }
  }

  throw new APIError(503, 'Balance changed. Please try again.')
}
