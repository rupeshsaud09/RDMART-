-- ============================================================
-- FIX PARTY NAME TYPOS from the Excel import — run once in
-- Supabase SQL Editor. Safe to re-run.
-- ============================================================

update public.cheques set party = 'NEW PRATIK TRADERS'  where party in ('NEW PRAIK TRADERS','NEW PRARIK TRADERS');
update public.cheques set party = 'KRITAGYA SUPPLIERS'  where party = 'KRIRAGYA SUPPLIERS';

-- One cheque had no party name in the Excel (Rs 68,608, dated 2025-04-21,
-- cheque no 23919585). When you find out whose it was, run:
-- update public.cheques set party = 'REAL PARTY NAME', note = '' where cheque_no = '23919585' and party = 'UNKNOWN PARTY';

-- Optional: name variants you may want to merge — uncomment what you agree with:
-- update public.cheques set party = 'K.A.P TRADERS'      where party in ('KAP TRADERS','K.A.P TRADERS ');
-- update public.cheques set party = 'NEW PRATIK TRADERS' where party = 'NEW PRATIK';
-- update public.cheques set party = 'B.G TRADERS'        where party = 'BG TRADERS';
-- update public.cheques set party = 'J.B ENTERPRISES'    where party = 'JB ENTERPRISES';

select party, count(*) as cheques, sum(amount) as total
from public.cheques group by party order by party;
