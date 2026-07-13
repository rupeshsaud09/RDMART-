-- ============================================================
-- SUPERSEDED — DO NOT RUN THIS FILE.
-- Everything here is already included (in corrected form) in
-- ../setup-complete.sql. Re-running this file can silently
-- regress the database (older function versions, wrong unique
-- constraints). Kept for historical reference only.
-- ============================================================

-- RD MART production Supabase schema.
-- Run this only after taking a JSON backup from the current app.
--
-- What this creates:
-- - Real tables instead of one shared JSON document.
-- - Admin access through Supabase Auth users listed in mart_admins.
-- - Customer PINs stored as hashes using pgcrypto.
-- - Customer portal access through RPC functions, not direct table writes.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mart_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.mart_settings (
  id boolean primary key default true,
  mart_name text not null default 'RD MART',
  mart_phone text default '',
  updated_at timestamptz not null default now(),
  constraint single_mart_settings_row check (id)
);

insert into public.mart_settings (id, mart_name)
values (true, 'RD MART')
on conflict (id) do nothing;

create table if not exists public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  phone text not null unique,
  pin_hash text not null,
  avatar_data text default '',
  email text default '',
  address text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credits (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  credit_date date not null default current_date,
  items text default '',
  amount numeric(12,2) not null check (amount > 0),
  paid numeric(12,2) not null default 0 check (paid >= 0),
  note text default '',
  payment_note text default '',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  sale_date date not null default current_date,
  party text not null default 'Walk-in Customer',
  amount numeric(12,2) not null check (amount > 0),
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.daily_sales (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  sale_date date not null default current_date,
  pos numeric(12,2) not null default 0,
  fonepay numeric(12,2) not null default 0,
  cash numeric(12,2) not null default 0,
  finance numeric(12,2) not null default 0,
  party_payment numeric(12,2) not null default 0,
  other numeric(12,2) not null default 0,
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.party_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  payment_date date not null default current_date,
  party text not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'Cash',
  reference text default '',
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.cheques (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  party text not null,
  cheque_no text not null,
  amount numeric(12,2) not null check (amount > 0),
  bank text default '',
  cheque_date date not null default current_date,
  status text not null default 'hold' check (status in ('hold','clear','bounce')),
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.activity (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  activity_type text not null default 'info',
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.login_events (
  id uuid primary key default extensions.gen_random_uuid(),
  login_role text not null check (login_role in ('admin','customer')),
  customer_id uuid references public.customers(id) on delete set null,
  display_name text not null default '',
  phone text default '',
  email text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.customer_sessions (
  token_hash text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_mart_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mart_admins
    where user_id = auth.uid()
  );
$$;

create or replace function public.hash_pin(pin text)
returns text
language sql
stable
as $$
  select extensions.crypt(pin, extensions.gen_salt('bf', 10));
$$;

create or replace function public.customer_login(phone_input text, pin_input text)
returns table(token text, customer_id uuid, name text, phone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  raw_token text;
begin
  select *
  into c
  from public.customers cst
  where cst.phone = regexp_replace(coalesce(phone_input,''), '\D', '', 'g')
  limit 1;

  if c.id is null
    or pin_input is null
    or c.pin_hash is null
    or c.pin_hash <> extensions.crypt(pin_input, c.pin_hash) then
    raise exception 'Invalid phone or PIN';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.customer_sessions(token_hash, customer_id, expires_at)
  values (encode(extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex'), c.id, now() + interval '30 days');

  insert into public.login_events(login_role, customer_id, display_name, phone)
  values ('customer', c.id, c.name, c.phone);

  return query select raw_token, c.id, c.name, c.phone;
end;
$$;

create or replace function public.record_admin_login(email_input text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_mart_admin() then
    raise exception 'Not authorized';
  end if;

  insert into public.login_events(login_role, display_name, email)
  values ('admin', coalesce(email_input, 'Admin'), coalesce(email_input, ''));
end;
$$;

create or replace function public.customer_session_customer_id(raw_token text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select customer_id
  from public.customer_sessions
  where token_hash = encode(extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and expires_at > now()
  limit 1;
$$;

create or replace function public.customer_portal(raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  result jsonb;
begin
  cid := public.customer_session_customer_id(raw_token);
  if cid is null then
    raise exception 'Invalid session';
  end if;

  select jsonb_build_object(
    'customer', to_jsonb(c) - 'pin_hash',
    'credits', coalesce(jsonb_agg(to_jsonb(cr) order by cr.credit_date desc, cr.created_at desc) filter (where cr.id is not null), '[]'::jsonb)
  )
  into result
  from public.customers c
  left join public.credits cr on cr.customer_id = c.id
  where c.id = cid
  group by c.id;

  return result;
end;
$$;

create or replace function public.customer_update_pin(raw_token text, new_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if new_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  cid := public.customer_session_customer_id(raw_token);
  if cid is null then
    raise exception 'Invalid session';
  end if;

  update public.customers
  set pin_hash = public.hash_pin(new_pin),
      updated_at = now()
  where id = cid;
end;
$$;

create or replace function public.customer_update_avatar(avatar_data_input text, raw_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if avatar_data_input is null
    or avatar_data_input !~ '^data:image/(jpeg|jpg|png|webp);base64,'
    or length(avatar_data_input) > 700000 then
    raise exception 'Profile picture must be a small JPG, PNG, or WebP image';
  end if;

  cid := public.customer_session_customer_id(raw_token);
  if cid is null then
    raise exception 'Invalid session';
  end if;

  update public.customers
  set avatar_data = avatar_data_input,
      updated_at = now()
  where id = cid;
end;
$$;

alter table public.mart_admins enable row level security;
alter table public.mart_settings enable row level security;
alter table public.customers enable row level security;
alter table public.credits enable row level security;
alter table public.sales enable row level security;
alter table public.daily_sales enable row level security;
alter table public.party_payments enable row level security;
alter table public.cheques enable row level security;
alter table public.activity enable row level security;
alter table public.login_events enable row level security;
alter table public.customer_sessions enable row level security;

drop policy if exists "admins manage settings" on public.mart_settings;
create policy "admins manage settings" on public.mart_settings
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "admins manage customers" on public.customers;
create policy "admins manage customers" on public.customers
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "admins manage credits" on public.credits;
create policy "admins manage credits" on public.credits
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "admins manage sales" on public.sales;
create policy "admins manage sales" on public.sales
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "admins manage daily sales" on public.daily_sales;
create policy "admins manage daily sales" on public.daily_sales
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "admins manage party payments" on public.party_payments;
create policy "admins manage party payments" on public.party_payments
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "admins manage cheques" on public.cheques;
create policy "admins manage cheques" on public.cheques
for all to authenticated
using (public.is_mart_admin())
with check (public.is_mart_admin());

drop policy if exists "admins read activity" on public.activity;
create policy "admins read activity" on public.activity
for select to authenticated
using (public.is_mart_admin());

drop policy if exists "admins read login events" on public.login_events;
create policy "admins read login events" on public.login_events
for select to authenticated
using (public.is_mart_admin());

-- No direct anon table access. Customers use RPC functions only.
revoke all on public.customers from anon;
revoke all on public.credits from anon;
revoke all on public.sales from anon;
revoke all on public.daily_sales from anon;
revoke all on public.party_payments from anon;
revoke all on public.cheques from anon;
revoke all on public.activity from anon;
revoke all on public.login_events from anon;
revoke all on public.customer_sessions from anon;

grant execute on function public.customer_login(text,text) to anon;
grant execute on function public.customer_portal(text) to anon;
grant execute on function public.customer_update_pin(text,text) to anon;
grant execute on function public.customer_update_avatar(text,text) to anon;
grant execute on function public.record_admin_login(text) to authenticated;
grant execute on function public.hash_pin(text) to authenticated;
grant select, insert, update, delete on public.mart_settings to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.credits to authenticated;
grant select, insert, update, delete on public.sales to authenticated;
grant select, insert, update, delete on public.daily_sales to authenticated;
grant select, insert, update, delete on public.party_payments to authenticated;
grant select, insert, update, delete on public.cheques to authenticated;
grant select, insert, update, delete on public.activity to authenticated;
grant select on public.login_events to authenticated;
