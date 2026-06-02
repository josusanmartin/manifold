alter table public.contracts
drop constraint if exists contracts_token_check;

alter table public.contracts
add constraint contracts_token_check check (
  token = any (array['MANA'::text, 'MEX'::text, 'CASH'::text])
);
