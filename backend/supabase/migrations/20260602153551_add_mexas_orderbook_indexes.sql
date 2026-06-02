-- MEXAS orderbook maker lookup indexes.
--
-- The matching RPC repeatedly selects the best opposite-side maker by
-- price-time priority. Keep that lookup index-backed for large books.

create index if not exists contract_bets_mexas_orderbook_no_asks_idx
on public.contract_bets (
  contract_id,
  ((data ->> 'limitProb')::numeric) asc,
  created_time asc,
  bet_id asc
)
where
  coalesce(is_cancelled, false) = false
  and coalesce(is_filled, false) = false
  and coalesce(is_redemption, false) = false
  and data ->> 'answerId' is null
  and data ->> 'limitProb' is not null
  and data ->> 'orderAmount' is not null
  and data ->> 'outcome' = 'NO';

create index if not exists contract_bets_mexas_orderbook_yes_bids_idx
on public.contract_bets (
  contract_id,
  ((data ->> 'limitProb')::numeric) desc,
  created_time asc,
  bet_id asc
)
where
  coalesce(is_cancelled, false) = false
  and coalesce(is_filled, false) = false
  and coalesce(is_redemption, false) = false
  and data ->> 'answerId' is null
  and data ->> 'limitProb' is not null
  and data ->> 'orderAmount' is not null
  and data ->> 'outcome' = 'YES';
