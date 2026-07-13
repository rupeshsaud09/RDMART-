-- ============================================================
-- ADD CHEQUE QUEUE — run once in Supabase SQL Editor
-- ============================================================
-- Adds the cheque_queue table: quick reminders of parties whose
-- cheque still has to be written (e.g. their ledger arrived on
-- WhatsApp). Entries are deleted once the cheque is written.
-- Safe to re-run.
-- ============================================================

create table if not exists public.cheque_queue (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
  party text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  note text default '',
  created_at timestamptz not null default now()
);

create index if not exists cheque_queue_store_id_idx on public.cheque_queue(store_id);

-- === ROW LEVEL SECURITY ===
alter table public.cheque_queue enable row level security;

drop policy if exists "admins manage cheque queue"    on public.cheque_queue;
drop policy if exists "staff use cheque queue"        on public.cheque_queue;
drop policy if exists "staff insert cheque queue"     on public.cheque_queue;
drop policy if exists "staff update cheque queue"     on public.cheque_queue;
drop policy if exists "staff delete cheque queue"     on public.cheque_queue;
drop policy if exists "store admins use cheque queue" on public.cheque_queue;
create policy "admins manage cheque queue"    on public.cheque_queue for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use cheque queue"        on public.cheque_queue for select to authenticated using (public.is_mart_staff());
create policy "staff insert cheque queue"     on public.cheque_queue for insert to authenticated                                         with check (public.is_mart_staff());
create policy "staff update cheque queue"     on public.cheque_queue for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
-- Unlike real cheque records, staff may delete queue entries: deleting IS the
-- normal workflow here (the cheque got written, the reminder is done).
create policy "staff delete cheque queue"     on public.cheque_queue for delete to authenticated using (public.is_mart_staff());
create policy "store admins use cheque queue" on public.cheque_queue for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- === PERMISSIONS ===
revoke all on public.cheque_queue from anon;
grant select, insert, update, delete on public.cheque_queue to authenticated;

-- === REALTIME (live multi-device sync) ===
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.cheque_queue';
  exception
    when duplicate_object then null;   -- already in the publication
    when undefined_object then null;   -- publication missing (non-Supabase Postgres)
  end;
end $$;

-- Force PostgREST to pick up the new table immediately
select pg_notify('pgrst', 'reload schema');
