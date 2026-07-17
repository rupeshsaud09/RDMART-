-- ============================================================
-- ADD STAFF TASKS — run once in Supabase SQL Editor
-- ============================================================
-- Adds the mart_tasks table: admin (or store admin) assigns a task
-- to one staff member (or leaves it blank to broadcast to every
-- active staff account), staff mark it done, and the dashboard
-- shows the admin which tasks are freshly completed and unread
-- (ack_by_admin) until they open the Tasks page.
-- Safe to re-run.
-- ============================================================

create table if not exists public.mart_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  legacy_id text unique,
  store_id uuid references public.mart_stores(id) on delete restrict,
  title text not null,
  description text default '',
  assigned_to_email text default '',
  assigned_to_name text default '',
  priority text not null default 'normal',
  due_date date,
  status text not null default 'pending',
  created_by text default '',
  completed_at timestamptz,
  completed_by text default '',
  ack_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mart_tasks_store_id_idx on public.mart_tasks(store_id);
create index if not exists mart_tasks_status_idx on public.mart_tasks(status);
create index if not exists mart_tasks_assigned_to_idx on public.mart_tasks(assigned_to_email);

-- === ROW LEVEL SECURITY ===
-- Same trust model as the rest of the app: admin has full control, any
-- active staff account can read and update (mark done / reopen) tasks,
-- but only admin/store admin can create or delete an assignment.
alter table public.mart_tasks enable row level security;

drop policy if exists "admins manage tasks"    on public.mart_tasks;
drop policy if exists "staff use tasks"        on public.mart_tasks;
drop policy if exists "staff update tasks"     on public.mart_tasks;
drop policy if exists "store admins use tasks" on public.mart_tasks;
create policy "admins manage tasks"    on public.mart_tasks for all    to authenticated using (public.is_mart_admin())          with check (public.is_mart_admin());
create policy "staff use tasks"        on public.mart_tasks for select to authenticated using (public.is_mart_staff());
create policy "staff update tasks"     on public.mart_tasks for update to authenticated using (public.is_mart_staff())         with check (public.is_mart_staff());
create policy "store admins use tasks" on public.mart_tasks for all    to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));

-- === PERMISSIONS ===
revoke all on public.mart_tasks from anon;
grant select, insert, update, delete on public.mart_tasks to authenticated;

-- === REALTIME (live multi-device sync) ===
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.mart_tasks';
  exception
    when duplicate_object then null;   -- already in the publication
    when undefined_object then null;   -- publication missing (non-Supabase Postgres)
  end;
end $$;

-- Force PostgREST to pick up the new table immediately
select pg_notify('pgrst', 'reload schema');
