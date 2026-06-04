-- MEXAS orderbook matching RPC.
--
-- This function is intentionally callable only from the backend service role.
-- Supabase exposes public-schema functions through the Data API unless execute
-- privileges are revoked, so keep anon/authenticated clients out of the
-- matching engine.
create
or replace function public.mexas_match_orderbook_limit_order (
  p_taker_bet_id text,
  p_timestamp_ms bigint,
  p_max_matches integer default 100
) returns jsonb language plpgsql security invoker
set
  search_path = public as $function$
declare
  v_contract public.contracts%rowtype;
  v_taker public.contract_bets%rowtype;
  v_maker public.contract_bets%rowtype;
  v_taker_data jsonb;
  v_maker_data jsonb;
  v_taker_fills jsonb;
  v_taker_outcome text;
  v_taker_limit_prob numeric;
  v_taker_order_amount numeric;
  v_taker_reserved_amount numeric;
  v_taker_amount numeric;
  v_taker_shares numeric;
  v_taker_escrowed boolean;
  v_taker_unused_refund numeric := 0;
  v_taker_refund_credit_key text;
  v_taker_user_data jsonb;
  v_taker_user_credit_keys jsonb;
  v_taker_open_reserved_amount numeric;
  v_maker_limit_prob numeric;
  v_maker_order_amount numeric;
  v_maker_reserved_amount numeric;
  v_maker_amount numeric;
  v_maker_shares numeric;
  v_maker_escrowed boolean;
  v_maker_unused_refund numeric := 0;
  v_maker_refund_credit_key text;
  v_maker_user_data jsonb;
  v_maker_user_credit_keys jsonb;
  v_maker_open_reserved_amount numeric;
  v_remaining_amount numeric;
  v_maker_remaining_amount numeric;
  v_price numeric;
  v_taker_price numeric;
  v_maker_price numeric;
  v_shares numeric;
  v_taker_fill_amount numeric;
  v_maker_fill_amount numeric;
  v_matches jsonb := '[]'::jsonb;
  v_now_ts timestamptz := to_timestamp(p_timestamp_ms / 1000.0);
  v_match_count integer := 0;
  v_epsilon numeric := 0.000000001;
begin
  if p_taker_bet_id is null or length(p_taker_bet_id) = 0 then
    raise exception 'Missing taker bet id' using errcode = '22023';
  end if;

  if p_timestamp_ms is null or p_timestamp_ms <= 0 then
    raise exception 'Missing matching timestamp' using errcode = '22023';
  end if;

  if p_max_matches is null or p_max_matches < 1 or p_max_matches > 1000 then
    raise exception 'Invalid max match count' using errcode = '22023';
  end if;

  select *
  into v_taker
  from public.contract_bets
  where bet_id = p_taker_bet_id
  for update;

  if not found then
    raise exception 'Taker bet not found' using errcode = 'P0002';
  end if;

  select *
  into v_contract
  from public.contracts
  where id = v_taker.contract_id
  for update;

  if not found then
    raise exception 'Contract not found' using errcode = 'P0002';
  end if;

  if not (
    v_contract.token = 'MEX'
    and v_contract.data ->> 'token' = 'MEX'
    and v_contract.data ->> 'mechanism' = 'cpmm-1'
    and v_contract.data ->> 'outcomeType' = 'BINARY'
  ) then
    raise exception 'MEXAS matching only supports MEX binary orderbook markets' using errcode = '22023';
  end if;

  if v_contract.resolution_time is not null or coalesce((v_contract.data ->> 'isResolved')::boolean, false) then
    raise exception 'Market is resolved' using errcode = '25006';
  end if;

  if v_contract.close_time is not null and v_contract.close_time <= v_now_ts then
    raise exception 'Trading is closed' using errcode = '25006';
  end if;

  v_taker_data := coalesce(v_taker.data, '{}'::jsonb);
  v_taker_outcome := v_taker_data ->> 'outcome';

  if v_taker_outcome not in ('YES', 'NO') then
    raise exception 'Invalid taker outcome' using errcode = '22023';
  end if;

  if coalesce(v_taker.is_cancelled, false) or coalesce((v_taker_data ->> 'isCancelled')::boolean, false) then
    raise exception 'Taker order is cancelled' using errcode = '25006';
  end if;

  if v_taker.expires_at is not null and v_taker.expires_at <= v_now_ts then
    raise exception 'Taker order is expired' using errcode = '25006';
  end if;

  if coalesce(v_taker.is_filled, false) or coalesce((v_taker_data ->> 'isFilled')::boolean, false) then
    return jsonb_build_object(
      'taker',
      to_jsonb(v_taker),
      'matches',
      v_matches
    );
  end if;

  if v_taker_data ->> 'answerId' is not null then
    raise exception 'Only binary MEXAS limit orders can be matched' using errcode = '22023';
  end if;

  if not coalesce((v_taker_data ->> 'mexasFundsReserved')::boolean, false) then
    raise exception 'Taker MEXAS funds are not reserved' using errcode = '22023';
  end if;

  if coalesce((v_taker_data ->> 'mexasFundsReleased')::boolean, false) then
    raise exception 'Taker MEXAS funds are already released' using errcode = '25006';
  end if;

  v_taker_escrowed := coalesce((v_taker_data ->> 'mexasStakeEscrowed')::boolean, false);
  v_taker_limit_prob := (v_taker_data ->> 'limitProb')::numeric;
  v_taker_order_amount := (v_taker_data ->> 'orderAmount')::numeric;
  v_taker_reserved_amount := coalesce((v_taker_data ->> 'mexasReservedAmount')::numeric, v_taker_order_amount);
  v_taker_amount := coalesce(v_taker.amount, 0);
  v_taker_shares := coalesce(v_taker.shares, 0);
  v_taker_fills := coalesce(v_taker_data -> 'fills', '[]'::jsonb);
  v_remaining_amount := greatest(0, v_taker_order_amount - v_taker_amount);

  if v_taker_limit_prob is null or v_taker_limit_prob <= 0 or v_taker_limit_prob >= 1 then
    raise exception 'Invalid taker limit probability' using errcode = '22023';
  end if;

  if v_taker_order_amount is null or v_taker_order_amount <= 0 then
    raise exception 'Invalid taker order amount' using errcode = '22023';
  end if;

  if v_taker_escrowed and abs(v_taker_reserved_amount - v_taker_order_amount) > v_epsilon then
    raise exception 'Escrowed taker reserved amount must equal order amount' using errcode = '22023';
  end if;

  if v_taker_escrowed and (
    v_taker_data ->> 'mexasEscrowTxHash' is null
    or v_taker_data ->> 'mexasEscrowPayerAddress' is null
    or v_taker_data ->> 'mexasEscrowTreasuryAddress' is null
  ) then
    raise exception 'Escrowed taker is missing capture metadata' using errcode = '22023';
  end if;

  while v_remaining_amount > v_epsilon and v_match_count < p_max_matches loop
    select *
    into v_maker
    from public.contract_bets b
    where
      b.contract_id = v_taker.contract_id
      and b.bet_id <> v_taker.bet_id
      and b.user_id <> v_taker.user_id
      and coalesce(b.is_cancelled, false) = false
      and coalesce((b.data ->> 'isCancelled')::boolean, false) = false
      and coalesce(b.is_filled, false) = false
      and coalesce((b.data ->> 'isFilled')::boolean, false) = false
      and coalesce(b.is_redemption, false) = false
      and coalesce((b.data ->> 'isRedemption')::boolean, false) = false
      and (b.expires_at is null or b.expires_at > v_now_ts)
      and b.data ->> 'answerId' is null
      and b.data ->> 'limitProb' is not null
      and b.data ->> 'orderAmount' is not null
      and coalesce((b.data ->> 'mexasFundsReserved')::boolean, false) = true
      and coalesce((b.data ->> 'mexasFundsReleased')::boolean, false) = false
      and coalesce((b.data ->> 'mexasStakeEscrowed')::boolean, false) = v_taker_escrowed
      and b.data ->> 'outcome' in ('YES', 'NO')
      and b.data ->> 'outcome' <> v_taker_outcome
      and (b.data ->> 'limitProb')::numeric > 0
      and (b.data ->> 'limitProb')::numeric < 1
      and (b.data ->> 'orderAmount')::numeric > 0
      and (
        (v_taker_outcome = 'YES' and (b.data ->> 'limitProb')::numeric <= v_taker_limit_prob)
        or (v_taker_outcome = 'NO' and (b.data ->> 'limitProb')::numeric >= v_taker_limit_prob)
      )
      and greatest(0, (b.data ->> 'orderAmount')::numeric - coalesce(b.amount, 0)) > v_epsilon
    order by
      case when v_taker_outcome = 'YES' then (b.data ->> 'limitProb')::numeric end asc,
      case when v_taker_outcome = 'NO' then (b.data ->> 'limitProb')::numeric end desc,
      b.created_time asc,
      b.bet_id asc
    limit 1
    for update;

    exit when not found;

    v_maker_data := coalesce(v_maker.data, '{}'::jsonb);
    v_maker_limit_prob := (v_maker_data ->> 'limitProb')::numeric;
    v_maker_order_amount := (v_maker_data ->> 'orderAmount')::numeric;
    v_maker_reserved_amount := coalesce((v_maker_data ->> 'mexasReservedAmount')::numeric, v_maker_order_amount);
    v_maker_amount := coalesce(v_maker.amount, 0);
    v_maker_shares := coalesce(v_maker.shares, 0);
    v_maker_escrowed := coalesce((v_maker_data ->> 'mexasStakeEscrowed')::boolean, false);
    v_maker_remaining_amount := greatest(0, v_maker_order_amount - v_maker_amount);
    v_price := v_maker_limit_prob;
    v_taker_price := case when v_taker_outcome = 'YES' then v_price else 1 - v_price end;
    v_maker_price := case when v_taker_outcome = 'YES' then 1 - v_price else v_price end;

    exit when v_taker_price <= v_epsilon or v_maker_price <= v_epsilon;

    v_shares := round(least(v_remaining_amount / v_taker_price, v_maker_remaining_amount / v_maker_price), 8);
    exit when v_shares <= v_epsilon;

    v_taker_fill_amount := round(v_shares * v_taker_price, 8);
    v_maker_fill_amount := round(v_shares * v_maker_price, 8);

    if v_maker_escrowed and abs(v_maker_reserved_amount - v_maker_order_amount) > v_epsilon then
      raise exception 'Escrowed maker reserved amount must equal order amount' using errcode = '22023';
    end if;

    if v_maker_escrowed and (
      v_maker_data ->> 'mexasEscrowTxHash' is null
      or v_maker_data ->> 'mexasEscrowPayerAddress' is null
      or v_maker_data ->> 'mexasEscrowTreasuryAddress' is null
    ) then
      raise exception 'Escrowed maker is missing capture metadata' using errcode = '22023';
    end if;

    v_taker_amount := round(v_taker_amount + v_taker_fill_amount, 8);
    v_taker_shares := round(v_taker_shares + v_shares, 8);
    v_maker_amount := round(v_maker_amount + v_maker_fill_amount, 8);
    v_maker_shares := round(v_maker_shares + v_shares, 8);
    v_remaining_amount := greatest(0, round(v_taker_order_amount - v_taker_amount, 8));
    v_maker_remaining_amount := greatest(0, round(v_maker_order_amount - v_maker_amount, 8));
    v_maker_unused_refund := case
      when
        v_maker_remaining_amount <= v_epsilon
        and coalesce((v_maker_data ->> 'mexasFundsReserved')::boolean, false)
        and not coalesce((v_maker_data ->> 'mexasFundsReleased')::boolean, false)
      then greatest(0, round(v_maker_reserved_amount - v_maker_amount, 8))
      else 0
    end;

    v_taker_fills := v_taker_fills || jsonb_build_array(
      jsonb_build_object(
        'matchedBetId',
        v_maker.bet_id,
        'amount',
        v_taker_fill_amount,
        'shares',
        v_shares,
        'timestamp',
        p_timestamp_ms
      )
    );

    if v_maker_unused_refund > v_epsilon and not v_maker_escrowed then
      v_maker_refund_credit_key := 'mexas-order-price-improvement:' || v_maker.bet_id;

      select
        coalesce(data, '{}'::jsonb),
        case
          when jsonb_typeof(coalesce(data, '{}'::jsonb) -> 'mexasBalanceCreditKeys') = 'array'
            then coalesce(data, '{}'::jsonb) -> 'mexasBalanceCreditKeys'
          else '[]'::jsonb
        end
      into v_maker_user_data, v_maker_user_credit_keys
      from public.users
      where id = v_maker.user_id
      for update;

      if not found then
        raise exception 'Maker user not found' using errcode = 'P0002';
      end if;

      if not (v_maker_user_credit_keys ? v_maker_refund_credit_key) then
        update public.users
        set
          balance = round(balance + v_maker_unused_refund, 8),
          data = jsonb_set(
            v_maker_user_data,
            '{mexasBalanceCreditKeys}',
            v_maker_user_credit_keys || to_jsonb(v_maker_refund_credit_key),
            true
          )
        where id = v_maker.user_id;
      end if;
    end if;

    v_maker_data := v_maker_data || jsonb_build_object(
      'amount',
      v_maker_amount,
      'shares',
      v_maker_shares,
      'fills',
      coalesce(v_maker_data -> 'fills', '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'matchedBetId',
          v_taker.bet_id,
          'amount',
          v_maker_fill_amount,
          'shares',
          v_shares,
          'timestamp',
          p_timestamp_ms
        )
      ),
      'isFilled',
      v_maker_remaining_amount <= v_epsilon,
      'mexasFundsReleased',
      case
        when v_maker_remaining_amount <= v_epsilon and not v_maker_escrowed then true
        else coalesce((v_maker_data ->> 'mexasFundsReleased')::boolean, false)
      end
    );

    if v_maker_unused_refund > v_epsilon and not v_maker_escrowed then
      v_maker_data := v_maker_data || jsonb_build_object(
        'mexasReleaseCreditKey',
        v_maker_refund_credit_key,
        'mexasReleaseReason',
        'price-improvement',
        'mexasUnusedReservationRefund',
        v_maker_unused_refund
      );
    end if;

    update public.contract_bets
    set
      amount = v_maker_amount,
      shares = v_maker_shares,
      is_filled = v_maker_remaining_amount <= v_epsilon,
      data = v_maker_data
    where bet_id = v_maker.bet_id
    returning *
    into v_maker;

    select coalesce(
      round(
        sum(
          greatest(
            0,
            coalesce(
              (b.data ->> 'mexasReservedAmount')::numeric,
              (b.data ->> 'orderAmount')::numeric,
              0
            ) - coalesce(b.amount, 0)
          )
        ),
        8
      ),
      0
    )
    into v_maker_open_reserved_amount
    from public.contract_bets b
    where
      b.user_id = v_maker.user_id
      and coalesce(b.is_cancelled, false) = false
      and coalesce((b.data ->> 'isCancelled')::boolean, false) = false
      and coalesce(b.is_filled, false) = false
      and coalesce((b.data ->> 'isFilled')::boolean, false) = false
      and (b.expires_at is null or b.expires_at > v_now_ts)
      and b.data ->> 'orderAmount' is not null
      and coalesce((b.data ->> 'mexasFundsReserved')::boolean, false) = true
      and coalesce((b.data ->> 'mexasFundsReleased')::boolean, false) = false
      and coalesce((b.data ->> 'mexasStakeEscrowed')::boolean, false) = false;

    update public.users
    set data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{mexasWalletOpenReservedAmount}',
      to_jsonb(v_maker_open_reserved_amount),
      true
    )
    where id = v_maker.user_id;

    v_matches := v_matches || jsonb_build_array(
      jsonb_build_object(
        'makerBetId',
        v_maker.bet_id,
        'makerUserId',
        v_maker.user_id,
        'price',
        v_price,
        'shares',
        v_shares,
        'takerAmount',
        v_taker_fill_amount,
        'makerAmount',
        v_maker_fill_amount
      )
    );

    v_match_count := v_match_count + 1;
  end loop;

  v_taker_unused_refund := case
    when
      v_remaining_amount <= v_epsilon
      and coalesce((v_taker_data ->> 'mexasFundsReserved')::boolean, false)
      and not coalesce((v_taker_data ->> 'mexasFundsReleased')::boolean, false)
    then greatest(0, round(v_taker_reserved_amount - v_taker_amount, 8))
    else 0
  end;

  if v_taker_unused_refund > v_epsilon and not v_taker_escrowed then
    v_taker_refund_credit_key := 'mexas-order-price-improvement:' || v_taker.bet_id;

    select
      coalesce(data, '{}'::jsonb),
      case
        when jsonb_typeof(coalesce(data, '{}'::jsonb) -> 'mexasBalanceCreditKeys') = 'array'
          then coalesce(data, '{}'::jsonb) -> 'mexasBalanceCreditKeys'
        else '[]'::jsonb
      end
    into v_taker_user_data, v_taker_user_credit_keys
    from public.users
    where id = v_taker.user_id
    for update;

    if not found then
      raise exception 'Taker user not found' using errcode = 'P0002';
    end if;

    if not (v_taker_user_credit_keys ? v_taker_refund_credit_key) then
      update public.users
      set
        balance = round(balance + v_taker_unused_refund, 8),
        data = jsonb_set(
          v_taker_user_data,
          '{mexasBalanceCreditKeys}',
          v_taker_user_credit_keys || to_jsonb(v_taker_refund_credit_key),
          true
        )
      where id = v_taker.user_id;
    end if;
  end if;

  v_taker_data := v_taker_data || jsonb_build_object(
    'amount',
    v_taker_amount,
    'shares',
    v_taker_shares,
    'fills',
    v_taker_fills,
    'isFilled',
    v_remaining_amount <= v_epsilon,
    'mexasFundsReleased',
    case
      when v_remaining_amount <= v_epsilon and not v_taker_escrowed then true
      else coalesce((v_taker_data ->> 'mexasFundsReleased')::boolean, false)
    end
  );

  if v_taker_unused_refund > v_epsilon and not v_taker_escrowed then
    v_taker_data := v_taker_data || jsonb_build_object(
      'mexasReleaseCreditKey',
      v_taker_refund_credit_key,
      'mexasReleaseReason',
      'price-improvement',
      'mexasUnusedReservationRefund',
      v_taker_unused_refund
    );
  end if;

  update public.contract_bets
  set
    amount = v_taker_amount,
    shares = v_taker_shares,
    is_filled = v_remaining_amount <= v_epsilon,
    data = v_taker_data
  where bet_id = v_taker.bet_id
  returning *
  into v_taker;

  select coalesce(
    round(
      sum(
        greatest(
          0,
          coalesce(
            (b.data ->> 'mexasReservedAmount')::numeric,
            (b.data ->> 'orderAmount')::numeric,
            0
          ) - coalesce(b.amount, 0)
        )
      ),
      8
    ),
    0
  )
  into v_taker_open_reserved_amount
  from public.contract_bets b
  where
    b.user_id = v_taker.user_id
    and coalesce(b.is_cancelled, false) = false
    and coalesce((b.data ->> 'isCancelled')::boolean, false) = false
    and coalesce(b.is_filled, false) = false
    and coalesce((b.data ->> 'isFilled')::boolean, false) = false
    and (b.expires_at is null or b.expires_at > v_now_ts)
    and b.data ->> 'orderAmount' is not null
    and coalesce((b.data ->> 'mexasFundsReserved')::boolean, false) = true
    and coalesce((b.data ->> 'mexasFundsReleased')::boolean, false) = false
    and coalesce((b.data ->> 'mexasStakeEscrowed')::boolean, false) = false;

  update public.users
  set data = jsonb_set(
    coalesce(data, '{}'::jsonb),
    '{mexasWalletOpenReservedAmount}',
    to_jsonb(v_taker_open_reserved_amount),
    true
  )
  where id = v_taker.user_id;

  return jsonb_build_object(
    'taker',
    to_jsonb(v_taker),
    'matches',
    v_matches
  );
end
$function$;

revoke
execute on function public.mexas_match_orderbook_limit_order (text, bigint, integer)
from
  public,
  anon,
  authenticated;

grant
execute on function public.mexas_match_orderbook_limit_order (text, bigint, integer) to service_role;
