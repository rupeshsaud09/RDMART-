const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

function loadStore() {
  let signOutCalls = 0;
  const localStorage = storage({
    'martai_remember_v1': 'remembered',
    'sb-project-auth-token': 'token',
    'sb-project-auth-token-code-verifier': 'verifier'
  });
  const sessionStorage = storage();
  const client = {
    auth: { async signOut() { signOutCalls += 1; } }
  };
  const sandbox = {
    Blob,
    URL,
    clearTimeout,
    console,
    localStorage,
    navigator: {},
    sessionStorage,
    setTimeout,
    window: {
      MARTAI_SUPABASE: {
        anonKey: 'public-anon-key',
        mode: 'tables',
        url: 'https://project.supabase.co'
      },
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      supabase: { createClient: () => client }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'martai_final', 'assets', 'martai-store.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.window.MartAI, localStorage, sessionStorage, signOutCalls: () => signOutCalls };
}

test('image data validator rejects attribute injection', () => {
  const { api } = loadStore();
  assert.equal(api.safeImageDataUrl('data:image/png;base64,QUJDRA=='), 'data:image/png;base64,QUJDRA==');
  assert.equal(api.safeImageDataUrl('data:image/png;base64,AAAA\" onerror=alert(1)'), '');
  assert.equal(api.safeImageDataUrl('javascript:alert(1)'), '');
});

test('logout revokes Supabase auth and clears local auth tokens', async () => {
  const state = loadStore();
  state.sessionStorage.setItem('martai_final_session', '{"role":"admin"}');
  await state.api.clearSession();
  assert.equal(state.signOutCalls(), 1);
  assert.equal(state.sessionStorage.getItem('martai_final_session'), null);
  assert.equal(state.localStorage.getItem('martai_remember_v1'), null);
  assert.equal(state.localStorage.getItem('sb-project-auth-token'), null);
  assert.equal(state.localStorage.getItem('sb-project-auth-token-code-verifier'), null);
});

test('database setup revokes anonymous legacy-state access', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'setup-complete.sql'), 'utf8');
  assert.match(sql, /revoke all on public\.martai_app_state\s+from anon;/i);
  assert.doesNotMatch(sql, /grant\s+select\s*,\s*insert\s*,\s*update\s+on public\.martai_app_state\s+to anon/i);
  assert.match(sql, /revoke execute on all functions in schema public from public;/i);
});

test('public pages pin the Supabase library with SRI', () => {
  for (const name of ['index.html', 'customer.html', 'dashboard.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'martai_final', name), 'utf8');
    assert.match(html, /@supabase\/supabase-js@2\.110\.2/);
    assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+"/);
  }
  const compatibilityStub = fs.readFileSync(path.join(__dirname, '..', 'martai_final', 'assets', 'daily-sales-baisakh-2083.js'), 'utf8');
  assert.match(compatibilityStub, /KP_DAILY_SALES_IMPORT_2083\s*=\s*\[\]/);
  assert.doesNotMatch(compatibilityStub, /\['20\d{2}-\d{2}-\d{2}'\s*,/);
});

test('all inline browser scripts compile', () => {
  for (const name of ['index.html', 'customer.html', 'dashboard.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'martai_final', name), 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    assert.ok(scripts.length > 0, `${name} should contain an inline application script`);
    scripts.forEach((source, index) => assert.doesNotThrow(
      () => new vm.Script(source, { filename: `${name}:inline-${index + 1}` })
    ));
  }
});
