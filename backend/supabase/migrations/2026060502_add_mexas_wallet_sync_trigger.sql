-- Record direct MEX wallet deposits/withdrawals in the same transaction as the
-- user balance sync. This prevents a successful users.balance update from being
-- separated from its movement-ledger row by an API crash or network failure.
create
or replace function public.mexas_record_wallet_movement_from_user_sync () returns trigger language plpgsql security invoker
set
  search_path = public as $function$
declare
  v_new_data jsonb := coalesce(to_jsonb(new.data), '{}'::jsonb);
  v_old_data jsonb := case
    when tg_op = 'UPDATE' then coalesce(to_jsonb(old.data), '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_new_units_text text := v_new_data ->> 'mexasWalletBalanceUnitsSynced';
  v_old_units_text text := case
    when tg_op = 'UPDATE' then v_old_data ->> 'mexasWalletBalanceUnitsSynced'
    else null
  end;
  v_new_units numeric(78, 0);
  v_old_units numeric(78, 0) := 0;
  v_delta_units numeric(78, 0);
  v_wallet_address text;
  v_previous_sync_time text;
  v_open_reserved_amount numeric(38, 8) := 0;
  v_context text;
  v_idempotency_key text;
  v_internal_balance_before numeric(38, 8) := 0;
begin
  if v_new_units_text is null or v_new_units_text !~ '^[0-9]+$' then
    return new;
  end if;

  if v_old_units_text is not null and v_old_units_text !~ '^[0-9]+$' then
    v_old_units_text := null;
  end if;

  v_new_units := v_new_units_text::numeric(78, 0);
  v_old_units := coalesce(v_old_units_text::numeric(78, 0), 0);
  v_delta_units := v_new_units - v_old_units;

  if v_delta_units = 0 then
    return new;
  end if;

  v_wallet_address := lower(
    coalesce(
      v_new_data ->> 'privyWalletAddress',
      v_old_data ->> 'privyWalletAddress',
      ''
    )
  );

  if v_wallet_address !~ '^0x[0-9a-f]{40}$' then
    return new;
  end if;

  v_previous_sync_time := coalesce(
    case
      when v_old_data ? 'mexasWalletBalanceSyncedTime' then
        v_old_data ->> 'mexasWalletBalanceSyncedTime'
      else null
    end,
    'none'
  );
  v_context := coalesce(
    nullif(v_new_data ->> 'mexasWalletBalanceSyncContext', ''),
    'trigger'
  );
  v_internal_balance_before := case
    when tg_op = 'UPDATE' then old.balance
    else 0
  end;

  if (v_new_data ->> 'mexasWalletOpenReservedAmount') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_open_reserved_amount :=
      (v_new_data ->> 'mexasWalletOpenReservedAmount')::numeric(38, 8);
  end if;

  v_idempotency_key := concat_ws(
    ':',
    'mexas-wallet-sync',
    v_context,
    new.id,
    v_wallet_address,
    v_old_units::text,
    v_new_units::text,
    v_previous_sync_time
  );

  insert into public.mexas_wallet_movements (
    id,
    idempotency_key,
    movement_type,
    user_id,
    wallet_address,
    amount,
    delta_units,
    previous_wallet_units,
    new_wallet_units,
    previous_wallet_amount,
    new_wallet_amount,
    internal_balance_before,
    internal_balance_after,
    open_reserved_amount,
    token_address,
    chain_id,
    metadata
  )
  values (
    'mwm_' || md5(v_idempotency_key),
    v_idempotency_key,
    case when v_delta_units < 0 then 'withdrawal' else 'deposit' end,
    new.id,
    v_wallet_address,
    round(abs(v_delta_units) / 1000000::numeric, 8),
    v_delta_units::text,
    v_old_units::text,
    v_new_units::text,
    round(v_old_units / 1000000::numeric, 8),
    round(v_new_units / 1000000::numeric, 8),
    v_internal_balance_before,
    new.balance,
    v_open_reserved_amount,
    '0xc4c2ede4f6fd623acc86c492bdf099b3ba2b8303',
    42161,
    jsonb_build_object(
      'source', 'users-wallet-sync-trigger',
      'context', v_context
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$function$;

drop trigger if exists mexas_wallet_movement_from_user_sync on public.users;

create trigger mexas_wallet_movement_from_user_sync
after insert or update of data, balance
on public.users
for each row
execute function public.mexas_record_wallet_movement_from_user_sync ();

revoke
execute on function public.mexas_record_wallet_movement_from_user_sync ()
from
  public,
  anon,
  authenticated;

grant
execute on function public.mexas_record_wallet_movement_from_user_sync () to service_role;

create
or replace function public.mexas_wallet_movements_ledger_ready () returns boolean language sql security invoker
set
  search_path = public as $function$
  with objects as (
    select
      to_regclass('public.mexas_wallet_movements') as ledger,
      to_regprocedure('public.mexas_wallet_movements_ledger_ready()') as health,
      to_regprocedure('public.mexas_record_wallet_movement_from_user_sync()') as sync_trigger_fn
  )
  select
    case
      when ledger is null or health is null or sync_trigger_fn is null then false
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
        and has_function_privilege('service_role', sync_trigger_fn, 'EXECUTE')
        and not has_function_privilege('anon', sync_trigger_fn, 'EXECUTE')
        and not has_function_privilege('authenticated', sync_trigger_fn, 'EXECUTE')
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
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = 'users'
            and t.tgname = 'mexas_wallet_movement_from_user_sync'
            and not t.tgisinternal
            and t.tgenabled <> 'D'
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
