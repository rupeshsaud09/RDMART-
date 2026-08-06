'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const BankCheques = require('../martai_final/assets/martai-bank-cheques.js');
const storeSource = fs.readFileSync(path.join(__dirname, '..', 'martai_final', 'assets', 'martai-store.js'), 'utf8');

function memoryStorage(seed) {
  const values = new Map(Object.entries(seed || {}));
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null
  };
}

function database(overrides) {
  return {
    version: 2,
    createdAt: '2026-08-03T00:00:00.000Z',
    settings: {
      martName: 'RD MART', adminUser: 'admin', adminPass: '', martPhone: '',
      storeLogo: '', storePaymentQr: '', storePaymentQrLabel: '',
      bankWeekendDays: [0, 6], bankHolidays: []
    },
    stores: [{ id: 'default', name: 'RD MART', phone: '', isActive: true }],
    customers: [], credits: [], sales: [], dailySales: [], partyPayments: [],
    cheques: [], chequeQueue: [], parties: [], estimateBills: [], activity: [],
    loginEvents: [], staffAccounts: [], paymentRequests: [], tasks: [], recycleBin: [],
    ...(overrides || {})
  };
}

function bootStore(seed, mode = 'json') {
  const localStorage = memoryStorage({ martai_final_db_v1: JSON.stringify(seed) });
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage,
    sessionStorage: memoryStorage({
      martai_final_session: JSON.stringify({ role: 'admin', email: 'admin@test.local' })
    }),
    navigator: {},
    addEventListener() {},
    MARTAI_SUPABASE: mode === 'tables'
      ? { mode: 'tables', url: 'https://rd-mart-test.supabase.co', anonKey: 'test-anon-key' }
      : { mode: 'json' }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(storeSource, sandbox);
  return { A: sandbox.MartAI, sandbox };
}

test('RD MART always rolls Saturday and Sunday cheques to Monday', () => {
  const seed = database({
    settings: {
      ...database().settings,
      bankWeekendDays: []
    }
  });
  const { A } = bootStore(seed);
  const weekendDays = Array.from(A.getDB().settings.bankWeekendDays);

  assert.deepEqual(weekendDays, [0, 6], 'stale or empty settings must not reopen Saturday/Sunday');
  for (const chequeDate of ['2026-08-01', '2026-08-02']) {
    const due = BankCheques.dueInfo({ chequeDate, status: 'hold' }, '2026-08-03', { weekendDays });
    assert.equal(due.effectiveDate, '2026-08-03');
    assert.equal(due.status, 'today');
  }
});

test('a new cheque cannot silently fall back to today when its date is blank', () => {
  const { A } = bootStore(database());

  assert.throws(
    () => A.addCheque(A.getDB(), {
      party: 'Supplier', chequeNo: '001', amount: 5000, chequeDate: ''
    }),
    /Cheque date is required/
  );
  assert.equal(A.getDB().cheques.length, 0);
});

test('legacy cheque schemas delete the remote row instead of resurrecting it', async () => {
  const seed = database({
    cheques: [{
      id: 'cheque-local-1', _tableId: 'cheque-table-1', storeId: 'default',
      party: 'Supplier', chequeNo: '001', amount: 5000, bank: 'Bank',
      chequeDate: '2026-08-01', dueDate: '2026-08-01', lifecycleStatus: 'on_hold',
      status: 'hold', direction: 'outgoing', version: 1, deletedAt: '',
      statusHistory: [], notes: [], followUps: [], attachments: [],
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
    }]
  });
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'cheques');
      return {
        update(row) {
          calls.push({ operation: 'update', row });
          return {
            eq(column, value) {
              calls.push({ operation: 'update-filter', column, value });
              return {
                select() {
                  return {
                    maybeSingle: async () => ({
                      data: null,
                      error: { message: 'column "deleted_at" of relation "cheques" does not exist' }
                    })
                  };
                }
              };
            }
          };
        },
        upsert(row) {
          calls.push({ operation: 'upsert', row });
          return { select: () => ({ maybeSingle: async () => ({ data: { id: 'unexpected' }, error: null }) }) };
        },
        delete() {
          calls.push({ operation: 'delete' });
          return {
            eq(column, value) {
              calls.push({ operation: 'delete-filter', column, value });
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }
  };
  const { A, sandbox } = bootStore(seed, 'tables');
  sandbox.supabase = { createClient: () => client };

  const removed = A.deleteCheque(A.getDB(), 'cheque-local-1', {
    confirmed: true,
    reason: 'Duplicate entry'
  });
  await A.syncInfo().pendingSave;

  assert.ok(removed.deletedAt, 'the local record is hidden immediately');
  assert.deepEqual(
    calls.filter(call => call.operation === 'delete-filter').map(call => [call.column, call.value]),
    [['id', 'cheque-table-1']]
  );
  assert.equal(calls.some(call => call.operation === 'upsert'), false, 'the legacy fallback must never reinsert a deleted cheque');
  assert.equal(A.syncInfo().hasPending, false, 'the deletion is fully flushed');
});
