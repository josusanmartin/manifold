-- Revoke public execution from legacy/internal RPC functions that are not part
-- of the MEXAS product surface. Backend jobs can still call them with the
-- service role where needed.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.close_contract_embeddings(text,double precision,integer)',
    'public.get_noob_questions()',
    'public.get_non_empty_private_message_channel_ids(text,integer)',
    'public.get_non_empty_private_message_channel_ids(text,text[],integer)',
    'public.install_available_extensions_and_test()',
    'public.pgrst_ddl_watch()',
    'public.pgrst_drop_watch()',
    'public.sample_resolved_bets(integer,numeric)',
    'public.search_contract_embeddings(vector,double precision,integer)',
    'public.test()'
  ]
  loop
    if to_regprocedure(v_signature) is not null then
      execute format(
        'alter function %s set search_path = public',
        v_signature
      );
      execute format(
        'revoke execute on function %s from public, anon, authenticated',
        v_signature
      );
    end if;
  end loop;
end
$$;

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
      ('public.close_contract_embeddings(text,double precision,integer)'),
      ('public.get_donations_by_charity()'),
      ('public.get_noob_questions()'),
      ('public.get_non_empty_private_message_channel_ids(text,integer)'),
      ('public.get_non_empty_private_message_channel_ids(text,text[],integer)'),
      ('public.get_user_manalink_claims(text)'),
      ('public.install_available_extensions_and_test()'),
      ('public.pgrst_ddl_watch()'),
      ('public.pgrst_drop_watch()'),
      ('public.sample_resolved_bets(integer,numeric)'),
      ('public.search_contract_embeddings(vector,double precision,integer)'),
      ('public.test()')
  ),
  search_path_targets(signature) as (
    values
      ('public.close_contract_embeddings(text,double precision,integer)'),
      ('public.count_recent_comments(text)'),
      ('public.get_donations_by_charity()'),
      ('public.get_noob_questions()'),
      ('public.get_non_empty_private_message_channel_ids(text,integer)'),
      ('public.get_non_empty_private_message_channel_ids(text,text[],integer)'),
      ('public.get_user_manalink_claims(text)'),
      ('public.has_moderator_or_above_role(text,text)'),
      ('public.install_available_extensions_and_test()'),
      ('public.pgrst_ddl_watch()'),
      ('public.pgrst_drop_watch()'),
      ('public.recently_liked_contract_counts(bigint)'),
      ('public.sample_resolved_bets(integer,numeric)'),
      ('public.search_contract_embeddings(vector,double precision,integer)'),
      ('public.test()'),
      ('public.trigger_set_timestamp()')
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
