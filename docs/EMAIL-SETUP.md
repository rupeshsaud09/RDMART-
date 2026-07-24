# Daily summary — setup guide

Once a day, RD MART sends a short digest — yesterday's sales, credit given
and collected, today's cheques due, and pending reports/tasks — to your
phone. Two independent channels, either can work without the other:

- **Push notification** — opt-in per phone/browser from Settings → "Daily
  summary" → **Enable push on this phone**. It just doesn't display reliably
  on iPhone even when every setting is correct (a known iOS/WebKit
  limitation, not a bug here).
- **Email** — this guide. Uses the **Resend** API (a transactional email
  service) via a plain HTTPS call — no SDK, no SMTP password stored
  anywhere. Sends to one configured recipient, since this app runs a single
  shop.

If email isn't configured, push still works on its own, and vice versa —
neither channel blocks the other.

## How it works

1. Vercel Cron calls **`/api/daily-summary`** once a day (`vercel.json`,
   `15 1 * * *` = 07:00 Nepal time), authenticated only by `CRON_SECRET` —
   there's no user session at that point, since nobody is sitting at a
   browser when the schedule fires. This scheduled run reads business data
   with the Supabase **service-role** key and needs the *full* env var list
   below (see the note at the bottom — this includes VAPID push keys even
   if you only care about email, a current limitation).
2. The **Send test summary** button in Settings calls the same endpoint
   with your own login session instead — this path is deliberately more
   lenient (see step 3) so you can test email delivery without setting up
   push or cron at all.
3. For both the scheduled run and the test button, `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` don't need to be set as Vercel env vars — the
   function automatically falls back to the same public config already
   committed in `martai_final/assets/martai-supabase-config.js` (the one
   the browser itself uses). Set them as env vars only if you want this
   function to point at a *different* Supabase project than the browser.

## 1. Create a Resend account and API key (one time)

1. Go to **resend.com** → sign up (free tier: 3,000 emails/month, 100/day —
   this feature sends at most a few emails a day).
2. **API Keys → Create API Key**. Copy it — it's your `RESEND_API_KEY`.
3. **Sender address** — two options:
   - **Quick start, no domain needed:** use Resend's own test sender,
     `onboarding@resend.dev`. Works immediately but only reliably delivers
     to the email address you signed up to Resend with.
   - **Your own domain:** **Domains → Add Domain**, add the DNS records
     Resend gives you (a few minutes at your domain registrar, DNS
     propagation can take longer), then send from any address at that
     domain, e.g. `RD MART <notifications@yourdomain.com>`.

## 2. Set the environment variables (Vercel)

**To test the email channel right now**, you only need three variables —
nothing Supabase-related, nothing push-related:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | the API key from step 1.2 |
| `RESEND_FROM_EMAIL` | e.g. `RD MART <onboarding@resend.dev>` or your own verified domain address |
| `SUMMARY_EMAIL_TO` | the email address that should receive the daily summary — plain address or `Name <address>` |

Redeploy, then Settings → **Send test summary**.

**For the summary to actually go out on the daily schedule** (not just on
demand), the scheduled run additionally needs everything below — this
includes the push/VAPID variables even if you don't want push, because the
scheduled path hasn't been given the same relaxed requirements as the test
button (see **Notes / limits**):

| Variable | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` secret (legacy JWT-style key) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | a Web Push VAPID keypair + contact URI (`mailto:` or `https://`) — needed to satisfy the scheduled run even if no phone ever enables push |
| `CRON_SECRET` | any random string; Vercel Cron sends it automatically as `Authorization: Bearer <CRON_SECRET>` once this env var exists |

If your Supabase project uses the newer key format, set `SUPABASE_SECRET_KEY`
(the opaque `sb_secret_...` key) instead of `SUPABASE_SERVICE_ROLE_KEY` — both
are accepted.

## 3. Test

- Sign in as admin → **Settings → Daily summary → Send test summary**.
- The toast reports each channel separately, e.g. *"Push: not enabled on
  this phone. Email: sent to owner@example.com."*
- Check your inbox (and spam folder, especially on the first send from a
  new sender address).

## Troubleshooting

- **"Daily summary testing is not connected to the database yet"**: the
  function couldn't resolve a Supabase URL/anon key from either env vars
  or the committed public config — check that
  `martai_final/assets/martai-supabase-config.js` is actually deployed and
  contains real values.
- **"Configure push notifications or summary email before sending a
  test"**: neither channel has its required variables set — add at least
  the 3 Resend ones above.
- **"Email failed: …"** with a Resend error message: common causes are an
  unverified `RESEND_FROM_EMAIL` domain, or `SUMMARY_EMAIL_TO` malformed.
- **"Scheduled daily summaries are not configured yet"** (only relevant to
  the automatic daily run, not the test button): one of the full set in
  step 2's second table is missing — recheck and redeploy.
- **Nothing in inbox but the toast said "sent"**: check spam/junk first —
  new sending domains and the shared `resend.dev` test sender are more
  likely to be filtered until your domain builds sending reputation.

## Notes / limits

- One recipient, one email address — this app runs a single shop, so a
  fixed `SUMMARY_EMAIL_TO` is simpler than building per-user email
  preferences nobody needs yet.
- The email contains only the same aggregate figures as the push
  notification — no cheque images, account numbers, or customer-level data.
- **Known inconsistency**: the manual test button only needs the channel
  you're actually testing (email *or* push) plus basic Supabase auth. The
  automated daily cron run was not given the same treatment — it still
  requires the complete variable list (service-role key, all three VAPID
  variables, cron secret) before it will run at all, even for a store that
  only wants email. If you've already set up push (even if push itself
  doesn't display reliably on your phone), this doesn't block you — the
  keys being present is enough to satisfy the check. It only matters if
  you want email-only with zero push setup at all.
