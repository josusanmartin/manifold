-- Backend-only health check for the MEXAS matching engine.
--
-- The application calls this before debiting a taker for a crossing order. If a
-- production env enables RPC matching before the matching migration is applied,
-- this returns false instead of allowing a partially-created order.

create or replace function public.mexas_orderbook_matching_engine_ready ()
returns boolean
language sql
security invoker
set search_path = public
as $function$
  with procedures as (
    select
      to_regprocedure('public.mexas_match_orderbook_limit_order(text,bigint,integer)') as matcher,
      to_regprocedure('public.mexas_orderbook_matching_engine_ready()') as health
  )
  select
    case
      when matcher is null or health is null then false
      else
        has_function_privilege('service_role', matcher, 'execute')
        and has_function_privilege('service_role', health, 'execute')
        and not has_function_privilege('anon', matcher, 'execute')
        and not has_function_privilege('authenticated', matcher, 'execute')
        and not has_function_privilege('anon', health, 'execute')
        and not has_function_privilege('authenticated', health, 'execute')
        and to_regclass('public.contract_bets_mexas_orderbook_no_asks_idx') is not null
        and to_regclass('public.contract_bets_mexas_orderbook_yes_bids_idx') is not null
    end
  from procedures;
$function$;

revoke execute on function public.mexas_orderbook_matching_engine_ready() from public, anon, authenticated;
grant execute on function public.mexas_orderbook_matching_engine_ready() to service_role;
