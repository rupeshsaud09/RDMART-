/*
 * Optional AI service client for RD MART.
 *
 * The browser supplies only a short-lived Supabase access token. Provider
 * credentials remain behind the same-origin /api/ai boundary. This client has
 * no storage or record-write capability and all successful output is marked for
 * human review. The caller should obtain explicit user consent before sending a
 * cheque image because that image is forwarded to the configured provider.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MartAIAIClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const DEFAULT_ENDPOINT = '/api/ai';
  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_REQUEST_BYTES = 2250000;
  const MAX_RESPONSE_BYTES = 131072;
  const MAX_IMAGE_BYTES = 1500000;
  const ACTIONS = Object.freeze(['extract-cheque', 'explain-risk', 'draft-message']);
  const STATES = Object.freeze({
    READY: 'READY',
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    UNAVAILABLE: 'UNAVAILABLE',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    FORBIDDEN: 'FORBIDDEN',
    INVALID_REQUEST: 'INVALID_REQUEST'
  });
  const STATUSES = Object.freeze([
    'draft', 'to_write', 'written', 'issued', 'received', 'deposited', 'hold',
    'cleared', 'bounced', 'cancelled', 'overdue'
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
    const limit = clamp(maximumLength == null ? 160 : maximumLength, 1, 4000);
    let text = String(value == null ? '' : value);
    try { text = text.normalize('NFKC'); } catch (_) { /* Older browsers. */ }
    return text
      .replace(/<[^>]{0,500}>/g, ' ')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  function byteLength(value) {
    const text = String(value == null ? '' : value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    return unescape(encodeURIComponent(text)).length;
  }

  function ownKeysOnly(object, allowed) {
    return plainObject(object) && Object.keys(object).every(key => allowed.includes(key));
  }

  function validateImageDataUrl(value) {
    const text = String(value || '');
    const match = text.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
    if (!match) return { ok: false, error: 'Image must be a JPEG, PNG, or WebP data URL.' };
    const payload = match[2];
    if (payload.length % 4 !== 0) return { ok: false, error: 'Image data is not valid base64.' };
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const decodedBytes = Math.floor(payload.length * 3 / 4) - padding;
    if (decodedBytes <= 0 || decodedBytes > MAX_IMAGE_BYTES) {
      return { ok: false, error: `Image must be no larger than ${MAX_IMAGE_BYTES} bytes.` };
    }
    let bytes;
    try {
      if (typeof atob === 'function') {
        const decoded = atob(payload.slice(0, 32));
        bytes = Array.from(decoded, character => character.charCodeAt(0));
      } else if (typeof Buffer !== 'undefined') {
        bytes = Array.from(Buffer.from(payload.slice(0, 32), 'base64'));
      } else return { ok: false, error: 'Image validation is unavailable.' };
    } catch (_) {
      return { ok: false, error: 'Image data is not valid base64.' };
    }
    const type = match[1].toLowerCase();
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
    const webp = [0x52, 0x49, 0x46, 0x46].every((byte, index) => bytes[index] === byte) &&
      [0x57, 0x45, 0x42, 0x50].every((byte, index) => bytes[index + 8] === byte);
    if ((type === 'jpeg' && !jpeg) || (type === 'png' && !png) || (type === 'webp' && !webp)) {
      return { ok: false, error: 'Image contents do not match the declared type.' };
    }
    return { ok: true, value: `data:image/${match[1].toLowerCase()};base64,${payload}`, decodedBytes };
  }

  function validateInput(action, input) {
    if (!ACTIONS.includes(action)) return { ok: false, error: 'Unsupported AI action.' };
    if (!plainObject(input)) return { ok: false, error: 'Input must be an object.' };

    if (action === 'extract-cheque') {
      if (!ownKeysOnly(input, ['imageDataUrl'])) return { ok: false, error: 'Unexpected extraction input field.' };
      const image = validateImageDataUrl(input.imageDataUrl);
      return image.ok ? { ok: true, value: { imageDataUrl: image.value } } : image;
    }

    if (action === 'explain-risk') {
      if (!ownKeysOnly(input, ['score', 'category', 'dataCompleteness', 'factors'])) {
        return { ok: false, error: 'Unexpected risk input field.' };
      }
      const score = Number(input.score);
      const completeness = plainObject(input.dataCompleteness)
        ? Number(input.dataCompleteness.score)
        : Number(input.dataCompleteness);
      const category = safeText(input.category, 16).toLowerCase();
      if (!Number.isFinite(score) || score < 0 || score > 100 || !Number.isFinite(completeness) || completeness < 0 || completeness > 100) {
        return { ok: false, error: 'Risk score and data completeness must be between 0 and 100.' };
      }
      if (!['low', 'medium', 'high', 'critical'].includes(category)) return { ok: false, error: 'Invalid risk category.' };
      if (!Array.isArray(input.factors) || input.factors.length > 20) return { ok: false, error: 'Risk factors must be a short array.' };
      const factors = [];
      for (const factor of input.factors) {
        if (!ownKeysOnly(factor, ['code', 'points'])) return { ok: false, error: 'Invalid risk factor shape.' };
        const code = safeText(factor.code, 64).toUpperCase();
        const points = Number(factor.points);
        if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code) || !Number.isFinite(points) || points < 0 || points > 100) {
          return { ok: false, error: 'Invalid risk factor.' };
        }
        factors.push({ code, points: Math.round(points) });
      }
      return { ok: true, value: { score: Math.round(score), category, dataCompleteness: Math.round(completeness), factors } };
    }

    if (!ownKeysOnly(input, ['locale', 'purpose', 'amount', 'dueDate', 'status', 'direction'])) {
      return { ok: false, error: 'Unexpected message input field.' };
    }
    const locale = input.locale === 'ne' ? 'ne' : input.locale === 'en' ? 'en' : '';
    const purpose = safeText(input.purpose, 24).toLowerCase();
    const amount = Number(input.amount);
    const dueDate = safeText(input.dueDate, 30);
    const status = safeText(input.status, 20).toLowerCase();
    const direction = safeText(input.direction, 12).toLowerCase();
    if (!locale || !['reminder', 'due_today', 'overdue', 'bounced', 'confirmation'].includes(purpose)) {
      return { ok: false, error: 'Invalid message locale or purpose.' };
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000000000) return { ok: false, error: 'Invalid cheque amount.' };
    if (dueDate && !/^[\p{L}\p{N} .,/:-]{1,30}$/u.test(dueDate)) return { ok: false, error: 'Invalid due date label.' };
    if (status && !STATUSES.includes(status)) return { ok: false, error: 'Invalid cheque status.' };
    if (direction && !['incoming', 'outgoing'].includes(direction)) return { ok: false, error: 'Invalid cheque direction.' };
    return { ok: true, value: { locale, purpose, amount, dueDate, status, direction } };
  }

  function errorResult(state, code, message, retryable) {
    return {
      ok: false,
      state,
      code: safeText(code, 64) || 'AI_CLIENT_ERROR',
      message: safeText(message, 240) || 'The optional AI service is unavailable.',
      retryable: Boolean(retryable)
    };
  }

  async function readResponseText(response, maximumBytes) {
    const declaredLength = Number(response && response.headers && response.headers.get
      ? response.headers.get('content-length')
      : 0);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error('RESPONSE_TOO_LARGE');
    if (response && response.body && typeof response.body.getReader === 'function' && typeof TextDecoder === 'function') {
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
          throw new Error('RESPONSE_TOO_LARGE');
        }
        text += decoder.decode(part.value, { stream: true });
      }
      return text + decoder.decode();
    }
    const text = await response.text();
    if (byteLength(text) > maximumBytes) throw new Error('RESPONSE_TOO_LARGE');
    return text;
  }

  function normalizeReadyResponse(payload, expectedAction) {
    if (!plainObject(payload) || !ownKeysOnly(payload, [
      'ok', 'state', 'version', 'action', 'reviewOnly', 'provider', 'model',
      'output', 'dataShared', 'disclaimer'
    ]) || payload.ok !== true || payload.state !== STATES.READY || payload.action !== expectedAction || payload.reviewOnly !== true) return null;
    if (!plainObject(payload.output)) return false;
    const output = payload.output;
    let normalizedOutput;
    if (expectedAction === 'extract-cheque') {
      if (!ownKeysOnly(output, ['fields', 'warnings']) || !plainObject(output.fields) || !Array.isArray(output.warnings) || output.warnings.length > 20 || !Object.keys(output.fields).every(key => [
        'chequeNumber', 'amount', 'bank', 'issueDate', 'dueDate', 'payee'
      ].includes(key))) return null;
      const fields = {};
      for (const key of ['chequeNumber', 'bank', 'issueDate', 'dueDate', 'payee']) {
        const value = output.fields[key];
        if (value != null && typeof value !== 'string') return null;
        fields[key] = value == null ? null : safeText(value, key === 'payee' ? 120 : 80) || null;
      }
      const amount = output.fields.amount;
      if (amount != null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1000000000000000)) return null;
      fields.amount = amount == null ? null : amount;
      if (!output.warnings.every(item => typeof item === 'string')) return null;
      normalizedOutput = { fields, warnings: output.warnings.map(item => safeText(item, 180)).filter(Boolean) };
    } else if (expectedAction === 'explain-risk') {
      if (!ownKeysOnly(output, ['summary', 'factors', 'recommendedReview']) ||
        typeof output.summary !== 'string' || !Array.isArray(output.factors) || output.factors.length > 20 ||
        typeof output.recommendedReview !== 'string') return null;
      const factors = [];
      for (const factor of output.factors) {
        if (!ownKeysOnly(factor, ['code', 'explanation']) || typeof factor.code !== 'string' || typeof factor.explanation !== 'string') return null;
        const code = safeText(factor.code, 64).toUpperCase();
        const explanation = safeText(factor.explanation, 400);
        if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code) || !explanation) return null;
        factors.push({ code, explanation });
      }
      normalizedOutput = {
        summary: safeText(output.summary, 800),
        factors,
        recommendedReview: safeText(output.recommendedReview, 500)
      };
      if (!normalizedOutput.summary || !normalizedOutput.recommendedReview) return null;
    } else {
      if (!ownKeysOnly(output, ['message', 'language', 'notes']) || typeof output.message !== 'string' ||
        !['en', 'ne'].includes(output.language) || !Array.isArray(output.notes) || output.notes.length > 10 ||
        !output.notes.every(item => typeof item === 'string')) return null;
      normalizedOutput = {
        message: safeText(output.message, 1200),
        language: output.language,
        notes: output.notes.map(item => safeText(item, 180)).filter(Boolean)
      };
      if (!normalizedOutput.message) return null;
    }
    if (!Array.isArray(payload.dataShared) || payload.dataShared.length > 10 || !payload.dataShared.every(item => typeof item === 'string')) return null;
    return {
      ok: true,
      state: STATES.READY,
      version: safeText(payload.version, 20),
      action: expectedAction,
      reviewOnly: true,
      provider: safeText(payload.provider, 40),
      model: safeText(payload.model, 128),
      output: normalizedOutput,
      dataShared: payload.dataShared.map(item => safeText(item, 80)).filter(Boolean),
      disclaimer: safeText(payload.disclaimer, 240)
    };
  }

  function validateReadyResponse(payload, expectedAction) {
    return Boolean(normalizeReadyResponse(payload, expectedAction));
  }

  function stateForHttp(status, payload) {
    if (payload && payload.code === 'AI_NOT_CONFIGURED') return STATES.NOT_CONFIGURED;
    if (status === 401) return STATES.UNAUTHENTICATED;
    if (status === 403) return STATES.FORBIDDEN;
    if (status >= 400 && status < 500) return STATES.INVALID_REQUEST;
    return STATES.UNAVAILABLE;
  }

  function createClient(options) {
    const settings = plainObject(options) ? options : {};
    const endpoint = typeof settings.endpoint === 'string' ? settings.endpoint : DEFAULT_ENDPOINT;
    if (!/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(endpoint)) throw new Error('AI endpoint must be a same-origin path.');
    const fetchImplementation = settings.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const tokenProvider = typeof settings.getAccessToken === 'function' ? settings.getAccessToken : null;
    const timeoutMs = clamp(settings.timeoutMs || DEFAULT_TIMEOUT_MS, 1000, 30000);

    async function request(action, input, requestOptions) {
      const perRequest = plainObject(requestOptions) ? requestOptions : {};
      const validation = validateInput(action, input);
      if (!validation.ok) return errorResult(STATES.INVALID_REQUEST, 'INVALID_INPUT', validation.error, false);
      if (!fetchImplementation) return errorResult(STATES.UNAVAILABLE, 'FETCH_UNAVAILABLE', 'This browser cannot reach the optional AI service.', false);

      let accessToken = typeof perRequest.accessToken === 'string' ? perRequest.accessToken : '';
      if (!accessToken && tokenProvider) {
        try { accessToken = await tokenProvider(); } catch (_) { accessToken = ''; }
      }
      if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 8192 || /\s/.test(accessToken)) {
        return errorResult(STATES.UNAUTHENTICATED, 'ACCESS_TOKEN_REQUIRED', 'Sign in again before using optional AI assistance.', false);
      }
      const storeId = perRequest.storeId == null ? '' : safeText(perRequest.storeId, 40);
      if (storeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
        return errorResult(STATES.INVALID_REQUEST, 'INVALID_STORE_ID', 'The selected store identifier is invalid.', false);
      }
      const bodyObject = { action, input: validation.value };
      if (storeId) bodyObject.storeId = storeId;
      const body = JSON.stringify(bodyObject);
      if (byteLength(body) > MAX_REQUEST_BYTES) return errorResult(STATES.INVALID_REQUEST, 'REQUEST_TOO_LARGE', 'The AI request is too large.', false);

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timedOut = false;
      const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
      const externalSignal = perRequest.signal;
      const abortFromCaller = () => controller && controller.abort();
      if (externalSignal && typeof externalSignal.addEventListener === 'function') {
        if (externalSignal.aborted) abortFromCaller();
        else externalSignal.addEventListener('abort', abortFromCaller, { once: true });
      }

      try {
        const response = await fetchImplementation(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body,
          signal: controller ? controller.signal : externalSignal
        });
        const contentType = response && response.headers && response.headers.get ? response.headers.get('content-type') || '' : '';
        if (!/\bapplication\/json\b/i.test(contentType)) {
          return errorResult(STATES.UNAVAILABLE, 'INVALID_SERVICE_RESPONSE', 'The optional AI service returned an invalid response.', true);
        }
        const text = await readResponseText(response, MAX_RESPONSE_BYTES);
        let payload;
        try { payload = JSON.parse(text); } catch (_) {
          return errorResult(STATES.UNAVAILABLE, 'INVALID_SERVICE_RESPONSE', 'The optional AI service returned unreadable data.', true);
        }
        if (!response.ok) {
          return errorResult(
            stateForHttp(response.status, payload),
            payload && payload.code,
            payload && payload.message,
            payload && payload.retryable
          );
        }
        const normalizedResponse = normalizeReadyResponse(payload, action);
        if (!normalizedResponse) {
          return errorResult(STATES.UNAVAILABLE, 'INVALID_SERVICE_SCHEMA', 'The optional AI service returned an unexpected data shape.', true);
        }
        return normalizedResponse;
      } catch (error) {
        if (timedOut) return errorResult(STATES.UNAVAILABLE, 'REQUEST_TIMEOUT', 'The optional AI service took too long to respond.', true);
        if (externalSignal && externalSignal.aborted) return errorResult(STATES.UNAVAILABLE, 'REQUEST_CANCELLED', 'The AI request was cancelled.', true);
        return errorResult(STATES.UNAVAILABLE, 'AI_SERVICE_UNAVAILABLE', 'The optional AI service could not be reached.', true);
      } finally {
        if (timer) clearTimeout(timer);
        if (externalSignal && typeof externalSignal.removeEventListener === 'function') externalSignal.removeEventListener('abort', abortFromCaller);
      }
    }

    return Object.freeze({ request });
  }

  return Object.freeze({
    VERSION,
    ACTIONS,
    STATES,
    MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
    MAX_IMAGE_BYTES,
    createClient,
    validateInput,
    validateImageDataUrl,
    validateReadyResponse,
    normalizeReadyResponse
  });
});
