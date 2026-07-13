-- ============================================================
-- SUPERSEDED — DO NOT RUN THIS FILE.
-- Everything here is already included (in corrected form) in
-- ../setup-complete.sql. Re-running this file can silently
-- regress the database (older function versions, wrong unique
-- constraints). Kept for historical reference only.
-- ============================================================

-- RD MART multi-store migration.
-- Run this once in Supabase SQL Editor before using the Stores feature.
--
-- Existing data is assigned to the first store: RD MART.
-- New stores use the same app, but customers, credits, sales, daily sales,
-- party payments, cheques and activity are separated by store_id.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mart_stores (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  phone text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mart_staff (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mart_store_admins (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.mart_stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);

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

create or replace function public.is_store_admin(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mart_store_admins
    where store_id = target_store
      and user_id = auth.uid()
  );
$$;

create or replace function public.admin_create_store(name_input text, phone_input text default '', email_input text default '')
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user uuid;
  new_store uuid;
  clean_email text;
begin
  if not public.is_mart_admin() then
    raise exception 'Only main admin can create stores';
  end if;

  clean_email := lower(trim(coalesce(email_input, '')));
  if trim(coalesce(name_input, '')) = '' then
    raise exception 'Store name is required';
  end if;
  if clean_email = '' then
    raise exception 'Store admin email is required';
  end if;

  select id into target_user
  from auth.users
  where lower(email) = clean_email
  limit 1;

  if target_user is null then
    raise exception 'Create this email in Authentication -> Users first';
  end if;

  insert into public.mart_stores (name, phone)
  values (trim(name_input), regexp_replace(coalesce(phone_input,''), '\D', '', 'g'))
  returning id into new_store;

  insert into public.mart_store_admins (store_id, user_id, email)
  values (new_store, target_user, clean_email)
  on conflict (store_id, user_id) do nothing;

  return new_store;
end;
$$;

create or replace function public.admin_delete_store(store_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  store_count integer;
begin
  if not public.is_mart_admin() then
    raise exception 'Only main admin can delete stores';
  end if;

  select count(*) into store_count
  from public.mart_stores
  where is_active = true;

  if store_count <= 1 then
    raise exception 'You must keep at least one store';
  end if;

  if not exists (select 1 from public.mart_stores where id = store_input) then
    raise exception 'Store not found';
  end if;

  delete from public.credits where store_id = store_input;
  delete from public.sales where store_id = store_input;
  delete from public.daily_sales where store_id = store_input;
  delete from public.party_payments where store_id = store_input;
  delete from public.cheques where store_id = store_input;
  delete from public.activity where store_id = store_input;
  delete from public.customers where store_id = store_input;
  delete from public.mart_store_admins where store_id = store_input;
  if to_regclass('public.login_events') is not null then
    delete from public.login_events where store_id = store_input;
  end if;
  delete from public.mart_stores where id = store_input;
end;
$$;

insert into public.mart_stores (name, phone)
select
  coalesce((select mart_name from public.mart_settings where id = true), 'RD MART'),
  coalesce((select mart_phone from public.mart_settings where id = true), '')
where not exists (select 1 from public.mart_stores);

do $$
declare
  default_store uuid;
begin
  select id into default_store
  from public.mart_stores
  order by created_at
  limit 1;

  alter table public.customers add column if not exists store_id uuid references public.mart_stores(id) on delete restrict;
  alter table public.credits add column if not exists store_id uuid references public.mart_stores(id) on delete restrict;
  alter table public.sales add column if not exists store_id uuid references public.mart_stores(id) on delete restrict;
  alter table public.daily_sales add column if not exists store_id uuid references public.mart_stores(id) on delete restrict;
  alter table public.party_payments add column if not exists store_id uuid references public.mart_stores(id) on delete restrict;
  alter table public.cheques add column if not exists store_id uuid references public.mart_stores(id) on delete restrict;
  alter table public.activity add column if not exists store_id uuid references public.mart_stores(id) on delete restrict;

  update public.customers set store_id = default_store where store_id is null;
  update public.credits set store_id = default_store where store_id is null;
  update public.sales set store_id = default_store where store_id is null;
  update public.daily_sales set store_id = default_store where store_id is null;
  update public.party_payments set store_id = default_store where store_id is null;
  update public.cheques set store_id = default_store where store_id is null;
  update public.activity set store_id = default_store where store_id is null;

  if to_regclass('public.login_events') is not null then
    alter table public.login_events add column if not exists store_id uuid references public.mart_stores(id) on delete restrict;
    update public.login_events set store_id = default_store where store_id is null;
  end if;
end $$;

create index if not exists customers_store_id_idx on public.customers(store_id);
create index if not exists credits_store_id_idx on public.credits(store_id);
create index if not exists sales_store_id_idx on public.sales(store_id);
create index if not exists daily_sales_store_id_idx on public.daily_sales(store_id);
create index if not exists party_payments_store_id_idx on public.party_payments(store_id);
create index if not exists cheques_store_id_idx on public.cheques(store_id);
create index if not exists activity_store_id_idx on public.activity(store_id);

alter table public.mart_stores enable row level security;
alter table public.mart_store_admins enable row level security;

drop policy if exists "admins manage stores" on public.mart_stores;
create policy "admins manage stores" on public.mart_stores
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "staff read stores" on public.mart_stores;
create policy "staff read stores" on public.mart_stores
for select to authenticated
using (public.is_mart_admin() or public.is_mart_staff() or public.is_store_admin(id));

drop policy if exists "admins manage store admins" on public.mart_store_admins;
create policy "admins manage store admins" on public.mart_store_admins
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "store admins read own access" on public.mart_store_admins;
create policy "store admins read own access" on public.mart_store_admins
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "store admins use customers" on public.customers;
create policy "store admins use customers" on public.customers
for all to authenticated
using (public.is_store_admin(store_id))
with check (public.is_store_admin(store_id));

drop policy if exists "store admins use credits" on public.credits;
create policy "store admins use credits" on public.credits
for all to authenticated
using (public.is_store_admin(store_id))
with check (public.is_store_admin(store_id));

drop policy if exists "store admins use sales" on public.sales;
create policy "store admins use sales" on public.sales
for all to authenticated
using (public.is_store_admin(store_id))
with check (public.is_store_admin(store_id));

drop policy if exists "store admins use daily sales" on public.daily_sales;
create policy "store admins use daily sales" on public.daily_sales
for all to authenticated
using (public.is_store_admin(store_id))
with check (public.is_store_admin(store_id));

drop policy if exists "store admins use party payments" on public.party_payments;
create policy "store admins use party payments" on public.party_payments
for all to authenticated
using (public.is_store_admin(store_id))
with check (public.is_store_admin(store_id));

drop policy if exists "store admins use cheques" on public.cheques;
create policy "store admins use cheques" on public.cheques
for all to authenticated
using (public.is_store_admin(store_id))
with check (public.is_store_admin(store_id));

drop policy if exists "store admins use activity" on public.activity;
create policy "store admins use activity" on public.activity
for all to authenticated
using (public.is_store_admin(store_id))
with check (public.is_store_admin(store_id));

grant select, insert, update, delete on public.mart_stores to authenticated;
grant select, insert, update, delete on public.mart_store_admins to authenticated;
grant execute on function public.is_store_admin(uuid) to authenticated;
grant execute on function public.admin_create_store(text,text,text) to authenticated;
grant execute on function public.admin_delete_store(uuid) to authenticated;

-- Force Supabase/PostgREST to reload new tables and columns immediately.
select pg_notify('pgrst', 'reload schema');
