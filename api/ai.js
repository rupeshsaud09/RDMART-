'use strict';

/*
 * Optional, provider-independent AI boundary for RD MART.
 *
 * Required server-only environment variables:
 *   MARTAI_AI_PROVIDER   openai | groq | openrouter | openai-compatible
 *   MARTAI_AI_MODEL      provider model identifier
 *   MARTAI_AI_API_KEY    provider credential
 *   MARTAI_AI_BASE_URL   HTTPS OpenAI-compatible API base (for example .../v1)
 *   SUPABASE_URL         Supabase project URL
 *   SUPABASE_ANON_KEY    public anon key used with the caller's bearer token
 *
 * A Supabase service-role key is intentionally neither required nor supported.
 * When authentication or provider configuration is incomplete, this function
 * fails closed. It never reads or writes business tables, and its three allowed
 * actions return review-only suggestions.
 */

const VERSION = '1.0.0';
const ACTIONS = Object.freeze(['extract-cheque', 'explain-risk', 'draft-message']);
const PROVIDERS = Object.freeze(['openai', 'groq', 'openrouter', 'openai-compatible']);
const REQUIRED_ENVIRONMENT = Object.freeze([
  'MARTAI_AI_PROVIDER',
  'MARTAI_AI_MODEL',
  'MARTAI_AI_API_KEY',
  'MARTAI_AI_BASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY'
]);
const MAX_REQUEST_BYTES = 2250000;
const MAX_IMAGE_BYTES = 1500000;
const MAX_AUTH_RESPONSE_BYTES = 32768;
const MAX_PROVIDER_RESPONSE_BYTES = 196608;
const MAX_PROVIDER_CONTENT_BYTES = 65536;
const STATUSES = Object.freeze([
  'draft', 'to_write', 'written', 'issued', 'received', 'deposited', 'hold',
  'cleared', 'bounced', 'cancelled', 'overdue'
]);
const FORBIDDEN_KEYS = new Set([
  '__proto__', 'prototype', 'constructor', 'sql', 'query', 'statement', 'mutation',
  'command', 'commands', 'write', 'writes', 'insert', 'update', 'delete', 'upsert',
  'execute', 'action', 'actions', 'tool', 'tools', 'function', 'functions', 'function_call', 'callback',
  'url', 'endpoint', 'apiKey', 'api_key', 'secret', 'password', 'pin', 'token'
]);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
}

function safeText(value, maximumLength) {
  const limit = clamp(maximumLength == null ? 160 : maximumLength, 1, 5000);
  let text = String(value == null ? '' : value);
  try { text = text.normalize('NFKC'); } catch (_) { /* Older runtimes. */ }
  return text
    .replace(/<[^>]{0,500}>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function byteLength(value) {
  return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
}

function getHeader(request, name) {
  const headers = request && request.headers ? request.headers : {};
  const direct = headers[name] === undefined ? headers[name.toLowerCase()] : headers[name];
  if (Array.isArray(direct)) return direct[0] || '';
  return String(direct || '');
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname === '::1') return null;
    if (/^(?:0|10|127|169\.254|192\.168)\./.test(hostname)) return null;
    if (/^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f:]*$/i.test(hostname) || /^::ffff:(?:0|10|127|169\.254|192\.168)\./i.test(hostname)) return null;
    const private172 = hostname.match(/^172\.(\d{1,3})\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return null;
    if (url.port && url.port !== '443') return null;
    return url;
  } catch (_) {
    return null;
  }
}

function jwtRole(value) {
  try {
    const parts = String(value || '').split('.');
    if (parts.length !== 3) return '';
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return safeText(payload && payload.role, 40);
  } catch (_) {
    return '';
  }
}

function loadConfiguration(environment) {
  const env = environment || {};
  const missing = REQUIRED_ENVIRONMENT.filter(name => !String(env[name] || '').trim());
  if (missing.length) return { ok: false, code: 'MISSING_ENVIRONMENT', missing };
  const provider = String(env.MARTAI_AI_PROVIDER).trim().toLowerCase();
  const model = String(env.MARTAI_AI_MODEL).trim();
  const providerKey = String(env.MARTAI_AI_API_KEY).trim();
  const providerBaseUrl = safeHttpsUrl(env.MARTAI_AI_BASE_URL);
  const supabaseUrl = safeHttpsUrl(env.SUPABASE_URL);
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY).trim();
  const invalid = [];
  if (!PROVIDERS.includes(provider)) invalid.push('MARTAI_AI_PROVIDER');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) invalid.push('MARTAI_AI_MODEL');
  if (providerKey.length < 8 || providerKey.length > 4096 || /[\r\n]/.test(providerKey)) invalid.push('MARTAI_AI_API_KEY');
  if (!providerBaseUrl) invalid.push('MARTAI_AI_BASE_URL');
  if (!supabaseUrl) invalid.push('SUPABASE_URL');
  if (supabaseAnonKey.length < 10 || supabaseAnonKey.length > 8192 || /\s/.test(supabaseAnonKey)) invalid.push('SUPABASE_ANON_KEY');
  if (jwtRole(supabaseAnonKey) === 'service_role') invalid.push('SUPABASE_ANON_KEY_MUST_NOT_BE_SERVICE_ROLE');
  if (invalid.length) return { ok: false, code: 'INVALID_ENVIRONMENT', invalid };
  return {
    ok: true,
    provider,
    model,
    providerKey,
    providerBaseUrl: providerBaseUrl.toString().replace(/\/+$/, ''),
    supabaseUrl: supabaseUrl.toString().replace(/\/+$/, ''),
    supabaseAnonKey
  };
}

function sendJson(response, status, payload) {
  const text = JSON.stringify(payload);
  response.statusCode = status;
  if (typeof response.setHeader === 'function') {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Vary', 'Authorization');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Length', Buffer.byteLength(text));
  }
  if (typeof response.end === 'function') response.end(text);
  else if (typeof response.json === 'function') response.json(payload);
}

function failure(code, message, retryable, state) {
  return {
    ok: false,
    state: state || 'UNAVAILABLE',
    code,
    message,
    retryable: Boolean(retryable)
  };
}

function sameOriginRequest(request) {
  const origin = getHeader(request, 'origin');
  if (!origin) return true;
  const forwardedHost = getHeader(request, 'x-forwarded-host').split(',')[0].trim();
  const host = forwardedHost || getHeader(request, 'host').trim();
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch (_) {
    return false;
  }
}

async function readRequestBody(request) {
  const declared = Number(getHeader(request, 'content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return { ok: false, code: 'REQUEST_TOO_LARGE' };
  let raw = '';
  if (Buffer.isBuffer(request.body)) raw = request.body.toString('utf8');
  else if (typeof request.body === 'string') raw = request.body;
  else if (request.body !== undefined && request.body !== null) {
    try { raw = JSON.stringify(request.body); } catch (_) { return { ok: false, code: 'INVALID_JSON' }; }
  } else if (request && typeof request[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_REQUEST_BYTES) return { ok: false, code: 'REQUEST_TOO_LARGE' };
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (!raw || byteLength(raw) > MAX_REQUEST_BYTES) return { ok: false, code: raw ? 'REQUEST_TOO_LARGE' : 'EMPTY_BODY' };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (_) {
    return { ok: false, code: 'INVALID_JSON' };
  }
}

function hasForbiddenKey(value, depth) {
  if (depth > 6) return true;
  if (Array.isArray(value)) return value.some(item => hasForbiddenKey(item, depth + 1));
  if (!plainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!(depth === 0 && key === 'action') && FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey(value[key], depth + 1)) return true;
  }
  return false;
}

function ownKeysOnly(object, allowed) {
  return plainObject(object) && Object.keys(object).every(key => allowed.includes(key));
}

function validateImageDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return { ok: false, message: 'Image must be a JPEG, PNG, or WebP data URL.' };
  const payload = match[2];
  if (payload.length % 4 !== 0) return { ok: false, message: 'Image data is not valid base64.' };
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const decodedBytes = Math.floor(payload.length * 3 / 4) - padding;
  if (decodedBytes <= 0 || decodedBytes > MAX_IMAGE_BYTES) return { ok: false, message: 'Cheque image is too large.' };
  let bytes;
  try { bytes = Buffer.from(payload.slice(0, 32), 'base64'); } catch (_) { return { ok: false, message: 'Image data is not valid base64.' }; }
  const type = match[1].toLowerCase();
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if ((type === 'jpeg' && !jpeg) || (type === 'png' && !png) || (type === 'webp' && !webp)) {
    return { ok: false, message: 'Image contents do not match the declared type.' };
  }
  return { ok: true, value: `data:image/${match[1].toLowerCase()};base64,${payload}`, decodedBytes };
}

function validateRequestBody(body) {
  if (!plainObject(body) || !ownKeysOnly(body, ['action', 'input', 'storeId'])) {
    return { ok: false, code: 'INVALID_BODY', message: 'Request body contains unexpected fields.' };
  }
  if (hasForbiddenKey(body, 0)) return { ok: false, code: 'UNSAFE_FIELD', message: 'Action, SQL, credential, and write fields are not accepted.' };
  const action = safeText(body.action, 40);
  if (!ACTIONS.includes(action)) return { ok: false, code: 'INVALID_ACTION', message: 'This AI action is not allowed.' };
  if (!plainObject(body.input)) return { ok: false, code: 'INVALID_INPUT', message: 'Input must be an object.' };
  const storeId = body.storeId == null ? '' : safeText(body.storeId, 40);
  if (storeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    return { ok: false, code: 'INVALID_STORE_ID', message: 'The selected store identifier is invalid.' };
  }

  if (action === 'extract-cheque') {
    if (!ownKeysOnly(body.input, ['imageDataUrl'])) return { ok: false, code: 'INVALID_INPUT', message: 'Unexpected extraction input field.' };
    const image = validateImageDataUrl(body.input.imageDataUrl);
    if (!image.ok) return { ok: false, code: 'INVALID_IMAGE', message: image.message };
    return { ok: true, value: { action, storeId, input: { imageDataUrl: image.value } } };
  }

  if (action === 'explain-risk') {
    if (!ownKeysOnly(body.input, ['score', 'category', 'dataCompleteness', 'factors'])) {
      return { ok: false, code: 'INVALID_INPUT', message: 'Unexpected risk input field.' };
    }
    const score = Number(body.input.score);
    const completeness = plainObject(body.input.dataCompleteness)
      ? Number(body.input.dataCompleteness.score)
      : Number(body.input.dataCompleteness);
    const category = safeText(body.input.category, 16).toLowerCase();
    if (!Number.isFinite(score) || score < 0 || score > 100 || !Number.isFinite(completeness) || completeness < 0 || completeness > 100) {
      return { ok: false, code: 'INVALID_INPUT', message: 'Risk score and data completeness must be between 0 and 100.' };
    }
    if (!['low', 'medium', 'high', 'critical'].includes(category)) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid risk category.' };
    if (!Array.isArray(body.input.factors) || body.input.factors.length > 20) return { ok: false, code: 'INVALID_INPUT', message: 'Risk factors must be a short array.' };
    const factors = [];
    for (const factor of body.input.factors) {
      if (!ownKeysOnly(factor, ['code', 'points'])) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid risk factor shape.' };
      const code = safeText(factor.code, 64).toUpperCase();
      const points = Number(factor.points);
      if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code) || !Number.isFinite(points) || points < 0 || points > 100) {
        return { ok: false, code: 'INVALID_INPUT', message: 'Invalid risk factor.' };
      }
      factors.push({ code, points: Math.round(points) });
    }
    return {
      ok: true,
      value: { action, storeId, input: { score: Math.round(score), category, dataCompleteness: Math.round(completeness), factors } }
    };
  }

  if (!ownKeysOnly(body.input, ['locale', 'purpose', 'amount', 'dueDate', 'status', 'direction'])) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Unexpected message input field.' };
  }
  const locale = body.input.locale === 'ne' ? 'ne' : body.input.locale === 'en' ? 'en' : '';
  const purpose = safeText(body.input.purpose, 24).toLowerCase();
  const amount = Number(body.input.amount);
  const dueDate = safeText(body.input.dueDate, 30);
  const status = safeText(body.input.status, 20).toLowerCase();
  const direction = safeText(body.input.direction, 12).toLowerCase();
  if (!locale || !['reminder', 'due_today', 'overdue', 'bounced', 'confirmation'].includes(purpose)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Invalid message locale or purpose.' };
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000000000) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid cheque amount.' };
  if (dueDate && !/^[\p{L}\p{N} .,/:-]{1,30}$/u.test(dueDate)) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid due date label.' };
  if (status && !STATUSES.includes(status)) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid cheque status.' };
  if (direction && !['incoming', 'outgoing'].includes(direction)) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid cheque direction.' };
  return { ok: true, value: { action, storeId, input: { locale, purpose, amount, dueDate, status, direction } } };
}

async function readResponseText(response, maximumBytes) {
  const declaredLength = Number(response && response.headers && response.headers.get
    ? response.headers.get('content-length')
    : 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error('REMOTE_RESPONSE_TOO_LARGE');
  if (response && response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = '';
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximumBytes) {
        try { await reader.cancel(); } catch (_) { /* Best effort. */ }
        throw new Error('REMOTE_RESPONSE_TOO_LARGE');
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  }
  const text = await response.text();
  if (byteLength(text) > maximumBytes) throw new Error('REMOTE_RESPONSE_TOO_LARGE');
  return text;
}

async function fetchWithTimeout(fetchImplementation, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(url, Object.assign({}, init, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(fetchImplementation, url, init, timeoutMs, maximumBytes) {
  const response = await fetchWithTimeout(fetchImplementation, url, init, timeoutMs);
  const text = await readResponseText(response, maximumBytes);
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* Invalid remote JSON is handled by caller. */ }
  return { ok: response.ok, status: response.status, data };
}

async function authenticateAndAuthorize(request, configuration, storeId, fetchImplementation) {
  const authorization = getHeader(request, 'authorization');
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]{20,8192})$/);
  if (!match) return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'A valid Supabase access token is required.', retryable: false };
  const bearer = match[1];
  const headers = {
    Accept: 'application/json',
    apikey: configuration.supabaseAnonKey,
    Authorization: `Bearer ${bearer}`
  };
  let userResponse;
  try {
    userResponse = await fetchJson(
      fetchImplementation,
      `${configuration.supabaseUrl}/auth/v1/user`,
      { method: 'GET', headers },
      8000,
      MAX_AUTH_RESPONSE_BYTES
    );
  } catch (_) {
    return { ok: false, status: 503, code: 'AUTH_UNAVAILABLE', message: 'Authentication could not be verified.', retryable: true };
  }
  if (userResponse.status === 401 || userResponse.status === 403) {
    return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.', retryable: false };
  }
  if (!userResponse.ok || !plainObject(userResponse.data) || !/^[0-9a-f-]{36}$/i.test(String(userResponse.data.id || ''))) {
    return { ok: false, status: 503, code: 'AUTH_UNAVAILABLE', message: 'Authentication could not be verified.', retryable: true };
  }

  async function roleCheck(functionName, body) {
    try {
      const result = await fetchJson(
        fetchImplementation,
        `${configuration.supabaseUrl}/rest/v1/rpc/${functionName}`,
        {
          method: 'POST',
          headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(body || {})
        },
        8000,
        MAX_AUTH_RESPONSE_BYTES
      );
      return result.ok && typeof result.data === 'boolean' ? { ok: true, allowed: result.data } : { ok: false, allowed: false };
    } catch (_) {
      return { ok: false, allowed: false };
    }
  }

  const admin = await roleCheck('is_mart_admin');
  if (!admin.ok) return { ok: false, status: 503, code: 'AUTHORIZATION_UNAVAILABLE', message: 'Your RD MART role could not be verified.', retryable: true };
  if (admin.allowed) return { ok: true, role: 'admin' };
  const staff = await roleCheck('is_mart_staff');
  if (!staff.ok) return { ok: false, status: 503, code: 'AUTHORIZATION_UNAVAILABLE', message: 'Your RD MART role could not be verified.', retryable: true };
  if (staff.allowed) return { ok: true, role: 'staff' };
  if (storeId) {
    const storeAdmin = await roleCheck('is_store_admin', { target_store: storeId });
    if (!storeAdmin.ok) return { ok: false, status: 503, code: 'AUTHORIZATION_UNAVAILABLE', message: 'Your RD MART role could not be verified.', retryable: true };
    if (storeAdmin.allowed) return { ok: true, role: 'store_admin' };
  }
  return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Your RD MART role cannot use this service.', retryable: false };
}

function buildProviderRequest(action, input, configuration) {
  const system = [
    'You are an optional, review-only assistant inside a cheque management application.',
    'Return one JSON object matching the requested schema and no markdown.',
    'Never propose or claim to execute a write, payment, database query, or status change.',
    'Never request passwords, PINs, OTPs, account credentials, or additional personal data.',
    'Do not invent missing facts, confidence scores, probabilities, or legal/credit conclusions.'
  ].join(' ');
  let user;
  if (action === 'extract-cheque') {
    user = [
      {
        type: 'text',
        text: 'Read only visible cheque fields. Return {"fields":{"chequeNumber":string|null,"amount":number|null,"bank":string|null,"issueDate":string|null,"dueDate":string|null,"payee":string|null},"warnings":string[]}. Use null when unreadable. Dates must remain exactly as visibly written.'
      },
      { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'auto' } }
    ];
  } else if (action === 'explain-risk') {
    user = `Explain this deterministic operational score without calling it a probability or credit rating. Return {"summary":string,"factors":[{"code":string,"explanation":string}],"recommendedReview":string}. Only explain supplied factor codes: ${JSON.stringify(input)}`;
  } else {
    user = `Draft one respectful, non-threatening cheque message with a generic salutation and no personal name. Never ask for credentials. Return {"message":string,"language":"${input.locale}","notes":string[]}. Supplied non-identifying details: ${JSON.stringify(input)}`;
  }
  return {
    model: configuration.model,
    temperature: 0,
    max_tokens: action === 'extract-cheque' ? 700 : 500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
}

function providerMessageContent(payload) {
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : null;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(item => item && item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('');
  return '';
}

function parseProviderContent(content) {
  if (typeof content !== 'string' || !content.trim() || byteLength(content) > MAX_PROVIDER_CONTENT_BYTES) return null;
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    return plainObject(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function containsSensitiveRequest(text) {
  return /\b(?:password|passcode|pin|otp|cvv|secret|login credential)\b|https?:\/\/|\bwww\./i.test(String(text || ''));
}

function validateProviderOutput(action, output, input) {
  if (!plainObject(output) || hasForbiddenKey(output, 1)) return { ok: false };
  if (action === 'extract-cheque') {
    if (!ownKeysOnly(output, ['fields', 'warnings']) || !plainObject(output.fields) || !ownKeysOnly(output.fields, [
      'chequeNumber', 'amount', 'bank', 'issueDate', 'dueDate', 'payee'
    ]) || !Array.isArray(output.warnings) || output.warnings.length > 20) return { ok: false };
    const fields = {};
    for (const key of ['chequeNumber', 'bank', 'issueDate', 'dueDate', 'payee']) {
      const value = output.fields[key];
      if (value == null || value === '') fields[key] = null;
      else {
        if (typeof value !== 'string') return { ok: false };
        fields[key] = safeText(value, key === 'payee' ? 120 : 80) || null;
      }
    }
    const numericAmount = output.fields.amount == null || output.fields.amount === ''
      ? null
      : Number(String(output.fields.amount).replace(/[,\s]/g, ''));
    if (numericAmount != null && (!Number.isFinite(numericAmount) || numericAmount < 0 || numericAmount > 1000000000000000)) return { ok: false };
    fields.amount = numericAmount == null ? null : Math.round((numericAmount + Number.EPSILON) * 100) / 100;
    const warnings = [];
    for (const warning of output.warnings) {
      if (typeof warning !== 'string') return { ok: false };
      const text = safeText(warning, 180);
      if (text) warnings.push(text);
    }
    return { ok: true, value: { fields, warnings } };
  }

  if (action === 'explain-risk') {
    if (!ownKeysOnly(output, ['summary', 'factors', 'recommendedReview']) || typeof output.summary !== 'string' ||
      typeof output.recommendedReview !== 'string' || !Array.isArray(output.factors) || output.factors.length > 20) return { ok: false };
    const allowedCodes = new Set(input.factors.map(factor => factor.code));
    const factors = [];
    for (const factor of output.factors) {
      if (!ownKeysOnly(factor, ['code', 'explanation'])) return { ok: false };
      const code = safeText(factor.code, 64).toUpperCase();
      const explanation = safeText(factor.explanation, 400);
      if (!allowedCodes.has(code) || !explanation) return { ok: false };
      factors.push({ code, explanation });
    }
    const summary = safeText(output.summary, 800);
    const recommendedReview = safeText(output.recommendedReview, 500);
    if (!summary || !recommendedReview || containsSensitiveRequest(`${summary} ${recommendedReview}`)) return { ok: false };
    return { ok: true, value: { summary, factors, recommendedReview } };
  }

  if (!ownKeysOnly(output, ['message', 'language', 'notes']) || typeof output.message !== 'string' ||
    output.language !== input.locale || !Array.isArray(output.notes) || output.notes.length > 10) return { ok: false };
  const message = safeText(output.message, 1200);
  if (!message || containsSensitiveRequest(message)) return { ok: false };
  const notes = [];
  for (const note of output.notes) {
    if (typeof note !== 'string') return { ok: false };
    const text = safeText(note, 180);
    if (text) notes.push(text);
  }
  return { ok: true, value: { message, language: output.language, notes } };
}

async function callProvider(action, input, configuration, fetchImplementation) {
  const endpoint = new URL('chat/completions', `${configuration.providerBaseUrl}/`).toString();
  const providerRequest = buildProviderRequest(action, input, configuration);
  let response;
  try {
    response = await fetchJson(
      fetchImplementation,
      endpoint,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${configuration.providerKey}`
        },
        body: JSON.stringify(providerRequest)
      },
      25000,
      MAX_PROVIDER_RESPONSE_BYTES
    );
  } catch (_) {
    return { ok: false, status: 503, code: 'AI_PROVIDER_UNAVAILABLE', message: 'The configured AI provider could not be reached.', retryable: true };
  }
  if (!response.ok) {
    const configurationError = response.status === 401 || response.status === 403 || response.status === 404;
    return {
      ok: false,
      status: configurationError ? 503 : 502,
      code: configurationError ? 'AI_PROVIDER_CONFIGURATION_ERROR' : 'AI_PROVIDER_UNAVAILABLE',
      message: configurationError ? 'The optional AI provider configuration needs attention.' : 'The optional AI provider is temporarily unavailable.',
      retryable: !configurationError
    };
  }
  if (!plainObject(response.data)) return { ok: false, status: 502, code: 'AI_PROVIDER_INVALID_RESPONSE', message: 'The AI provider returned invalid data.', retryable: true };
  const parsed = parseProviderContent(providerMessageContent(response.data));
  const validated = parsed && validateProviderOutput(action, parsed, input);
  if (!validated || !validated.ok) return { ok: false, status: 502, code: 'AI_PROVIDER_INVALID_RESPONSE', message: 'The AI provider returned an unexpected data shape.', retryable: true };
  return { ok: true, output: validated.value };
}

function sharedDataFor(action) {
  if (action === 'extract-cheque') return ['cheque image'];
  if (action === 'explain-risk') return ['risk score', 'risk category', 'data completeness', 'factor codes and points'];
  return ['language', 'message purpose', 'amount', 'due-date label', 'status', 'direction'];
}

function createHandler(dependencies) {
  const settings = dependencies && plainObject(dependencies) ? dependencies : {};
  const environment = settings.env || process.env;
  const fetchImplementation = settings.fetch || global.fetch;

  return async function aiHandler(request, response) {
    if (!request || !response) return;
    if (String(request.method || 'GET').toUpperCase() !== 'POST') {
      if (typeof response.setHeader === 'function') response.setHeader('Allow', 'POST');
      return sendJson(response, 405, failure('METHOD_NOT_ALLOWED', 'Use POST for this endpoint.', false, 'INVALID_REQUEST'));
    }
    const configuration = loadConfiguration(environment);
    if (!configuration.ok) {
      return sendJson(response, 503, Object.assign(
        failure('AI_NOT_CONFIGURED', 'Optional AI assistance is not configured. Deterministic tools remain available.', false, 'NOT_CONFIGURED'),
        { requiredEnvironment: REQUIRED_ENVIRONMENT }
      ));
    }
    if (!sameOriginRequest(request)) return sendJson(response, 403, failure('CROSS_ORIGIN_FORBIDDEN', 'Cross-origin AI requests are not accepted.', false, 'FORBIDDEN'));
    if (!/^application\/json(?:\s*;|$)/i.test(getHeader(request, 'content-type'))) {
      return sendJson(response, 415, failure('CONTENT_TYPE_REQUIRED', 'Content-Type must be application/json.', false, 'INVALID_REQUEST'));
    }
    const parsedBody = await readRequestBody(request);
    if (!parsedBody.ok) {
      const status = parsedBody.code === 'REQUEST_TOO_LARGE' ? 413 : 400;
      return sendJson(response, status, failure(parsedBody.code, 'The request body is missing, invalid, or too large.', false, 'INVALID_REQUEST'));
    }
    const validated = validateRequestBody(parsedBody.value);
    if (!validated.ok) return sendJson(response, 400, failure(validated.code, validated.message, false, 'INVALID_REQUEST'));
    if (typeof fetchImplementation !== 'function') {
      return sendJson(response, 503, failure('AI_SERVICE_UNAVAILABLE', 'Server fetch support is unavailable.', false, 'UNAVAILABLE'));
    }
    const authorization = await authenticateAndAuthorize(
      request,
      configuration,
      validated.value.storeId,
      fetchImplementation
    );
    if (!authorization.ok) {
      const state = authorization.status === 401 ? 'UNAUTHENTICATED' : authorization.status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE';
      return sendJson(response, authorization.status, failure(authorization.code, authorization.message, authorization.retryable, state));
    }
    const provider = await callProvider(validated.value.action, validated.value.input, configuration, fetchImplementation);
    if (!provider.ok) return sendJson(response, provider.status, failure(provider.code, provider.message, provider.retryable, 'UNAVAILABLE'));
    return sendJson(response, 200, {
      ok: true,
      state: 'READY',
      version: VERSION,
      action: validated.value.action,
      reviewOnly: true,
      provider: configuration.provider,
      model: configuration.model,
      output: provider.output,
      dataShared: sharedDataFor(validated.value.action),
      disclaimer: 'Review and confirm this suggestion. No RD MART record was changed.'
    });
  };
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports._test = Object.freeze({
  ACTIONS,
  PROVIDERS,
  REQUIRED_ENVIRONMENT,
  loadConfiguration,
  safeHttpsUrl,
  validateImageDataUrl,
  validateRequestBody,
  validateProviderOutput,
  buildProviderRequest,
  parseProviderContent,
  sameOriginRequest
});
