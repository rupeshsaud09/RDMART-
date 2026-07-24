-- ============================================================
-- DAILY SALES: ONE ENTRY PER STORE PER DAY
-- Run once in the Supabase SQL Editor for an existing database.
-- Safe to re-run (the constraint uses IF NOT EXISTS).
-- ============================================================
-- There is no shift/counter/branch concept in this table - one entry per
-- (store, date) is the intended design. Without this constraint, a staff
-- member (who cannot read existing daily_sales rows, by design - see
-- staff-daily-sales-write-only.sql) and an admin could each independently
-- save a "today" entry, silently double-counting that day's sales in
-- every total, chart, and report that sums by date.
--
-- STEP 1 - run this SELECT first. If it returns any rows, you have
-- existing duplicate dates that must be reviewed manually before the
-- constraint below can be applied - Postgres will refuse to add a unique
-- constraint while violating rows exist, and per this app's own rule,
-- duplicate financial records must never be auto-merged or deleted.
--   select store_id, sale_date, count(*) as entries, array_agg(id) as row_ids
--   from public.daily_sales
--   group by store_id, sale_date
--   having count(*) > 1;
--
-- If that query returns zero rows, continue to Step 2.

-- STEP 2 - the actual constraint.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'daily_sales_store_date_unique') then
    alter table public.daily_sales
      add constraint daily_sales_store_date_unique unique (store_id, sale_date);
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
