-- ============================================================
-- HOTFIX: adds only the columns the dashboard is currently
-- failing on. Run this in Supabase SQL Editor if the full
-- setup-complete.sql reports an error. Safe to re-run.
-- ============================================================

alter table public.credits     add column if not exists due_date date;
alter table public.customers   add column if not exists credit_limit numeric(12,2) not null default 0;
alter table public.mart_stores add column if not exists qr_data text default '';
alter table public.mart_stores add column if not exists qr_label text default '';

-- Make PostgREST see the new columns immediately
select pg_notify('pgrst', 'reload schema');
