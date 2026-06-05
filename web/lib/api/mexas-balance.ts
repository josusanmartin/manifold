import { APIError } from 'common/api/utils'
import { getNewBetId } from 'common/bet'
import type { SupabaseClient } from 'common/supabase/utils'

const BALANCE_UPDATE_ATTEMPTS = 5
const BALANCE_LOCK_ATTEMPTS = 30
const BALANCE_LOCK_RETRY_MS = 100
const BALANCE_LOCK_TIMEOUT_MS = 2 * 60 * 1000
const EPSILON = 1e-9
const MEXAS_BALANCE_CREDIT_KEYS = 'mexasBalanceCreditKeys'
const MEXAS_BALANCE_LOCK_KEY = 'mexasBalanceLock'
const MEXAS_BALANCE_LOCK_OWNER_KEY = 'mexasBalanceLockOwner'
const MEXAS_BALANCE_LOCK_SINCE_KEY = 'mexasBalanceLockSince'

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hasFreshMexasUserBalanceLock(data: Record<string, unknown>) {
  const locked = data[MEXAS_BALANCE_LOCK_KEY] === true
  const since =
    typeof data[MEXAS_BALANCE_LOCK_SINCE_KEY] === 'number'
      ? data[MEXAS_BALANCE_LOCK_SINCE_KEY]
      : 0

  return locked && Date.now() - since < BALANCE_LOCK_TIMEOUT_MS
}

export async function acquireMexasUserBalanceLock(
  db: SupabaseClient,
  userId: string
) {
  const lockOwner = getNewBetId()

  for (let attempt = 0; attempt < BALANCE_LOCK_ATTEMPTS; attempt++) {
    const { data: userRow, error: readError } = await db
      .from('users')
      .select('id,data')
      .eq('id', userId)
      .single()

    if (readError) throw readError
    if (!userRow) throw new APIError(404, 'User not found.')

    const userData = getUserData(userRow)
    if (hasFreshMexasUserBalanceLock(userData)) {
      await sleep(BALANCE_LOCK_RETRY_MS)
      continue
    }

    const now = Date.now()
    const lockedData = {
      ...userData,
      [MEXAS_BALANCE_LOCK_KEY]: true,
      [MEXAS_BALANCE_LOCK_OWNER_KEY]: lockOwner,
      [MEXAS_BALANCE_LOCK_SINCE_KEY]: now,
    }

    const previousOwner = userData[MEXAS_BALANCE_LOCK_OWNER_KEY]
    const previousSince = userData[MEXAS_BALANCE_LOCK_SINCE_KEY]
    const isStaleLocked = userData[MEXAS_BALANCE_LOCK_KEY] === true

    let query = db
      .from('users')
      .update({ data: lockedData as any })
      .eq('id', userId)
      .filter('data', 'eq', JSON.stringify(userRow.data))

    if (isStaleLocked && typeof previousOwner === 'string') {
      query = query.eq('data->>mexasBalanceLockOwner', previousOwner)
    } else if (isStaleLocked && typeof previousSince === 'number') {
      query = query.eq('data->>mexasBalanceLockSince', String(previousSince))
    } else {
      query = query.or(
        'data->>mexasBalanceLock.is.null,data->>mexasBalanceLock.eq.false'
      )
    }

    const { data: lockedRow, error: updateError } = await query
      .select('id,data')
      .maybeSingle()

    if (updateError) throw updateError
    if (lockedRow) return lockOwner

    await sleep(BALANCE_LOCK_RETRY_MS)
  }

  throw new APIError(503, 'MEX balance is busy. Please try again.')
}

export async function releaseMexasUserBalanceLock(
  db: SupabaseClient,
  userId: string,
  lockOwner: string
) {
  const { data: userRow, error: readError } = await db
    .from('users')
    .select('id,data')
    .eq('id', userId)
    .single()

  if (readError || !userRow) return

  const userData = getUserData(userRow)
  if (userData[MEXAS_BALANCE_LOCK_OWNER_KEY] !== lockOwner) return

  await db
    .from('users')
    .update({
      data: {
        ...userData,
        [MEXAS_BALANCE_LOCK_KEY]: false,
        [MEXAS_BALANCE_LOCK_OWNER_KEY]: null,
        [MEXAS_BALANCE_LOCK_SINCE_KEY]: null,
      } as any,
    })
    .eq('id', userId)
    .filter('data', 'eq', JSON.stringify(userRow.data))
    .eq('data->>mexasBalanceLockOwner', lockOwner)
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
      .filter('data', 'eq', JSON.stringify(userRow.data))
      .select('id,balance,data')
      .maybeSingle()

    if (updateError) throw updateError
    if (updatedUserRow) return { credited: true, user: updatedUserRow }
  }

  throw new APIError(503, 'Balance changed. Please try again.')
}

export async function setMexasUserBalanceCas(
  db: SupabaseClient,
  userId: string,
  balance: number,
  options?: {
    dataPatch?: Record<string, unknown>
    totalDeposits?: number
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

    const nextBalance = Math.max(0, balance)
    const nextData: Record<string, unknown> = {
      ...getUserData(userRow),
      ...(options?.dataPatch ?? {}),
    }

    const { data: updatedUserRow, error: updateError } = await db
      .from('users')
      .update({
        balance: nextBalance,
        ...(options?.totalDeposits !== undefined
          ? { total_deposits: options.totalDeposits }
          : {}),
        data: nextData as any,
      })
      .eq('id', userId)
      .eq('balance', userRow.balance)
      .filter('data', 'eq', JSON.stringify(userRow.data))
      .select('id,balance,data')
      .maybeSingle()

    if (updateError) throw updateError
    if (updatedUserRow) return updatedUserRow
  }

  throw new APIError(503, 'Balance changed. Please try again.')
}
