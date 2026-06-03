-- Allow the backend to claim an idempotent treasury transfer before it signs
-- and broadcasts an ERC-20 transaction. Without a processing state, two
-- concurrent callers could both observe a pending row and send duplicate
-- transfers before either writes a tx hash.
alter table public.mexas_treasury_transfers
drop constraint if exists mexas_treasury_transfers_status_check;

alter table public.mexas_treasury_transfers
add constraint mexas_treasury_transfers_status_check check (
  status in (
    'pending',
    'processing',
    'submitted',
    'confirmed',
    'failed',
    'cancelled'
  )
);

create
or replace function public.mexas_treasury_settlement_ledger_ready () returns boolean language sql security invoker
set
  search_path = public as $function$
  with objects as (
    select
      to_regclass('public.mexas_treasury_transfers') as ledger,
      to_regprocedure('public.mexas_treasury_settlement_ledger_ready()') as health
  )
  select
    case
      when ledger is null or health is null then false
      else
        has_table_privilege('service_role', ledger, 'SELECT')
        and has_table_privilege('service_role', ledger, 'INSERT')
        and has_table_privilege('service_role', ledger, 'UPDATE')
        and not has_table_privilege('anon', ledger, 'SELECT')
        and not has_table_privilege('authenticated', ledger, 'SELECT')
        and not has_table_privilege('anon', ledger, 'INSERT')
        and not has_table_privilege('authenticated', ledger, 'INSERT')
        and not has_table_privilege('anon', ledger, 'UPDATE')
        and not has_table_privilege('authenticated', ledger, 'UPDATE')
        and has_function_privilege('service_role', health, 'EXECUTE')
        and not has_function_privilege('anon', health, 'EXECUTE')
        and not has_function_privilege('authenticated', health, 'EXECUTE')
        and exists (
          select 1
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = 'mexas_treasury_transfers'
            and c.relrowsecurity = true
        )
        and exists (
          select 1
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = 'mexas_treasury_transfers'
            and con.conname = 'mexas_treasury_transfers_status_check'
            and position('processing' in pg_get_constraintdef(con.oid)) > 0
        )
        and to_regclass('public.mexas_treasury_transfers_idempotency_key_idx') is not null
        and to_regclass('public.mexas_treasury_transfers_tx_hash_idx') is not null
        and to_regclass('public.mexas_treasury_transfers_status_created_idx') is not null
    end
  from objects;
$function$;

revoke
execute on function public.mexas_treasury_settlement_ledger_ready ()
from
  public,
  anon,
  authenticated;

grant
execute on function public.mexas_treasury_settlement_ledger_ready () to service_role;
