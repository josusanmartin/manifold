-- MEXAS launch runs on MEX only. Do not let new contract rows silently fall
-- back to the upstream Manifold MANA default.
update public.contracts
set
  token = 'MEX'
where
  data ->> 'token' = 'MEX'
  and token is distinct from 'MEX';

do $$
begin
  if exists (
    select 1
    from public.contracts
    where token is distinct from 'MEX'
  ) then
    raise exception 'Cannot enforce MEX-only contracts while non-MEX contract rows exist';
  end if;
end
$$;

alter table public.contracts
alter column token
set default 'MEX';

alter table public.contracts
drop constraint if exists contracts_token_check;

alter table public.contracts
add constraint contracts_token_check check (token = 'MEX');
