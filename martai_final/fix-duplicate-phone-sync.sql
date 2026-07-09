-- ============================================================
-- HOTFIX: duplicate key value violates unique constraint
--         "customers_phone_key" during online sync.
--
-- HOW TO RUN:
-- 1. Open Supabase Dashboard.
-- 2. Go to SQL Editor.
-- 3. Paste this whole file and click Run.
-- 4. Go back to RD MART and press Sync / refresh.
--
-- Safe to run more than once.
--
-- CAUSE:
-- The original schema made customer phone unique across the whole database.
-- RD MART now supports multiple stores, so the same phone can exist in
-- different stores. Old databases still carry the global phone constraint,
-- which blocks sync until it is removed.
-- ============================================================

-- 1) Drop the old global unique constraint / index on phone.
alter table public.customers drop constraint if exists customers_phone_key;
drop index if exists public.customers_phone_key;

-- 2) Ensure the correct per-store unique index exists.
do $$
begin
  execute 'create unique index if not exists customers_phone_store_unique on public.customers(store_id, phone)';
exception when others then
  raise notice 'Could not create per-store phone index yet. Fix duplicate phones inside one store, then re-run. Error: %', sqlerrm;
end $$;

-- 3) List duplicates still left inside one store.
-- This should return no rows. If rows appear, edit those customers so each
-- phone is unique inside that store, then run this file again.
select store_id, phone, count(*) as copies, array_agg(name) as names
from public.customers
group by store_id, phone
having count(*) > 1;
