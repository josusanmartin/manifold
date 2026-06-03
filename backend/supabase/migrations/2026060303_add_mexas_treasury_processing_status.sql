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
