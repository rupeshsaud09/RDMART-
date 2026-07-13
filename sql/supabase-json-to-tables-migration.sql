-- Optional one-time migration from the old martai_app_state JSON row to
-- the production tables in supabase-production-schema.sql.
--
-- Run this after supabase-production-schema.sql.
-- Take a JSON backup first.

insert into public.mart_settings (id, mart_name, mart_phone, updated_at)
select
  true,
  coalesce(data #>> '{settings,martName}', 'RD MART'),
  coalesce(data #>> '{settings,martPhone}', ''),
  now()
from public.martai_app_state
where id = 'main'
on conflict (id) do update
set mart_name = excluded.mart_name,
    mart_phone = excluded.mart_phone,
    updated_at = now();

insert into public.customers (legacy_id, name, phone, pin_hash, email, address, notes, created_at, updated_at)
select
  c->>'id',
  coalesce(c->>'name','Customer'),
  regexp_replace(coalesce(c->>'phone',''), '\D', '', 'g'),
  public.hash_pin(coalesce(c->>'pin','0000')),
  coalesce(c->>'email',''),
  coalesce(c->>'address',''),
  coalesce(c->>'notes',''),
  coalesce((c->>'createdAt')::timestamptz, now()),
  coalesce((c->>'updatedAt')::timestamptz, now())
from public.martai_app_state s,
jsonb_array_elements(s.data->'customers') c
where s.id = 'main'
on conflict (legacy_id) do update
set name = excluded.name,
    phone = excluded.phone,
    pin_hash = excluded.pin_hash,
    email = excluded.email,
    address = excluded.address,
    notes = excluded.notes,
    updated_at = now();

insert into public.credits (legacy_id, customer_id, credit_date, items, amount, paid, note, payment_note, paid_at, created_at)
select
  cr->>'id',
  cu.id,
  coalesce((cr->>'date')::date, current_date),
  coalesce(cr->>'items',''),
  coalesce((cr->>'amount')::numeric, 0),
  coalesce((cr->>'paid')::numeric, 0),
  coalesce(cr->>'note',''),
  coalesce(cr->>'paymentNote',''),
  nullif(cr->>'paidAt','')::timestamptz,
  coalesce((cr->>'createdAt')::timestamptz, now())
from public.martai_app_state s,
jsonb_array_elements(s.data->'credits') cr
join public.customers cu on cu.legacy_id = cr->>'customerId'
where s.id = 'main'
  and coalesce((cr->>'amount')::numeric, 0) > 0
on conflict (legacy_id) do nothing;

insert into public.sales (legacy_id, sale_date, party, amount, note, created_at)
select
  x->>'id',
  coalesce((x->>'date')::date, current_date),
  coalesce(x->>'party','Walk-in Customer'),
  coalesce((x->>'amount')::numeric, 0),
  coalesce(x->>'note',''),
  coalesce((x->>'createdAt')::timestamptz, now())
from public.martai_app_state s,
jsonb_array_elements(s.data->'sales') x
where s.id = 'main'
  and coalesce((x->>'amount')::numeric, 0) > 0
on conflict (legacy_id) do nothing;

insert into public.daily_sales (legacy_id, sale_date, pos, fonepay, cash, finance, party_payment, other, note, created_at)
select
  x->>'id',
  coalesce((x->>'date')::date, current_date),
  coalesce((x->>'pos')::numeric, 0),
  coalesce((x->>'fonepay')::numeric, 0),
  coalesce((x->>'cash')::numeric, 0),
  coalesce((x->>'finance')::numeric, 0),
  coalesce((x->>'partyPayment')::numeric, 0),
  coalesce((x->>'other')::numeric, 0),
  coalesce(x->>'note',''),
  coalesce((x->>'createdAt')::timestamptz, now())
from public.martai_app_state s,
jsonb_array_elements(s.data->'dailySales') x
where s.id = 'main'
on conflict (legacy_id) do nothing;

insert into public.party_payments (legacy_id, payment_date, party, amount, method, reference, note, created_at)
select
  x->>'id',
  coalesce((x->>'date')::date, current_date),
  coalesce(x->>'party',''),
  coalesce((x->>'amount')::numeric, 0),
  coalesce(x->>'method','Cash'),
  coalesce(x->>'reference',''),
  coalesce(x->>'note',''),
  coalesce((x->>'createdAt')::timestamptz, now())
from public.martai_app_state s,
jsonb_array_elements(s.data->'partyPayments') x
where s.id = 'main'
  and coalesce((x->>'amount')::numeric, 0) > 0
on conflict (legacy_id) do nothing;

insert into public.cheques (legacy_id, party, cheque_no, amount, bank, cheque_date, status, note, created_at, updated_at)
select
  x->>'id',
  coalesce(x->>'party',''),
  coalesce(x->>'chequeNo',''),
  coalesce((x->>'amount')::numeric, 0),
  coalesce(x->>'bank',''),
  coalesce((x->>'chequeDate')::date, current_date),
  case when x->>'status' in ('hold','clear','bounce') then x->>'status' else 'hold' end,
  coalesce(x->>'note',''),
  coalesce((x->>'createdAt')::timestamptz, now()),
  nullif(x->>'updatedAt','')::timestamptz
from public.martai_app_state s,
jsonb_array_elements(s.data->'cheques') x
where s.id = 'main'
  and coalesce((x->>'amount')::numeric, 0) > 0
on conflict (legacy_id) do nothing;

insert into public.activity (legacy_id, activity_type, message, created_at)
select
  x->>'id',
  coalesce(x->>'type','info'),
  coalesce(x->>'message','Activity'),
  coalesce((x->>'time')::timestamptz, now())
from public.martai_app_state s,
jsonb_array_elements(s.data->'activity') x
where s.id = 'main'
on conflict (legacy_id) do nothing;
