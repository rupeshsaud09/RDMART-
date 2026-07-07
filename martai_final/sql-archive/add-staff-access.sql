-- ============================================================
-- SUPERSEDED — DO NOT RUN THIS FILE.
-- Everything here is already included (in corrected form) in
-- ../setup-complete.sql. Re-running this file can silently
-- regress the database (older function versions, wrong unique
-- constraints). Kept for historical reference only.
-- ============================================================

-- RD MART staff access.
-- Run this in Supabase SQL Editor after your production schema.
--
-- Important:
-- 1. Create/invite the staff email in Supabase Authentication first.
-- 2. Then use RD MART Admin -> Settings -> Staff access to allow that email.
-- 3. Staff login from the existing Admin tab. Do not add a staff tab to the public login page.

create table if not exists public.mart_staff (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mart_staff enable row level security;

create or replace function public.is_mart_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mart_staff
    where user_id = auth.uid()
      and is_active = true
  );
$$;

create or replace function public.admin_add_staff(email_input text, name_input text default '')
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user uuid;
  staff_id uuid;
begin
  if not public.is_mart_admin() then
    raise exception 'Only admin can manage staff';
  end if;

  select id
  into target_user
  from auth.users
  where lower(email) = lower(trim(email_input))
  limit 1;

  if target_user is null then
    raise exception 'Create this email in Supabase Authentication first';
  end if;

  insert into public.mart_staff (user_id, email, full_name, is_active, updated_at)
  values (target_user, lower(trim(email_input)), coalesce(name_input,''), true, now())
  on conflict (email)
  do update set full_name = excluded.full_name,
                is_active = true,
                updated_at = now()
  returning id into staff_id;

  return staff_id;
end;
$$;

create or replace function public.admin_set_staff_active(email_input text, active_input boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_mart_admin() then
    raise exception 'Only admin can manage staff';
  end if;

  update public.mart_staff
  set is_active = active_input,
      updated_at = now()
  where lower(email) = lower(trim(email_input));
end;
$$;

drop policy if exists "admins manage staff" on public.mart_staff;
create policy "admins manage staff" on public.mart_staff
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "staff read own staff row" on public.mart_staff;
create policy "staff read own staff row" on public.mart_staff
for select to authenticated
using (user_id = auth.uid() and is_active = true);

drop policy if exists "staff read settings" on public.mart_settings;
create policy "staff read settings" on public.mart_settings
for select to authenticated
using (public.is_mart_staff());

drop policy if exists "staff use customers" on public.customers;
create policy "staff use customers" on public.customers
for select to authenticated
using (public.is_mart_staff());

drop policy if exists "staff insert customers" on public.customers;
create policy "staff insert customers" on public.customers
for insert to authenticated
with check (public.is_mart_staff());

drop policy if exists "staff update customers" on public.customers;
create policy "staff update customers" on public.customers
for update to authenticated
using (public.is_mart_staff())
with check (public.is_mart_staff());

drop policy if exists "staff use credits" on public.credits;
create policy "staff use credits" on public.credits
for select to authenticated
using (public.is_mart_staff());

drop policy if exists "staff insert credits" on public.credits;
create policy "staff insert credits" on public.credits
for insert to authenticated
with check (public.is_mart_staff());

drop policy if exists "staff update credits" on public.credits;
create policy "staff update credits" on public.credits
for update to authenticated
using (public.is_mart_staff())
with check (public.is_mart_staff());

drop policy if exists "staff use sales" on public.sales;
create policy "staff use sales" on public.sales
for select to authenticated
using (public.is_mart_staff());

drop policy if exists "staff insert sales" on public.sales;
create policy "staff insert sales" on public.sales
for insert to authenticated
with check (public.is_mart_staff());

drop policy if exists "staff update sales" on public.sales;
create policy "staff update sales" on public.sales
for update to authenticated
using (public.is_mart_staff())
with check (public.is_mart_staff());

drop policy if exists "staff use daily sales" on public.daily_sales;
create policy "staff use daily sales" on public.daily_sales
for select to authenticated
using (public.is_mart_staff());

drop policy if exists "staff insert daily sales" on public.daily_sales;
create policy "staff insert daily sales" on public.daily_sales
for insert to authenticated
with check (public.is_mart_staff());

drop policy if exists "staff update daily sales" on public.daily_sales;
create policy "staff update daily sales" on public.daily_sales
for update to authenticated
using (public.is_mart_staff())
with check (public.is_mart_staff());

drop policy if exists "staff use party payments" on public.party_payments;
create policy "staff use party payments" on public.party_payments
for select to authenticated
using (public.is_mart_staff());

drop policy if exists "staff insert party payments" on public.party_payments;
create policy "staff insert party payments" on public.party_payments
for insert to authenticated
with check (public.is_mart_staff());

drop policy if exists "staff update party payments" on public.party_payments;
create policy "staff update party payments" on public.party_payments
for update to authenticated
using (public.is_mart_staff())
with check (public.is_mart_staff());

drop policy if exists "staff use cheques" on public.cheques;
create policy "staff use cheques" on public.cheques
for select to authenticated
using (public.is_mart_staff());

drop policy if exists "staff insert cheques" on public.cheques;
create policy "staff insert cheques" on public.cheques
for insert to authenticated
with check (public.is_mart_staff());

drop policy if exists "staff update cheques" on public.cheques;
create policy "staff update cheques" on public.cheques
for update to authenticated
using (public.is_mart_staff())
with check (public.is_mart_staff());

drop policy if exists "staff read activity" on public.activity;
create policy "staff read activity" on public.activity
for select to authenticated
using (public.is_mart_staff());

grant select, insert, update on public.mart_staff to authenticated;
grant execute on function public.is_mart_staff() to authenticated;
grant execute on function public.admin_add_staff(text,text) to authenticated;
grant execute on function public.admin_set_staff_active(text,boolean) to authenticated;
