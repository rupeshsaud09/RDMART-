-- ============================================================
-- SUPERSEDED — DO NOT RUN THIS FILE.
-- Everything here is already included (in corrected form) in
-- ../setup-complete.sql. Re-running this file can silently
-- regress the database (older function versions, wrong unique
-- constraints). Kept for historical reference only.
-- ============================================================

-- MartAI first Supabase migration.
-- Run this in Supabase SQL Editor before adding your URL/key to
-- assets/martai-supabase-config.js.

create table if not exists public.martai_app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.martai_app_state enable row level security;

-- Phase 1 policy: lets the browser app read/write the shared app state.
-- This matches the current app's simple phone/PIN login model, but it is not
-- the final security model for sensitive public production data.
drop policy if exists "martai app can read state" on public.martai_app_state;
create policy "martai app can read state"
on public.martai_app_state
for select
to anon
using (id = 'main');

drop policy if exists "martai app can insert state" on public.martai_app_state;
create policy "martai app can insert state"
on public.martai_app_state
for insert
to anon
with check (id = 'main');

drop policy if exists "martai app can update state" on public.martai_app_state;
create policy "martai app can update state"
on public.martai_app_state
for update
to anon
using (id = 'main')
with check (id = 'main');
