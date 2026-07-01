-- Add customer profile pictures to an existing RD MART Supabase project.
-- Run this once in Supabase SQL Editor.

alter table public.customers
add column if not exists avatar_data text default '';

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

grant execute on function public.customer_update_avatar(text,text) to anon;
