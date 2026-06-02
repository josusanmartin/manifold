import { APIError } from 'common/api/utils'
import { LimitBet } from 'common/bet'
import { convertBet } from 'common/supabase/bets'
import type { Row, SupabaseClient } from 'common/supabase/utils'

type MexasRpcMatchPayload = {
  taker?: unknown
  matches?: unknown
}

const MAX_MATCHES_PER_RPC = 1000
const MAX_RPC_MATCH_PASSES = 20

function getTakerRow(payload: unknown) {
  const result =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as MexasRpcMatchPayload)
      : undefined
  const taker = result?.taker

  if (!taker || typeof taker !== 'object' || Array.isArray(taker)) {
    throw new APIError(503, 'MEXAS matching RPC returned no taker order.')
  }

  return taker as Row<'contract_bets'>
}

function getMatchCount(payload: unknown) {
  const result =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as MexasRpcMatchPayload)
      : undefined

  return Array.isArray(result?.matches) ? result.matches.length : 0
}

export async function matchMexasOrderbookLimitOrderRpc(
  db: SupabaseClient,
  takerBetId: string
) {
  let latestTaker: LimitBet | undefined

  for (let pass = 0; pass < MAX_RPC_MATCH_PASSES; pass++) {
    const { data, error } = await db.rpc('mexas_match_orderbook_limit_order', {
      p_taker_bet_id: takerBetId,
      p_timestamp_ms: Date.now(),
      p_max_matches: MAX_MATCHES_PER_RPC,
    })

    if (error) {
      throw new APIError(
        503,
        `MEXAS matching engine unavailable: ${error.message}`
      )
    }

    latestTaker = convertBet(getTakerRow(data)) as LimitBet
    const matchCount = getMatchCount(data)
    if (latestTaker.isFilled || matchCount < MAX_MATCHES_PER_RPC) {
      return latestTaker
    }
  }

  throw new APIError(
    503,
    'MEXAS matching engine reached the maximum matching passes for one order.'
  )
}

export async function assertMexasOrderbookMatchingEngineReady(
  db: SupabaseClient
) {
  const { data, error } = await db.rpc('mexas_orderbook_matching_engine_ready')

  if (error || data !== true) {
    throw new APIError(
      503,
      'MEXAS matching engine is configured but the Supabase RPC is not ready.'
    )
  }
}
