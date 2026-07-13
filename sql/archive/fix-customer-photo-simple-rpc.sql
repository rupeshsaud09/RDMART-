-- ============================================================
-- SUPERSEDED — DO NOT RUN THIS FILE.
-- Everything here is already included (in corrected form) in
-- ../setup-complete.sql. Re-running this file can silently
-- regress the database (older function versions, wrong unique
-- constraints). Kept for historical reference only.
-- ============================================================

-- Alternative profile photo upload RPC with simple argument names.
-- Run this in Supabase SQL Editor if customer_update_avatar is still not found.

alter table public.customers
add column if not exists avatar_data text default '';

create or replace function public.update_customer_photo(token text, image text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if image is null
    or image !~ '^data:image/(jpeg|jpg|png|webp);base64,'
    or length(image) > 700000 then
    raise exception 'Profile picture must be a small JPG, PNG, or WebP image';
  end if;

  cid := public.customer_session_customer_id(token);
  if cid is null then
    raise exception 'Invalid session';
  end if;

  update public.customers
  set avatar_data = image,
      updated_at = now()
  where id = cid;
end;
$$;

grant execute on function public.update_customer_photo(text,text) to anon;

select pg_notify('pgrst', 'reload schema');

select
  p.proname,
  p.proargnames,
  pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'update_customer_photo';

