-- ============================================================================
-- RD MART / KHATA PANA - CHEQUE LIFECYCLE, AUDIT AND AI-READINESS UPGRADE
-- Version: 2026-07-20
--
-- Run after sql/setup-complete.sql in the Supabase SQL editor.
-- This migration is additive and safe to re-run. It deliberately keeps the
-- legacy `cheques.status` (hold/clear/bounce) and `cheques.cheque_date` fields
-- synchronized so deployed clients continue to work while new clients use the
-- richer lifecycle model.
--
-- Important migration principles:
--   * No historical status events are invented. Existing current status is
--     projected into lifecycle_status, but the event timeline begins only when
--     this migration is installed.
--   * Unknown direction/source/currency data remains unknown on existing rows.
--   * AI/risk output is stored as an immutable, non-authoritative snapshot and
--     never overwrites factual cheque fields.
--   * Financial/terminal transitions exposed by the new RPC require an
--     authenticated user's explicit confirmation; bounce/cancel also require a
--     reason. Legacy direct writes remain readable and auditable for backwards
--     compatibility, but upgraded clients must use transition_cheque().
--   * Important cheque rows are soft-deleted. Direct hard deletion is blocked
--     for API users and retained only for database/service recovery operators.
-- ============================================================================

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Fail early with an actionable message instead of partially installing against
-- an uninitialized database. The surrounding transaction makes every change
-- below atomic.
do $$
begin
  if to_regclass('public.cheques') is null
     or to_regclass('public.mart_stores') is null
     or to_regclass('public.mart_staff') is null
     or to_regclass('public.parties') is null
     or to_regclass('public.customers') is null
     or to_regclass('public.credits') is null
     or to_regclass('public.party_payments') is null
     or to_regclass('public.sales') is null then
    raise exception using
      errcode = '55000',
      message = 'Run sql/setup-complete.sql before upgrade-cheque-lifecycle-ai.sql';
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- 1. EXPLICIT STAFF-TO-STORE MEMBERSHIP
-- --------------------------------------------------------------------------

create table if not exists public.mart_staff_store_access (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.mart_stores(id) on delete cascade,
  staff_user_id uuid not null references public.mart_staff(user_id) on delete cascade,
  access_role text not null default 'operator'
    check (access_role in ('viewer', 'operator', 'manager')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (store_id, staff_user_id)
);

comment on table public.mart_staff_store_access is
  'Explicit store scope for staff. New cheque RLS never infers cross-store access.';
comment on column public.mart_staff_store_access.access_role is
  'Cheque workspace role only; it does not grant mart admin or store admin rights.';

-- A sole active store is unambiguous and preserves access for existing staff.
-- With two or more active stores, no assignment is guessed: an admin must insert
-- the correct memberships before those staff can access cheque data.
insert into public.mart_staff_store_access (store_id, staff_user_id, access_role)
select s.id, ms.user_id, 'operator'
from public.mart_stores s
cross join public.mart_staff ms
where s.is_active = true
  and ms.is_active = true
  and (select count(*) from public.mart_stores where is_active = true) = 1
on conflict (store_id, staff_user_id) do nothing;

create index if not exists mart_staff_store_access_user_idx
  on public.mart_staff_store_access(staff_user_id, store_id);

-- --------------------------------------------------------------------------
-- 2. BACKWARDS-COMPATIBLE FACTUAL CHEQUE FIELDS
-- --------------------------------------------------------------------------

alter table public.cheques add column if not exists lifecycle_status text;
alter table public.cheques add column if not exists direction text;
alter table public.cheques add column if not exists party_id uuid;
alter table public.cheques add column if not exists customer_id uuid;
alter table public.cheques add column if not exists drawer_name text;
alter table public.cheques add column if not exists payee_name text;
alter table public.cheques add column if not exists amount_in_words text;
alter table public.cheques add column if not exists signature_present boolean;
alter table public.cheques add column if not exists visible_correction_present boolean;
alter table public.cheques add column if not exists verification_notes text;
alter table public.cheques add column if not exists verified_at timestamptz;
alter table public.cheques add column if not exists verified_by uuid;
alter table public.cheques add column if not exists bank_branch text;
alter table public.cheques add column if not exists instrument_type text;
alter table public.cheques add column if not exists currency_code text;
alter table public.cheques add column if not exists issue_date date;
alter table public.cheques add column if not exists due_date date;
alter table public.cheques add column if not exists deposit_date date;
alter table public.cheques add column if not exists written_at timestamptz;
alter table public.cheques add column if not exists issued_at timestamptz;
alter table public.cheques add column if not exists received_at timestamptz;
alter table public.cheques add column if not exists deposited_at timestamptz;
alter table public.cheques add column if not exists cleared_at timestamptz;
alter table public.cheques add column if not exists bounced_at timestamptz;
alter table public.cheques add column if not exists cancelled_at timestamptz;
alter table public.cheques add column if not exists clearing_reference text;
alter table public.cheques add column if not exists bounce_reason text;
alter table public.cheques add column if not exists cancellation_reason text;
alter table public.cheques add column if not exists assigned_to uuid;
alter table public.cheques add column if not exists source text;
alter table public.cheques add column if not exists source_reference text;
alter table public.cheques add column if not exists last_follow_up_at timestamptz;
alter table public.cheques add column if not exists next_action_at timestamptz;
alter table public.cheques add column if not exists version integer not null default 1;
alter table public.cheques add column if not exists deleted_at timestamptz;
alter table public.cheques add column if not exists deleted_by uuid;
alter table public.cheques add column if not exists deletion_reason text;

-- Exact projections from fields that already existed. These are current-state
-- conversions, not synthetic event history.
update public.cheques
set lifecycle_status = case status
  when 'clear' then 'cleared'
  when 'bounce' then 'bounced'
  else 'hold'
end
where lifecycle_status is null;

update public.cheques
set due_date = cheque_date
where due_date is null;

-- Some intermediate clients used `unknown`; normalize it to the canonical
-- explicit-unknown value before the constraint is installed.
update public.cheques
set direction = 'unspecified'
where direction = 'unknown';

-- Defaults apply to future inserts only. Existing unknown facts stay NULL.
alter table public.cheques alter column lifecycle_status set default 'hold';
alter table public.cheques alter column lifecycle_status set not null;
alter table public.cheques alter column direction set default 'unspecified';
alter table public.cheques alter column instrument_type set default 'unspecified';
alter table public.cheques alter column currency_code set default 'NPR';
alter table public.cheques alter column source set default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_lifecycle_status_check'
  ) then
    alter table public.cheques add constraint cheques_lifecycle_status_check
      check (lifecycle_status in (
        'draft', 'to_write', 'written', 'issued', 'received', 'deposited',
        'hold', 'cleared', 'bounced', 'cancelled', 'overdue'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_direction_check'
  ) then
    alter table public.cheques add constraint cheques_direction_check
      check (direction is null or direction in ('incoming', 'outgoing', 'unspecified'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_instrument_type_check'
  ) then
    alter table public.cheques add constraint cheques_instrument_type_check
      check (instrument_type is null or instrument_type in (
        'bearer', 'account_payee', 'crossed', 'order', 'other', 'unspecified'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_currency_code_check'
  ) then
    alter table public.cheques add constraint cheques_currency_code_check
      check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_source_check'
  ) then
    alter table public.cheques add constraint cheques_source_check
      check (source is null or source in ('manual', 'import', 'api', 'ocr_confirmed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_observation_text_check'
  ) then
    alter table public.cheques add constraint cheques_observation_text_check
      check (
        (amount_in_words is null or length(amount_in_words) <= 500)
        and (verification_notes is null or length(verification_notes) <= 1000)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_observation_verifier_check'
  ) then
    alter table public.cheques add constraint cheques_observation_verifier_check
      check (
        (signature_present is null and visible_correction_present is null)
        or (verified_at is not null and verified_by is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_version_check'
  ) then
    alter table public.cheques add constraint cheques_version_check
      check (version > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_issue_due_order_check'
  ) then
    alter table public.cheques add constraint cheques_issue_due_order_check
      check (issue_date is null or due_date is null or issue_date <= due_date);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_soft_delete_check'
  ) then
    alter table public.cheques add constraint cheques_soft_delete_check
      check (
        deleted_at is null
        or (deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) >= 3)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_party_id_fkey'
  ) then
    alter table public.cheques add constraint cheques_party_id_fkey
      foreign key (party_id) references public.parties(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_customer_id_fkey'
  ) then
    alter table public.cheques add constraint cheques_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_assigned_to_fkey'
  ) then
    alter table public.cheques add constraint cheques_assigned_to_fkey
      foreign key (assigned_to) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_deleted_by_fkey'
  ) then
    alter table public.cheques add constraint cheques_deleted_by_fkey
      foreign key (deleted_by) references auth.users(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheques'::regclass
      and conname = 'cheques_verified_by_fkey'
  ) then
    alter table public.cheques add constraint cheques_verified_by_fkey
      foreign key (verified_by) references auth.users(id) on delete restrict;
  end if;
end
$$;

comment on column public.cheques.lifecycle_status is
  'Rich workflow status. A trigger projects this to legacy status for old clients.';
comment on column public.cheques.direction is
  'incoming/outgoing; unspecified or NULL means the fact was not captured.';
comment on column public.cheques.due_date is
  'Canonical AD due date, synchronized with legacy cheque_date; the UI derives Nepali BS display.';
comment on column public.cheques.deposit_date is
  'Transitional factual calendar-date alias; deposited_at retains the optional exact event time.';
comment on column public.cheques.drawer_name is
  'Account holder/drawer name as printed on the cheque, once manually entered or user-approved.';
comment on column public.cheques.source is
  'How factual fields entered the system. OCR is only ocr_confirmed after user review.';
comment on column public.cheques.signature_present is
  'Nullable user-verified observation; NULL means not checked, not false.';
comment on column public.cheques.visible_correction_present is
  'Nullable user-verified observation; AI may suggest it but cannot save it automatically.';
comment on column public.cheques.version is
  'Optimistic-concurrency counter incremented on every update.';
comment on column public.cheques.deleted_at is
  'Soft-delete timestamp. Important cheque records are not removed by normal API users.';

create unique index if not exists cheques_store_id_id_uidx
  on public.cheques(store_id, id);
create unique index if not exists customers_store_id_id_uidx
  on public.customers(store_id, id);
create unique index if not exists parties_store_id_id_uidx
  on public.parties(store_id, id);
create index if not exists cheques_active_lifecycle_due_idx
  on public.cheques(store_id, lifecycle_status, due_date)
  where deleted_at is null;
create index if not exists cheques_active_next_action_idx
  on public.cheques(store_id, next_action_at)
  where deleted_at is null and next_action_at is not null;
create index if not exists cheques_active_assignee_idx
  on public.cheques(store_id, assigned_to, lifecycle_status)
  where deleted_at is null;
create index if not exists cheques_party_lookup_idx
  on public.cheques(store_id, lower(party));
create index if not exists cheques_number_lookup_idx
  on public.cheques(store_id, lower(cheque_no));
create index if not exists cheques_anomaly_amount_date_idx
  on public.cheques(store_id, amount, due_date)
  where deleted_at is null;

-- --------------------------------------------------------------------------
-- 3. SAFE ACCESS, PROJECTION AND FILTER HELPERS
-- --------------------------------------------------------------------------

-- Keep the established helper signature, but inactive stores must not continue
-- granting their store-admin access to financial rows.
create or replace function public.is_store_admin(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.mart_store_admins a
    join public.mart_stores s on s.id = a.store_id and s.is_active = true
    where a.store_id = target_store and a.user_id = auth.uid()
  );
$$;

create or replace function public.has_staff_store_access(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select target_store is not null
    and public.is_mart_staff()
    and exists (
      select 1
      from public.mart_staff_store_access a
      join public.mart_stores s on s.id = a.store_id and s.is_active = true
      where a.store_id = target_store
        and a.staff_user_id = auth.uid()
    );
$$;

create or replace function public.can_access_cheque_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.is_mart_admin()
    or (
      target_store is not null
      and (
        public.is_store_admin(target_store)
        or public.has_staff_store_access(target_store)
      )
    );
$$;

create or replace function public.can_manage_cheque_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.is_mart_admin()
    or (
      target_store is not null
      and (
        public.is_store_admin(target_store)
        or (
          public.is_mart_staff()
          and exists (
            select 1
            from public.mart_staff_store_access a
            where a.store_id = target_store
              and a.staff_user_id = auth.uid()
              and a.access_role in ('operator', 'manager')
          )
        )
      )
    );
$$;

create or replace function public.can_manage_active_cheque(target_store uuid, target_cheque uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.can_manage_cheque_store(target_store)
    and exists (
      select 1
      from public.cheques c
      where c.store_id = target_store
        and c.id = target_cheque
        and c.deleted_at is null
    );
$$;

create or replace function public.cheque_legacy_status(target_lifecycle text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  select case target_lifecycle
    when 'cleared' then 'clear'
    when 'bounced' then 'bounce'
    else 'hold'
  end;
$$;

create or replace function public.cheque_lifecycle_from_legacy(target_status text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  select case target_status
    when 'clear' then 'cleared'
    when 'bounce' then 'bounced'
    else 'hold'
  end;
$$;

create or replace function public.is_safe_cheque_filter(candidate jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_typeof(candidate) = 'object', false)
    and octet_length(candidate::text) <= 16384
    and not exists (
      select 1
      from jsonb_object_keys(candidate) as key_name
      where key_name not in (
        'statuses', 'directions', 'banks', 'party', 'search',
        'amount_min', 'amount_max', 'due_from', 'due_to',
        'risk_levels', 'assigned_to', 'overdue', 'smart_view',
        'include_deleted', 'sort', 'sort_direction'
      )
    )
    and (not (candidate ? 'statuses') or (
      jsonb_typeof(candidate -> 'statuses') = 'array'
      and jsonb_array_length(candidate -> 'statuses') <= 11
    ))
    and (not (candidate ? 'directions') or (
      jsonb_typeof(candidate -> 'directions') = 'array'
      and jsonb_array_length(candidate -> 'directions') <= 3
    ))
    and (not (candidate ? 'banks') or (
      jsonb_typeof(candidate -> 'banks') = 'array'
      and jsonb_array_length(candidate -> 'banks') <= 50
    ))
    and (not (candidate ? 'risk_levels') or (
      jsonb_typeof(candidate -> 'risk_levels') = 'array'
      and jsonb_array_length(candidate -> 'risk_levels') <= 4
    ))
    and (not (candidate ? 'party') or (
      jsonb_typeof(candidate -> 'party') = 'string'
      and length(candidate ->> 'party') <= 200
    ))
    and (not (candidate ? 'search') or (
      jsonb_typeof(candidate -> 'search') = 'string'
      and length(candidate ->> 'search') <= 200
    ))
    and (not (candidate ? 'amount_min') or jsonb_typeof(candidate -> 'amount_min') = 'number')
    and (not (candidate ? 'amount_max') or jsonb_typeof(candidate -> 'amount_max') = 'number')
    and (not (candidate ? 'overdue') or jsonb_typeof(candidate -> 'overdue') = 'boolean')
    and (not (candidate ? 'include_deleted') or jsonb_typeof(candidate -> 'include_deleted') = 'boolean')
    and (not (candidate ? 'due_from') or candidate ->> 'due_from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    and (not (candidate ? 'due_to') or candidate ->> 'due_to' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    and (not (candidate ? 'sort') or candidate ->> 'sort' in (
      'due_date', 'amount', 'party', 'bank', 'lifecycle_status',
      'risk_score', 'next_action_at', 'created_at'
    ))
    and (not (candidate ? 'sort_direction') or candidate ->> 'sort_direction' in ('asc', 'desc'))
    and (not (candidate ? 'smart_view') or candidate ->> 'smart_view' in (
      'action_needed', 'due_today', 'upcoming', 'to_write', 'deposited',
      'hold', 'cleared', 'bounced', 'all'
    ));
$$;

create or replace function public.is_valid_cheque_transition(from_status text, to_status text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case from_status
    when 'draft' then to_status in ('to_write', 'cancelled')
    when 'to_write' then to_status in ('written', 'cancelled')
    when 'written' then to_status in ('issued', 'received', 'deposited', 'hold', 'cancelled')
    when 'issued' then to_status in ('hold', 'deposited', 'cleared', 'bounced', 'cancelled', 'overdue')
    when 'received' then to_status in ('deposited', 'hold', 'cleared', 'bounced', 'cancelled', 'overdue')
    when 'deposited' then to_status in ('hold', 'cleared', 'bounced', 'overdue')
    when 'hold' then to_status in ('issued', 'received', 'deposited', 'cleared', 'bounced', 'cancelled', 'overdue')
    when 'overdue' then to_status in ('hold', 'deposited', 'cleared', 'bounced', 'cancelled')
    else false
  end;
$$;

create or replace function public.cheque_actor_role(target_store uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when public.is_mart_admin() then 'mart_admin'
    when target_store is not null and public.is_store_admin(target_store) then 'store_admin'
    when target_store is not null and public.has_staff_store_access(target_store) then 'staff'
    when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then 'service_role'
    else 'unknown'
  end;
$$;

-- Preserve the existing RPC signature while making store removal compatible
-- with immutable cheque audit history. The current application already queries
-- only active stores, so callers see the same removal outcome without destroying
-- financial records. A mart admin can recover a store by setting is_active=true.
create or replace function public.admin_delete_store(store_input uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_store_count integer;
begin
  if not public.is_mart_admin() then
    raise exception using errcode = '42501', message = 'Only the main admin can archive stores';
  end if;

  select count(*) into active_store_count
  from public.mart_stores
  where is_active = true;

  if active_store_count <= 1 then
    raise exception using errcode = '55000', message = 'You must keep at least one active store';
  end if;

  update public.mart_stores
  set is_active = false, updated_at = now()
  where id = store_input and is_active = true;

  if not found then
    raise exception using errcode = 'P0002', message = 'Active store not found';
  end if;
end;
$$;

comment on function public.admin_delete_store(uuid) is
  'Backwards-compatible store removal RPC; deactivates instead of deleting financial history.';

-- --------------------------------------------------------------------------
-- 4. APPEND-ONLY AUDIT / STATUS TIMELINE
-- --------------------------------------------------------------------------

create table if not exists public.cheque_events (
  id uuid primary key default extensions.gen_random_uuid(),
  -- NULL is retained only for pre-existing orphaned legacy cheques. RLS exposes
  -- those events to mart admins only; every new child/workflow row requires a store.
  store_id uuid,
  cheque_id uuid not null,
  event_type text not null check (event_type in (
    'created', 'updated', 'status_changed', 'soft_deleted', 'restored',
    'note_added', 'followup_logged', 'reminder_created', 'reminder_updated',
    'attachment_registered', 'risk_snapshot_created', 'payment_recorded',
    'payment_confirmed', 'payment_reversed', 'allocation_created', 'allocation_removed'
  )),
  from_status text,
  to_status text,
  reason text,
  confirmed_by_user boolean not null default false,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text not null default 'unknown',
  source text not null default 'direct',
  correlation_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint cheque_events_cheque_id_fkey
    foreign key (cheque_id)
    references public.cheques(id) on delete restrict,
  constraint cheque_events_cheque_fkey
    foreign key (store_id, cheque_id)
    references public.cheques(store_id, id) on delete restrict,
  constraint cheque_events_details_check
    check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 16384),
  constraint cheque_events_reason_check
    check (reason is null or length(reason) <= 500),
  constraint cheque_events_correlation_check
    check (correlation_id is null or length(correlation_id) <= 128)
);

comment on table public.cheque_events is
  'Immutable authoritative audit timeline. Existing rows are intentionally not backfilled.';
comment on column public.cheque_events.confirmed_by_user is
  'True only when the transition RPC received explicit confirmation from an authenticated user.';

create index if not exists cheque_events_timeline_idx
  on public.cheque_events(store_id, cheque_id, created_at desc);
create index if not exists cheque_events_store_recent_idx
  on public.cheque_events(store_id, created_at desc);

create or replace function public.prevent_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only; create a compensating event instead', tg_table_name);
end;
$$;

drop trigger if exists cheque_events_append_only_guard on public.cheque_events;
create trigger cheque_events_append_only_guard
before update or delete on public.cheque_events
for each row execute function public.prevent_append_only_mutation();

create or replace function public.write_cheque_event(
  p_store_id uuid,
  p_cheque_id uuid,
  p_event_type text,
  p_from_status text default null,
  p_to_status text default null,
  p_reason text default null,
  p_confirmed boolean default false,
  p_source text default 'direct',
  p_correlation_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_id uuid;
begin
  if p_cheque_id is null then
    raise exception using errcode = '23502', message = 'Cheque event requires cheque_id';
  end if;

  insert into public.cheque_events (
    store_id, cheque_id, event_type, from_status, to_status, reason,
    confirmed_by_user, actor_user_id, actor_role, source, correlation_id, details
  ) values (
    p_store_id,
    p_cheque_id,
    p_event_type,
    p_from_status,
    p_to_status,
    nullif(trim(coalesce(p_reason, '')), ''),
    coalesce(p_confirmed, false),
    auth.uid(),
    public.cheque_actor_role(p_store_id),
    left(coalesce(nullif(trim(p_source), ''), 'direct'), 40),
    nullif(left(trim(coalesce(p_correlation_id, '')), 128), ''),
    coalesce(p_details, '{}'::jsonb)
  ) returning id into event_id;

  return event_id;
end;
$$;

-- --------------------------------------------------------------------------
-- 5. NOTES, FOLLOW-UPS, REMINDERS AND PRIVATE ATTACHMENT METADATA
-- --------------------------------------------------------------------------

create table if not exists public.cheque_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null,
  cheque_id uuid not null,
  note_type text not null default 'general'
    check (note_type in ('general', 'internal', 'bank', 'party')),
  body text not null check (length(trim(body)) between 1 and 4000),
  is_pinned boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint cheque_notes_cheque_fkey
    foreign key (store_id, cheque_id)
    references public.cheques(store_id, id) on delete restrict
);

create table if not exists public.cheque_followups (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null,
  cheque_id uuid not null,
  channel text not null check (channel in (
    'phone', 'whatsapp', 'sms', 'email', 'in_person', 'other'
  )),
  contact_direction text not null default 'outbound'
    check (contact_direction in ('outbound', 'inbound')),
  outcome text not null default 'contacted'
    check (outcome in ('contacted', 'no_answer', 'promised', 'disputed', 'resolved', 'other')),
  note text check (note is null or length(note) <= 4000),
  contacted_at timestamptz not null default now(),
  next_follow_up_at timestamptz
    check (next_follow_up_at is null or next_follow_up_at > contacted_at),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint cheque_followups_cheque_fkey
    foreign key (store_id, cheque_id)
    references public.cheques(store_id, id) on delete restrict
);

create table if not exists public.cheque_reminders (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null,
  cheque_id uuid not null,
  reminder_type text not null default 'follow_up'
    check (reminder_type in ('follow_up', 'deposit', 'due', 'collection', 'review', 'other')),
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'snoozed', 'done', 'cancelled')),
  message text check (message is null or length(message) <= 1000),
  assigned_to uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cheque_reminders_cheque_fkey
    foreign key (store_id, cheque_id)
    references public.cheques(store_id, id) on delete restrict
);

create table if not exists public.cheque_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null,
  cheque_id uuid not null,
  bucket_id text not null default 'cheque-attachments'
    check (bucket_id = 'cheque-attachments'),
  object_path text not null unique,
  original_filename text not null check (length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'clean', 'quarantined', 'rejected')),
  ocr_status text not null default 'not_requested'
    check (ocr_status in ('not_requested', 'pending', 'completed', 'failed')),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete restrict,
  deletion_reason text,
  constraint cheque_attachments_cheque_fkey
    foreign key (store_id, cheque_id)
    references public.cheques(store_id, id) on delete restrict,
  constraint cheque_attachments_path_check check (
    object_path like store_id::text || '/' || cheque_id::text || '/%'
    and position('..' in object_path) = 0
    and length(object_path) <= 1024
  ),
  constraint cheque_attachments_delete_check check (
    deleted_at is null
    or (deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) >= 3)
  )
);

comment on table public.cheque_attachments is
  'Metadata only. Binary files live in the private cheque-attachments Storage bucket.';
comment on column public.cheque_attachments.ocr_status is
  'OCR processing state only; extracted values must be previewed and confirmed before saving factual fields.';

create index if not exists cheque_notes_timeline_idx
  on public.cheque_notes(store_id, cheque_id, created_at desc);
create index if not exists cheque_followups_timeline_idx
  on public.cheque_followups(store_id, cheque_id, contacted_at desc);
create index if not exists cheque_reminders_due_idx
  on public.cheque_reminders(store_id, scheduled_for)
  where status in ('pending', 'snoozed');
create index if not exists cheque_attachments_cheque_idx
  on public.cheque_attachments(store_id, cheque_id, created_at desc)
  where deleted_at is null;
create index if not exists cheque_attachments_sha256_idx
  on public.cheque_attachments(store_id, sha256)
  where deleted_at is null and sha256 is not null;

drop trigger if exists cheque_notes_append_only_guard on public.cheque_notes;
create trigger cheque_notes_append_only_guard
before update or delete on public.cheque_notes
for each row execute function public.prevent_append_only_mutation();

drop trigger if exists cheque_followups_append_only_guard on public.cheque_followups;
create trigger cheque_followups_append_only_guard
before update or delete on public.cheque_followups
for each row execute function public.prevent_append_only_mutation();

-- --------------------------------------------------------------------------
-- 6. NON-AUTHORITATIVE RISK / ANOMALY SNAPSHOTS
-- --------------------------------------------------------------------------

create table if not exists public.cheque_risk_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null,
  cheque_id uuid not null,
  score_source text not null default 'deterministic'
    check (score_source in ('deterministic', 'manual_override')),
  explanation_source text not null default 'deterministic'
    check (explanation_source in ('deterministic', 'provider', 'manual')),
  provider_id text check (provider_id is null or length(provider_id) <= 80),
  model_id text check (model_id is null or length(model_id) <= 160),
  model_version text check (model_version is null or length(model_version) <= 80),
  risk_score smallint not null check (risk_score between 0 and 100),
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  factors jsonb not null default '[]'::jsonb,
  anomaly_flags jsonb not null default '[]'::jsonb,
  explanation text check (explanation is null or length(explanation) <= 4000),
  recommended_action text check (recommended_action is null or recommended_action in (
    'none', 'review', 'contact_party', 'deposit', 'hold', 'escalate'
  )),
  recommended_action_reason text
    check (recommended_action_reason is null or length(recommended_action_reason) <= 1000),
  input_fingerprint text check (
    input_fingerprint is null or input_fingerprint ~ '^(sha256:)?[a-f0-9]{64}$'
  ),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint cheque_risk_snapshots_cheque_fkey
    foreign key (store_id, cheque_id)
    references public.cheques(store_id, id) on delete restrict,
  constraint cheque_risk_factors_check check (
    jsonb_typeof(factors) = 'array'
    and jsonb_typeof(anomaly_flags) = 'array'
    and octet_length(factors::text) <= 16384
    and octet_length(anomaly_flags::text) <= 16384
  ),
  constraint cheque_risk_level_score_check check (
    (risk_level = 'low' and risk_score between 0 and 29)
    or (risk_level = 'medium' and risk_score between 30 and 59)
    or (risk_level = 'high' and risk_score between 60 and 79)
    or (risk_level = 'critical' and risk_score between 80 and 100)
  ),
  constraint cheque_risk_provider_check check (
    explanation_source <> 'provider' or provider_id is not null
  ),
  constraint cheque_risk_manual_override_check check (
    score_source <> 'manual_override'
    or (explanation_source = 'manual' and length(trim(coalesce(explanation, ''))) >= 3)
  )
);

comment on table public.cheque_risk_snapshots is
  'Immutable decision-support output. Scores are not facts and never trigger financial actions.';
comment on column public.cheque_risk_snapshots.score_source is
  'Core scores are deterministic unless a user explicitly records a manual override; providers cannot score.';
comment on column public.cheque_risk_snapshots.recommended_action is
  'Advisory only. The database never executes this recommendation.';
comment on column public.cheque_risk_snapshots.input_fingerprint is
  'Optional non-reversible fingerprint; raw prompts, full records and provider secrets must not be stored.';

create index if not exists cheque_risk_latest_idx
  on public.cheque_risk_snapshots(store_id, cheque_id, created_at desc);
create index if not exists cheque_risk_action_idx
  on public.cheque_risk_snapshots(store_id, risk_level, created_at desc);

drop trigger if exists cheque_risk_snapshots_append_only_guard on public.cheque_risk_snapshots;
create trigger cheque_risk_snapshots_append_only_guard
before update or delete on public.cheque_risk_snapshots
for each row execute function public.prevent_append_only_mutation();

create or replace view public.cheque_latest_risk
with (security_invoker = true)
as
select distinct on (store_id, cheque_id)
  id, store_id, cheque_id, score_source, explanation_source,
  provider_id, model_id, model_version,
  risk_score, risk_level, factors, anomaly_flags, explanation,
  recommended_action, recommended_action_reason,
  input_fingerprint, created_by, created_at
from public.cheque_risk_snapshots
order by store_id, cheque_id, created_at desc, id desc;

comment on view public.cheque_latest_risk is
  'RLS-respecting projection of the newest available risk snapshot per cheque.';

-- --------------------------------------------------------------------------
-- 7. FACTUAL PAYMENTS AND ALLOCATIONS
-- --------------------------------------------------------------------------

create table if not exists public.cheque_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null,
  cheque_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_date date not null default current_date,
  method text not null default 'cheque'
    check (method in ('cheque', 'bank_transfer', 'cash', 'adjustment', 'other')),
  reference text check (reference is null or length(reference) <= 255),
  note text check (note is null or length(note) <= 2000),
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'reversed')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cheque_payments_cheque_fkey
    foreign key (store_id, cheque_id)
    references public.cheques(store_id, id) on delete restrict,
  constraint cheque_payments_confirmation_check check (
    (status = 'draft' and confirmed_at is null and reversed_at is null)
    or (status = 'confirmed' and confirmed_by is not null and confirmed_at is not null and reversed_at is null)
    or (status = 'reversed' and confirmed_by is not null and confirmed_at is not null
        and reversed_by is not null and reversed_at is not null
        and length(trim(coalesce(reversal_reason, ''))) >= 3)
  )
);

create table if not exists public.cheque_payment_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null,
  payment_id uuid not null references public.cheque_payments(id) on delete restrict,
  credit_id uuid references public.credits(id) on delete restrict,
  party_payment_id uuid references public.party_payments(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete restrict,
  external_reference text,
  amount numeric(12,2) not null check (amount > 0),
  note text check (note is null or length(note) <= 1000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint cheque_payment_allocations_target_check check (
    num_nonnulls(credit_id, party_payment_id, sale_id, external_reference) = 1
  ),
  constraint cheque_payment_allocations_external_check check (
    external_reference is null or length(trim(external_reference)) between 1 and 255
  )
);

comment on table public.cheque_payments is
  'Factual settlement records. They begin as drafts and require an explicit RPC confirmation.';
comment on table public.cheque_payment_allocations is
  'Allocates a draft cheque payment to exactly one store-scoped accounting target.';

create unique index if not exists cheque_payments_store_id_id_uidx
  on public.cheque_payments(store_id, id);
create index if not exists cheque_payments_cheque_idx
  on public.cheque_payments(store_id, cheque_id, payment_date desc);
create index if not exists cheque_payment_allocations_payment_idx
  on public.cheque_payment_allocations(store_id, payment_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cheque_payment_allocations'::regclass
      and conname = 'cheque_payment_allocations_payment_store_fkey'
  ) then
    alter table public.cheque_payment_allocations
      add constraint cheque_payment_allocations_payment_store_fkey
      foreign key (store_id, payment_id)
      references public.cheque_payments(store_id, id) on delete restrict;
  end if;
end
$$;

create or replace function public.can_manage_active_cheque_payment(target_store uuid, target_payment uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.can_manage_cheque_store(target_store)
    and exists (
      select 1
      from public.cheque_payments p
      join public.cheques c on c.id = p.cheque_id and c.store_id = p.store_id
      where p.store_id = target_store
        and p.id = target_payment
        and c.deleted_at is null
    );
$$;

-- --------------------------------------------------------------------------
-- 8. SAVED SMART VIEWS (DECLARATIVE FILTERS ONLY; NEVER SQL)
-- --------------------------------------------------------------------------

create table if not exists public.cheque_saved_views (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.mart_stores(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  filters jsonb not null default '{}'::jsonb
    check (public.is_safe_cheque_filter(filters)),
  is_shared boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id, name)
);

comment on table public.cheque_saved_views is
  'Allowlisted JSON filter state only. Natural-language search must compile to this schema, never SQL.';

create unique index if not exists cheque_saved_views_one_default_uidx
  on public.cheque_saved_views(store_id, user_id)
  where is_default = true;
create index if not exists cheque_saved_views_store_idx
  on public.cheque_saved_views(store_id, is_shared, updated_at desc);

-- --------------------------------------------------------------------------
-- 9. ROW PREPARATION, STORE CONSISTENCY AND AUDIT TRIGGERS
-- --------------------------------------------------------------------------

create or replace function public.prepare_cheque_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  lifecycle_changed boolean := false;
  legacy_changed boolean := false;
begin
  if new.direction = 'unknown' then
    new.direction := 'unspecified';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.store_id is distinct from old.store_id
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '22000', message = 'Cheque identity, store and created_at are immutable';
    end if;

    if new.deleted_at is distinct from old.deleted_at then
      if old.deleted_at is null
         and coalesce(current_setting('martai.soft_delete_confirmed', true), '') <> 'true' then
        raise exception using errcode = '42501', message = 'Use soft_delete_cheque() with confirmation';
      elsif old.deleted_at is not null
         and new.deleted_at is null
         and coalesce(current_setting('martai.restore_confirmed', true), '') <> 'true' then
        raise exception using errcode = '42501', message = 'Use restore_cheque() with confirmation';
      end if;
    end if;

    lifecycle_changed := new.lifecycle_status is distinct from old.lifecycle_status;
    legacy_changed := new.status is distinct from old.status;

    -- New lifecycle wins if both representations were sent. Otherwise accept a
    -- legacy status-only update and map it into the richer state.
    if lifecycle_changed then
      new.status := public.cheque_legacy_status(new.lifecycle_status);
    elsif legacy_changed then
      new.lifecycle_status := public.cheque_lifecycle_from_legacy(new.status);
    else
      new.status := public.cheque_legacy_status(new.lifecycle_status);
    end if;

    if new.due_date is distinct from old.due_date
       and new.cheque_date is not distinct from old.cheque_date then
      new.cheque_date := new.due_date;
    elsif new.cheque_date is distinct from old.cheque_date
       and new.due_date is not distinct from old.due_date then
      new.due_date := new.cheque_date;
    elsif new.cheque_date is distinct from old.cheque_date
       and new.due_date is distinct from old.due_date
       and new.cheque_date is distinct from new.due_date then
      raise exception using errcode = '22000', message = 'due_date and legacy cheque_date disagree';
    end if;

  else
    if new.deleted_at is not null then
      raise exception using errcode = '42501', message = 'New cheques cannot be inserted as archived';
    end if;
    new.version := coalesce(new.version, 1);
    new.updated_at := coalesce(new.updated_at, now());
    new.lifecycle_status := coalesce(new.lifecycle_status, public.cheque_lifecycle_from_legacy(new.status));

    -- A legacy insert that explicitly sends clear/bounce must not be hidden by
    -- the lifecycle column's hold default.
    if new.lifecycle_status = 'hold' and new.status in ('clear', 'bounce') then
      new.lifecycle_status := public.cheque_lifecycle_from_legacy(new.status);
    end if;

    new.status := public.cheque_legacy_status(new.lifecycle_status);
    new.due_date := coalesce(new.due_date, new.cheque_date);
    new.cheque_date := coalesce(new.due_date, new.cheque_date);
  end if;

  if new.party_id is not null and not exists (
    select 1 from public.parties p
    where p.id = new.party_id and p.store_id = new.store_id
  ) then
    raise exception using errcode = '23514', message = 'party_id must belong to the cheque store';
  end if;

  if new.customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.store_id = new.store_id
  ) then
    raise exception using errcode = '23514', message = 'customer_id must belong to the cheque store';
  end if;

  if tg_op = 'UPDATE' then
    -- Legacy sync performs idempotent upserts. Do not create false optimistic-
    -- concurrency conflicts when the factual row did not actually change.
    if (to_jsonb(new) - array['version', 'updated_at']::text[])
       is distinct from
       (to_jsonb(old) - array['version', 'updated_at']::text[]) then
      new.version := old.version + 1;
      new.updated_at := now();
    else
      new.version := old.version;
      new.updated_at := old.updated_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists cheques_prepare_row on public.cheques;
create trigger cheques_prepare_row
before insert or update on public.cheques
for each row execute function public.prepare_cheque_row();

create or replace function public.audit_cheque_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_reason text := nullif(current_setting('martai.transition_reason', true), '');
  event_source text := coalesce(nullif(current_setting('martai.transition_source', true), ''), 'direct');
  correlation text := nullif(current_setting('martai.transition_correlation_id', true), '');
  was_confirmed boolean := false;
  safe_metadata jsonb := '{}'::jsonb;
  changed_fields text[] := array[]::text[];
  before_values jsonb := '{}'::jsonb;
  after_values jsonb := '{}'::jsonb;
begin
  begin
    was_confirmed := coalesce(nullif(current_setting('martai.transition_confirmed', true), ''), 'false')::boolean;
  exception when invalid_text_representation then
    was_confirmed := false;
  end;

  begin
    safe_metadata := coalesce(nullif(current_setting('martai.transition_metadata', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    safe_metadata := '{}'::jsonb;
  end;

  if tg_op = 'INSERT' then
    perform public.write_cheque_event(
      new.store_id, new.id, 'created', null, new.lifecycle_status, null,
      false, event_source, correlation, '{}'::jsonb
    );
    return new;
  end if;

  if new.lifecycle_status is distinct from old.lifecycle_status then
    perform public.write_cheque_event(
      new.store_id, new.id, 'status_changed', old.lifecycle_status, new.lifecycle_status,
      event_reason, was_confirmed, event_source, correlation, safe_metadata
    );
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform public.write_cheque_event(
      new.store_id, new.id, 'soft_deleted', old.lifecycle_status, new.lifecycle_status,
      new.deletion_reason, was_confirmed, event_source, correlation, '{}'::jsonb
    );
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform public.write_cheque_event(
      new.store_id, new.id, 'restored', old.lifecycle_status, new.lifecycle_status,
      event_reason, was_confirmed, event_source, correlation, '{}'::jsonb
    );
  end if;

  select
    coalesce(array_agg(n.key order by n.key), array[]::text[]),
    coalesce(
      jsonb_object_agg(n.key, o.value) filter (
        where n.key in (
          'amount', 'cheque_date', 'direction', 'party_id', 'customer_id',
          'instrument_type', 'currency_code', 'issue_date', 'due_date', 'deposit_date',
          'signature_present', 'visible_correction_present', 'verified_at', 'verified_by',
          'written_at', 'issued_at', 'received_at', 'deposited_at', 'cleared_at',
          'bounced_at', 'cancelled_at', 'assigned_to',
          'source', 'last_follow_up_at', 'next_action_at'
        )
      ), '{}'::jsonb
    ),
    coalesce(
      jsonb_object_agg(n.key, n.value) filter (
        where n.key in (
          'amount', 'cheque_date', 'direction', 'party_id', 'customer_id',
          'instrument_type', 'currency_code', 'issue_date', 'due_date', 'deposit_date',
          'signature_present', 'visible_correction_present', 'verified_at', 'verified_by',
          'written_at', 'issued_at', 'received_at', 'deposited_at', 'cleared_at',
          'bounced_at', 'cancelled_at', 'assigned_to',
          'source', 'last_follow_up_at', 'next_action_at'
        )
      ), '{}'::jsonb
    )
  into changed_fields, before_values, after_values
  from jsonb_each(
    to_jsonb(new) - array[
      'version', 'updated_at', 'status', 'lifecycle_status',
      'deleted_at', 'deleted_by', 'deletion_reason'
    ]::text[]
  ) n
  join jsonb_each(
    to_jsonb(old) - array[
      'version', 'updated_at', 'status', 'lifecycle_status',
      'deleted_at', 'deleted_by', 'deletion_reason'
    ]::text[]
  ) o on o.key = n.key
  where n.value is distinct from o.value;

  if cardinality(changed_fields) > 0 then
    perform public.write_cheque_event(
      new.store_id, new.id, 'updated', old.lifecycle_status, new.lifecycle_status,
      null, false, event_source, correlation,
      jsonb_build_object(
        'changed_fields', to_jsonb(changed_fields),
        'before', before_values,
        'after', after_values
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists cheques_audit_row on public.cheques;
create trigger cheques_audit_row
after insert or update on public.cheques
for each row execute function public.audit_cheque_row();

create or replace function public.block_cheque_hard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or jwt_role = 'service_role' then
    return old;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Hard deletion is disabled; use soft_delete_cheque() with confirmation';
end;
$$;

drop trigger if exists cheques_block_hard_delete on public.cheques;
create trigger cheques_block_hard_delete
before delete on public.cheques
for each row execute function public.block_cheque_hard_delete();

create or replace function public.prepare_cheque_reminder()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.store_id is distinct from old.store_id
       or new.cheque_id is distinct from old.cheque_id
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception using errcode = '22000', message = 'Reminder identity and ownership are immutable';
    end if;

    if old.status in ('done', 'cancelled') and new.status is distinct from old.status then
      raise exception using errcode = '22000', message = 'Completed/cancelled reminders are terminal';
    end if;

    if new.status = 'done' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif new.status <> 'done' then
      new.completed_at := null;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists cheque_reminders_prepare on public.cheque_reminders;
create trigger cheque_reminders_prepare
before update on public.cheque_reminders
for each row execute function public.prepare_cheque_reminder();

create or replace function public.prepare_saved_cheque_view()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.store_id is distinct from old.store_id
       or new.user_id is distinct from old.user_id
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '22000', message = 'Saved view identity and owner are immutable';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists cheque_saved_views_prepare on public.cheque_saved_views;
create trigger cheque_saved_views_prepare
before update on public.cheque_saved_views
for each row execute function public.prepare_saved_cheque_view();

create or replace function public.validate_cheque_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment_row public.cheque_payments%rowtype;
  allocated numeric(12,2);
begin
  if tg_op = 'DELETE' then
    select * into payment_row
    from public.cheque_payments
    where id = old.payment_id
    for update;
  else
    select * into payment_row
    from public.cheque_payments
    where id = new.payment_id
    for update;
  end if;

  if not found then
    raise exception using errcode = '23503', message = 'Payment does not exist';
  end if;

  if payment_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only draft payment allocations can change';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.store_id is distinct from payment_row.store_id then
    raise exception using errcode = '23514', message = 'Allocation and payment must belong to the same store';
  end if;

  if new.credit_id is not null and not exists (
    select 1 from public.credits c where c.id = new.credit_id and c.store_id = new.store_id
  ) then
    raise exception using errcode = '23514', message = 'Allocated credit must belong to the payment store';
  end if;

  if new.party_payment_id is not null and not exists (
    select 1 from public.party_payments p where p.id = new.party_payment_id and p.store_id = new.store_id
  ) then
    raise exception using errcode = '23514', message = 'Allocated party payment must belong to the payment store';
  end if;

  if new.sale_id is not null and not exists (
    select 1 from public.sales s where s.id = new.sale_id and s.store_id = new.store_id
  ) then
    raise exception using errcode = '23514', message = 'Allocated sale must belong to the payment store';
  end if;

  select coalesce(sum(a.amount), 0)
  into allocated
  from public.cheque_payment_allocations a
  where a.payment_id = new.payment_id
    and a.id <> new.id;

  if allocated + new.amount > payment_row.amount then
    raise exception using errcode = '23514', message = 'Allocations cannot exceed the payment amount';
  end if;

  return new;
end;
$$;

drop trigger if exists cheque_payment_allocations_validate on public.cheque_payment_allocations;
create trigger cheque_payment_allocations_validate
before insert or update or delete on public.cheque_payment_allocations
for each row execute function public.validate_cheque_payment_allocation();

create or replace function public.audit_cheque_child_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_name text;
  target_cheque uuid;
  target_store uuid;
  detail_data jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'cheque_notes' then
    event_name := 'note_added';
    target_cheque := new.cheque_id;
    target_store := new.store_id;
    detail_data := jsonb_build_object('note_id', new.id, 'note_type', new.note_type);
  elsif tg_table_name = 'cheque_followups' then
    event_name := 'followup_logged';
    target_cheque := new.cheque_id;
    target_store := new.store_id;
    detail_data := jsonb_build_object(
      'followup_id', new.id, 'channel', new.channel, 'outcome', new.outcome
    );

    update public.cheques
    set last_follow_up_at = greatest(coalesce(last_follow_up_at, new.contacted_at), new.contacted_at),
        next_action_at = case
          when new.next_follow_up_at is null then next_action_at
          when next_action_at is null then new.next_follow_up_at
          else least(next_action_at, new.next_follow_up_at)
        end
    where id = new.cheque_id and store_id = new.store_id;
  elsif tg_table_name = 'cheque_reminders' then
    target_cheque := new.cheque_id;
    target_store := new.store_id;
    event_name := case when tg_op = 'INSERT' then 'reminder_created' else 'reminder_updated' end;
    detail_data := jsonb_build_object(
      'reminder_id', new.id, 'status', new.status, 'scheduled_for', new.scheduled_for
    );
  elsif tg_table_name = 'cheque_attachments' then
    event_name := 'attachment_registered';
    target_cheque := new.cheque_id;
    target_store := new.store_id;
    detail_data := jsonb_build_object(
      'attachment_id', new.id, 'mime_type', new.mime_type, 'size_bytes', new.size_bytes
    );
  elsif tg_table_name = 'cheque_risk_snapshots' then
    event_name := 'risk_snapshot_created';
    target_cheque := new.cheque_id;
    target_store := new.store_id;
    detail_data := jsonb_build_object(
      'snapshot_id', new.id, 'risk_score', new.risk_score,
      'risk_level', new.risk_level, 'score_source', new.score_source,
      'explanation_source', new.explanation_source
    );
  elsif tg_table_name = 'cheque_payments' then
    if tg_op <> 'INSERT' then return new; end if;
    event_name := 'payment_recorded';
    target_cheque := new.cheque_id;
    target_store := new.store_id;
    detail_data := jsonb_build_object('payment_id', new.id, 'amount', new.amount, 'status', new.status);
  elsif tg_table_name = 'cheque_payment_allocations' then
    if tg_op = 'DELETE' then
      select p.cheque_id, p.store_id into target_cheque, target_store
      from public.cheque_payments p
      where p.id = old.payment_id;
      event_name := 'allocation_removed';
      detail_data := jsonb_build_object('allocation_id', old.id, 'amount', old.amount);
    else
      select p.cheque_id, p.store_id into target_cheque, target_store
      from public.cheque_payments p
      where p.id = new.payment_id;
      event_name := 'allocation_created';
      detail_data := jsonb_build_object('allocation_id', new.id, 'amount', new.amount);
    end if;
  else
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform public.write_cheque_event(
    target_store, target_cheque, event_name, null, null, null,
    false, 'direct', null, detail_data
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists cheque_notes_audit on public.cheque_notes;
create trigger cheque_notes_audit after insert on public.cheque_notes
for each row execute function public.audit_cheque_child_row();

drop trigger if exists cheque_followups_audit on public.cheque_followups;
create trigger cheque_followups_audit after insert on public.cheque_followups
for each row execute function public.audit_cheque_child_row();

drop trigger if exists cheque_reminders_audit on public.cheque_reminders;
create trigger cheque_reminders_audit after insert or update on public.cheque_reminders
for each row execute function public.audit_cheque_child_row();

drop trigger if exists cheque_attachments_audit on public.cheque_attachments;
create trigger cheque_attachments_audit after insert on public.cheque_attachments
for each row execute function public.audit_cheque_child_row();

drop trigger if exists cheque_risk_snapshots_audit on public.cheque_risk_snapshots;
create trigger cheque_risk_snapshots_audit after insert on public.cheque_risk_snapshots
for each row execute function public.audit_cheque_child_row();

drop trigger if exists cheque_payments_audit on public.cheque_payments;
create trigger cheque_payments_audit after insert on public.cheque_payments
for each row execute function public.audit_cheque_child_row();

drop trigger if exists cheque_payment_allocations_audit on public.cheque_payment_allocations;
create trigger cheque_payment_allocations_audit
after insert or delete on public.cheque_payment_allocations
for each row execute function public.audit_cheque_child_row();

-- --------------------------------------------------------------------------
-- 10. TRANSACTIONAL, CONFIRMATION-AWARE RPCS
-- --------------------------------------------------------------------------

create or replace function public.transition_cheque(
  p_cheque_id uuid,
  p_to_status text,
  p_confirmed boolean default false,
  p_reason text default null,
  p_expected_version integer default null,
  p_effective_at timestamptz default null,
  p_source text default 'ui',
  p_metadata jsonb default '{}'::jsonb
)
returns public.cheques
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_cheque public.cheques%rowtype;
  updated_cheque public.cheques%rowtype;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
  clean_source text := lower(trim(coalesce(p_source, 'ui')));
  safe_metadata jsonb;
  is_high_impact boolean;
begin
  if p_to_status is null or p_to_status not in (
    'draft', 'to_write', 'written', 'issued', 'received', 'deposited',
    'hold', 'cleared', 'bounced', 'cancelled', 'overdue'
  ) then
    raise exception using errcode = '22023', message = 'Unknown cheque lifecycle status';
  end if;

  if clean_source not in ('ui', 'api', 'import', 'legacy', 'ai_assisted') then
    raise exception using errcode = '22023', message = 'Unsupported transition source';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or octet_length(p_metadata::text) > 8192 then
    raise exception using errcode = '22023', message = 'Transition metadata must be a small JSON object';
  end if;

  safe_metadata := jsonb_strip_nulls(jsonb_build_object(
    'request_id', nullif(left(coalesce(p_metadata ->> 'request_id', ''), 128), ''),
    'client_version', nullif(left(coalesce(p_metadata ->> 'client_version', ''), 64), ''),
    'channel', nullif(left(coalesce(p_metadata ->> 'channel', ''), 40), '')
  ));

  select * into current_cheque
  from public.cheques
  where id = p_cheque_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Cheque not found';
  end if;

  if not public.can_manage_cheque_store(current_cheque.store_id) then
    raise exception using errcode = '42501', message = 'Not authorized for this cheque store';
  end if;

  if current_cheque.deleted_at is not null then
    raise exception using errcode = '55000', message = 'Restore the cheque before changing its status';
  end if;

  if p_expected_version is not null and p_expected_version <> current_cheque.version then
    raise exception using errcode = '40001', message = 'Cheque changed on another device; refresh and try again';
  end if;

  if current_cheque.lifecycle_status = p_to_status then
    return current_cheque;
  end if;

  -- Terminal-state corrections are possible only for mart admins, are always
  -- explicit, and keep the original event history intact.
  if current_cheque.lifecycle_status in ('cleared', 'bounced', 'cancelled') then
    if not public.is_mart_admin() or not coalesce(p_confirmed, false) or clean_reason is null then
      raise exception using
        errcode = '42501',
        message = 'Only a mart admin can correct a terminal status with confirmation and a reason';
    end if;
  elsif not public.is_valid_cheque_transition(current_cheque.lifecycle_status, p_to_status) then
    raise exception using errcode = '22023', message = 'Invalid cheque lifecycle transition';
  end if;

  is_high_impact := p_to_status in ('cleared', 'bounced', 'cancelled');
  if is_high_impact and (not coalesce(p_confirmed, false) or auth.uid() is null) then
    raise exception using
      errcode = '42501',
      message = 'Clearing, bouncing or cancelling requires explicit confirmation by an authenticated user';
  end if;

  if p_to_status in ('bounced', 'cancelled') and clean_reason is null then
    raise exception using errcode = '22023', message = 'Bounce and cancellation require a reason';
  end if;

  if clean_reason is not null and length(clean_reason) > 500 then
    raise exception using errcode = '22023', message = 'Transition reason must be 500 characters or fewer';
  end if;

  if p_effective_at is not null and p_effective_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Effective time cannot be in the future';
  end if;

  perform set_config('martai.transition_reason', coalesce(clean_reason, ''), true);
  perform set_config('martai.transition_confirmed', coalesce(p_confirmed, false)::text, true);
  perform set_config('martai.transition_source', clean_source, true);
  perform set_config('martai.transition_correlation_id', coalesce(safe_metadata ->> 'request_id', ''), true);
  perform set_config('martai.transition_metadata', safe_metadata::text, true);

  update public.cheques
  set lifecycle_status = p_to_status,
      written_at = case when p_to_status = 'written' and p_effective_at is not null
                        then p_effective_at else written_at end,
      issued_at = case when p_to_status = 'issued' and p_effective_at is not null
                       then p_effective_at else issued_at end,
      received_at = case when p_to_status = 'received' and p_effective_at is not null
                         then p_effective_at else received_at end,
      deposited_at = case when p_to_status = 'deposited' and p_effective_at is not null
                          then p_effective_at else deposited_at end,
      deposit_date = case when p_to_status = 'deposited' and p_effective_at is not null
                          then (p_effective_at at time zone 'Asia/Kathmandu')::date else deposit_date end,
      cleared_at = case when p_to_status = 'cleared' and p_effective_at is not null
                        then p_effective_at else cleared_at end,
      bounced_at = case when p_to_status = 'bounced' and p_effective_at is not null
                        then p_effective_at else bounced_at end,
      cancelled_at = case when p_to_status = 'cancelled' and p_effective_at is not null
                          then p_effective_at else cancelled_at end,
      bounce_reason = case when p_to_status = 'bounced' then clean_reason else bounce_reason end,
      cancellation_reason = case when p_to_status = 'cancelled' then clean_reason else cancellation_reason end,
      next_action_at = case when p_to_status in ('cleared', 'bounced', 'cancelled')
                            then null else next_action_at end
  where id = p_cheque_id
  returning * into updated_cheque;

  return updated_cheque;
end;
$$;

create or replace function public.soft_delete_cheque(
  p_cheque_id uuid,
  p_confirmed boolean,
  p_reason text,
  p_expected_version integer default null
)
returns public.cheques
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_cheque public.cheques%rowtype;
  updated_cheque public.cheques%rowtype;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into current_cheque
  from public.cheques
  where id = p_cheque_id
  for update;

  if not found then raise exception using errcode = 'P0002', message = 'Cheque not found'; end if;
  if auth.uid() is null or not (
    public.is_mart_admin() or public.is_store_admin(current_cheque.store_id)
  ) then
    raise exception using errcode = '42501', message = 'Only a mart or store admin can archive a cheque';
  end if;
  if not coalesce(p_confirmed, false) then
    raise exception using errcode = '42501', message = 'Archiving a cheque requires explicit confirmation';
  end if;
  if clean_reason is null or length(clean_reason) < 3 or length(clean_reason) > 500 then
    raise exception using errcode = '22023', message = 'Archive reason must be 3 to 500 characters';
  end if;
  if p_expected_version is not null and p_expected_version <> current_cheque.version then
    raise exception using errcode = '40001', message = 'Cheque changed on another device; refresh and try again';
  end if;
  if current_cheque.deleted_at is not null then return current_cheque; end if;

  perform set_config('martai.soft_delete_confirmed', 'true', true);
  perform set_config('martai.transition_confirmed', 'true', true);
  perform set_config('martai.transition_source', 'ui', true);
  perform set_config('martai.transition_reason', clean_reason, true);

  update public.cheques
  set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = clean_reason
  where id = p_cheque_id
  returning * into updated_cheque;

  return updated_cheque;
end;
$$;

create or replace function public.restore_cheque(
  p_cheque_id uuid,
  p_confirmed boolean,
  p_reason text,
  p_expected_version integer default null
)
returns public.cheques
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_cheque public.cheques%rowtype;
  updated_cheque public.cheques%rowtype;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into current_cheque
  from public.cheques
  where id = p_cheque_id
  for update;

  if not found then raise exception using errcode = 'P0002', message = 'Cheque not found'; end if;
  if auth.uid() is null or not (
    public.is_mart_admin() or public.is_store_admin(current_cheque.store_id)
  ) then
    raise exception using errcode = '42501', message = 'Only a mart or store admin can restore a cheque';
  end if;
  if not coalesce(p_confirmed, false) then
    raise exception using errcode = '42501', message = 'Restoring a cheque requires explicit confirmation';
  end if;
  if clean_reason is null or length(clean_reason) < 3 or length(clean_reason) > 500 then
    raise exception using errcode = '22023', message = 'Restore reason must be 3 to 500 characters';
  end if;
  if p_expected_version is not null and p_expected_version <> current_cheque.version then
    raise exception using errcode = '40001', message = 'Cheque changed on another device; refresh and try again';
  end if;
  if current_cheque.deleted_at is null then return current_cheque; end if;

  perform set_config('martai.restore_confirmed', 'true', true);
  perform set_config('martai.transition_confirmed', 'true', true);
  perform set_config('martai.transition_source', 'ui', true);
  perform set_config('martai.transition_reason', clean_reason, true);

  update public.cheques
  set deleted_at = null, deleted_by = null, deletion_reason = null
  where id = p_cheque_id
  returning * into updated_cheque;

  return updated_cheque;
end;
$$;

create or replace function public.transition_cheque_payment(
  p_payment_id uuid,
  p_to_status text,
  p_confirmed boolean,
  p_reason text default null
)
returns public.cheque_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment_row public.cheque_payments%rowtype;
  updated_payment public.cheque_payments%rowtype;
  cheque_row public.cheques%rowtype;
  confirmed_total numeric(12,2);
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_to_status is null or p_to_status not in ('confirmed', 'reversed') then
    raise exception using errcode = '22023', message = 'Payment can only be confirmed or reversed';
  end if;
  if auth.uid() is null or not coalesce(p_confirmed, false) then
    raise exception using errcode = '42501', message = 'Payment changes require explicit authenticated confirmation';
  end if;
  if clean_reason is not null and length(clean_reason) > 500 then
    raise exception using errcode = '22023', message = 'Payment reason must be 500 characters or fewer';
  end if;

  select * into payment_row
  from public.cheque_payments
  where id = p_payment_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Cheque payment not found'; end if;
  if not public.can_manage_cheque_store(payment_row.store_id) then
    raise exception using errcode = '42501', message = 'Not authorized for this payment store';
  end if;

  select * into cheque_row
  from public.cheques
  where id = payment_row.cheque_id and store_id = payment_row.store_id
  for update;
  if cheque_row.deleted_at is not null then
    raise exception using errcode = '55000', message = 'Cannot change a payment for an archived cheque';
  end if;

  if p_to_status = 'confirmed' then
    if payment_row.status <> 'draft' then
      raise exception using errcode = '22023', message = 'Only a draft payment can be confirmed';
    end if;
    select coalesce(sum(amount), 0) into confirmed_total
    from public.cheque_payments
    where cheque_id = payment_row.cheque_id and status = 'confirmed';
    if confirmed_total + payment_row.amount > cheque_row.amount then
      raise exception using errcode = '23514', message = 'Confirmed payments cannot exceed the cheque amount';
    end if;

    update public.cheque_payments
    set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
    where id = p_payment_id
    returning * into updated_payment;

    perform public.write_cheque_event(
      payment_row.store_id, payment_row.cheque_id, 'payment_confirmed', null, null,
      clean_reason, true, 'ui', null,
      jsonb_build_object('payment_id', payment_row.id, 'amount', payment_row.amount)
    );
  else
    if payment_row.status <> 'confirmed' then
      raise exception using errcode = '22023', message = 'Only a confirmed payment can be reversed';
    end if;
    if clean_reason is null or length(clean_reason) < 3 or length(clean_reason) > 500 then
      raise exception using errcode = '22023', message = 'Reversal reason must be 3 to 500 characters';
    end if;

    update public.cheque_payments
    set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(),
        reversal_reason = clean_reason, updated_at = now()
    where id = p_payment_id
    returning * into updated_payment;

    perform public.write_cheque_event(
      payment_row.store_id, payment_row.cheque_id, 'payment_reversed', null, null,
      clean_reason, true, 'ui', null,
      jsonb_build_object('payment_id', payment_row.id, 'amount', payment_row.amount)
    );
  end if;

  return updated_payment;
end;
$$;

-- --------------------------------------------------------------------------
-- 11. STORE-SCOPED ROW LEVEL SECURITY
-- --------------------------------------------------------------------------

alter table public.mart_staff_store_access enable row level security;
alter table public.cheque_events enable row level security;
alter table public.cheque_notes enable row level security;
alter table public.cheque_followups enable row level security;
alter table public.cheque_reminders enable row level security;
alter table public.cheque_attachments enable row level security;
alter table public.cheque_risk_snapshots enable row level security;
alter table public.cheque_payments enable row level security;
alter table public.cheque_payment_allocations enable row level security;
alter table public.cheque_saved_views enable row level security;

drop policy if exists "mart admins manage staff store access" on public.mart_staff_store_access;
drop policy if exists "staff read own store access" on public.mart_staff_store_access;
create policy "mart admins manage staff store access"
  on public.mart_staff_store_access for all to authenticated
  using (public.is_mart_admin())
  with check (public.is_mart_admin());
create policy "staff read own store access"
  on public.mart_staff_store_access for select to authenticated
  using (staff_user_id = auth.uid() and public.is_mart_staff());

-- Replace the three legacy global staff cheque policies. The mart-admin policy
-- remains intact. Single-store staff have already been assigned above;
-- multi-store assignments must be deliberate.
drop policy if exists "staff use cheques" on public.cheques;
drop policy if exists "staff insert cheques" on public.cheques;
drop policy if exists "staff update cheques" on public.cheques;
create policy "staff use cheques"
  on public.cheques for select to authenticated
  using (public.is_mart_staff() and public.has_staff_store_access(store_id));
create policy "staff insert cheques"
  on public.cheques for insert to authenticated
  with check (public.is_mart_staff() and public.can_manage_cheque_store(store_id));
create policy "staff update cheques"
  on public.cheques for update to authenticated
  using (public.is_mart_staff() and public.can_manage_cheque_store(store_id) and deleted_at is null)
  with check (public.is_mart_staff() and public.can_manage_cheque_store(store_id) and deleted_at is null);

-- Store admins may read archived records for recovery, but normal direct writes
-- are limited to active rows. restore_cheque() performs an explicitly confirmed
-- restore through its security-definer transaction.
drop policy if exists "store admins use cheques" on public.cheques;
drop policy if exists "store admins read cheques" on public.cheques;
drop policy if exists "store admins insert cheques" on public.cheques;
drop policy if exists "store admins update cheques" on public.cheques;
drop policy if exists "store admins delete cheques" on public.cheques;
create policy "store admins read cheques"
  on public.cheques for select to authenticated
  using (public.is_store_admin(store_id));
create policy "store admins insert cheques"
  on public.cheques for insert to authenticated
  with check (public.is_store_admin(store_id) and deleted_at is null);
create policy "store admins update cheques"
  on public.cheques for update to authenticated
  using (public.is_store_admin(store_id) and deleted_at is null)
  with check (public.is_store_admin(store_id) and deleted_at is null);
create policy "store admins delete cheques"
  on public.cheques for delete to authenticated
  using (public.is_store_admin(store_id));

drop policy if exists "authorized users read cheque events" on public.cheque_events;
create policy "authorized users read cheque events"
  on public.cheque_events for select to authenticated
  using (public.can_access_cheque_store(store_id));

drop policy if exists "authorized users read cheque notes" on public.cheque_notes;
drop policy if exists "authorized users add cheque notes" on public.cheque_notes;
create policy "authorized users read cheque notes"
  on public.cheque_notes for select to authenticated
  using (public.can_access_cheque_store(store_id));
create policy "authorized users add cheque notes"
  on public.cheque_notes for insert to authenticated
  with check (public.can_manage_active_cheque(store_id, cheque_id) and created_by = auth.uid());

drop policy if exists "authorized users read cheque followups" on public.cheque_followups;
drop policy if exists "authorized users add cheque followups" on public.cheque_followups;
create policy "authorized users read cheque followups"
  on public.cheque_followups for select to authenticated
  using (public.can_access_cheque_store(store_id));
create policy "authorized users add cheque followups"
  on public.cheque_followups for insert to authenticated
  with check (public.can_manage_active_cheque(store_id, cheque_id) and created_by = auth.uid());

drop policy if exists "authorized users read cheque reminders" on public.cheque_reminders;
drop policy if exists "authorized users add cheque reminders" on public.cheque_reminders;
drop policy if exists "authorized users update cheque reminders" on public.cheque_reminders;
create policy "authorized users read cheque reminders"
  on public.cheque_reminders for select to authenticated
  using (public.can_access_cheque_store(store_id));
create policy "authorized users add cheque reminders"
  on public.cheque_reminders for insert to authenticated
  with check (public.can_manage_active_cheque(store_id, cheque_id) and created_by = auth.uid());
create policy "authorized users update cheque reminders"
  on public.cheque_reminders for update to authenticated
  using (public.can_manage_active_cheque(store_id, cheque_id))
  with check (public.can_manage_active_cheque(store_id, cheque_id));

drop policy if exists "authorized users read cheque attachments" on public.cheque_attachments;
drop policy if exists "authorized users register cheque attachments" on public.cheque_attachments;
create policy "authorized users read cheque attachments"
  on public.cheque_attachments for select to authenticated
  using (public.can_access_cheque_store(store_id));
create policy "authorized users register cheque attachments"
  on public.cheque_attachments for insert to authenticated
  with check (
    public.can_manage_active_cheque(store_id, cheque_id)
    and uploaded_by = auth.uid()
    and scan_status = 'pending'
    and ocr_status = 'not_requested'
  );

drop policy if exists "authorized users read cheque risk" on public.cheque_risk_snapshots;
drop policy if exists "authorized users add cheque risk" on public.cheque_risk_snapshots;
create policy "authorized users read cheque risk"
  on public.cheque_risk_snapshots for select to authenticated
  using (public.can_access_cheque_store(store_id));
create policy "authorized users add cheque risk"
  on public.cheque_risk_snapshots for insert to authenticated
  with check (public.can_manage_active_cheque(store_id, cheque_id) and created_by = auth.uid());

drop policy if exists "authorized users read cheque payments" on public.cheque_payments;
drop policy if exists "authorized users draft cheque payments" on public.cheque_payments;
create policy "authorized users read cheque payments"
  on public.cheque_payments for select to authenticated
  using (public.can_access_cheque_store(store_id));
create policy "authorized users draft cheque payments"
  on public.cheque_payments for insert to authenticated
  with check (
    public.can_manage_active_cheque(store_id, cheque_id)
    and created_by = auth.uid()
    and status = 'draft'
  );

drop policy if exists "authorized users read cheque allocations" on public.cheque_payment_allocations;
drop policy if exists "authorized users add cheque allocations" on public.cheque_payment_allocations;
drop policy if exists "authorized users remove draft cheque allocations" on public.cheque_payment_allocations;
create policy "authorized users read cheque allocations"
  on public.cheque_payment_allocations for select to authenticated
  using (public.can_access_cheque_store(store_id));
create policy "authorized users add cheque allocations"
  on public.cheque_payment_allocations for insert to authenticated
  with check (
    public.can_manage_active_cheque_payment(store_id, payment_id)
    and created_by = auth.uid()
  );
create policy "authorized users remove draft cheque allocations"
  on public.cheque_payment_allocations for delete to authenticated
  using (public.can_manage_cheque_store(store_id));

drop policy if exists "authorized users read saved cheque views" on public.cheque_saved_views;
drop policy if exists "users create own saved cheque views" on public.cheque_saved_views;
drop policy if exists "users update own saved cheque views" on public.cheque_saved_views;
drop policy if exists "users delete own saved cheque views" on public.cheque_saved_views;
create policy "authorized users read saved cheque views"
  on public.cheque_saved_views for select to authenticated
  using (
    public.can_access_cheque_store(store_id)
    and (user_id = auth.uid() or is_shared or public.is_mart_admin())
  );
create policy "users create own saved cheque views"
  on public.cheque_saved_views for insert to authenticated
  with check (public.can_access_cheque_store(store_id) and user_id = auth.uid());
create policy "users update own saved cheque views"
  on public.cheque_saved_views for update to authenticated
  using (public.can_access_cheque_store(store_id) and user_id = auth.uid())
  with check (public.can_access_cheque_store(store_id) and user_id = auth.uid());
create policy "users delete own saved cheque views"
  on public.cheque_saved_views for delete to authenticated
  using (public.can_access_cheque_store(store_id) and user_id = auth.uid());

-- --------------------------------------------------------------------------
-- 12. PRIVATE SUPABASE STORAGE BUCKET (CONDITIONAL FOR PLAIN POSTGRES)
-- --------------------------------------------------------------------------

create or replace function public.can_access_cheque_attachment_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(object_name, '') ~
      '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/].*$'
    and length(object_name) <= 1024
    and position('..' in object_name) = 0
    and exists (
      select 1
      from public.cheques c
      where c.store_id::text = split_part(object_name, '/', 1)
        and c.id::text = split_part(object_name, '/', 2)
        and c.deleted_at is null
        and public.can_access_cheque_store(c.store_id)
    );
$$;

create or replace function public.can_manage_cheque_attachment_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(object_name, '') ~
      '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/].*$'
    and length(object_name) <= 1024
    and position('..' in object_name) = 0
    and exists (
      select 1
      from public.cheques c
      where c.store_id::text = split_part(object_name, '/', 1)
        and c.id::text = split_part(object_name, '/', 2)
        and c.deleted_at is null
        and public.can_manage_cheque_store(c.store_id)
    );
$$;

do $storage_setup$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('cheque-attachments', 'cheque-attachments', false)
      on conflict (id) do update set public = false
    $sql$;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
    ) then
      execute $sql$
        update storage.buckets set file_size_limit = 10485760
        where id = 'cheque-attachments'
      $sql$;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
    ) then
      execute $sql$
        update storage.buckets
        set allowed_mime_types = array[
          'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
        ]::text[]
        where id = 'cheque-attachments'
      $sql$;
    end if;
  end if;

  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "authorized users read private cheque files" on storage.objects';
    execute 'drop policy if exists "authorized users upload private cheque files" on storage.objects';

    execute $policy$
      create policy "authorized users read private cheque files"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'cheque-attachments'
        and public.can_access_cheque_attachment_path(name)
      )
    $policy$;

    execute $policy$
      create policy "authorized users upload private cheque files"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'cheque-attachments'
        and public.can_manage_cheque_attachment_path(name)
      )
    $policy$;
  end if;
end
$storage_setup$;

-- --------------------------------------------------------------------------
-- 13. LEAST-PRIVILEGE GRANTS AND REALTIME
-- --------------------------------------------------------------------------

revoke all on public.mart_staff_store_access from anon;
revoke all on public.cheque_events from anon;
revoke all on public.cheque_notes from anon;
revoke all on public.cheque_followups from anon;
revoke all on public.cheque_reminders from anon;
revoke all on public.cheque_attachments from anon;
revoke all on public.cheque_risk_snapshots from anon;
revoke all on public.cheque_payments from anon;
revoke all on public.cheque_payment_allocations from anon;
revoke all on public.cheque_saved_views from anon;
revoke all on public.cheque_latest_risk from anon;

grant select, insert, update, delete on public.mart_staff_store_access to authenticated;
grant select on public.cheque_events to authenticated;
grant select, insert on public.cheque_notes to authenticated;
grant select, insert on public.cheque_followups to authenticated;
grant select, insert, update on public.cheque_reminders to authenticated;
grant select, insert on public.cheque_attachments to authenticated;
grant select, insert on public.cheque_risk_snapshots to authenticated;
grant select, insert on public.cheque_payments to authenticated;
grant select, insert, delete on public.cheque_payment_allocations to authenticated;
grant select, insert, update, delete on public.cheque_saved_views to authenticated;
grant select on public.cheque_latest_risk to authenticated;

-- Supabase's service role is trusted for malware scanning, OCR processing and
-- recovery work, but provider-facing code must still avoid calling financial
-- transition RPCs without a real user session.
grant select, insert, update, delete on public.mart_staff_store_access to service_role;
grant select on public.cheque_events to service_role;
grant select, insert on public.cheque_notes to service_role;
grant select, insert on public.cheque_followups to service_role;
grant select, insert, update on public.cheque_reminders to service_role;
grant select, insert, update on public.cheque_attachments to service_role;
grant select, insert on public.cheque_risk_snapshots to service_role;
grant select, insert on public.cheque_payments to service_role;
grant select, insert, delete on public.cheque_payment_allocations to service_role;
grant select, insert, update, delete on public.cheque_saved_views to service_role;
grant select on public.cheque_latest_risk to service_role;

-- Remove PostgreSQL's implicit PUBLIC function execution, then expose only the
-- helpers/RPCs a signed-in client needs. Existing direct anon/auth grants from
-- setup-complete.sql are not removed by this PUBLIC-only revoke.
revoke execute on all functions in schema public from public;
grant execute on function public.has_staff_store_access(uuid) to authenticated;
grant execute on function public.can_access_cheque_store(uuid) to authenticated;
grant execute on function public.can_manage_cheque_store(uuid) to authenticated;
grant execute on function public.can_manage_active_cheque(uuid,uuid) to authenticated;
grant execute on function public.can_manage_active_cheque_payment(uuid,uuid) to authenticated;
grant execute on function public.is_store_admin(uuid) to authenticated;
grant execute on function public.admin_delete_store(uuid) to authenticated;
grant execute on function public.cheque_legacy_status(text) to authenticated;
grant execute on function public.cheque_lifecycle_from_legacy(text) to authenticated;
grant execute on function public.is_safe_cheque_filter(jsonb) to authenticated;
grant execute on function public.can_access_cheque_attachment_path(text) to authenticated;
grant execute on function public.can_manage_cheque_attachment_path(text) to authenticated;
grant execute on function public.transition_cheque(uuid,text,boolean,text,integer,timestamptz,text,jsonb) to authenticated;
grant execute on function public.soft_delete_cheque(uuid,boolean,text,integer) to authenticated;
grant execute on function public.restore_cheque(uuid,boolean,text,integer) to authenticated;
grant execute on function public.transition_cheque_payment(uuid,text,boolean,text) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cheque_events', 'cheque_notes', 'cheque_followups', 'cheque_reminders',
    'cheque_risk_snapshots', 'cheque_payments'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end
$$;

commit;

-- ============================================================================
-- POST-MIGRATION VERIFICATION (READ-ONLY; SAFE TO RUN REPEATEDLY)
-- ============================================================================

-- 1) Every existing legacy status must have an exact lifecycle projection.
select
  count(*) filter (where lifecycle_status is null) as missing_lifecycle,
  count(*) filter (
    where status is distinct from public.cheque_legacy_status(lifecycle_status)
  ) as projection_mismatches,
  count(*) filter (where due_date is distinct from cheque_date) as date_mismatches
from public.cheques;

-- 2) Review this before staff use a multi-store deployment. Rows returned here
--    are active staff with no explicit store membership and therefore no cheque
--    access until a mart admin assigns them.
select ms.user_id, ms.email, ms.full_name
from public.mart_staff ms
where ms.is_active = true
  and not exists (
    select 1 from public.mart_staff_store_access a
    where a.staff_user_id = ms.user_id
  )
order by ms.email;

-- 3) No history is backfilled. This count should be zero immediately after the
--    migration unless a concurrent client created/updated a cheque during setup.
select count(*) as recorded_cheque_events from public.cheque_events;

-- 4) Confirm all new tables have RLS enabled.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'mart_staff_store_access', 'cheque_events', 'cheque_notes',
    'cheque_followups', 'cheque_reminders', 'cheque_attachments',
    'cheque_risk_snapshots', 'cheque_payments',
    'cheque_payment_allocations', 'cheque_saved_views'
  )
order by c.relname;

-- 5) Optional private-bucket check (returns no row on non-Supabase Postgres):
-- select id, name, public, file_size_limit, allowed_mime_types
-- from storage.buckets where id = 'cheque-attachments';

-- Rollback approach: keep the new columns/tables for audit retention and return
-- clients to legacy fields. Do not drop cheque_events after real activity exists.
-- If emergency staff access is required, add the correct store membership rather
-- than restoring the old global staff policy.
