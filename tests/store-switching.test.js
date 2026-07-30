'use strict';

// Regression tests for multi-store switching in martai-store.js.
// Bugs covered (all real, found 2026-07-29):
//   1. Pending offline records were flushed to Supabase under the NEW store's id
//      after a switch, silently moving data between stores.
//   2. A queued save could run after setActiveStoreId() and mis-tag records the
//      same way (store id is now pinned when the save is queued).
//   3. A slow load started before a switch could finish after it and overwrite
//      the new store's data with the old store's (generation guard).
//   4. A failed load of the new store left the app pointing at the new store
//      while holding the old store's data, so every page rendered empty
//      (switchStore now rolls back).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const STORE_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'martai_final', 'assets', 'martai-store.js'), 'utf8');

function memoryStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null
  };
}

function createFakeSupabase(remote, network) {
  remote._seq = remote._seq || 0;
  const uuid = () => '00000000-0000-4000-8000-' + String(++remote._seq).padStart(12, '0');
  const rows = name => (remote[name] = remote[name] || []);
  function makeQuery(name) {
    const q = {
      _op: 'select', _filters: [], _payload: null, _single: '', _conflict: null,
      select() { return q; },
      eq(col, val) { q._filters.push([col, val]); return q; },
      order() { return q; }, limit() { return q; },
      maybeSingle() { q._single = 'maybe'; return q; },
      single() { q._single = 'one'; return q; },
      update(p) { q._op = 'update'; q._payload = p; return q; },
      upsert(p, opts) { q._op = 'upsert'; q._payload = p; q._conflict = opts && opts.onConflict; return q; },
      insert(p) { q._op = 'insert'; q._payload = p; return q; },
      delete() { q._op = 'delete'; return q; },
      then(res, rej) { return q._exec().then(res, rej); },
      async _exec() {
        const delay = network.delay ? network.delay(name, q._filters) : 0;
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (!network.online) return { data: null, error: { message: 'Failed to fetch' } };
        if (network.tableError === name) return { data: null, error: { code: '42501', message: 'permission denied for table ' + name } };
        const all = rows(name);
        const match = r => q._filters.every(([c, v]) => r[c] === v);
        if (q._op === 'select') {
          const out = all.filter(match);
          if (q._single) return { data: out[0] || null, error: q._single === 'one' && !out[0] ? { message: 'no rows' } : null };
          return { data: out, error: null };
        }
        if (q._op === 'update') {
          const hit = all.filter(match);
          hit.forEach(r => Object.assign(r, q._payload));
          return { data: q._single ? (hit[0] ? { id: hit[0].id } : null) : hit.map(r => ({ id: r.id })), error: null };
        }
        if (q._op === 'insert') {
          const row = { id: uuid(), ...q._payload };
          all.push(row);
          return { data: q._single ? { id: row.id } : [{ id: row.id }], error: null };
        }
        if (q._op === 'upsert') {
          const key = q._conflict || 'id';
          const existing = all.find(r => q._payload[key] != null && r[key] === q._payload[key]);
          if (existing) { Object.assign(existing, q._payload); return { data: q._single ? { id: existing.id } : [{ id: existing.id }], error: null }; }
          const row = { id: q._payload.id || uuid(), ...q._payload };
          all.push(row);
          return { data: q._single ? { id: row.id } : [{ id: row.id }], error: null };
        }
        if (q._op === 'delete') {
          remote[name] = all.filter(r => !match(r));
          return { data: null, error: null };
        }
        return { data: null, error: { message: 'unsupported op' } };
      }
    };
    return q;
  }
  return {
    from: name => makeQuery(name),
    rpc: async fn => {
      if (!network.online) return { data: null, error: { message: 'Failed to fetch' } };
      if (fn === 'hash_pin') return { data: 'hashed-pin', error: null };
      return { data: null, error: null };
    },
    auth: {
      async signOut() { return {}; },
      async getSession() { return { data: { session: network.session === false ? null : { user: {} } } }; }
    },
    channel: () => ({ on() { return this; }, subscribe() {} })
  };
}

function seedRemote() {
  return {
    mart_stores: [
      { id: 'store-a', name: 'Store A', phone: '', is_active: true, created_at: '2026-01-01T00:00:00Z' },
      { id: 'store-b', name: 'Store B', phone: '', is_active: true, created_at: '2026-01-02T00:00:00Z' }
    ],
    sales: [
      { id: 'sale-row-a', legacy_id: 'seed_a1', store_id: 'store-a', sale_date: '2026-07-28', party: 'A-party', amount: 100, note: '', created_at: '2026-07-28T05:00:00Z' },
      { id: 'sale-row-b', legacy_id: 'seed_b1', store_id: 'store-b', sale_date: '2026-07-28', party: 'B-party', amount: 200, note: '', created_at: '2026-07-28T06:00:00Z' }
    ]
  };
}

async function boot() {
  const remote = seedRemote();
  const network = { online: true, delay: null };
  const client = createFakeSupabase(remote, network);
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage({ martai_final_session: JSON.stringify({ role: 'admin', email: 'admin@test.local' }) }),
    navigator: {},
    addEventListener() {},
    MARTAI_SUPABASE: { url: 'https://fake.supabase.co', anonKey: 'fake-key', mode: 'tables' },
    supabase: { createClient: () => client }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(STORE_SOURCE, sandbox);
  await sandbox.MartAI.ready;
  return { A: sandbox.MartAI, remote, network };
}

test('boot picks the first real store when none is selected', async () => {
  const { A } = await boot();
  assert.equal(A.getActiveStoreId(), 'store-a');
  const db = A.getDB();
  assert.equal(db.sales.length, 1);
  assert.equal(db.sales[0].party, 'A-party');
  assert.equal(db.sales[0].storeId, 'store-a');
});

test('offline changes are flushed to the store they were created in, not the switch target', async () => {
  const { A, remote, network } = await boot();
  network.online = false;
  A.addSale(A.getDB(), { amount: 500, party: 'Offline Sale' });
  await new Promise(r => setTimeout(r, 20)); // let the failed remote save settle
  network.online = true;

  await A.switchStore('store-b');

  const flushed = remote.sales.find(r => r.party === 'Offline Sale');
  assert.ok(flushed, 'offline sale must reach Supabase during the switch');
  assert.equal(flushed.store_id, 'store-a', 'offline sale must keep its original store');
  assert.equal(A.getActiveStoreId(), 'store-b');
  const db = A.getDB();
  assert.deepEqual(Array.from(db.sales, s => s.party), ['B-party'], 'after switching, only store B data is loaded');
});

test('a save queued before a legacy setActiveStoreId call keeps the old store id', async () => {
  const { A, remote } = await boot();
  A.addSale(A.getDB(), { amount: 700, party: 'Queued Sale' });
  A.setActiveStoreId('store-b'); // legacy-style direct repoint while the save is still queued
  await A.syncNow();

  const saved = remote.sales.find(r => r.party === 'Queued Sale');
  assert.ok(saved, 'queued sale must reach Supabase');
  assert.equal(saved.store_id, 'store-a', 'queued sale is pinned to the store it was created in');
  assert.equal(A.getActiveStoreId(), 'store-b');
  assert.deepEqual(Array.from(A.getDB().sales, s => s.party), ['B-party']);
});

test('a slow stale load cannot overwrite the newly switched store', async () => {
  const { A, network } = await boot();
  // store-a row queries crawl; everything else is fast.
  network.delay = (name, filters) => filters.some(([c, v]) => c === 'store_id' && v === 'store-a') ? 40 : 1;
  const slowLoad = A.syncNow();          // starts loading store A
  await new Promise(r => setTimeout(r, 10)); // let it pass the store-list query and start row queries
  await A.switchStore('store-b');        // supersedes the slow load
  await slowLoad;                        // stale load finishes afterwards
  await new Promise(r => setTimeout(r, 80));

  assert.equal(A.getActiveStoreId(), 'store-b');
  assert.deepEqual(Array.from(A.getDB().sales, s => s.party), ['B-party'], 'stale store A load must be discarded');
});

test('a failed switch rolls back to the previous store instead of showing empty data', async () => {
  const { A, network } = await boot();
  network.online = false;

  await assert.rejects(() => A.switchStore('store-b'), /Could not load/);
  assert.equal(A.getActiveStoreId(), 'store-a', 'active store rolls back on failure');
  const db = A.getDB();
  assert.deepEqual(Array.from(db.sales, s => s.party), ['A-party'], 'store A data is still visible after the failed switch');
});

test('a failed store-list read never repoints the active store or hides cached data', async () => {
  const { A, network } = await boot();
  assert.equal(A.getActiveStoreId(), 'store-a');
  // Simulate an expired login: every mart_stores read is denied from now on.
  network.tableError = 'mart_stores';
  network.session = false;
  await A.syncNow();

  // The old code repointed the active store to 'default' here, after which the
  // store filter hid every cached record — the "data not loading" bug.
  assert.equal(A.getActiveStoreId(), 'store-a', 'active store must not change on a failed load');
  assert.deepEqual(Array.from(A.getDB().sales, s => s.party), ['A-party'], 'cached data stays visible');
  assert.match(String(A.syncInfo().remoteError), /Online login expired/, 'sync status explains the real cause');
});

test('an authenticated permission error is reported as-is, not as an expired login', async () => {
  const { A, network } = await boot();
  network.tableError = 'mart_stores'; // session still present
  await A.syncNow();
  assert.equal(A.getActiveStoreId(), 'store-a');
  assert.match(String(A.syncInfo().remoteError), /permission denied for table mart_stores/);
});

test('switching stores with unsyncable offline changes is refused', async () => {
  const { A, network } = await boot();
  network.online = false;
  A.addSale(A.getDB(), { amount: 300, party: 'Stuck Sale' });
  await new Promise(r => setTimeout(r, 20));

  await assert.rejects(() => A.switchStore('store-b'), /Cannot switch stores yet/);
  assert.equal(A.getActiveStoreId(), 'store-a');
  assert.deepEqual(Array.from(A.getDB().sales, s => s.party).sort(), ['A-party', 'Stuck Sale']);
});
