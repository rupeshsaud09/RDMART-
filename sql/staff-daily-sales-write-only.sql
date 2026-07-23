-- ============================================================
-- STAFF DAILY SALES: WRITE-ONLY ACCESS
-- Run once in the Supabase SQL Editor for an existing database.
-- Safe to re-run.
-- ============================================================
-- Staff can submit a daily-sales total but cannot select, update, or delete
-- any daily-sales row. Admin and store-admin policies remain unchanged.

alter table public.daily_sales enable row level security;

drop policy if exists "staff use daily sales" on public.daily_sales;
drop policy if exists "staff update daily sales" on public.daily_sales;
drop policy if exists "staff insert daily sales" on public.daily_sales;

create policy "staff insert daily sales"
  on public.daily_sales
  for insert
  to authenticated
  with check (
    public.is_mart_staff()
    and sale_date = (now() at time zone 'Asia/Kathmandu')::date
  );

revoke all on public.daily_sales from anon;
grant select, insert, update, delete on public.daily_sales to authenticated;

select pg_notify('pgrst', 'reload schema');
