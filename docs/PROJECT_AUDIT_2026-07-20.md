# RD MART product, UX, data, and AI audit

Date: 2026-07-20  
Upgrade branch: `feature-ui-ux-ai-upgrade`  
Recovery branch: `backup-pre-ui-ux-ai-upgrade-20260720`

## Executive summary

RD MART is a capable local-first business dashboard, but its current presentation and data model have grown through layered additions. The result is visually inconsistent, difficult to scan, and risky to extend. The highest-priority work is not a cosmetic reskin: the product needs a coherent design system, accessible interaction primitives, a complete cheque lifecycle, durable audit history, and an honest boundary between deterministic assistance and optional provider-backed AI.

The upgrade will remain compatible with the existing static Vercel deployment and Supabase backend. Existing `hold`, `clear`, and `bounce` cheque records will continue to work while the richer model is introduced additively. No provider secret will be shipped to the browser, no OCR result will save automatically, and every financial mutation must pass through an explicit user-confirmation boundary.

## Current architecture

- Static multi-page HTML/CSS/JavaScript PWA in `martai_final/`; there is no frontend framework or build step.
- Browser-first state in one local-storage database, mirrored row by row to Supabase.
- Supabase Auth for administrators and staff; a separate phone/PIN RPC flow for customers.
- Direct browser access to Supabase using the public anonymous key and database row-level security.
- Vercel serves the static application and security headers.
- Large monolithic pages: dashboard rendering, forms, navigation, date conversion, and business calculations currently live together.
- The existing Saathi assistant is a deterministic keyword and form-flow engine. It is useful offline, but it is not a provider-backed AI service.

## What is working well

- Existing automated tests pass (8 of 8 at audit time).
- Public database access is protected by RLS and function grants; sensitive customer tokens are hashed.
- Backup export removes known authentication secrets and validates imported content.
- The application already supports dark mode, offline state, pagination, basic keyboard handling, reduced motion, and a responsive sidebar.
- The dashboard has useful business data and a practical foundation for a cheque command centre.

## Product and UX findings

### Critical

1. **Financial state changes are not durably auditable.** Activity is stored locally but is not included in the remote dirty/save loop. Cheque status changes accept arbitrary strings client-side and do not validate lifecycle transitions.
2. **One assistant cheque path changes financial state without confirmation.** All assistant or automation paths must only prepare a proposed action; the user must approve the final mutation.
3. **Payment approval is non-transactional.** A request can be marked approved before its credit allocation finishes. Concurrent writes can also overwrite accumulated payment values.
4. **Store isolation is incomplete for staff and offline operations.** Staff policies are not membership-scoped to a store, and dirty IDs are not keyed by store. Switching stores can therefore sync the wrong local rows.

### High

1. The visual system has lost semantic meaning: danger and warning colors were collapsed toward neutral gray, so bounced/overdue/destructive states are not immediately distinguishable.
2. Dashboard and cheque logic contain duplicate function declarations; later declarations silently override earlier ones.
3. Hundreds of inline styles plus late CSS override blocks make the cascade fragile and expensive to maintain.
4. Forms rarely associate labels with controls. Modals lack dialog semantics, focus trapping, and reliable focus restoration. Tabs and mobile icon-only controls do not always expose an accessible name.
5. The cheque model has only one ambiguous date, a free-text party link, and three statuses. It cannot reliably distinguish incoming/outgoing cash, issue/due/deposit dates, ownership, follow-up history, or risk evidence.
6. Financial records are hard-deleted. Important records need soft deletion and append-only events.
7. Customer payment history is reduced to an accumulated amount and last note, so past timing and allocation cannot be reconstructed.
8. Search rerenders large page sections on each keystroke. Scripts and visual effects are eagerly loaded.

### Medium

1. BS date conversion is copied across three pages, supports a limited range, and silently clamps unsupported dates.
2. “Today” relies on browser-local date behavior rather than explicitly using `Asia/Kathmandu`.
3. The bank calendar hardcodes closed days and has no configurable Nepal holiday source.
4. Dashboard KPIs have limited trend context, and actionable work is fragmented across cards.
5. `partyPayment` is labelled as money paid to a party but is also included in sales totals; this accounting meaning must be confirmed before it is used in forecasting.
6. The `sales` and `dailySales` collections are interpreted differently in the dashboard and assistant.
7. The reset message implies remote deletion although the implementation only resets the browser copy.
8. Local storage and exported backups contain plaintext business and customer data.

## Security and privacy findings

- Keep the Supabase anonymous key public as designed, but treat RLS as the primary boundary and test it against real cross-store cases.
- Add store membership to staff authorization and require store scope in every new policy/RPC.
- Key offline pending operations by store and prevent a store switch while unsynced work is ambiguous.
- Move important writes to transactional, security-definer RPCs with strict caller/store checks.
- Revoke customer sessions on logout/PIN change and reduce customer RPC output to customer-safe fields.
- Clear sensitive cached state at logout or offer an explicit trusted-device mode.
- Replace hard deletion with soft deletion for financial records and record every lifecycle transition server-side.
- Keep attachment objects in a private bucket; expose only short-lived signed URLs after an authorization check.
- Gradually remove `unsafe-inline` from CSP by extracting inline scripts/styles; do not weaken the current policy further.

## Cheque model migration

The migration is additive and dual-compatible:

1. Preserve the legacy `status` column and add `lifecycle_status`.
2. Backfill `hold -> on_hold`, `clear -> cleared`, and `bounce -> bounced`.
3. Project rich states back to the legacy values so old clients still render usable data.
4. Add factual fields only: direction, customer/party link, issue/due/deposit dates, assignee, next action, version, and soft-deletion metadata. Existing `cheque_date` becomes the initial due date with an explicit legacy marker.
5. Derive `overdue` at display/query time; do not overwrite the underlying lifecycle state.
6. Add append-only status events, notes, follow-ups, reminders, attachment metadata, risk snapshots, anomaly findings, payment events/allocations, and saved views.
7. Route new transitions and payment allocation through transactional RPCs. Database triggers audit legacy direct updates.
8. Keep the old cheque queue as the compatibility source for “To write”; archive its conversion event before removing a queue row.

## Intelligence and AI boundary

The essential intelligence layer will be deterministic, explainable, and available offline:

- Risk scoring returns a documented version, factor scores, evidence, data completeness, and category.
- Anomaly checks use normalized cheque numbers, repeated combinations, robust amount outliers, date order, required fields, and known bounce history.
- Priority combines amount, due/overdue timing, risk, contact staleness, and promises with deterministic tie-breaking.
- Cash forecasting uses incoming cheques only. It reports “insufficient data” when direction, payment history, opening cash, or outgoing obligations are missing.
- Natural-language search produces a validated, allowlisted filter AST; it never generates or executes SQL.
- Message generation begins with reviewed templates in respectful Nepali and English.

Optional OCR or generative AI will use an authenticated same-origin server/edge adapter. Provider credentials stay in environment secrets. Requests are minimized and scrubbed; responses are schema-validated. OCR always opens a review screen and never writes directly. AI endpoints may analyze or draft, while separately confirmed RPCs perform mutations.

## Implementation sequence

### Phase 1 — foundation

- Consolidate exact light/dark tokens and semantic component states.
- Add shared accessible dialog, focus, toast, tab, debounce, and Nepal-date utilities.
- Modernize shell, sidebar, top bar, command palette, buttons, fields, cards, tables, empty/loading/error states.
- Establish responsive/mobile list patterns and remove duplicate render code as pages are migrated.

### Phase 2 — dashboard

- Add scan-friendly KPI hierarchy with comparisons.
- Add a real accessible SVG trend chart with period controls and tooltips.
- Add financial summary and one priority action centre covering overdue credit, cheques, follow-ups, and reports.
- Make quick add and notifications proper accessible surfaces.

### Phase 3 — cheque tracker

- Deploy additive schema and dual-read/write mapping.
- Add smart views, compound filters, saved views, responsive rows/cards, bulk actions, and a detail drawer.
- Add lifecycle timeline, notes, follow-up scheduling, assignee, attachments, risk explanation, anomalies, and explicit transition confirmations.

### Phase 4 — intelligence

- Ship deterministic risk, anomaly, priority, forecast sufficiency, safe filter parsing, and message templates.
- Relabel the existing bot honestly as the local smart assistant.
- Add an optional provider-independent server adapter for OCR/explanation/drafting with graceful “not configured” behavior.

### Phase 5 — hardening and handoff

- Complete keyboard, screen-reader, focus, contrast, reduced-motion, responsive, and dark-mode review.
- Add data/RLS/lifecycle/intelligence/date/security regression tests.
- Validate on local static server and Vercel-compatible runtime.
- Document migration, environment, deployment, rollback, and operator workflows in `UI_UX_AND_AI_UPGRADE_GUIDE.md`.

## Acceptance gates

- Existing users can still sign in and access existing Supabase data.
- Legacy cheque status values remain readable and writable during migration.
- No financial action occurs from AI/OCR without explicit review and confirmation.
- No provider secret or unrestricted database interface is present in the browser.
- All interactive controls are named, keyboard reachable, and visibly focused.
- Light/dark themes preserve semantic status contrast.
- Mobile layouts do not require table-width horizontal navigation for core workflows.
- Tests cover lifecycle mappings, cross-store boundaries, deterministic rules, date boundaries, confirmation gates, and unavailable-provider behavior.
- Rollback is possible through the recovery branch and additive database migration strategy.
