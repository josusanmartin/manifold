-- MEXAS escrow capture guard.
--
-- Incoming order-stake captures are represented on the bet row. Keep the
-- transaction hash globally unique so one payer-to-treasury transfer cannot
-- back more than one order.
create unique index if not exists contract_bets_mexas_escrow_tx_hash_idx on public.contract_bets ((lower(data ->> 'mexasEscrowTxHash')))
where
  data ->> 'mexasEscrowTxHash' ~* '^0x[0-9a-f]{64}$'
  and coalesce((data ->> 'mexasStakeEscrowed')::boolean, false) = true;

-- Backend-only health check for the capture idempotency boundary.
create
or replace function public.mexas_escrow_capture_ready () returns boolean language sql security invoker
set
  search_path = public as $function$
select
  to_regclass('public.contract_bets') is not null
  and to_regclass('public.contract_bets_mexas_escrow_tx_hash_idx') is not null
  and to_regprocedure('public.mexas_escrow_capture_ready()') is not null;
$function$;

revoke
execute on function public.mexas_escrow_capture_ready ()
from
  public,
  anon,
  authenticated;

grant
execute on function public.mexas_escrow_capture_ready () to service_role;
