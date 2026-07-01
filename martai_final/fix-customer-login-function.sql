-- Fix customer login ambiguity error:
-- column reference "phone" is ambiguous
-- Run this in Supabase SQL Editor.

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

  return query select raw_token, c.id, c.name, c.phone;
end;
$$;

grant execute on function public.customer_login(text,text) to anon;

