'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const aiClientModule = require('../assets/martai-ai-client.js');
const aiService = require('../../api/ai.js');

function responseRecorder() {
  const result = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    end(text) { this.body = JSON.parse(String(text)); }
  };
  return result;
}

function configuredEnvironment() {
  return {
    MARTAI_AI_PROVIDER: 'openai-compatible',
    MARTAI_AI_MODEL: 'test-model-v1',
    MARTAI_AI_API_KEY: 'provider-test-key-12345',
    MARTAI_AI_BASE_URL: 'https://provider.example/v1',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'public-anon-test-key'
  };
}

function riskRequest(overrides) {
  return Object.assign({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer header.payload.signature'
    },
    body: {
      action: 'explain-risk',
      input: {
        score: 42,
        category: 'medium',
        dataCompleteness: 86,
        factors: [{ code: 'DUE_SOON', points: 5 }]
      }
    }
  }, overrides || {});
}

test('server fails closed with a clear NOT_CONFIGURED state and never calls a provider', async () => {
  let fetchCalls = 0;
  const handler = aiService.createHandler({ env: {}, fetch: async () => { fetchCalls += 1; throw new Error('must not run'); } });
  const response = responseRecorder();

  await handler(riskRequest(), response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.state, 'NOT_CONFIGURED');
  assert.equal(response.body.code, 'AI_NOT_CONFIGURED');
  assert.ok(response.body.requiredEnvironment.includes('MARTAI_AI_API_KEY'));
  assert.equal(fetchCalls, 0);
});

test('only the three read-only actions and their exact schemas are accepted', async () => {
  let fetchCalls = 0;
  const handler = aiService.createHandler({
    env: configuredEnvironment(),
    fetch: async () => { fetchCalls += 1; throw new Error('validation must run first'); }
  });

  const invalidActionResponse = responseRecorder();
  await handler(riskRequest({ body: { action: 'delete-cheque', input: {} } }), invalidActionResponse);
  assert.equal(invalidActionResponse.statusCode, 400);
  assert.equal(invalidActionResponse.body.code, 'INVALID_ACTION');

  const sqlResponse = responseRecorder();
  await handler(riskRequest({
    body: {
      action: 'explain-risk',
      input: { score: 20, category: 'low', dataCompleteness: 100, factors: [], sql: 'select * from cheques' }
    }
  }), sqlResponse);
  assert.equal(sqlResponse.statusCode, 400);
  assert.equal(sqlResponse.body.code, 'UNSAFE_FIELD');
  assert.equal(fetchCalls, 0);
});

test('an authenticated request rejects an invalid provider response without leaking it', async () => {
  const seenUrls = [];
  const fetchStub = async (url, init) => {
    seenUrls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/is_mart_admin')) {
      assert.equal(init.method, 'POST');
      return new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'not valid structured JSON and must stay private' } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const handler = aiService.createHandler({ env: configuredEnvironment(), fetch: fetchStub });
  const response = responseRecorder();

  await handler(riskRequest(), response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.code, 'AI_PROVIDER_INVALID_RESPONSE');
  assert.doesNotMatch(JSON.stringify(response.body), /must stay private/);
  assert.ok(seenUrls.some(url => url === 'https://provider.example/v1/chat/completions'));
});

test('provider output must match the action schema and may not introduce actions', () => {
  const input = {
    score: 42,
    category: 'medium',
    dataCompleteness: 90,
    factors: [{ code: 'DUE_SOON', points: 5 }]
  };
  assert.equal(aiService._test.validateProviderOutput('explain-risk', {
    summary: 'Review is recommended.',
    factors: [{ code: 'DUE_SOON', explanation: 'The cheque is due shortly.' }],
    recommendedReview: 'Verify the date with the source record.',
    action: 'clear-cheque'
  }, input).ok, false);
  assert.equal(aiService._test.validateProviderOutput('explain-risk', {
    summary: 'Review is recommended.',
    factors: [{ code: 'INVENTED_FACTOR', explanation: 'Unsupported.' }],
    recommendedReview: 'Review it.'
  }, input).ok, false);
});

test('configuration rejects a service-role key in the anon-key slot', () => {
  const servicePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const environment = configuredEnvironment();
  environment.SUPABASE_ANON_KEY = `header.${servicePayload}.signature`;
  const result = aiService._test.loadConfiguration(environment);

  assert.equal(result.ok, false);
  assert.ok(result.invalid.includes('SUPABASE_ANON_KEY_MUST_NOT_BE_SERVICE_ROLE'));
});

test('browser client exposes NOT_CONFIGURED without throwing and sends no provider credential', async () => {
  let requestOptions;
  const client = aiClientModule.createClient({
    getAccessToken: async () => 'header.payload.signature',
    fetch: async (_url, options) => {
      requestOptions = options;
      return new Response(JSON.stringify({
        ok: false,
        state: 'NOT_CONFIGURED',
        code: 'AI_NOT_CONFIGURED',
        message: 'Optional AI assistance is not configured.',
        retryable: false
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
  });

  const result = await client.request('explain-risk', {
    score: 20,
    category: 'low',
    dataCompleteness: 100,
    factors: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, aiClientModule.STATES.NOT_CONFIGURED);
  assert.match(requestOptions.headers.Authorization, /^Bearer /);
  assert.equal('X-API-Key' in requestOptions.headers, false);

  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'martai-ai-client.js'), 'utf8');
  assert.doesNotMatch(clientSource, /MARTAI_AI_API_KEY|SUPABASE_ANON_KEY|service_role|\bsk-[A-Za-z0-9]/);
});

test('browser client validates unsupported actions locally without a network call', async () => {
  let calls = 0;
  const client = aiClientModule.createClient({
    getAccessToken: async () => 'header.payload.signature',
    fetch: async () => { calls += 1; throw new Error('must not run'); }
  });

  const result = await client.request('run-sql', { sql: 'delete from cheques' });
  assert.equal(result.state, aiClientModule.STATES.INVALID_REQUEST);
  assert.equal(calls, 0);
});
