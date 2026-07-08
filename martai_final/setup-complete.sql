-- ============================================================
-- RD MART  —  COMPLETE SETUP SQL
-- Run this ONCE in Supabase SQL Editor (Project → SQL Editor → New Query)
-- This replaces running the individual SQL files one by one.
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING.
-- ============================================================

-- === EXTENSIONS ===
create extension if not exists pgcrypto with schema extensions;

-- === CORE SETTINGS TABLE ===
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

-- === AUTH / ACCESS TABLES ===
create table if not exists public.mart_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Admin bootstrap: dashboard login only works for users listed in mart_admins.
-- If nobody is an admin yet, promote the earliest-created auth user (the
-- account you created first in Authentication → Users). To use a different
-- account instead, run:
--   insert into public.mart_admins (user_id)
--   select id from auth.users where email = 'you@example.com';
insert into public.mart_admins (user_id)
select u.id from auth.users u
where not exists (select 1 from public.mart_admins)
order by u.created_at asc
limit 1
on conflict (user_id) do nothing;

create table if not exists public.mart_stores (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  phone text default '',
  logo_data text default '',
  qr_data text default '',
  qr_label text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Payment QR columns for databases created before the QR feature existed
alter table public.mart_stores add column if not exists logo_data text default '';
alter table public.mart_stores add column if not exists qr_data text default '';
alter table public.mart_stores add column if not exists qr_label text default '';

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

-- === BUSINESS DATA TABLES ===
create table if not exists public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
  name text not null,
  phone text not null,
  pin_hash text not null,
  avatar_data text default '',
  email text default '',
  address text default '',
  notes text default '',
  credit_limit numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- For databases created before credit_limit existed (create table if not exists skips them)
alter table public.customers add column if not exists credit_limit numeric(12,2) not null default 0;
-- Login looks customers up by phone alone (across stores)
create index if not exists customers_phone_idx on public.customers(phone);

create table if not exists public.credits (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  credit_date date not null default current_date,
  due_date date,
  items text default '',
  amount numeric(12,2) not null check (amount > 0),
  paid numeric(12,2) not null default 0 check (paid >= 0),
  note text default '',
  payment_note text default '',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
-- For databases created before due_date existed
alter table public.credits add column if not exists due_date date;

create table if not exists public.sales (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
  sale_date date not null default current_date,
  party text not null default 'Walk-in Customer',
  amount numeric(12,2) not null check (amount > 0),
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.daily_sales (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
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
  store_id uuid references public.mart_stores(id) on delete restrict,
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
  store_id uuid references public.mart_stores(id) on delete restrict,
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
alter table public.estimate_bills add column if not exists legacy_id text;
alter table public.estimate_bills add column if not exists store_id uuid;
alter table public.estimate_bills add column if not exists estimate_date date;
alter table public.estimate_bills add column if not exists customer text;
alter table public.estimate_bills add column if not exists phone text;
alter table public.estimate_bills add column if not exists items text;
alter table public.estimate_bills add column if not exists amount numeric(12,2);
alter table public.estimate_bills add column if not exists valid_until date;
alter table public.estimate_bills add column if not exists status text;
alter table public.estimate_bills add column if not exists note text;
alter table public.estimate_bills add column if not exists created_at timestamptz;
alter table public.estimate_bills add column if not exists updated_at timestamptz;

-- Customer "I paid" reports from the portal; admin approves to apply to dues
create table if not exists public.payment_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid references public.mart_stores(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  method text default '',
  reference text default '',
  note text default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text default ''
);
alter table public.payment_requests add column if not exists customer_id uuid;
alter table public.payment_requests add column if not exists store_id uuid;
alter table public.payment_requests add column if not exists amount numeric(12,2);
alter table public.payment_requests add column if not exists method text;
alter table public.payment_requests add column if not exists reference text;
alter table public.payment_requests add column if not exists note text;
alter table public.payment_requests add column if not exists status text;
alter table public.payment_requests add column if not exists created_at timestamptz;
alter table public.payment_requests add column if not exists resolved_at timestamptz;
alter table public.payment_requests add column if not exists resolved_by text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'store_id'
  ) then
    execute 'create index if not exists payment_requests_store_idx on public.payment_requests(store_id)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'customer_id'
  ) then
    execute 'create index if not exists payment_requests_customer_idx on public.payment_requests(customer_id)';
  end if;
end $$;

create table if not exists public.activity (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
  activity_type text not null default 'info',
  message text not null,
  created_at timestamptz not null default now()
);
alter table public.activity add column if not exists store_id uuid;
alter table public.activity add column if not exists activity_type text;
alter table public.activity add column if not exists message text;
alter table public.activity add column if not exists created_at timestamptz;

create table if not exists public.login_events (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid references public.mart_stores(id) on delete restrict,
  login_role text not null check (login_role in ('admin','customer')),
  customer_id uuid references public.customers(id) on delete set null,
  display_name text not null default '',
  phone text default '',
  email text default '',
  created_at timestamptz not null default now()
);
alter table public.login_events add column if not exists store_id uuid;
alter table public.login_events add column if not exists login_role text;
alter table public.login_events add column if not exists customer_id uuid;
alter table public.login_events add column if not exists display_name text;
alter table public.login_events add column if not exists phone text;
alter table public.login_events add column if not exists email text;
alter table public.login_events add column if not exists created_at timestamptz;

-- For databases created before multi-store support, add the missing columns.
do $$
begin
  if to_regclass('public.login_events') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'login_events' and column_name = 'customer_id'
    ) then
      execute 'alter table public.login_events add column customer_id uuid';
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'login_events' and column_name = 'store_id'
    ) then
      execute 'alter table public.login_events add column store_id uuid';
    end if;
  end if;

  if to_regclass('public.payment_requests') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'customer_id'
    ) then
      execute 'alter table public.payment_requests add column customer_id uuid';
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'store_id'
    ) then
      execute 'alter table public.payment_requests add column store_id uuid';
    end if;
  end if;
end $$;

alter table public.customers add column if not exists store_id uuid;
alter table public.credits add column if not exists store_id uuid;
alter table public.credits add column if not exists customer_id uuid;
alter table public.sales add column if not exists store_id uuid;
alter table public.daily_sales add column if not exists store_id uuid;
alter table public.party_payments add column if not exists store_id uuid;
alter table public.cheques add column if not exists store_id uuid;
alter table public.estimate_bills add column if not exists legacy_id text;
alter table public.estimate_bills add column if not exists store_id uuid;
alter table public.estimate_bills add column if not exists estimate_date date;
alter table public.estimate_bills add column if not exists customer text;
alter table public.estimate_bills add column if not exists phone text;
alter table public.estimate_bills add column if not exists items text;
alter table public.estimate_bills add column if not exists amount numeric(12,2);
alter table public.estimate_bills add column if not exists valid_until date;
alter table public.estimate_bills add column if not exists status text;
alter table public.estimate_bills add column if not exists note text;
alter table public.estimate_bills add column if not exists created_at timestamptz;
alter table public.estimate_bills add column if not exists updated_at timestamptz;
alter table public.payment_requests add column if not exists customer_id uuid;
alter table public.payment_requests add column if not exists store_id uuid;
alter table public.payment_requests add column if not exists amount numeric(12,2);
alter table public.payment_requests add column if not exists method text;
alter table public.payment_requests add column if not exists reference text;
alter table public.payment_requests add column if not exists note text;
alter table public.payment_requests add column if not exists status text;
alter table public.payment_requests add column if not exists created_at timestamptz;
alter table public.payment_requests add column if not exists resolved_at timestamptz;
alter table public.payment_requests add column if not exists resolved_by text;
alter table public.activity add column if not exists store_id uuid;
alter table public.activity add column if not exists activity_type text;
alter table public.activity add column if not exists message text;
alter table public.activity add column if not exists created_at timestamptz;
alter table public.login_events add column if not exists store_id uuid;
alter table public.login_events add column if not exists login_role text;
alter table public.login_events add column if not exists customer_id uuid;
alter table public.login_events add column if not exists display_name text;
alter table public.login_events add column if not exists phone text;
alter table public.login_events add column if not exists email text;
alter table public.login_events add column if not exists created_at timestamptz;
do $$
begin
  if to_regclass('public.customer_sessions') is not null then
    alter table public.customer_sessions add column if not exists customer_id uuid;
    alter table public.customer_sessions add column if not exists expires_at timestamptz;
    alter table public.customer_sessions add column if not exists created_at timestamptz;
  end if;
end $$;

-- === DEFAULT STORE (created from settings if none exists) ===
-- Must run BEFORE the backfill below, so upgraded databases get their
-- existing rows attached to this store instead of being left with NULL.
insert into public.mart_stores (name, phone)
select
  coalesce((select mart_name from public.mart_settings where id = true), 'RD MART'),
  coalesce((select mart_phone from public.mart_settings where id = true), '')
where not exists (select 1 from public.mart_stores);

-- Backfill the new store_id column for existing rows using the default store.
do $$
declare default_store uuid;
begin
  select id into default_store from public.mart_stores where is_active = true order by created_at asc limit 1;
  if default_store is not null then
    update public.customers set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.credits set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.sales set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.daily_sales set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.party_payments set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.cheques set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.estimate_bills set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.payment_requests set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.activity set store_id = coalesce(store_id, default_store) where store_id is null;
    update public.login_events set store_id = coalesce(store_id, default_store) where store_id is null;
  end if;
end $$;

-- === APP STATE TABLE ===
create table if not exists public.martai_app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Initialize the app state row for anon users
insert into public.martai_app_state (id, data, updated_at)
values ('main', '{}', now())
on conflict (id) do update set updated_at = now();

-- === SESSION & BRUTE-FORCE TABLES ===
create table if not exists public.customer_sessions (
  token_hash text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Tracks failed customer login attempts per phone number for rate-limiting
create table if not exists public.login_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  phone text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists login_attempts_phone_time_idx on public.login_attempts(phone, attempted_at);

-- === INDEXES ===
-- Phone unique per store (not globally), supports multi-store with same customer phone.
-- Created here (not at table definition) because older databases only get the
-- store_id column from the ALTER statements above. Wrapped so duplicate phones
-- in existing data cannot abort the whole setup script.
do $$
begin
  execute 'create unique index if not exists customers_phone_store_unique on public.customers(store_id, phone)';
exception when others then
  raise notice 'Skipped unique phone index (fix duplicate customer phones, then re-run): %', sqlerrm;
end $$;
create index if not exists customers_store_id_idx on public.customers(store_id);
create index if not exists credits_store_id_idx on public.credits(store_id);
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'credits' and column_name = 'customer_id'
  ) then
    execute 'create index if not exists credits_customer_id_idx on public.credits(customer_id)';
  end if;
end $$;
create index if not exists sales_store_id_idx on public.sales(store_id);
create index if not exists daily_sales_store_id_idx on public.daily_sales(store_id);
create index if not exists party_payments_store_id_idx on public.party_payments(store_id);
create index if not exists cheques_store_id_idx on public.cheques(store_id);
create index if not exists estimate_bills_store_id_idx on public.estimate_bills(store_id);
create unique index if not exists estimate_bills_legacy_id_uidx on public.estimate_bills(legacy_id) where legacy_id is not null;
create index if not exists activity_store_id_idx on public.activity(store_id);

-- === HELPER FUNCTIONS ===

create or replace function public.is_mart_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mart_admins where user_id = auth.uid());
$$;

create or replace function public.is_mart_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mart_staff where user_id = auth.uid() and is_active = true);
$$;

create or replace function public.is_store_admin(target_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mart_store_admins where store_id = target_store and user_id = auth.uid());
$$;

create or replace function public.hash_pin(pin text)
returns text language sql stable as $$
  select extensions.crypt(pin, extensions.gen_salt('bf', 10));
$$;

create or replace function public.customer_session_customer_id(raw_token text)
returns uuid language sql stable security definer set search_path = public as $$
  select customer_id from public.customer_sessions
  where token_hash = encode(extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and expires_at > now()
  limit 1;
$$;

-- === CUSTOMER LOGIN WITH BRUTE-FORCE PROTECTION ===
-- Blocks a phone number after 10 failed attempts within 15 minutes.
-- Clears the attempt counter on successful login.
-- Also cleans up expired sessions on each successful login.
-- The same phone can exist in more than one store (unique per store, not
-- globally), so the PIN is checked against every customer with that phone
-- and login goes to the account whose PIN matches — never an arbitrary row.
-- All column references are table-qualified: "phone"/"customer_id" are also
-- output columns of this function and unqualified use is ambiguous in plpgsql.
create or replace function public.customer_login(phone_input text, pin_input text)
returns table(token text, customer_id uuid, name text, phone text)
language plpgsql security definer set search_path = public as $$
declare
  c record;
  raw_token text;
  clean_phone text;
  attempt_count integer;
begin
  clean_phone := regexp_replace(coalesce(phone_input, ''), '\D', '', 'g');

  -- Remove stale attempt records older than 15 minutes
  delete from public.login_attempts la
  where la.attempted_at < now() - interval '15 minutes';

  -- Count recent failed attempts for this phone
  select count(*) into attempt_count
  from public.login_attempts la
  where la.phone = clean_phone;

  if attempt_count >= 10 then
    raise exception 'Too many failed attempts. Please wait 15 minutes and try again.';
  end if;

  -- Look up customer: verify the PIN against every store's customer with
  -- this phone; if two stores share phone AND PIN, prefer the most recent.
  select cst.* into c
  from public.customers cst
  where cst.phone = clean_phone
    and pin_input is not null
    and cst.pin_hash is not null
    and cst.pin_hash = extensions.crypt(pin_input, cst.pin_hash)
  order by cst.updated_at desc nulls last, cst.created_at desc
  limit 1;

  if c.id is null then
    -- Return empty instead of raising: an exception would roll back this
    -- insert, so failed attempts would never be recorded and the
    -- brute-force limit above could never trigger.
    insert into public.login_attempts(phone) values(clean_phone);
    return;
  end if;

  -- Login OK: clear failed attempts and expired sessions
  delete from public.login_attempts la where la.phone = clean_phone;
  delete from public.customer_sessions cs where cs.expires_at < now();

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.customer_sessions(token_hash, customer_id, expires_at)
  values (
    encode(extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex'),
    c.id,
    now() + interval '30 days'
  );

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'login_events' and column_name = 'customer_id'
  ) then
    insert into public.login_events(login_role, customer_id, display_name, phone)
    values ('customer', c.id, c.name, c.phone);
  else
    insert into public.login_events(login_role, display_name, phone)
    values ('customer', c.name, c.phone);
  end if;

  return query select raw_token, c.id, c.name, c.phone;
end;
$$;

-- === CUSTOMER PORTAL ===
create or replace function public.customer_portal(raw_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  result jsonb;
begin
  cid := public.customer_session_customer_id(raw_token);
  if cid is null then
    raise exception 'Invalid or expired session';
  end if;

  select jsonb_build_object(
    'customer', to_jsonb(c) - 'pin_hash',
    'credits', coalesce(
      jsonb_agg(to_jsonb(cr) order by cr.credit_date desc, cr.created_at desc)
        filter (where cr.id is not null),
      '[]'::jsonb
    ),
    'payment_requests', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.created_at desc)
      from public.payment_requests pr
      where pr.customer_id = c.id
        and pr.created_at > now() - interval '90 days'
    ), '[]'::jsonb),
    -- Store name, logo + payment QR for the portal. Anon cannot read mart_stores
    -- directly (access is revoked above), so it must come from this function.
    'store', (
      select jsonb_build_object('name', s.name, 'logo_data', s.logo_data, 'qr_data', s.qr_data, 'qr_label', s.qr_label)
      from public.mart_stores s
      where s.id = c.store_id
    )
  )
  into result
  from public.customers c
  left join public.credits cr on cr.customer_id = c.id
  where c.id = cid
  group by c.id;

  return result;
end;
$$;

-- === CUSTOMER SELF-SERVICE RPCs ===
create or replace function public.customer_update_pin(raw_token text, new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if new_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;
  cid := public.customer_session_customer_id(raw_token);
  if cid is null then raise exception 'Invalid session'; end if;
  update public.customers
  set pin_hash = public.hash_pin(new_pin), updated_at = now()
  where id = cid;
end;
$$;

-- Primary avatar RPC (simple argument names, preferred by PostgREST)
create or replace function public.update_customer_photo(token text, image text)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if image is null
    or image !~ '^data:image/(jpeg|jpg|png|webp);base64,'
    or length(image) > 700000 then
    raise exception 'Profile picture must be a small JPG, PNG, or WebP image (max ~500 KB)';
  end if;
  cid := public.customer_session_customer_id(token);
  if cid is null then raise exception 'Invalid session'; end if;
  update public.customers set avatar_data = image, updated_at = now() where id = cid;
end;
$$;

-- Fallback avatar RPC (for PostgREST schema cache compatibility)
create or replace function public.customer_update_avatar(avatar_data_input text, raw_token text)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if avatar_data_input is null
    or avatar_data_input !~ '^data:image/(jpeg|jpg|png|webp);base64,'
    or length(avatar_data_input) > 700000 then
    raise exception 'Profile picture must be a small JPG, PNG, or WebP image (max ~500 KB)';
  end if;
  cid := public.customer_session_customer_id(raw_token);
  if cid is null then raise exception 'Invalid session'; end if;
  update public.customers set avatar_data = avatar_data_input, updated_at = now() where id = cid;
end;
$$;

-- === CUSTOMER "I PAID" REPORT ===
-- Customer reports a payment from the portal; capped at 5 open reports
-- per customer so the mart's inbox cannot be flooded.
create or replace function public.customer_request_payment(
  raw_token text,
  amount_input numeric,
  method_input text default '',
  reference_input text default '',
  note_input text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  sid uuid;
  new_id uuid;
  pending_count integer;
begin
  cid := public.customer_session_customer_id(raw_token);
  if cid is null then raise exception 'Invalid or expired session'; end if;
  if amount_input is null or amount_input <= 0 then raise exception 'Amount must be greater than 0'; end if;
  if amount_input > 10000000 then raise exception 'Amount is too large'; end if;
  select count(*) into pending_count
  from public.payment_requests pr
  where pr.customer_id = cid and pr.status = 'pending';
  if pending_count >= 5 then
    raise exception 'You already have pending payment reports. Please wait for the mart to confirm them.';
  end if;
  select c.store_id into sid from public.customers c where c.id = cid;
  insert into public.payment_requests(store_id, customer_id, amount, method, reference, note)
  values (sid, cid, amount_input, left(coalesce(method_input,''),40), left(coalesce(reference_input,''),120), left(coalesce(note_input,''),240))
  returning id into new_id;
  return new_id;
end;
$$;

-- === PUBLIC INFO RPC ===
-- Lets the login page show public brand info for PIN reset help.
-- Exposes only the mart name, public phone and uploaded logo.
drop function if exists public.public_store_info();
create or replace function public.public_store_info()
returns table(mart_name text, mart_phone text, logo_data text)
language sql stable security definer set search_path = public as $$
  select
    coalesce(nullif(s.name, ''), ms.mart_name),
    coalesce(nullif(s.phone, ''), ms.mart_phone),
    coalesce(s.logo_data, '')
  from public.mart_settings ms
  left join lateral (
    select name, phone, logo_data
    from public.mart_stores
    where is_active = true
    order by created_at asc
    limit 1
  ) s on true
  where ms.id = true;
$$;

-- === ADMIN RPCs ===
create or replace function public.record_admin_login(email_input text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mart_admin() then raise exception 'Not authorized'; end if;
  insert into public.login_events(login_role, display_name, email)
  values ('admin', coalesce(email_input, 'Admin'), coalesce(email_input, ''));
end;
$$;

create or replace function public.admin_create_store(
  name_input text,
  phone_input text default '',
  email_input text default ''
)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  target_user uuid;
  new_store uuid;
  clean_email text;
begin
  if not public.is_mart_admin() then raise exception 'Only main admin can create stores'; end if;
  clean_email := lower(trim(coalesce(email_input, '')));
  if trim(coalesce(name_input, '')) = '' then raise exception 'Store name is required'; end if;
  if clean_email = '' then raise exception 'Store admin email is required'; end if;
  select id into target_user from auth.users where lower(email) = clean_email limit 1;
  if target_user is null then
    raise exception 'Create this email in Authentication → Users first';
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
returns void language plpgsql security definer set search_path = public as $$
declare store_count integer;
begin
  if not public.is_mart_admin() then raise exception 'Only main admin can delete stores'; end if;
  select count(*) into store_count from public.mart_stores where is_active = true;
  if store_count <= 1 then raise exception 'You must keep at least one store'; end if;
  if not exists (select 1 from public.mart_stores where id = store_input) then
    raise exception 'Store not found';
  end if;
  delete from public.payment_requests where store_id = store_input;
  delete from public.credits        where store_id = store_input;
  delete from public.sales           where store_id = store_input;
  delete from public.daily_sales     where store_id = store_input;
  delete from public.party_payments  where store_id = store_input;
  delete from public.cheques         where store_id = store_input;
  delete from public.estimate_bills  where store_id = store_input;
  delete from public.activity        where store_id = store_input;
  delete from public.login_events    where store_id = store_input;
  delete from public.customers       where store_id = store_input;
  delete from public.mart_store_admins where store_id = store_input;
  delete from public.mart_stores     where id = store_input;
end;
$$;

create or replace function public.admin_add_staff(email_input text, name_input text default '')
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  target_user uuid;
  staff_id uuid;
begin
  if not public.is_mart_admin() then raise exception 'Only admin can manage staff'; end if;
  select id into target_user from auth.users
  where lower(email) = lower(trim(email_input)) limit 1;
  if target_user is null then
    raise exception 'Create this email in Supabase Authentication first';
  end if;
  insert into public.mart_staff (user_id, email, full_name, is_active, updated_at)
  values (target_user, lower(trim(email_input)), coalesce(name_input,''), true, now())
  on conflict (email) do update
    set full_name = excluded.full_name, is_active = true, updated_at = now()
  returning id into staff_id;
  return staff_id;
end;
$$;

create or replace function public.admin_set_staff_active(email_input text, active_input boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mart_admin() then raise exception 'Only admin can manage staff'; end if;
  update public.mart_staff
  set is_active = active_input, updated_at = now()
  where lower(email) = lower(trim(email_input));
end;
$$;

-- === ROW LEVEL SECURITY ===
alter table public.mart_admins      enable row level security;
alter table public.mart_settings    enable row level security;
alter table public.mart_stores      enable row level security;
alter table public.mart_staff       enable row level security;
alter table public.mart_store_admins enable row level security;
alter table public.customers        enable row level security;
alter table public.credits          enable row level security;
alter table public.sales            enable row level security;
alter table public.daily_sales      enable row level security;
alter table public.party_payments   enable row level security;
alter table public.cheques          enable row level security;
alter table public.estimate_bills   enable row level security;
alter table public.activity         enable row level security;
alter table public.login_events     enable row level security;
alter table public.martai_app_state enable row level security;
do $$
begin
  if to_regclass('public.customer_sessions') is not null then
    execute 'alter table public.customer_sessions enable row level security';
  end if;
end $$;
alter table public.login_attempts   enable row level security;
alter table public.payment_requests enable row level security;

-- payment_requests: written only via the customer RPC; admin/staff/store admins manage
drop policy if exists "admins manage payment requests"      on public.payment_requests;
drop policy if exists "staff use payment requests"          on public.payment_requests;
drop policy if exists "staff update payment requests"       on public.payment_requests;
drop policy if exists "store admins use payment requests"   on public.payment_requests;
create policy "admins manage payment requests"    on public.payment_requests for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use payment requests"        on public.payment_requests for select to authenticated using (public.is_mart_staff());
create policy "staff update payment requests"     on public.payment_requests for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use payment requests" on public.payment_requests for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- mart_settings
drop policy if exists "admins manage settings"  on public.mart_settings;
drop policy if exists "staff read settings"     on public.mart_settings;
create policy "admins manage settings" on public.mart_settings
  for all to authenticated using (public.is_mart_admin()) with check (public.is_mart_admin());
create policy "staff read settings" on public.mart_settings
  for select to authenticated using (public.is_mart_staff());

-- mart_stores
drop policy if exists "admins manage stores"              on public.mart_stores;
drop policy if exists "staff read stores"                 on public.mart_stores;
drop policy if exists "staff and store admins read stores" on public.mart_stores;
create policy "admins manage stores" on public.mart_stores
  for all to authenticated using (public.is_mart_admin()) with check (public.is_mart_admin());
create policy "staff and store admins read stores" on public.mart_stores
  for select to authenticated
  using (public.is_mart_admin() or public.is_mart_staff() or public.is_store_admin(id));

-- mart_store_admins
drop policy if exists "admins manage store admins"   on public.mart_store_admins;
drop policy if exists "store admins read own access" on public.mart_store_admins;
create policy "admins manage store admins" on public.mart_store_admins
  for all to authenticated using (public.is_mart_admin()) with check (public.is_mart_admin());
create policy "store admins read own access" on public.mart_store_admins
  for select to authenticated using (user_id = auth.uid());

-- mart_staff
drop policy if exists "admins manage staff"  on public.mart_staff;
drop policy if exists "staff read own staff row" on public.mart_staff;
drop policy if exists "staff read own row"   on public.mart_staff;
create policy "admins manage staff" on public.mart_staff
  for all to authenticated using (public.is_mart_admin()) with check (public.is_mart_admin());
create policy "staff read own row" on public.mart_staff
  for select to authenticated using (user_id = auth.uid() and is_active = true);

-- customers
drop policy if exists "admins manage customers"    on public.customers;
drop policy if exists "staff use customers"        on public.customers;
drop policy if exists "staff insert customers"     on public.customers;
drop policy if exists "staff update customers"     on public.customers;
drop policy if exists "store admins use customers" on public.customers;
create policy "admins manage customers"    on public.customers for all       to authenticated using (public.is_mart_admin())               with check (public.is_mart_admin());
create policy "staff use customers"        on public.customers for select    to authenticated using (public.is_mart_staff());
create policy "staff insert customers"     on public.customers for insert    to authenticated                                               with check (public.is_mart_staff());
create policy "staff update customers"     on public.customers for update    to authenticated using (public.is_mart_staff())               with check (public.is_mart_staff());
create policy "store admins use customers" on public.customers for all       to authenticated using (public.is_store_admin(store_id))      with check (public.is_store_admin(store_id));

-- credits
drop policy if exists "admins manage credits"    on public.credits;
drop policy if exists "staff use credits"        on public.credits;
drop policy if exists "staff insert credits"     on public.credits;
drop policy if exists "staff update credits"     on public.credits;
drop policy if exists "store admins use credits" on public.credits;
create policy "admins manage credits"    on public.credits for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use credits"        on public.credits for select to authenticated using (public.is_mart_staff());
create policy "staff insert credits"     on public.credits for insert to authenticated                                         with check (public.is_mart_staff());
create policy "staff update credits"     on public.credits for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use credits" on public.credits for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- sales
drop policy if exists "admins manage sales"    on public.sales;
drop policy if exists "staff use sales"        on public.sales;
drop policy if exists "staff insert sales"     on public.sales;
drop policy if exists "staff update sales"     on public.sales;
drop policy if exists "store admins use sales" on public.sales;
create policy "admins manage sales"    on public.sales for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use sales"        on public.sales for select to authenticated using (public.is_mart_staff());
create policy "staff insert sales"     on public.sales for insert to authenticated                                         with check (public.is_mart_staff());
create policy "staff update sales"     on public.sales for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use sales" on public.sales for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- daily_sales
drop policy if exists "admins manage daily sales"    on public.daily_sales;
drop policy if exists "staff use daily sales"        on public.daily_sales;
drop policy if exists "staff insert daily sales"     on public.daily_sales;
drop policy if exists "staff update daily sales"     on public.daily_sales;
drop policy if exists "store admins use daily sales" on public.daily_sales;
create policy "admins manage daily sales"    on public.daily_sales for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use daily sales"        on public.daily_sales for select to authenticated using (public.is_mart_staff());
create policy "staff insert daily sales"     on public.daily_sales for insert to authenticated                                         with check (public.is_mart_staff());
create policy "staff update daily sales"     on public.daily_sales for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use daily sales" on public.daily_sales for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- party_payments
drop policy if exists "admins manage party payments"    on public.party_payments;
drop policy if exists "staff use party payments"        on public.party_payments;
drop policy if exists "staff insert party payments"     on public.party_payments;
drop policy if exists "staff update party payments"     on public.party_payments;
drop policy if exists "store admins use party payments" on public.party_payments;
create policy "admins manage party payments"    on public.party_payments for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use party payments"        on public.party_payments for select to authenticated using (public.is_mart_staff());
create policy "staff insert party payments"     on public.party_payments for insert to authenticated                                         with check (public.is_mart_staff());
create policy "staff update party payments"     on public.party_payments for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use party payments" on public.party_payments for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- cheques
drop policy if exists "admins manage cheques"    on public.cheques;
drop policy if exists "staff use cheques"        on public.cheques;
drop policy if exists "staff insert cheques"     on public.cheques;
drop policy if exists "staff update cheques"     on public.cheques;
drop policy if exists "store admins use cheques" on public.cheques;
create policy "admins manage cheques"    on public.cheques for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use cheques"        on public.cheques for select to authenticated using (public.is_mart_staff());
create policy "staff insert cheques"     on public.cheques for insert to authenticated                                         with check (public.is_mart_staff());
create policy "staff update cheques"     on public.cheques for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use cheques" on public.cheques for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- estimate_bills
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

-- activity
drop policy if exists "admins read activity"    on public.activity;
drop policy if exists "staff read activity"     on public.activity;
drop policy if exists "store admins use activity" on public.activity;
create policy "admins read activity"      on public.activity for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff read activity"       on public.activity for select to authenticated using (public.is_mart_staff());
create policy "store admins use activity" on public.activity for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- login_events
drop policy if exists "admins read login events" on public.login_events;
create policy "admins read login events" on public.login_events
  for select to authenticated using (public.is_mart_admin());

-- martai_app_state: allows anon app to read/write the shared app state
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

-- === REVOKE ANON DIRECT TABLE ACCESS ===
revoke all on public.customers         from anon;
revoke all on public.credits           from anon;
revoke all on public.sales             from anon;
revoke all on public.daily_sales       from anon;
revoke all on public.party_payments    from anon;
revoke all on public.cheques           from anon;
revoke all on public.estimate_bills    from anon;
revoke all on public.activity          from anon;
revoke all on public.login_events      from anon;
revoke all on public.customer_sessions from anon;
revoke all on public.login_attempts    from anon;
revoke all on public.payment_requests  from anon;
revoke all on public.mart_admins       from anon;
revoke all on public.mart_settings     from anon;
revoke all on public.mart_stores       from anon;
revoke all on public.mart_staff        from anon;
revoke all on public.mart_store_admins from anon;

-- === GRANT PERMISSIONS ===
-- Anon: customer RPCs and app state access
grant execute on function public.customer_login(text,text)          to anon;
grant execute on function public.customer_portal(text)              to anon;
grant execute on function public.customer_update_pin(text,text)     to anon;
grant execute on function public.update_customer_photo(text,text)   to anon;
grant execute on function public.customer_update_avatar(text,text)  to anon;
grant execute on function public.public_store_info()                 to anon;
grant execute on function public.customer_request_payment(text,numeric,text,text,text) to anon;
grant select, insert, update on public.martai_app_state to anon;

-- Authenticated: admin and lookup functions
grant execute on function public.record_admin_login(text)           to authenticated;
grant execute on function public.hash_pin(text)                     to authenticated;
grant execute on function public.is_mart_admin()                    to authenticated;
grant execute on function public.is_mart_staff()                    to authenticated;
grant execute on function public.is_store_admin(uuid)               to authenticated;
grant execute on function public.admin_add_staff(text,text)         to authenticated;
grant execute on function public.admin_set_staff_active(text,boolean) to authenticated;
grant execute on function public.admin_create_store(text,text,text) to authenticated;
grant execute on function public.admin_delete_store(uuid)           to authenticated;

-- Authenticated: table access (RLS policies above restrict what each role can actually do)
grant select, insert, update, delete on public.mart_settings     to authenticated;
grant select, insert, update, delete on public.mart_stores       to authenticated;
grant select, insert, update, delete on public.mart_store_admins to authenticated;
grant select, insert, update          on public.mart_staff        to authenticated;
grant select, insert, update, delete on public.customers         to authenticated;
grant select, insert, update, delete on public.credits           to authenticated;
grant select, insert, update, delete on public.sales             to authenticated;
grant select, insert, update, delete on public.daily_sales       to authenticated;
grant select, insert, update, delete on public.party_payments    to authenticated;
grant select, insert, update, delete on public.cheques           to authenticated;
grant select, insert, update, delete on public.estimate_bills    to authenticated;
grant select, insert, update, delete on public.activity          to authenticated;
grant select                          on public.login_events      to authenticated;
grant select, insert, update, delete on public.payment_requests  to authenticated;

-- === REALTIME (live multi-device sync) ===
-- Adds business tables to the supabase_realtime publication so open
-- dashboards receive live change events. Safe to re-run.
do $$
declare t text;
begin
  foreach t in array array['customers','credits','sales','daily_sales','party_payments','cheques','estimate_bills','payment_requests','mart_stores']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already in the publication
      when undefined_object then null;   -- publication missing (non-Supabase Postgres)
    end;
  end loop;
end $$;

-- Force PostgREST to reload new tables, columns and functions immediately
select pg_notify('pgrst', 'reload schema');
