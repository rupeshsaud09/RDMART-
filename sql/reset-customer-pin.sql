-- Reset one customer PIN if the customer portal login fails.
-- Replace the phone and PIN values, then run this in Supabase SQL Editor.

update public.customers
set pin_hash = public.hash_pin('1234'),
    updated_at = now()
where phone = regexp_replace('1234567890', '\D', '', 'g');

-- Confirm the row was found and the PIN now works.
select *
from public.customer_login('1234567890', '1234');
