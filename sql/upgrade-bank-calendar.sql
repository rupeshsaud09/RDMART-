-- Configurable Nepal cheque banking calendar.
-- Safe to run more than once in Supabase SQL Editor.
alter table public.mart_settings
  add column if not exists bank_weekend_days integer[] not null default array[0,6];

alter table public.mart_settings
  add column if not exists bank_holidays date[] not null default '{}';

update public.mart_settings
set
  bank_weekend_days = coalesce(bank_weekend_days, array[0,6]),
  bank_holidays = coalesce(bank_holidays, '{}'),
  updated_at = now()
where id = true;
