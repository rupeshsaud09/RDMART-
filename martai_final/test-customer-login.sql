-- Test one customer login directly in Supabase.
-- Replace the phone and PIN values, then run this in Supabase SQL Editor.
-- If this returns a row with token/customer_id/name/phone, the PIN is correct.

select *
from public.customer_login('1234567890', '1234');

