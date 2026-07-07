SQL ARCHIVE — DO NOT RUN THESE FILES
=====================================

Every file in this folder is superseded by ../setup-complete.sql,
which contains all tables, functions, indexes, and RLS policies in
their final, corrected form and is safe to re-run at any time.

These files are kept only as a historical record of how the schema
evolved. Running them today can silently break a working database:

- fix-customer-login-function.sql replaces customer_login with an
  old version that drops brute-force protection and login tracking.
- supabase-production-schema.sql declares phone as globally unique,
  which conflicts with multi-store support (setup-complete.sql uses
  unique(store_id, phone) instead).
- supabase-schema.sql is the legacy single-JSON-blob schema used
  only by the old mode:'json' setting, which is no longer the
  shipped configuration.

If you need to set up or update the database, run only:
  ../setup-complete.sql

Standalone maintenance scripts that are still valid live in the
parent folder: reset-customer-pin.sql, test-customer-login.sql,
supabase-json-to-tables-migration.sql (one-time data migration for
very old JSON-mode deployments).
