import { PrivyClient, type User as PrivyUser } from '@privy-io/node'
import { APIError } from 'common/api/utils'
import { RESERVED_PATHS } from 'common/envs/constants'
import { getStablePrivyEmbeddedEthereumWallet } from 'common/privy-wallet'
import { type UserAndPrivateUser, type PrivateUser } from 'common/user'
import { getDefaultNotificationPreferences } from 'common/user-notification-preferences'
import { cleanDisplayName, cleanUsername } from 'common/util/clean-username'
import { randomString } from 'common/util/random'
import { getMexasSyncedAvailableBalance } from 'common/mexas-market'
import { convertPrivateUser, convertUser } from 'common/supabase/users'
import {
  createClient,
  type SupabaseClient,
  type Row,
} from 'common/supabase/utils'
import { isAddress, type Address } from 'viem'
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getOpenReservedMexasAmount,
  releaseClosedMexasMarketOrders,
  releaseExpiredMexasOrders,
  releaseUnbackedMexasOrders,
} from 'web/lib/api/mexas-orders'
import {
  acquireMexasUserBalanceLock,
  releaseMexasUserBalanceLock,
} from 'web/lib/api/mexas-balance'
import { formatMexasUnits, getMexasBalanceUnits } from 'web/lib/crypto/mexas'
import { z } from 'zod'

type ErrorResponse = { message: string }
type JsonObject = Record<string, unknown>

const MEXAS_WALLET_SYNC_UNITS_KEY = 'mexasWalletBalanceUnitsSynced'
const MEXAS_WALLET_SYNC_TIME_KEY = 'mexasWalletBalanceSyncedTime'
const MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY = 'mexasWalletOpenReservedAmount'
const USER_UPDATE_ATTEMPTS = 5

const bodySchema = z
  .object({
    deviceToken: z.string().optional(),
    visitedContractIds: z.array(z.string()).optional(),
    walletAddress: z.string().optional().nullable(),
  })
  .strict()

let privyClient: PrivyClient | undefined

function getPrivyClient() {
  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) {
    throw new Error('Privy server credentials are not configured.')
  }

  privyClient ??= new PrivyClient({ appId, appSecret })
  return privyClient
}

function getSupabaseAdminClient() {
  const key =
    process.env.PROD_ADMIN_SUPABASE_KEY ||
    process.env.DEV_ADMIN_SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  const urlOrInstanceId =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_INSTANCE_ID ||
    process.env.NEXT_PUBLIC_SUPABASE_INSTANCE_ID

  if (!key || !urlOrInstanceId) {
    throw new Error('Supabase admin credentials are not configured.')
  }

  return createClient(urlOrInstanceId, key)
}

function isSupabaseUniqueViolation(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

function getBearerToken(req: NextApiRequest) {
  const header = req.headers.authorization
  if (!header) return undefined

  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return undefined
  return token
}

function getIp(req: NextApiRequest) {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string') return forwardedFor.split(',')[0].trim()
  return req.socket.remoteAddress
}

function getLinkedEmail(privyUser: PrivyUser) {
  for (const account of privyUser.linked_accounts) {
    if (account.type === 'email') return account.address
    if ('email' in account && typeof account.email === 'string') {
      return account.email
    }
  }
  return undefined
}

function getLinkedWallet(
  privyUser: PrivyUser,
  walletAddress?: string | null,
  existingWalletAddress?: string | null
) {
  if (walletAddress && !isAddress(walletAddress)) {
    throw new APIError(400, 'Invalid wallet address.')
  }

  const linkedWallet = getStablePrivyEmbeddedEthereumWallet(
    privyUser.linked_accounts,
    walletAddress,
    existingWalletAddress
  )
  if (walletAddress && !linkedWallet) {
    throw new APIError(
      403,
      'Wallet address is not linked to this Privy account.'
    )
  }

  return linkedWallet
}

function getStoredPrivyWalletAddress(
  userRow: Row<'users'> | null,
  privateUserRow: Row<'private_users'> | null
) {
  const userWalletAddress = getUserData(userRow).privyWalletAddress
  if (typeof userWalletAddress === 'string') return userWalletAddress

  const privateUserData = privateUserRow?.data
  const privateWalletAddress =
    privateUserData &&
    typeof privateUserData === 'object' &&
    !Array.isArray(privateUserData) &&
    'privyWalletAddress' in privateUserData
      ? privateUserData.privyWalletAddress
      : undefined
  return typeof privateWalletAddress === 'string'
    ? privateWalletAddress
    : undefined
}

function getFallbackName(
  email: string | undefined,
  walletAddress: string | undefined
) {
  if (email) return email.replace(/@.*$/, '')
  if (walletAddress) {
    return `MEX ${walletAddress.slice(2, 8)}`
  }
  return `MEX ${randomString(4)}`
}

function getUserData(row: Row<'users'> | null): JsonObject {
  const data = row?.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as JsonObject)
    : {}
}

function parseSyncedMexasUnits(data: JsonObject) {
  const raw = data[MEXAS_WALLET_SYNC_UNITS_KEY]
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw)
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
    return BigInt(raw)
  }
  return 0n
}

function mexasUnitsToAmount(units: bigint) {
  return Number(formatMexasUnits(units))
}

function mexasUnitsDeltaToAmount(deltaUnits: bigint) {
  if (deltaUnits === 0n) return 0
  const sign = deltaUnits < 0n ? -1 : 1
  const absUnits = deltaUnits < 0n ? -deltaUnits : deltaUnits
  return sign * mexasUnitsToAmount(absUnits)
}

async function readMexasWalletBalance(
  walletAddress: string,
  context: 'new-user' | 'existing-user'
) {
  try {
    const units = await getMexasBalanceUnits(walletAddress as Address)
    return {
      units,
      amount: mexasUnitsToAmount(units),
    }
  } catch (error) {
    console.error('Failed to load MEXAS wallet balance', {
      context,
      walletAddress,
      error,
    })
    throw new APIError(
      503,
      'No se pudo leer el balance MEXAS de tu Wallet. Intenta de nuevo.'
    )
  }
}

async function getMexasWalletSync(
  db: SupabaseClient,
  row: Row<'users'>,
  walletAddress?: string
) {
  if (!walletAddress || !isAddress(walletAddress)) return undefined

  const data = getUserData(row)
  const walletBalance = await readMexasWalletBalance(
    walletAddress,
    'existing-user'
  )
  const previousUnits = parseSyncedMexasUnits(data)
  const deltaAmount = mexasUnitsDeltaToAmount(
    walletBalance.units - previousUnits
  )
  await releaseClosedMexasMarketOrders(db, {
    userId: row.id,
    skipUserBalanceLock: true,
  })
  await releaseExpiredMexasOrders(db, {
    userId: row.id,
    skipUserBalanceLock: true,
  })
  await releaseUnbackedMexasOrders(db, {
    userId: row.id,
    requireBalanceRead: true,
    skipUserBalanceLock: true,
  })
  const openReservedAmount = await getOpenReservedMexasAmount(db, {
    userId: row.id,
  })
  const balance = getMexasSyncedAvailableBalance({
    currentBalance: row.balance,
    onChainAmount: walletBalance.amount,
    onChainDeltaAmount: deltaAmount,
    openReservedAmount,
  })
  const totalDeposits =
    deltaAmount > 0 ? row.total_deposits + deltaAmount : row.total_deposits

  return {
    data: {
      ...data,
      [MEXAS_WALLET_SYNC_UNITS_KEY]: walletBalance.units.toString(),
      [MEXAS_WALLET_SYNC_TIME_KEY]: Date.now(),
      [MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]: openReservedAmount,
    },
    balance,
    totalDeposits,
  }
}

async function getNewUserMexasWalletBalance(walletAddress?: string) {
  if (!walletAddress || !isAddress(walletAddress)) return undefined

  return readMexasWalletBalance(walletAddress, 'new-user')
}

async function getAvailableUsername(db: SupabaseClient, name: string) {
  const fallback = `mex${randomString(8)}`
  const base = cleanUsername(name) || fallback

  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 20)}${randomString(4)}`
    if (RESERVED_PATHS.includes(candidate)) continue

    const { count, error } = await db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .ilike('username', candidate)

    if (error) throw error
    if (!count) return candidate
  }

  return fallback
}

function buildPrivateUser(params: {
  id: string
  email?: string
  ip?: string
  deviceToken?: string
  walletAddress?: string
}) {
  return {
    id: params.id,
    email: params.email,
    initialIpAddress: params.ip,
    initialDeviceToken: params.deviceToken,
    notificationPreferences: getDefaultNotificationPreferences(),
    blockedUserIds: [],
    blockedByUserIds: [],
    blockedContractIds: [],
    blockedGroupSlugs: [],
    privyUserId: params.id,
    privyWalletAddress: params.walletAddress,
  } as PrivateUser & {
    privyUserId: string
    privyWalletAddress?: string
  }
}

async function upsertPrivyPrivateUser(params: {
  db: SupabaseClient
  privateUser: Row<'private_users'>['data']
  userId: string
}) {
  const { data: updatedPrivateUser, error } = await params.db
    .from('private_users')
    .upsert(
      { id: params.userId, data: params.privateUser },
      { onConflict: 'id' }
    )
    .select()
    .single()

  if (error) throw error
  if (!updatedPrivateUser) {
    throw new Error('Could not update Privy user.')
  }

  return updatedPrivateUser as Row<'private_users'>
}

async function loadPrivyUserRows(db: SupabaseClient, userId: string) {
  const [
    { data: userRow, error: userError },
    { data: privateUserRow, error: privateUserError },
  ] = await Promise.all([
    db.from('users').select().eq('id', userId).maybeSingle(),
    db.from('private_users').select().eq('id', userId).maybeSingle(),
  ])

  if (userError) throw userError
  if (privateUserError) throw privateUserError

  return {
    userRow: userRow as Row<'users'> | null,
    privateUserRow: privateUserRow as Row<'private_users'> | null,
  }
}

async function updateExistingUser(params: {
  db: SupabaseClient
  userRow: Row<'users'>
  privateUserRow: Row<'private_users'> | null
  email?: string
  walletAddress?: string
  ip?: string
  deviceToken?: string
}) {
  const { db, email, walletAddress, userRow } = params
  const existingPrivateUser =
    (params.privateUserRow?.data as Record<string, unknown> | undefined) ?? {}
  const existingEmail =
    typeof existingPrivateUser.email === 'string'
      ? existingPrivateUser.email
      : undefined
  const existingWalletAddress =
    typeof existingPrivateUser.privyWalletAddress === 'string'
      ? existingPrivateUser.privyWalletAddress
      : undefined

  const privateUser = {
    ...buildPrivateUser({
      id: userRow.id,
      email,
      ip: params.ip,
      deviceToken: params.deviceToken,
      walletAddress,
    }),
    ...existingPrivateUser,
    id: userRow.id,
    email: email ?? existingEmail,
    privyUserId: userRow.id,
    privyWalletAddress: walletAddress ?? existingWalletAddress,
  } as Row<'private_users'>['data']

  const balanceLockOwner = await acquireMexasUserBalanceLock(db, userRow.id)
  try {
    const { data: lockedUserRow, error: lockedUserError } = await db
      .from('users')
      .select()
      .eq('id', userRow.id)
      .single()

    if (lockedUserError) throw lockedUserError
    if (!lockedUserRow) throw new Error('Could not load locked Privy user.')

    let latestUserRow = lockedUserRow as Row<'users'>
    for (let attempt = 0; attempt < USER_UPDATE_ATTEMPTS; attempt++) {
      const walletSync = await getMexasWalletSync(
        db,
        latestUserRow,
        walletAddress
      )
      const userData = {
        ...getUserData(latestUserRow),
        ...(walletSync?.data ?? {}),
        privyUserId: latestUserRow.id,
        ...(walletAddress ? { privyWalletAddress: walletAddress } : {}),
      }

      const { data: updatedUser, error: userError } = await db
        .from('users')
        .update({
          data: userData,
          ...(walletSync
            ? {
                balance: walletSync.balance,
                total_deposits: walletSync.totalDeposits,
              }
            : {}),
        })
        .eq('id', latestUserRow.id)
        .eq('balance', latestUserRow.balance)
        .filter('data', 'eq', JSON.stringify(latestUserRow.data))
        .select()
        .maybeSingle()

      if (userError) throw userError
      if (updatedUser) {
        const updatedPrivateUser = await upsertPrivyPrivateUser({
          db,
          privateUser,
          userId: userRow.id,
        })
        return {
          user: convertUser(updatedUser),
          privateUser: convertPrivateUser(updatedPrivateUser),
        }
      }

      const { data: refetchedUserRow, error: refetchError } = await db
        .from('users')
        .select()
        .eq('id', latestUserRow.id)
        .single()

      if (refetchError) throw refetchError
      latestUserRow = refetchedUserRow
    }

    throw new Error('Could not update Privy user balance.')
  } finally {
    await releaseMexasUserBalanceLock(db, userRow.id, balanceLockOwner)
  }
}

async function createPrivyManifoldUser(params: {
  db: SupabaseClient
  id: string
  email?: string
  walletAddress?: string
  ip?: string
  deviceToken?: string
}) {
  const { db, id, email, walletAddress } = params
  const name =
    cleanDisplayName(getFallbackName(email, walletAddress)) || 'MEX User'
  const username = await getAvailableUsername(db, name)
  const now = Date.now()
  const walletBalance = await getNewUserMexasWalletBalance(walletAddress)
  const userData = {
    id,
    avatarUrl: '',
    streakForgiveness: 0,
    shouldShowWelcome: true,
    creatorTraders: { daily: 0, weekly: 0, monthly: 0, allTime: 0 },
    signupBonusPaid: 0,
    privyUserId: id,
    privyWalletAddress: walletAddress,
    [MEXAS_WALLET_OPEN_RESERVED_AMOUNT_KEY]: 0,
    ...(walletBalance
      ? {
          [MEXAS_WALLET_SYNC_UNITS_KEY]: walletBalance.units.toString(),
          [MEXAS_WALLET_SYNC_TIME_KEY]: now,
        }
      : {}),
  }
  const privateUser = buildPrivateUser({
    id,
    email,
    ip: params.ip,
    deviceToken: params.deviceToken,
    walletAddress,
  })

  const { data: userRow, error: userError } = await db
    .from('users')
    .insert({
      id,
      name,
      username,
      balance: walletBalance?.amount ?? 0,
      cash_balance: 0,
      spice_balance: 0,
      total_deposits: walletBalance?.amount ?? 0,
      total_cash_deposits: 0,
      created_time: new Date(now).toISOString(),
      data: userData,
    })
    .select()
    .single()

  if (userError) throw userError

  const privateUserRow = await upsertPrivyPrivateUser({
    db,
    privateUser,
    userId: id,
  })

  return {
    user: convertUser(userRow),
    privateUser: convertPrivateUser(privateUserRow),
  }
}

async function createOrUpdatePrivyManifoldUser(params: {
  db: SupabaseClient
  id: string
  email?: string
  walletAddress?: string
  ip?: string
  deviceToken?: string
}) {
  for (let attempt = 0; attempt < USER_UPDATE_ATTEMPTS; attempt++) {
    const { userRow, privateUserRow } = await loadPrivyUserRows(
      params.db,
      params.id
    )
    if (userRow) {
      return await updateExistingUser({
        db: params.db,
        userRow,
        privateUserRow,
        email: params.email,
        walletAddress: params.walletAddress,
        ip: params.ip,
        deviceToken: params.deviceToken,
      })
    }

    try {
      return await createPrivyManifoldUser(params)
    } catch (error) {
      if (!isSupabaseUniqueViolation(error)) throw error
    }
  }

  throw new Error('Could not create Privy user after retrying conflicts.')
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserAndPrivateUser | ErrorResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    const token = getBearerToken(req)
    if (!token) return res.status(401).json({ message: 'Missing Privy token.' })

    const body = bodySchema.parse(req.body)
    const client = getPrivyClient()
    const verified = await client.utils().auth().verifyAccessToken(token)
    const privyUser = await client.users()._get(verified.user_id)
    const email = getLinkedEmail(privyUser)
    const db = getSupabaseAdminClient()
    const { userRow, privateUserRow } = await loadPrivyUserRows(
      db,
      verified.user_id
    )
    const existingWalletAddress = getStoredPrivyWalletAddress(
      userRow,
      privateUserRow
    )
    const walletAddress = getLinkedWallet(
      privyUser,
      body.walletAddress,
      existingWalletAddress
    )
    const ip = getIp(req)

    const result = await createOrUpdatePrivyManifoldUser({
      db,
      id: verified.user_id,
      email,
      walletAddress,
      ip,
      deviceToken: body.deviceToken,
    })

    return res.status(200).json(result)
  } catch (e) {
    console.error('Privy signup failed', e)
    if (e instanceof APIError) {
      return res.status(e.code).json({ message: e.message })
    }
    if (e instanceof z.ZodError) {
      return res.status(400).json({
        message: 'Invalid Privy signup request.',
      })
    }
    return res.status(500).json({
      message: e instanceof Error ? e.message : 'Privy signup failed.',
    })
  }
}
