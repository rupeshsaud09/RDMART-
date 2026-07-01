-- Add admin/customer login history to an existing RD MART Supabase project.
-- Run this in Supabase SQL Editor, then redeploy the app files.

create table if not exists public.login_events (
  id uuid primary key default extensions.gen_random_uuid(),
  login_role text not null check (login_role in ('admin','customer')),
  customer_id uuid references public.customers(id) on delete set null,
  display_name text not null default '',
  phone text default '',
  email text default '',
  created_at timestamptz not null default now()
);

alter table public.login_events enable row level security;

drop policy if exists "admins read login events" on public.login_events;
create policy "admins read login events" on public.login_events
for select to authenticated
using (public.is_mart_admin());

revoke all on public.login_events from anon;
grant select on public.login_events to authenticated;

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

grant execute on function public.customer_login(text,text) to anon;
grant execute on function public.record_admin_login(text) to authenticated;

