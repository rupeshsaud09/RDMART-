'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const handler = require(path.join(__dirname, '..', '..', 'api', 'notify-whatsapp.js'));
const helpers = handler._test;

const FULL_ENV = Object.freeze({
  WHATSAPP_TOKEN: 'x'.repeat(30),
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_TEMPLATE_NAME: 'task_assigned',
  WHATSAPP_TEMPLATE_LANG: 'en',
  SUPABASE_URL: 'https://demo.supabase.co',
  SUPABASE_ANON_KEY: 'anon'.repeat(5)
});

function mockResponse() {
  const out = { status: 0, payload: null };
  return {
    statusCode: 0,
    setHeader() {},
    end(text) { out.payload = JSON.parse(text); out.status = this.statusCode; },
    _out: out
  };
}

async function invoke(request, options) {
  const response = mockResponse();
  await handler(request, response, options);
  return response._out;
}

const okFetch = async () => ({ ok: true, status: 200, text: async () => '{}' });

test('configuration is missing until every required variable is present', () => {
  assert.equal(helpers.loadConfiguration({}).ok, false);
  assert.equal(helpers.loadConfiguration({}).missing.length, helpers.REQUIRED_ENV.length);
  assert.equal(helpers.loadConfiguration(FULL_ENV).ok, true);
});

test('phone numbers normalise to E.164 digits and reject junk', () => {
  assert.equal(helpers.normalizePhone('9812345678', '977'), '9779812345678');
  assert.equal(helpers.normalizePhone('+977 98-1234-5678', '977'), '9779812345678');
  assert.equal(helpers.normalizePhone('00977 9812345678', '977'), '9779812345678');
  assert.equal(helpers.normalizePhone('123', '977'), '');
  assert.equal(helpers.normalizePhone('', '977'), '');
});

test('template message carries exactly the three ordered body parameters', () => {
  const message = helpers.buildTemplateMessage(helpers.loadConfiguration(FULL_ENV), '9779812345678', ['Ram', 'Restock shelf', '2083 Shrawan 5']);
  assert.equal(message.messaging_product, 'whatsapp');
  assert.equal(message.template.name, 'task_assigned');
  assert.equal(message.template.language.code, 'en');
  const params = message.template.components[0].parameters;
  assert.equal(params.length, 3);
  assert.deepEqual(params.map(p => p.text), ['Ram', 'Restock shelf', '2083 Shrawan 5']);
});

test('non-POST is rejected', async () => {
  const result = await invoke({ method: 'GET', headers: {} }, { env: FULL_ENV, fetch: okFetch });
  assert.equal(result.status, 405);
});

test('unconfigured deployment fails closed without sending', async () => {
  const result = await invoke({ method: 'POST', headers: {}, body: {} }, { env: {}, fetch: okFetch });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.state, 'NOT_CONFIGURED');
});

test('a missing or invalid access token is rejected before any provider call', async () => {
  let providerCalled = false;
  const fetchImpl = async (url) => {
    if (String(url).includes('graph.facebook.com')) providerCalled = true;
    return { ok: false, status: 401, text: async () => '{}' };
  };
  const result = await invoke({ method: 'POST', headers: {}, body: { to: '9812345678', title: 'x' } }, { env: FULL_ENV, fetch: fetchImpl });
  assert.equal(result.status, 401);
  assert.equal(result.payload.state, 'UNAUTHENTICATED');
  assert.equal(providerCalled, false);
});

test('an authenticated request sends the template and returns the message id', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/auth/v1/user')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: '11111111-1111-1111-1111-111111111111' }) };
    if (String(url).includes('graph.facebook.com')) return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }) };
    return { ok: false, status: 404, text: async () => '{}' };
  };
  const request = { method: 'POST', headers: { authorization: 'Bearer ' + 'a'.repeat(40) }, body: { to: '9812345678', staffName: 'Ram', title: 'Restock', dueDate: '2083 Shrawan 5' } };
  const result = await invoke(request, { env: FULL_ENV, fetch: fetchImpl });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.state, 'SENT');
  assert.equal(result.payload.to, '9779812345678');
  assert.equal(result.payload.messageId, 'wamid.TEST');
});

test('a valid request with no task title is rejected', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/auth/v1/user')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: '11111111-1111-1111-1111-111111111111' }) };
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const request = { method: 'POST', headers: { authorization: 'Bearer ' + 'a'.repeat(40) }, body: { to: '9812345678', staffName: 'Ram' } };
  const result = await invoke(request, { env: FULL_ENV, fetch: fetchImpl });
  assert.equal(result.status, 400);
});
