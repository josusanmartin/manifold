-- Private ledger for direct MEXAS wallet movements observed during Privy wallet
-- balance sync. These are not treasury-signed transfers: deposits and user
-- withdrawals happen directly in the user's embedded wallet, then the backend
-- records the observed on-chain balance delta.
create table if not exists
  public.mexas_wallet_movements (
    id text primary key,
    idempotency_key text not null,
    movement_type text not null,
    user_id text not null references public.users (id) on delete restrict,
    wallet_address text not null,
    amount numeric(38, 8) not null,
    delta_units text not null,
    previous_wallet_units text not null,
    new_wallet_units text not null,
    previous_wallet_amount numeric(38, 8) not null,
    new_wallet_amount numeric(38, 8) not null,
    internal_balance_before numeric(38, 8) not null,
    internal_balance_after numeric(38, 8) not null,
    open_reserved_amount numeric(38, 8) not null default 0,
    token_address text not null,
    chain_id integer not null,
    metadata jsonb not null default '{}'::jsonb,
    observed_time timestamptz not null default now(),
    created_time timestamptz not null default now(),
    constraint mexas_wallet_movements_idempotency_key_not_blank check (length(trim(idempotency_key)) > 0),
    constraint mexas_wallet_movements_type_check check (
      movement_type in ('deposit', 'withdrawal')
    ),
    constraint mexas_wallet_movements_amount_positive check (amount > 0),
    constraint mexas_wallet_movements_delta_units_check check (delta_units ~ '^-?[0-9]+$'),
    constraint mexas_wallet_movements_previous_units_check check (previous_wallet_units ~ '^[0-9]+$'),
    constraint mexas_wallet_movements_new_units_check check (new_wallet_units ~ '^[0-9]+$'),
    constraint mexas_wallet_movements_direction_check check (
      (movement_type = 'deposit' and delta_units !~ '^-')
      or (movement_type = 'withdrawal' and delta_units ~ '^-')
    ),
    constraint mexas_wallet_movements_wallet_address_check check (wallet_address ~* '^0x[0-9a-f]{40}$'),
    constraint mexas_wallet_movements_chain_id_check check (chain_id = 42161),
    constraint mexas_wallet_movements_token_address_check check (token_address ~* '^0x[0-9a-f]{40}$'),
    constraint mexas_wallet_movements_balances_nonnegative check (
      previous_wallet_amount >= 0
      and new_wallet_amount >= 0
      and internal_balance_before >= 0
      and internal_balance_after >= 0
      and open_reserved_amount >= 0
    )
  );

create unique index if not exists mexas_wallet_movements_idempotency_key_idx on public.mexas_wallet_movements (idempotency_key);

create index if not exists mexas_wallet_movements_user_observed_idx on public.mexas_wallet_movements (user_id, observed_time desc, id desc);

create index if not exists mexas_wallet_movements_wallet_observed_idx on public.mexas_wallet_movements (wallet_address, observed_time desc, id desc);

alter table public.mexas_wallet_movements enable row level security;

revoke all on table public.mexas_wallet_movements
from
  public,
  anon,
  authenticated;

grant
select
,
  insert on table public.mexas_wallet_movements to service_role;

drop policy if exists mexas_wallet_movements_service_role_only on public.mexas_wallet_movements;

create policy mexas_wallet_movements_service_role_only
on public.mexas_wallet_movements
for all
to service_role
using (true)
with check (true);

create
or replace function public.mexas_wallet_movements_ledger_ready () returns boolean language sql security invoker
set
  search_path = public as $function$
  with objects as (
    select
      to_regclass('public.mexas_wallet_movements') as ledger,
      to_regprocedure('public.mexas_wallet_movements_ledger_ready()') as health
  )
  select
    case
      when ledger is null or health is null then false
      else
        has_table_privilege('service_role', ledger, 'SELECT')
        and has_table_privilege('service_role', ledger, 'INSERT')
        and not has_table_privilege('anon', ledger, 'SELECT')
        and not has_table_privilege('authenticated', ledger, 'SELECT')
        and not has_table_privilege('anon', ledger, 'INSERT')
        and not has_table_privilege('authenticated', ledger, 'INSERT')
        and has_function_privilege('service_role', health, 'EXECUTE')
        and not has_function_privilege('anon', health, 'EXECUTE')
        and not has_function_privilege('authenticated', health, 'EXECUTE')
        and exists (
          select 1
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = 'mexas_wallet_movements'
            and c.relrowsecurity = true
        )
        and exists (
          select 1
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = 'mexas_wallet_movements'
            and p.polname = 'mexas_wallet_movements_service_role_only'
        )
        and exists (
          select 1
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = 'mexas_wallet_movements'
            and con.conname = 'mexas_wallet_movements_type_check'
        )
        and to_regclass('public.mexas_wallet_movements_idempotency_key_idx') is not null
        and to_regclass('public.mexas_wallet_movements_user_observed_idx') is not null
        and to_regclass('public.mexas_wallet_movements_wallet_observed_idx') is not null
    end
  from objects;
$function$;

revoke
execute on function public.mexas_wallet_movements_ledger_ready ()
from
  public,
  anon,
  authenticated;

grant
execute on function public.mexas_wallet_movements_ledger_ready () to service_role;
