# Daily summary — setup guide

Once a day, RD MART sends a short digest — yesterday's sales, credit given
and collected, today's cheques due, and pending reports/tasks — to your
phone. Two independent channels, either can work without the other:

- **Push notification** — opt-in per phone/browser from Settings → "Daily
  summary" → **Enable push on this phone**. No setup below is needed for
  this channel; it just doesn't display reliably on iPhone even when every
  setting is correct (a known iOS/WebKit limitation, not a bug here).
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
   browser when the schedule fires.
2. That function reads yesterday's/today's figures with the Supabase
   **service-role** key (the one place in this app that key is used) and
   sends the same summary to every registered push device and the
   configured email address.
3. The **Send test summary** button in Settings calls the same endpoint
   with your own login session instead, so you can check delivery without
   waiting for the schedule.

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

In **Vercel → your project → Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | the API key from step 1.2 |
| `RESEND_FROM_EMAIL` | e.g. `RD MART <onboarding@resend.dev>` or your own verified domain address |
| `SUMMARY_EMAIL_TO` | the email address that should receive the daily summary |

Redeploy after adding them.

## 3. Test

- Sign in as admin → **Settings → Daily summary → Send test summary**.
- The toast reports each channel separately, e.g. *"Push: not enabled on
  this phone. Email: sent to owner@example.com."*
- Check your inbox (and spam folder, especially on the first send from a
  new sender address).

## Troubleshooting

- **"Email is not configured yet":** one of the three env vars above is
  missing — recheck step 2 and redeploy.
- **"Email failed: …"** with a Resend error message: common causes are an
  unverified `RESEND_FROM_EMAIL` domain, or `SUMMARY_EMAIL_TO` malformed.
- **Nothing in inbox but the toast said "sent":** check spam/junk first —
  new sending domains and the shared `resend.dev` test sender are more
  likely to be filtered until your domain builds sending reputation.

## Notes / limits

- One recipient, one email address — this app runs a single shop, so a
  fixed `SUMMARY_EMAIL_TO` is simpler than building per-user email
  preferences nobody needs yet.
- The email contains only the same aggregate figures as the push
  notification — no cheque images, account numbers, or customer-level data.
