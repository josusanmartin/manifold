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
  select to_regprocedure('public.mexas_match_orderbook_limit_order(text,bigint,integer)') is not null;
$function$;

revoke execute on function public.mexas_orderbook_matching_engine_ready() from public, anon, authenticated;
grant execute on function public.mexas_orderbook_matching_engine_ready() to service_role;
