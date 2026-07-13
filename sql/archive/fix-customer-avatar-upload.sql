-- ============================================================
-- SUPERSEDED — DO NOT RUN THIS FILE.
-- Everything here is already included (in corrected form) in
-- ../setup-complete.sql. Re-running this file can silently
-- regress the database (older function versions, wrong unique
-- constraints). Kept for historical reference only.
-- ============================================================

-- Fix profile photo upload RPC lookup:
-- Could not find public.customer_update_avatar(avatar_data_input, raw_token)
-- Run this in Supabase SQL Editor.

alter table public.customers
add column if not exists avatar_data text default '';

drop function if exists public.customer_update_avatar(text,text);

create function public.customer_update_avatar(avatar_data_input text, raw_token text)
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

grant execute on function public.customer_update_avatar(text,text) to anon;

select pg_notify('pgrst', 'reload schema');

-- This must show one row with argument names:
-- {avatar_data_input,raw_token}
select
  p.proname,
  p.proargnames,
  pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'customer_update_avatar';
