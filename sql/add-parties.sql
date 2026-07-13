-- ============================================================
-- ADD PARTY ACCOUNTS — run once in Supabase SQL Editor
-- ============================================================
-- Adds the parties table: a saved supplier/party master created
-- from the Estimates page and used by estimates, cheques and
-- party payments for quick name selection.
-- Safe to re-run.
-- ============================================================

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

-- === ROW LEVEL SECURITY ===
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

-- === PERMISSIONS ===
revoke all on public.parties from anon;
grant select, insert, update, delete on public.parties to authenticated;

-- === REALTIME (live multi-device sync) ===
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.parties';
  exception
    when duplicate_object then null;   -- already in the publication
    when undefined_object then null;   -- publication missing (non-Supabase Postgres)
  end;
end $$;

-- Force PostgREST to pick up the new table immediately
select pg_notify('pgrst', 'reload schema');
