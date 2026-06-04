-- Lock down legacy Manifold Supabase surfaces that are not part of the MEXAS
-- launch product. The public website now blocks these routes, but the
-- publishable Supabase key can still reach exposed public-schema objects unless
-- the database layer denies them too.
do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'ach_trades',
    'mod_reports',
    'predictle_daily',
    'predictle_results',
    'reports',
    'shop_orders',
    'user_bans',
    'user_entitlements'
  ]
  loop
    if to_regclass(format('public.%I', v_name)) is not null then
      execute format('alter table public.%I enable row level security', v_name);
      execute format(
        'revoke all on table public.%I from public, anon, authenticated',
        v_name
      );
    end if;
  end loop;

  foreach v_name in array array[
    'mv_ach_account_age',
    'mv_ach_comments',
    'mv_ach_creator_contracts',
    'mv_ach_creator_traders',
    'mv_ach_leagues',
    'mv_ach_pnl',
    'mv_ach_referrals',
    'mv_ach_txns_achievements',
    'mv_ach_volume'
  ]
  loop
    if to_regclass(format('public.%I', v_name)) is not null then
      execute format(
        'revoke all on table public.%I from public, anon, authenticated',
        v_name
      );
    end if;
  end loop;
end
$$;

do $$
begin
  if to_regprocedure('public.count_recent_comments(text)') is not null then
    execute 'alter function public.count_recent_comments(text) set search_path = public';
  end if;

  if to_regprocedure('public.has_moderator_or_above_role(text,text)') is not null then
    execute 'alter function public.has_moderator_or_above_role(text, text) set search_path = public';
  end if;

  if to_regprocedure('public.trigger_set_timestamp()') is not null then
    execute 'alter function public.trigger_set_timestamp() set search_path = public';
  end if;

  if to_regprocedure('public.recently_liked_contract_counts(bigint)') is not null then
    execute 'alter function public.recently_liked_contract_counts(bigint) set search_path = public';
  end if;

  if to_regprocedure('public.get_donations_by_charity()') is not null then
    execute 'alter function public.get_donations_by_charity() set search_path = public';
  end if;

  if to_regprocedure('public.get_user_manalink_claims(text)') is not null then
    execute 'alter function public.get_user_manalink_claims(text) set search_path = public';
  end if;

  if to_regprocedure('public.get_donations_by_charity()') is not null then
    revoke execute on function public.get_donations_by_charity()
    from
      public,
      anon,
      authenticated;
  end if;

  if to_regprocedure('public.get_user_manalink_claims(text)') is not null then
    revoke execute on function public.get_user_manalink_claims(text)
    from
      public,
      anon,
      authenticated;
  end if;
end
$$;

-- Backend-only health check for the legacy Supabase surface lockdown.
create
or replace function public.mexas_legacy_surface_locked_down () returns boolean language sql security invoker
set
  search_path = public as $function$
  with table_targets(name) as (
    values
      ('ach_trades'),
      ('mod_reports'),
      ('predictle_daily'),
      ('predictle_results'),
      ('reports'),
      ('shop_orders'),
      ('user_bans'),
      ('user_entitlements')
  ),
  mview_targets(name) as (
    values
      ('mv_ach_account_age'),
      ('mv_ach_comments'),
      ('mv_ach_creator_contracts'),
      ('mv_ach_creator_traders'),
      ('mv_ach_leagues'),
      ('mv_ach_pnl'),
      ('mv_ach_referrals'),
      ('mv_ach_txns_achievements'),
      ('mv_ach_volume')
  ),
  locked_tables as (
    select
      c.oid,
      c.relrowsecurity
    from table_targets t
    join pg_class c on c.relname = t.name
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ),
  locked_mviews as (
    select c.oid
    from mview_targets t
    join pg_class c on c.relname = t.name
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ),
  function_targets(signature) as (
    values
      ('public.get_donations_by_charity()'),
      ('public.get_user_manalink_claims(text)')
  ),
  search_path_targets(signature) as (
    values
      ('public.count_recent_comments(text)'),
      ('public.has_moderator_or_above_role(text,text)'),
      ('public.trigger_set_timestamp()'),
      ('public.recently_liked_contract_counts(bigint)'),
      ('public.get_donations_by_charity()'),
      ('public.get_user_manalink_claims(text)')
  )
  select
    not exists (
      select 1
      from locked_tables
      where relrowsecurity is distinct from true
        or has_table_privilege('anon', oid, 'SELECT')
        or has_table_privilege('authenticated', oid, 'SELECT')
        or has_table_privilege('anon', oid, 'INSERT')
        or has_table_privilege('authenticated', oid, 'INSERT')
        or has_table_privilege('anon', oid, 'UPDATE')
        or has_table_privilege('authenticated', oid, 'UPDATE')
        or has_table_privilege('anon', oid, 'DELETE')
        or has_table_privilege('authenticated', oid, 'DELETE')
    )
    and not exists (
      select 1
      from locked_mviews
      where has_table_privilege('anon', oid, 'SELECT')
        or has_table_privilege('authenticated', oid, 'SELECT')
    )
    and not exists (
      select 1
      from function_targets f
      where to_regprocedure(f.signature) is not null
        and (
          has_function_privilege('anon', f.signature, 'EXECUTE')
          or has_function_privilege('authenticated', f.signature, 'EXECUTE')
        )
    )
    and not exists (
      select 1
      from search_path_targets f
      join pg_proc p on p.oid = to_regprocedure(f.signature)
      where not coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']
    );
$function$;

revoke
execute on function public.mexas_legacy_surface_locked_down ()
from
  public,
  anon,
  authenticated;

grant
execute on function public.mexas_legacy_surface_locked_down () to service_role;
