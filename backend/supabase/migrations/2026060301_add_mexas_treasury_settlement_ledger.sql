-- MEXAS treasury settlement ledger.
--
-- This table is the idempotency boundary for future treasury-signed outgoing
-- MEXAS transfers. It intentionally stores payment intent/status only; signing
-- and broadcasting transfers remains a separate backend capability.
create table if not exists
  public.mexas_treasury_transfers (
    id text primary key,
    idempotency_key text not null,
    transfer_type text not null,
    status text not null default 'pending',
    user_id text not null references public.users (id) on delete restrict,
    contract_id text null references public.contracts (id) on delete restrict,
    bet_id text null references public.contract_bets (bet_id) on delete restrict,
    outcome text null,
    amount numeric(38, 8) not null,
    token_address text not null,
    chain_id integer not null,
    treasury_address text not null,
    recipient_address text not null,
    tx_hash text null,
    error text null,
    metadata jsonb not null default '{}'::jsonb,
    created_time timestamptz not null default now(),
    updated_time timestamptz not null default now(),
    submitted_time timestamptz null,
    confirmed_time timestamptz null,
    constraint mexas_treasury_transfers_idempotency_key_not_blank check (length(trim(idempotency_key)) > 0),
    constraint mexas_treasury_transfers_transfer_type_check check (
      transfer_type in (
        'order-release',
        'resolution-payout',
        'resolution-cancel',
        'withdrawal'
      )
    ),
    constraint mexas_treasury_transfers_status_check check (
      status in (
        'pending',
        'submitted',
        'confirmed',
        'failed',
        'cancelled'
      )
    ),
    constraint mexas_treasury_transfers_outcome_check check (
      outcome is null
      or outcome in ('YES', 'NO', 'CANCEL')
    ),
    constraint mexas_treasury_transfers_amount_positive check (amount > 0),
    constraint mexas_treasury_transfers_chain_id_check check (chain_id = 42161),
    constraint mexas_treasury_transfers_token_address_check check (token_address ~* '^0x[0-9a-f]{40}$'),
    constraint mexas_treasury_transfers_treasury_address_check check (treasury_address ~* '^0x[0-9a-f]{40}$'),
    constraint mexas_treasury_transfers_recipient_address_check check (recipient_address ~* '^0x[0-9a-f]{40}$'),
    constraint mexas_treasury_transfers_tx_hash_check check (
      tx_hash is null
      or tx_hash ~* '^0x[0-9a-f]{64}$'
    ),
    constraint mexas_treasury_transfers_submitted_requires_hash check (
      status not in ('submitted', 'confirmed')
      or tx_hash is not null
    ),
    constraint mexas_treasury_transfers_confirmed_requires_time check (
      status <> 'confirmed'
      or confirmed_time is not null
    ),
    constraint mexas_treasury_transfers_failed_requires_error check (
      status <> 'failed'
      or error is not null
    )
  );

create unique index if not exists mexas_treasury_transfers_idempotency_key_idx on public.mexas_treasury_transfers (idempotency_key);

create unique index if not exists mexas_treasury_transfers_tx_hash_idx on public.mexas_treasury_transfers (tx_hash)
where
  tx_hash is not null;

create index if not exists mexas_treasury_transfers_status_created_idx on public.mexas_treasury_transfers (status, created_time asc, id asc);

create index if not exists mexas_treasury_transfers_user_created_idx on public.mexas_treasury_transfers (user_id, created_time desc, id desc);

create index if not exists mexas_treasury_transfers_contract_bet_idx on public.mexas_treasury_transfers (contract_id, bet_id)
where
  contract_id is not null
  or bet_id is not null;

alter table public.mexas_treasury_transfers enable row level security;

revoke all on table public.mexas_treasury_transfers
from
  public,
  anon,
  authenticated;

grant
select
,
  insert,
update on table public.mexas_treasury_transfers to service_role;

-- Backend-only health check for the settlement ledger and its grants.
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
