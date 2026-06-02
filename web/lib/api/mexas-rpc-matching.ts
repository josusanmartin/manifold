import { APIError } from 'common/api/utils'
import { LimitBet } from 'common/bet'
import { convertBet } from 'common/supabase/bets'
import type { Row, SupabaseClient } from 'common/supabase/utils'

type MexasRpcMatchPayload = {
  taker?: unknown
  matches?: unknown
}

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

export async function matchMexasOrderbookLimitOrderRpc(
  db: SupabaseClient,
  takerBetId: string
) {
  const { data, error } = await db.rpc('mexas_match_orderbook_limit_order', {
    p_taker_bet_id: takerBetId,
    p_timestamp_ms: Date.now(),
    p_max_matches: 100,
  })

  if (error) {
    throw new APIError(
      503,
      `MEXAS matching engine unavailable: ${error.message}`
    )
  }

  return convertBet(getTakerRow(data)) as LimitBet
}
