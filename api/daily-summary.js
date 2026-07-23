'use strict';

/*
 * Daily business-summary notification for RD MART.
 *
 * Two ways in, both fail closed when unconfigured:
 *
 *   GET  — called once a day by Vercel Cron (see vercel.json). Authenticated
 *          only by a shared secret (CRON_SECRET), never a user session,
 *          because a scheduled job has no browser and no login. Reads
 *          business data with the Supabase SERVICE-ROLE key — the one
 *          exception in this codebase to "never touch data server-side
 *          without a caller's own session" — and that key is used ONLY in
 *          this function, gated ONLY behind CRON_SECRET, and is NEVER sent
 *          to a browser. It sends the same push/email to every registered
 *          device and the configured recipient, for each active store.
 *
 *   POST — "send me a test notification now", called from the dashboard by
 *          a signed-in admin. Uses that admin's own Supabase access token
 *          with the ANON key (exactly like every other read the dashboard
 *          already performs), so Postgres row-level security — not this
 *          file — decides what the caller may see. It only ever pushes to
 *          that same caller's own registered device(s).
 *
 * Required configuration (push):
 *   SUPABASE_URL               Supabase project URL; may reuse the browser's public config
 *   SUPABASE_ANON_KEY          public anon key; may reuse the browser's public config (POST)
 *   SUPABASE_SERVICE_ROLE_KEY  service-role key, used only for the cron-triggered GET
 *   VAPID_PUBLIC_KEY           Web Push VAPID public key (also embedded in the browser)
 *   VAPID_PRIVATE_KEY          Web Push VAPID private key
 *   VAPID_SUBJECT              contact URI required by the Web Push spec (mailto: or https:)
 *   CRON_SECRET                shared secret; Vercel Cron sends it automatically as
 *                              "Authorization: Bearer <CRON_SECRET>" once this env var exists
 *
 * Email is a second, fully independent delivery channel for the same
 * summary — useful because iOS Web Push is unreliable even when every
 * device setting is correct. It sends via the Resend API (plain HTTPS
 * call, no SDK) to a single configured recipient — this app runs one shop,
 * so a fixed recipient is simpler and more honest than building multi-user
 * email preferences nobody needs yet. Missing email env vars simply skip
 * that channel — push still works, and vice versa.
 *
 *   RESEND_API_KEY     API key from resend.com
 *   RESEND_FROM_EMAIL  verified sender, e.g. "RD MART <onboarding@resend.dev>"
 *   SUMMARY_EMAIL_TO   where the daily summary should land
 *
 * This function never reads request bodies larger than a few KB, never logs
 * subscription endpoints, push keys, or email addresses, and never returns
 * another user's data.
 */

const crypto = require('crypto');

const REQUIRED_ENV = Object.freeze([
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET'
]);
const TEST_AUTH_REQUIRED_ENV = Object.freeze(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
const PUSH_REQUIRED_ENV = Object.freeze(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
const EMAIL_REQUIRED_ENV = Object.freeze(['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'SUMMARY_EMAIL_TO']);
const NEPAL_OFFSET_MINUTES = 345; // UTC+5:45
const MAX_BODY_BYTES = 4096;
const MAX_RESPONSE_BYTES = 262144;
const MAX_AUTH_RESPONSE_BYTES = 32768;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function loadConfiguration(environment, publicConfiguration) {
  const env = environment && typeof environment === 'object' ? environment : {};
  const publicConfig = plainObject(publicConfiguration) ? publicConfiguration : {};
  const publicFallback = {
    SUPABASE_URL: publicConfig.url,
    SUPABASE_ANON_KEY: publicConfig.anonKey
  };
  const value = key => String(
    env[key] == null || String(env[key]).trim() === ''
      ? (publicFallback[key] == null ? '' : publicFallback[key])
      : env[key]
  ).trim();
  const missing = REQUIRED_ENV.filter(key => !value(key));
  const supabaseUrl = safeHttpsUrl(value('SUPABASE_URL'));
  if (!supabaseUrl && !missing.includes('SUPABASE_URL')) missing.push('SUPABASE_URL');
  const vapidSubject = value('VAPID_SUBJECT');
  const validSubject = /^(mailto:|https:\/\/)/i.test(vapidSubject);
  if (!validSubject && !missing.includes('VAPID_SUBJECT')) missing.push('VAPID_SUBJECT');
  const testAuthMissing = TEST_AUTH_REQUIRED_ENV.filter(key => !value(key));
  if (!supabaseUrl && !testAuthMissing.includes('SUPABASE_URL')) testAuthMissing.push('SUPABASE_URL');
  const pushMissing = PUSH_REQUIRED_ENV.filter(key => !value(key));
  if (!validSubject && !pushMissing.includes('VAPID_SUBJECT')) pushMissing.push('VAPID_SUBJECT');
  return {
    ok: missing.length === 0,
    missing: Object.freeze(missing),
    testAuthOk: testAuthMissing.length === 0,
    testAuthMissing: Object.freeze(testAuthMissing),
    pushOk: pushMissing.length === 0,
    pushMissing: Object.freeze(pushMissing),
    supabaseUrl: supabaseUrl ? supabaseUrl.toString().replace(/\/+$/, '') : '',
    anonKey: value('SUPABASE_ANON_KEY'),
    serviceRoleKey: value('SUPABASE_SERVICE_ROLE_KEY'),
    vapidPublicKey: value('VAPID_PUBLIC_KEY'),
    vapidPrivateKey: value('VAPID_PRIVATE_KEY'),
    vapidSubject: vapidSubject,
    cronSecret: value('CRON_SECRET')
  };
}

/* Independent of loadConfiguration(): email is an optional second channel.
   Its absence never fails the request — push keeps working without it. */
function loadEmailConfiguration(environment) {
  const env = environment && typeof environment === 'object' ? environment : {};
  const value = key => String(env[key] == null ? '' : env[key]).trim();
  const missing = EMAIL_REQUIRED_ENV.filter(key => !value(key));
  const toEmail = value('SUMMARY_EMAIL_TO');
  const toMatch = toEmail.match(/<([^<>]+)>\s*$/);
  const toAddressOnly = toMatch ? toMatch[1] : toEmail;
  if (toEmail && !EMAIL_PATTERN.test(toAddressOnly) && !missing.includes('SUMMARY_EMAIL_TO')) missing.push('SUMMARY_EMAIL_TO');
  return {
    ok: missing.length === 0,
    missing: Object.freeze(missing),
    apiKey: value('RESEND_API_KEY'),
    fromEmail: value('RESEND_FROM_EMAIL'),
    toEmail: toEmail
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendSummaryEmail(fetchImplementation, emailConfig, dateLabel, line1, line2) {
  const subject = `RD MART Daily Summary — ${dateLabel}`;
  const text = `${line1}\n${line2}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">`
    + `<p style="margin:0 0 10px;font-size:17px;font-weight:700">RD MART Daily Summary — ${escapeHtml(dateLabel)}</p>`
    + `<p style="margin:0 0 8px">${escapeHtml(line1)}</p>`
    + `<p style="margin:0">${escapeHtml(line2)}</p>`
    + `</div>`;
  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
    let response;
    try {
      response = await fetchImplementation('https://api.resend.com/emails', Object.assign(
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${emailConfig.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: emailConfig.fromEmail, to: [emailConfig.toEmail], subject, html, text })
        },
        controller ? { signal: controller.signal } : {}
      ));
    } finally {
      if (timer) clearTimeout(timer);
    }
    const respText = await readBoundedText(response, MAX_RESPONSE_BYTES);
    let data = null;
    try { data = respText ? JSON.parse(respText) : null; } catch (_) { data = null; }
    if (!response.ok) return { ok: false, error: (data && data.message) ? String(data.message).slice(0, 240) : 'Email provider rejected the message.' };
    return { ok: true, to: emailConfig.toEmail };
  } catch (_) {
    return { ok: false, error: 'Email provider could not be reached.' };
  }
}

function respond(response, status, payload) {
  const text = JSON.stringify(payload);
  if (response && typeof response.setHeader === 'function') {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  if (response) response.statusCode = status;
  if (response && typeof response.end === 'function') response.end(text);
  else if (response && typeof response.json === 'function') response.json(payload);
  return { status, payload };
}

function getHeader(request, name) {
  const headers = (request && request.headers) || {};
  const found = headers[name] === undefined ? headers[name.toLowerCase()] : headers[name];
  return Array.isArray(found) ? found[0] || '' : String(found || '');
}

/* Constant-time secret check: compare SHA-256 digests (fixed length) rather
   than the raw strings, so neither length nor content can leak by timing. */
function secretsMatch(a, b) {
  const da = crypto.createHash('sha256').update(String(a || '')).digest();
  const db = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(da, db);
}

async function readJsonBody(request) {
  if (request && plainObject(request.body)) return request.body;
  if (request && typeof request.body === 'string') {
    if (request.body.length > MAX_BODY_BYTES) throw new Error('too_large');
    return request.body ? JSON.parse(request.body) : {};
  }
  if (!request || typeof request.on !== 'function') return {};
  const chunks = [];
  let total = 0;
  await new Promise((resolve, reject) => {
    request.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) { reject(new Error('too_large')); return; }
      chunks.push(chunk);
    });
    request.on('end', resolve);
    request.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

async function readBoundedText(response, maxBytes) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('response_too_large');
  return text;
}

async function restRequest(fetchImplementation, supabaseUrl, headers, pathAndQuery, init) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
  try {
    const response = await fetchImplementation(`${supabaseUrl}/rest/v1/${pathAndQuery}`, Object.assign(
      { headers },
      init,
      controller ? { signal: controller.signal } : {}
    ));
    const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    return { ok: response.ok, status: response.status, data };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* --- Nepal-local calendar date helpers (UTC+5:45, no DST) --- */
function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function nepalTodayIso(now) {
  const shifted = new Date(now.getTime() + NEPAL_OFFSET_MINUTES * 60000);
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}
function addDaysIso(dateIso, days) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
/* The instant Nepal-local midnight of dateIso occurs, expressed in UTC —
   used to bound a timestamptz column by Nepal calendar day. */
function nepalMidnightUtcIso(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - NEPAL_OFFSET_MINUTES * 60000).toISOString();
}

function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function sumBy(rows, keys) {
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => total + keys.reduce((s, k) => s + num(row[k]), 0), 0);
}
function money(n) { return 'Rs ' + Math.round(num(n)).toLocaleString('en-IN'); }

/* Reads today/yesterday's figures for one store. `rest(table, query)` is a
   caller-supplied reader so the cron path (service-role key) and the test
   path (caller's own bearer token) can share this exact logic while using
   different credentials and therefore different Postgres RLS outcomes. */
async function buildStoreSummary(rest, storeId, today, yesterday) {
  const yStartUtc = nepalMidnightUtcIso(yesterday);
  const tStartUtc = nepalMidnightUtcIso(today);
  const [dailySales, creditGiven, creditCollected, chequesDue, chequesOverdue, pendingReports, openTasks] = await Promise.all([
    rest('daily_sales', `select=pos,fonepay,cash,finance,party_payment,other&store_id=eq.${storeId}&sale_date=eq.${yesterday}`),
    rest('credits', `select=amount&store_id=eq.${storeId}&credit_date=eq.${yesterday}`),
    rest('credits', `select=paid&store_id=eq.${storeId}&paid_at=gte.${encodeURIComponent(yStartUtc)}&paid_at=lt.${encodeURIComponent(tStartUtc)}`),
    rest('cheques', `select=amount&store_id=eq.${storeId}&status=eq.hold&cheque_date=eq.${today}`),
    rest('cheques', `select=amount&store_id=eq.${storeId}&status=eq.hold&cheque_date=lt.${today}`),
    rest('payment_requests', `select=id&store_id=eq.${storeId}&status=eq.pending`),
    rest('mart_tasks', `select=id&store_id=eq.${storeId}&status=eq.pending`)
  ]);
  const salesYesterday = sumBy(dailySales.data, ['pos', 'fonepay', 'cash', 'finance', 'party_payment', 'other']);
  const creditGivenYesterday = sumBy(creditGiven.data, ['amount']);
  const creditCollectedYesterday = sumBy(creditCollected.data, ['paid']);
  const dueCount = Array.isArray(chequesDue.data) ? chequesDue.data.length : 0;
  const dueAmount = sumBy(chequesDue.data, ['amount']);
  const overdueCount = Array.isArray(chequesOverdue.data) ? chequesOverdue.data.length : 0;
  const pendingReportCount = Array.isArray(pendingReports.data) ? pendingReports.data.length : 0;
  const openTaskCount = Array.isArray(openTasks.data) ? openTasks.data.length : 0;

  const line1 = `Yesterday: ${money(salesYesterday)} sales, ${money(creditGivenYesterday)} credit given, ${money(creditCollectedYesterday)} collected.`;
  const line2 = [
    dueCount ? `Today: ${dueCount} cheque${dueCount === 1 ? '' : 's'} due (${money(dueAmount)}).` : 'Today: no cheques due.',
    overdueCount ? `${overdueCount} on hold past due.` : '',
    (pendingReportCount || openTaskCount) ? `${pendingReportCount} payment report${pendingReportCount === 1 ? '' : 's'} waiting, ${openTaskCount} open task${openTaskCount === 1 ? '' : 's'}.` : ''
  ].filter(Boolean).join(' ');

  return {
    title: 'RD MART — Daily summary',
    body: `${line1} ${line2}`.trim().slice(0, 480),
    url: 'dashboard.html',
    tag: `martai-daily-summary-${today}`,
    dateLabel: today,
    line1: line1,
    line2: line2,
    counts: { salesYesterday, creditGivenYesterday, creditCollectedYesterday, dueCount, dueAmount, overdueCount, pendingReportCount, openTaskCount }
  };
}

async function sendToSubscriptions(webpush, configuration, subscriptions, payload) {
  const results = await Promise.allSettled(subscriptions.map(row =>
    webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } },
      JSON.stringify(payload),
      { vapidDetails: { subject: configuration.vapidSubject, publicKey: configuration.vapidPublicKey, privateKey: configuration.vapidPrivateKey } }
    ).then(() => ({ id: row.id, ok: true })).catch(error => ({ id: row.id, ok: false, statusCode: error && error.statusCode, message: error && error.message }))
  ));
  return results.map(r => (r.status === 'fulfilled' ? r.value : { ok: false, message: 'send_failed' }));
}

async function pruneAndMark(fetchImplementation, configuration, results, rowsById) {
  const headers = {
    apikey: configuration.serviceRoleKey,
    Authorization: `Bearer ${configuration.serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal'
  };
  await Promise.allSettled(results.map(result => {
    if (!result || !result.id || !rowsById.has(result.id)) return null;
    const gone = result.statusCode === 404 || result.statusCode === 410;
    if (gone) {
      return restRequest(fetchImplementation, configuration.supabaseUrl, headers, `push_subscriptions?id=eq.${result.id}`, { method: 'DELETE' });
    }
    const patch = result.ok
      ? { last_notified_at: new Date().toISOString(), last_error: '' }
      : { last_error: String(result.message || 'send_failed').slice(0, 200) };
    return restRequest(fetchImplementation, configuration.supabaseUrl, headers, `push_subscriptions?id=eq.${result.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }));
}

/* --- GET: cron-triggered send to every registered device + configured email, every store --- */
async function handleCron(request, response, configuration, emailConfiguration, fetchImplementation, webpush) {
  const provided = getHeader(request, 'authorization').replace(/^Bearer\s+/i, '');
  if (!secretsMatch(provided, configuration.cronSecret)) {
    return respond(response, 401, { ok: false, state: 'UNAUTHENTICATED', error: 'A valid schedule secret is required.' });
  }
  const headers = { apikey: configuration.serviceRoleKey, Authorization: `Bearer ${configuration.serviceRoleKey}` };
  const rest = (table, query) => restRequest(fetchImplementation, configuration.supabaseUrl, headers, `${table}?${query}`);

  const [subscriptionsResult, storesResult] = await Promise.all([
    rest('push_subscriptions', 'select=id,store_id,endpoint,p256dh,auth_key'),
    emailConfiguration.ok ? rest('mart_stores', 'select=id&is_active=eq.true') : Promise.resolve({ ok: true, data: [] })
  ]);
  if (!subscriptionsResult.ok || !Array.isArray(subscriptionsResult.data)) {
    return respond(response, 502, { ok: false, state: 'UPSTREAM_ERROR', error: 'Could not read registered devices.' });
  }
  const pushByStore = new Map();
  subscriptionsResult.data.forEach(row => {
    if (!row || !row.store_id) return;
    if (!pushByStore.has(row.store_id)) pushByStore.set(row.store_id, []);
    pushByStore.get(row.store_id).push(row);
  });
  const emailStoreIds = new Set((Array.isArray(storesResult.data) ? storesResult.data : []).map(row => row && row.id).filter(Boolean));
  const storeIds = new Set([...pushByStore.keys(), ...emailStoreIds]);

  const today = nepalTodayIso(new Date());
  const yesterday = addDaysIso(today, -1);

  let pushSent = 0, pushFailed = 0, pushPruned = 0, emailSent = 0, emailFailed = 0;
  for (const storeId of storeIds) {
    const rows = pushByStore.get(storeId) || [];
    let payload;
    try {
      payload = await buildStoreSummary(rest, storeId, today, yesterday);
    } catch (_) {
      pushFailed += rows.length;
      if (emailStoreIds.has(storeId)) emailFailed += 1;
      continue;
    }
    if (rows.length) {
      const results = await sendToSubscriptions(webpush, configuration, rows, payload);
      const rowsById = new Map(rows.map(r => [r.id, r]));
      results.forEach(r => {
        if (r.ok) pushSent += 1;
        else if (r.statusCode === 404 || r.statusCode === 410) pushPruned += 1;
        else pushFailed += 1;
      });
      await pruneAndMark(fetchImplementation, configuration, results, rowsById);
    }
    if (emailConfiguration.ok && emailStoreIds.has(storeId)) {
      const emailResult = await sendSummaryEmail(fetchImplementation, emailConfiguration, payload.dateLabel, payload.line1, payload.line2);
      if (emailResult.ok) emailSent += 1; else emailFailed += 1;
    }
  }
  return respond(response, 200, {
    ok: true,
    state: 'SENT',
    stores: storeIds.size,
    push: { sent: pushSent, failed: pushFailed, pruned: pushPruned },
    email: { sent: emailSent, failed: emailFailed }
  });
}

/* --- POST: authenticated "send me a test notification" from the dashboard --- */
function sameOriginRequest(request) {
  const origin = getHeader(request, 'origin');
  if (!origin) return true;
  const host = (getHeader(request, 'x-forwarded-host').split(',')[0].trim()) || getHeader(request, 'host').trim();
  if (!host) return false;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch (_) { return false; }
}

async function authenticateCaller(request, configuration, fetchImplementation) {
  const match = getHeader(request, 'authorization').match(/^Bearer ([A-Za-z0-9._~-]{20,8192})$/);
  if (!match) return { ok: false, status: 401, message: 'A valid access token is required.' };
  const headers = { Accept: 'application/json', apikey: configuration.anonKey, Authorization: `Bearer ${match[1]}` };
  let userResponse;
  try {
    userResponse = await restRequestAuth(fetchImplementation, configuration.supabaseUrl, headers);
  } catch (_) {
    return { ok: false, status: 503, message: 'Authentication could not be verified.' };
  }
  if (!userResponse.ok || !userResponse.data || !/^[0-9a-f-]{36}$/i.test(String(userResponse.data.id || ''))) {
    return { ok: false, status: 401, message: 'Your session has expired. Please sign in again.' };
  }
  return { ok: true, bearer: match[1], headers };
}

async function restRequestAuth(fetchImplementation, supabaseUrl, headers) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
  try {
    const response = await fetchImplementation(`${supabaseUrl}/auth/v1/user`, Object.assign({ headers }, controller ? { signal: controller.signal } : {}));
    const text = await readBoundedText(response, MAX_AUTH_RESPONSE_BYTES);
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    return { ok: response.ok, data };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function roleCheck(fetchImplementation, configuration, authHeaders, functionName, body) {
  try {
    const result = await restRequest(fetchImplementation, configuration.supabaseUrl, Object.assign({ 'Content-Type': 'application/json' }, authHeaders), `rpc/${functionName}`, { method: 'POST', body: JSON.stringify(body || {}) });
    return result.ok && typeof result.data === 'boolean' ? result.data : false;
  } catch (_) {
    return false;
  }
}

async function handleTestSend(request, response, configuration, emailConfiguration, fetchImplementation, webpush) {
  if (!sameOriginRequest(request)) return respond(response, 403, { ok: false, error: 'Cross-origin requests are not accepted.' });
  if (!/^application\/json(?:\s*;|$)/i.test(getHeader(request, 'content-type'))) {
    return respond(response, 415, { ok: false, error: 'Content-Type must be application/json.' });
  }
  let body;
  try { body = await readJsonBody(request); }
  catch (error) { return respond(response, 400, { ok: false, error: error.message === 'too_large' ? 'Request body is too large.' : 'Invalid JSON body.' }); }
  const storeId = String((body && body.storeId) || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    return respond(response, 400, { ok: false, error: 'A valid store identifier is required.' });
  }
  const auth = await authenticateCaller(request, configuration, fetchImplementation);
  if (!auth.ok) return respond(response, auth.status, { ok: false, error: auth.message });

  const admin = await roleCheck(fetchImplementation, configuration, auth.headers, 'is_mart_admin');
  const storeAdmin = admin ? true : await roleCheck(fetchImplementation, configuration, auth.headers, 'is_store_admin', { target_store: storeId });
  if (!admin && !storeAdmin) return respond(response, 403, { ok: false, error: 'Only an admin can send a test notification.' });

  const rest = (table, query) => restRequest(fetchImplementation, configuration.supabaseUrl, auth.headers, `${table}?${query}`);
  let subscriptions = [], pushError = null;
  if (configuration.pushOk) {
    const subscriptionsResult = await rest('push_subscriptions', `select=id,endpoint,p256dh,auth_key&store_id=eq.${storeId}`);
    if (subscriptionsResult.ok && Array.isArray(subscriptionsResult.data)) subscriptions = subscriptionsResult.data;
    else {
      pushError = 'Could not read this device\'s registration.';
      if (!emailConfiguration.ok) return respond(response, 502, { ok: false, error: pushError });
    }
  } else {
    pushError = 'Push is not configured on this server.';
  }

  const today = nepalTodayIso(new Date());
  const yesterday = addDaysIso(today, -1);
  let payload;
  try { payload = await buildStoreSummary(rest, storeId, today, yesterday); }
  catch (_) { return respond(response, 502, { ok: false, error: 'Could not build the summary.' }); }
  payload.tag = 'martai-daily-summary-test';

  let pushSent = 0;
  if (subscriptions.length) {
    const results = await sendToSubscriptions(webpush, configuration, subscriptions, payload);
    pushSent = results.filter(r => r.ok).length;
    if (!pushSent && results.length) pushError = 'The registered device rejected the test notification.';
  }

  let email = { attempted: false, sent: false, to: null, error: null };
  if (!emailConfiguration.ok) {
    email.error = 'Email is not configured yet.';
  } else {
    email.attempted = true;
    const emailResult = await sendSummaryEmail(fetchImplementation, emailConfiguration, payload.dateLabel, payload.line1, payload.line2);
    email.sent = emailResult.ok;
    email.to = emailResult.ok ? emailResult.to : null;
    email.error = emailResult.ok ? null : emailResult.error;
  }

  return respond(response, 200, {
    ok: true,
    sent: pushSent,
    push: { configured: configuration.pushOk, sent: pushSent, error: pushError },
    email: email
  });
}

function createHandler(dependencies) {
  const settings = plainObject(dependencies) ? dependencies : {};
  const environment = settings.env || process.env;
  let publicConfiguration = settings.publicConfig;
  if (publicConfiguration === undefined) {
    try { publicConfiguration = require('../martai_final/assets/martai-supabase-config.js'); }
    catch (_) { publicConfiguration = {}; }
  }
  const fetchImplementation = settings.fetch || (typeof fetch === 'function' ? fetch : null);
  const webpush = settings.webpush || require('web-push');

  return async function dailySummaryHandler(request, response) {
    if (!request || !response) return;
    const configuration = loadConfiguration(environment, publicConfiguration);
    const emailConfiguration = loadEmailConfiguration(environment);
    const method = String(request.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      if (typeof response.setHeader === 'function') response.setHeader('Allow', 'GET, POST');
      return respond(response, 405, { ok: false, error: 'Only GET and POST are supported.' });
    }
    if (!fetchImplementation) return respond(response, 500, { ok: false, error: 'No fetch implementation available.' });
    if (method === 'GET') {
      if (!configuration.ok) {
        return respond(response, 200, { ok: false, state: 'NOT_CONFIGURED', message: 'Scheduled daily summaries are not configured yet.', missing: configuration.missing });
      }
      return handleCron(request, response, configuration, emailConfiguration, fetchImplementation, webpush);
    }
    if (!configuration.testAuthOk) {
      return respond(response, 200, { ok: false, state: 'NOT_CONFIGURED', message: 'Daily summary testing is not connected to the database yet.', missing: configuration.testAuthMissing });
    }
    if (!configuration.pushOk && !emailConfiguration.ok) {
      return respond(response, 200, {
        ok: false,
        state: 'NOT_CONFIGURED',
        message: 'Configure push notifications or summary email before sending a test.',
        missing: { push: configuration.pushMissing, email: emailConfiguration.missing }
      });
    }
    return handleTestSend(request, response, configuration, emailConfiguration, fetchImplementation, webpush);
  };
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports._test = Object.freeze({
  loadConfiguration,
  loadEmailConfiguration,
  secretsMatch,
  nepalTodayIso,
  addDaysIso,
  nepalMidnightUtcIso,
  buildStoreSummary,
  sameOriginRequest,
  REQUIRED_ENV,
  TEST_AUTH_REQUIRED_ENV,
  PUSH_REQUIRED_ENV,
  EMAIL_REQUIRED_ENV
});
