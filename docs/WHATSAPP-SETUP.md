# WhatsApp task alerts — setup guide

When an admin assigns a task to a staff member, the staff gets a WhatsApp
message on their phone automatically. This uses the **WhatsApp Cloud API** (from
Meta). The code is already wired; you only need to do the one-time Meta setup
below and add each staff member's WhatsApp number in the app.

## How it works

1. Admin assigns a task in the dashboard.
2. The browser calls the same-origin endpoint **`/api/notify-whatsapp`** with the
   admin's Supabase login token (so only signed-in users can trigger it).
3. That server function sends a **pre-approved WhatsApp template** to the staff
   member's number. Your WhatsApp token never touches the browser.

If WhatsApp isn't configured yet, task assignment still works — it just skips the
alert silently.

---

## 1. Create the WhatsApp Cloud API app (one time)

1. Go to **developers.facebook.com** → **My Apps** → **Create App** →
   type **Business**.
2. In the app, add the **WhatsApp** product.
3. In **WhatsApp → API Setup** you'll see a test sender number and a
   **Phone number ID** — copy that ID. (For production, add and verify your own
   business number; the test number can only message a few numbers you add
   manually, which is fine for trying it out.)
4. Create a **permanent access token** (the 24-hour token in the UI expires):
   **Business Settings → Users → System users → Add** a system user (Admin) →
   **Generate token** → select your app → grant **`whatsapp_business_messaging`**
   and **`whatsapp_business_management`**. Copy this token — it's your
   `WHATSAPP_TOKEN`.

## 2. Create the message template (one time)

Business-initiated messages must use an approved template.

1. **WhatsApp Manager → Message templates → Create template**.
2. Category: **Utility**. Name: **`task_assigned`**. Language: **English**.
3. Body (must have exactly **3** variables, in this order):

   ```
   Namaste {{1}} 🙏 New task assigned: "{{2}}". Due: {{3}}. Open KHATA PANA to see the details.
   ```

   - `{{1}}` = staff name
   - `{{2}}` = task title
   - `{{3}}` = due date (or "No due date")

4. Add sample values and submit. Utility templates are usually approved quickly.

> If you use a different template name or language, set `WHATSAPP_TEMPLATE_NAME`
> and `WHATSAPP_TEMPLATE_LANG` to match (see below). Keep the 3 body variables in
> the same order.

## 3. Set the environment variables (Vercel)

In **Vercel → your project → Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `WHATSAPP_TOKEN` | the permanent token from step 1.4 |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID from step 1.3 |
| `WHATSAPP_TEMPLATE_NAME` | `task_assigned` |
| `WHATSAPP_TEMPLATE_LANG` | `en` |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_ANON_KEY` | your Supabase anon (public) key |

Optional: `WHATSAPP_API_VERSION` (default `v21.0`), `WHATSAPP_DEFAULT_COUNTRY`
(default `977` for Nepal — used to turn a 10-digit `98…` number into full
international format).

Redeploy after adding them.

## 4. Add staff WhatsApp numbers (in the app)

1. Sign in as admin → **Settings → Staff access**.
2. For each staff member, enter their **WhatsApp phone** (10-digit `98…` is fine —
   it's auto-converted to `977…`) and save. This also works for staff you already
   added — just re-enter the email with the phone.

Numbers are stored in your synced settings, so no database migration is needed.

## 5. Test

- Assign a task to a staff member who has a phone saved.
- You should see a toast **"WhatsApp alert sent to …"** and the message arrives on
  their phone.
- Assigning to **"All staff"** notifies every active staff member who has a phone.

## Troubleshooting

- **Nothing happens / no toast:** the phone number isn't saved for that staff, or
  the app is in local-only mode (no Supabase login token). WhatsApp alerts only
  fire in live Supabase mode.
- **"WhatsApp alert failed: …":** the message is the Meta error. Common causes:
  the template name/language doesn't match, the template isn't approved yet, or
  (on the test number) the recipient isn't in your allowed-numbers list.
- **"not configured":** one of the environment variables is missing — recheck
  step 3 and redeploy.

## Notes / limits

- The **test** sender number can only message numbers you add manually in the
  Meta dashboard. Add a verified business number for real use.
- Meta may charge per conversation depending on your country and volume; utility
  templates are the cheapest category.
- The endpoint sends only the template with the three fields above — no cheque
  images, account numbers, or other sensitive data.

> The daily business-summary notification (Settings → "Daily summary") is a
> separate feature and does **not** use WhatsApp — see `docs/EMAIL-SETUP.md`
> for its email channel, and push notifications need no setup here at all.
