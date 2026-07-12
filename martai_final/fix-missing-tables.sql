-- ============================================================
-- FIX MISSING TABLES — run once in Supabase SQL Editor
-- ============================================================
-- Fixes: "Could not find the table 'public.estimate_bills' in
-- the schema cache" (and creates cheque_queue / parties too if
-- they are missing). Everything is idempotent — safe to re-run.
-- ============================================================

-- === ESTIMATE BILLS ===
create table if not exists public.estimate_bills (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
  estimate_date date not null default current_date,
  customer text not null,
  phone text default '',
  items text default '',
  amount numeric(12,2) not null check (amount > 0),
  valid_until date,
  status text not null default 'draft' check (status in ('draft','sent','approved','rejected','expired')),
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists estimate_bills_store_id_idx on public.estimate_bills(store_id);

alter table public.estimate_bills enable row level security;
drop policy if exists "admins manage estimate bills"    on public.estimate_bills;
drop policy if exists "staff use estimate bills"        on public.estimate_bills;
drop policy if exists "staff insert estimate bills"     on public.estimate_bills;
drop policy if exists "staff update estimate bills"     on public.estimate_bills;
drop policy if exists "store admins use estimate bills" on public.estimate_bills;
create policy "admins manage estimate bills"    on public.estimate_bills for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use estimate bills"        on public.estimate_bills for select to authenticated using (public.is_mart_staff());
create policy "staff insert estimate bills"     on public.estimate_bills for insert to authenticated                                         with check (public.is_mart_staff());
create policy "staff update estimate bills"     on public.estimate_bills for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use estimate bills" on public.estimate_bills for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));
revoke all on public.estimate_bills from anon;
grant select, insert, update, delete on public.estimate_bills to authenticated;

-- === CHEQUE QUEUE (skip errors if you already ran add-cheque-queue.sql) ===
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
create policy "staff delete cheque queue"     on public.cheque_queue for delete to authenticated using (public.is_mart_staff());
create policy "store admins use cheque queue" on public.cheque_queue for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));
revoke all on public.cheque_queue from anon;
grant select, insert, update, delete on public.cheque_queue to authenticated;

-- === PARTIES (skip errors if you already ran add-parties.sql) ===
create table if not exists public.parties (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
  name text not null,
  phone text default '',
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists parties_store_id_idx on public.parties(store_id);
alter table public.parties enable row level security;
drop policy if exists "admins manage parties"    on public.parties;
drop policy if exists "staff use parties"        on public.parties;
drop policy if exists "staff insert parties"     on public.parties;
drop policy if exists "staff update parties"     on public.parties;
drop policy if exists "store admins use parties" on public.parties;
create policy "admins manage parties"    on public.parties for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use parties"        on public.parties for select to authenticated using (public.is_mart_staff());
create policy "staff insert parties"     on public.parties for insert to authenticated                                         with check (public.is_mart_staff());
create policy "staff update parties"     on public.parties for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use parties" on public.parties for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));
revoke all on public.parties from anon;
grant select, insert, update, delete on public.parties to authenticated;

-- === REALTIME (live multi-device sync) ===
do $$
declare t text;
begin
  foreach t in array array['estimate_bills','cheque_queue','parties']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already in the publication
      when undefined_object then null;   -- publication missing (non-Supabase Postgres)
    end;
  end loop;
end $$;

-- Make PostgREST see the new tables immediately
select pg_notify('pgrst', 'reload schema');
