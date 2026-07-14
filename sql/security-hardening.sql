-- ============================================================
-- RD MART emergency security hardening
-- Run once in Supabase Dashboard -> SQL Editor as the project owner.
-- Safe to re-run. It does not delete the legacy row or business records.
-- After this succeeds, re-run setup-complete.sql for all current protections.
-- ============================================================

begin;

-- The legacy JSON state can contain plaintext local-mode credentials.
drop policy if exists "martai app can read state" on public.martai_app_state;
drop policy if exists "martai app can insert state" on public.martai_app_state;
drop policy if exists "martai app can update state" on public.martai_app_state;
drop policy if exists "admins manage legacy app state" on public.martai_app_state;
revoke all on public.martai_app_state from anon;
revoke all on public.martai_app_state from public;

create policy "admins manage legacy app state" on public.martai_app_state
  for all to authenticated
  using (public.is_mart_admin())
  with check (public.is_mart_admin());
grant select, insert, update, delete on public.martai_app_state to authenticated;

-- Remove PostgreSQL's default PUBLIC function execution and rebuild the
-- explicit API allowlist used by this application.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;

grant execute on function public.customer_login(text,text) to anon;
grant execute on function public.customer_portal(text) to anon;
grant execute on function public.customer_update_pin(text,text) to anon;
grant execute on function public.update_customer_photo(text,text) to anon;
grant execute on function public.customer_update_avatar(text,text) to anon;
grant execute on function public.public_store_info() to anon;
grant execute on function public.customer_request_payment(text,numeric,text,text,text) to anon;

grant execute on function public.record_admin_login(text) to authenticated;
grant execute on function public.hash_pin(text) to authenticated;
grant execute on function public.is_mart_admin() to authenticated;
grant execute on function public.is_mart_staff() to authenticated;
grant execute on function public.is_store_admin(uuid) to authenticated;
grant execute on function public.admin_add_staff(text,text) to authenticated;
grant execute on function public.admin_set_staff_active(text,boolean) to authenticated;
grant execute on function public.admin_create_store(text,text,text) to authenticated;
grant execute on function public.admin_delete_store(uuid) to authenticated;

commit;

-- Expected result: anon_has_legacy_state_access = false
select has_table_privilege('anon', 'public.martai_app_state', 'select')
  as anon_has_legacy_state_access;
