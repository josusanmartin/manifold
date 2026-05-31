import {
  PrivyClient,
  type LinkedAccount,
  type User as PrivyUser,
} from '@privy-io/node'
import { RESERVED_PATHS } from 'common/envs/constants'
import { type UserAndPrivateUser, type PrivateUser } from 'common/user'
import { getDefaultNotificationPreferences } from 'common/user-notification-preferences'
import { cleanDisplayName, cleanUsername } from 'common/util/clean-username'
import { randomString } from 'common/util/random'
import { convertPrivateUser, convertUser } from 'common/supabase/users'
import {
  createClient,
  type SupabaseClient,
  type Row,
} from 'common/supabase/utils'
import type { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'

type ErrorResponse = { message: string }

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

function getLinkedWallet(privyUser: PrivyUser, walletAddress?: string | null) {
  if (walletAddress) return walletAddress

  const wallets = privyUser.linked_accounts.filter(
    (account): account is Extract<LinkedAccount, { type: 'wallet' }> =>
      account.type === 'wallet' &&
      'chain_type' in account &&
      account.chain_type === 'ethereum'
  )
  return (
    wallets.find((wallet) => wallet.wallet_client_type === 'privy')?.address ??
    wallets[0]?.address
  )
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
  const userData = {
    ...(userRow.data as Record<string, unknown>),
    privyUserId: userRow.id,
    ...(walletAddress ? { privyWalletAddress: walletAddress } : {}),
  }
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

  const [
    { data: updatedUser, error: userError },
    { data: updatedPrivateUser, error: privateUserError },
  ] = await Promise.all([
    db
      .from('users')
      .update({ data: userData })
      .eq('id', userRow.id)
      .select()
      .single(),
    params.privateUserRow
      ? db
          .from('private_users')
          .update({ data: privateUser })
          .eq('id', userRow.id)
          .select()
          .single()
      : db
          .from('private_users')
          .insert({ id: userRow.id, data: privateUser })
          .select()
          .single(),
  ])

  if (userError) throw userError
  if (privateUserError) throw privateUserError
  if (!updatedUser || !updatedPrivateUser) {
    throw new Error('Could not update Privy user.')
  }

  return {
    user: convertUser(updatedUser),
    privateUser: convertPrivateUser(updatedPrivateUser),
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
  const userData = {
    id,
    avatarUrl: '',
    streakForgiveness: 0,
    shouldShowWelcome: true,
    creatorTraders: { daily: 0, weekly: 0, monthly: 0, allTime: 0 },
    signupBonusPaid: 0,
    privyUserId: id,
    privyWalletAddress: walletAddress,
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
      balance: 0,
      cash_balance: 0,
      spice_balance: 0,
      total_deposits: 0,
      total_cash_deposits: 0,
      created_time: new Date(now).toISOString(),
      data: userData,
    })
    .select()
    .single()

  if (userError) throw userError

  const { data: privateUserRow, error: privateUserError } = await db
    .from('private_users')
    .insert({ id, data: privateUser })
    .select()
    .single()

  if (privateUserError) throw privateUserError

  return {
    user: convertUser(userRow),
    privateUser: convertPrivateUser(privateUserRow),
  }
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
    const db = getSupabaseAdminClient()
    const email = getLinkedEmail(privyUser)
    const walletAddress = getLinkedWallet(privyUser, body.walletAddress)
    const ip = getIp(req)

    const [
      { data: userRow, error: userError },
      { data: privateUserRow, error: privateUserError },
    ] = await Promise.all([
      db.from('users').select().eq('id', verified.user_id).maybeSingle(),
      db
        .from('private_users')
        .select()
        .eq('id', verified.user_id)
        .maybeSingle(),
    ])

    if (userError) throw userError
    if (privateUserError) throw privateUserError

    const result = userRow
      ? await updateExistingUser({
          db,
          userRow,
          privateUserRow,
          email,
          walletAddress,
          ip,
          deviceToken: body.deviceToken,
        })
      : await createPrivyManifoldUser({
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
    return res.status(500).json({
      message: e instanceof Error ? e.message : 'Privy signup failed.',
    })
  }
}
