RD MART - Setup Guide
=====================

STEP 1: SUPABASE DATABASE SETUP
--------------------------------
1. Open your Supabase project dashboard.
2. Go to SQL Editor → New Query.
3. Open setup-complete.sql from this folder.
4. Paste the entire file content and click Run.
   (This single file creates all tables, functions, indexes, RLS policies,
    brute-force protection, and session cleanup — safe to re-run.)

5. Go to Authentication → Users → Add user.
   Create your admin account with a strong email and password.

6. Go to SQL Editor → New Query and run:
   insert into public.mart_admins (user_id)
   values ('YOUR_AUTH_USER_ID_HERE');
   (Copy the user ID from the Users list.)


STEP 2: CONFIGURE SUPABASE CREDENTIALS
---------------------------------------
1. Go to Project Settings → API.
2. Copy Project URL and anon/public key.
3. Open assets/martai-supabase-config.js.
4. Replace the url and anonKey values.
5. Keep mode as 'tables'.


STEP 3: OPEN / DEPLOY
-----------------------

Option A — Open locally (no install needed):
  Open index.html directly in Chrome or Edge.

Option B — Local server (Node.js):
  Open CMD/terminal in this folder and run:
    node server.js
  Then visit: http://localhost:3000

Option C — Deploy to Netlify (free, HTTPS, recommended for live):
  1. Go to netlify.com and sign up free.
  2. Drag and drop this entire martai_final folder onto the Netlify dashboard.
  3. Your site is live at a .netlify.app URL with HTTPS and security headers.
  (netlify.toml is already included in this folder — headers are pre-configured.)


HOW TO LOGIN
-------------
Admin:
  - Go to the Admin tab on the login page.
  - Login with the email and password you created in Supabase Authentication.
  - First login: you must set your admin user as mart_admin (see Step 1 above).

Staff:
  - Create their email in Supabase Authentication → Users first.
  - Login as admin → Settings → Staff access → Allow staff access.
  - Staff login from the same Admin tab.

Customer:
  1. Login as admin.
  2. Go to Customers → Add a customer with name, phone, and 4-digit PIN.
  3. Sign out.
  4. On the login page, use the Customer tab.
  5. Enter the customer's phone number and PIN.


MULTI-STORE SUPPORT
--------------------
- The main admin can create additional stores from Settings → Stores.
- Each store has its own customers, credits, sales, cheques, and reports.
- A store admin email must be created in Supabase Authentication first.
- Store admins log in from the Admin tab and only see their store's data.


SECURITY NOTES
---------------
- All customer PINs are stored as bcrypt hashes (never plain text).
- Customers access data only through secure RPC functions, not direct SQL.
- Customer login is rate-limited: 10 failed attempts per phone locks it for 15 minutes.
- All tables have Row Level Security (RLS) enabled.
- The anon key in the config is intentionally public — RLS is what secures the data.
- For extra protection, set up Supabase Auth rate limiting in:
  Project Settings → Auth → Rate Limits.


DATA BACKUP
------------
Admin dashboard → Settings → Download JSON backup
(Download a full backup before major changes.)


CUSTOMER EXPORT (without PINs)
--------------------------------
Admin dashboard → Customers → Export customers
(Exports name, phone, email, address, balance as CSV — PINs are never included.)
