-- ============================================================
-- ADD PUSH SUBSCRIPTIONS — run once in Supabase SQL Editor
-- ============================================================
-- Stores one row per phone/browser that has enabled the daily
-- business summary notification. A scheduled server job (Vercel
-- Cron, see api/daily-summary.js) reads these rows once a day
-- using the service-role key and sends a Web Push notification
-- to each one. The browser can only ever see or manage its own
-- device's row (RLS below); admins can see how many devices are
-- registered for their store but not the raw push keys of others.
-- Safe to re-run.
-- ============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.mart_stores(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_notified_at timestamptz,
  last_error text default ''
);

create index if not exists push_subscriptions_store_id_idx on public.push_subscriptions(store_id);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

-- === ROW LEVEL SECURITY ===
-- A signed-in owner (admin or store admin) can register/remove their own
-- device only. Nobody can read another person's endpoint/keys through the
-- anon+bearer path — only the server-side service-role key (used solely by
-- the scheduled daily-summary job, never sent to a browser) can read every
-- row in order to deliver the notification.
alter table public.push_subscriptions enable row level security;

drop policy if exists "owner manages own push subscription" on public.push_subscriptions;
drop policy if exists "admins count store subscriptions"     on public.push_subscriptions;
create policy "owner manages own push subscription" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (public.is_mart_admin() or public.is_store_admin(store_id)));

-- === PERMISSIONS ===
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Force PostgREST to pick up the new table immediately
select pg_notify('pgrst', 'reload schema');
