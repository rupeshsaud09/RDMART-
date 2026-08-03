const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBackupHelpers() {
  const sandbox = {
    Blob,
    CustomEvent: function CustomEvent() {},
    console,
    crypto: require('node:crypto').webcrypto,
    navigator: {},
    window: {
      dispatchEvent() {},
      localStorage: { getItem: () => null, setItem() {} },
      MartAI: {}
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'martai_final', 'assets', 'khata-backup.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  return sandbox.window.KhataBackup._test;
}

const helpers = loadBackupHelpers();

test('automatic backup becomes due at exactly seven days', () => {
  const previous = { lastBackupAt: '2026-07-06T00:00:00.000Z' };
  assert.equal(helpers.automaticBackupDue({}, new Date('2026-07-13T00:00:00.000Z')), true);
  assert.equal(helpers.automaticBackupDue(previous, new Date('2026-07-12T23:59:59.999Z')), false);
  assert.equal(helpers.automaticBackupDue(previous, new Date('2026-07-13T00:00:00.000Z')), true);
});

test('manual backups wait for the exclusive lock instead of silently skipping', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(helpers.backupLockOptions({ force: true }))),
    { mode: 'exclusive' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(helpers.backupLockOptions({ force: false }))),
    { mode: 'exclusive', ifAvailable: true }
  );
});

test('retention always keeps only the newest weekly backup', () => {
  assert.equal(helpers.normalizeRetention(30), 1);
  const context = { filePrefix: 'KHATA-PANA__shop__' };
  const plan = helpers.retentionPlan([
    'KHATA-PANA__shop__2026-07-06.json',
    'KHATA-PANA__shop__2026-07-13.json'
  ], context, 30);
  assert.deepEqual(Array.from(plan.keep), ['KHATA-PANA__shop__2026-07-13.json']);
  assert.deepEqual(Array.from(plan.remove), ['KHATA-PANA__shop__2026-07-06.json']);
});

test('backup data excludes local passwords and PINs', () => {
  const input = {
    settings: { adminPass: 'secret' },
    customers: [{ id: 'c1', pin: '1234' }],
    staffAccounts: [{ id: 's1', password: 'staff-secret' }]
  };
  const output = helpers.sanitizeBackupData(input);
  assert.equal(output.settings.adminPass, '');
  assert.equal(output.customers[0].pin, '');
  assert.equal('password' in output.staffAccounts[0], false);
  assert.equal(input.settings.adminPass, 'secret');
});

/* ===== Per-store envelope scoping (backup-fails-with-unscoped-data bug) ===== */

function loadBackupHelpersTablesMode(activeStoreId) {
  const sandbox = {
    Blob,
    CustomEvent: function CustomEvent() {},
    console,
    crypto: require('node:crypto').webcrypto,
    navigator: {},
    window: {
      dispatchEvent() {},
      localStorage: { getItem: () => null, setItem() {} },
      MartAI: {
        getActiveStoreId: () => activeStoreId,
        syncInfo: () => ({ mode: 'tables' })
      }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'martai_final', 'assets', 'khata-backup.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  return sandbox.window.KhataBackup;
}

function contaminatedDb() {
  const empty = { dailySales: [], partyPayments: [], cheques: [], parties: [], estimateBills: [], activity: [], loginEvents: [], staffAccounts: [], paymentRequests: [] };
  return {
    version: 2,
    settings: { martName: 'Store A', adminPass: 'secret' },
    stores: [{ id: 'store-a', name: 'Store A' }, { id: 'store-b', name: 'Store B' }],
    customers: [{ id: 'c1', storeId: 'store-a', name: 'Ram', pin: '1234' }],
    credits: [{ id: 'cr1', storeId: 'store-a', customerId: 'c1', amount: 100 }],
    sales: [
      { id: 's1', storeId: 'store-a', amount: 500 },
      { id: 's2', storeId: 'store-b', amount: 900 } // left behind by old store-switch bugs
    ],
    chequeQueue: [
      { id: 'q1', storeId: 'store-b', party: 'Foreign supplier' }, // keep-local fallback row
      { id: 'q2', party: 'Legacy row with no storeId' }            // maps to 'default'
    ],
    tasks: [
      { id: 't1', storeId: 'store-a', title: 'Count stock' },
      { id: 't2', storeId: 'store-b', title: 'Foreign task' }
    ],
    recycleBin: [
      { id: 'r1', storeId: 'store-a', collection: 'credits', record: {} },
      { id: 'r2', storeId: 'store-b', collection: 'sales', record: {} }
    ],
    ...empty
  };
}

test('createEnvelope keeps only the active store\'s records in tables mode', () => {
  const api = loadBackupHelpersTablesMode('store-a');
  const envelope = api.createEnvelope(contaminatedDb());
  assert.equal(envelope.storeId, 'store-a');
  assert.deepEqual(Array.from(envelope.data.sales, s => s.id), ['s1']);
  assert.equal(envelope.data.chequeQueue.length, 0, 'foreign and legacy-unscoped queue rows are excluded');
  assert.deepEqual(Array.from(envelope.data.tasks, item => item.id), ['t1']);
  assert.deepEqual(Array.from(envelope.data.recycleBin, item => item.id), ['r1']);
  assert.deepEqual(Array.from(envelope.data.customers, c => c.id), ['c1']);
  assert.equal(envelope.data.customers[0].pin, '', 'secrets still sanitized');
});

test('a contaminated cache no longer breaks backup verification or restore', () => {
  const api = loadBackupHelpersTablesMode('store-a');
  const envelope = api.createEnvelope(contaminatedDb());
  // The same checks writeInternal/writeFolder and restore run — used to throw
  // 'Backup contains unscoped data or data from a different store'.
  assert.doesNotThrow(() => api._test.validateEnvelope(envelope, api._test.storeContext(contaminatedDb()), envelope.backupDay, 'daily'));
  assert.doesNotThrow(() => api.validateForRestore(contaminatedDb(), envelope));
});

test('local (all-stores) mode keeps every record in the envelope', () => {
  const helpers = loadBackupHelpers();
  const context = { storeId: 'all-stores', storeName: 'All stores', localScope: true };
  const data = contaminatedDb();
  const scoped = helpers.scopeBackupData(JSON.parse(JSON.stringify(data)), context);
  assert.equal(scoped.sales.length, 2);
  assert.equal(scoped.chequeQueue.length, 2);
});

test('dashboard backup buttons use the verified manual backup path', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'martai_final', 'dashboard.html'), 'utf8');
  assert.match(dashboard, /async function runManualBackup\(button,\{downloadCopy=false\}=\{\}\)/);
  assert.match(dashboard, /runAutoBackupNowBtn'\)\?\.addEventListener\('click',e=>runManualBackup\(e\.currentTarget\)\)/);
  assert.match(dashboard, /dashboardBackupNowBtn'\)\?\.addEventListener\('click',e=>\{e\.preventDefault\(\);e\.stopImmediatePropagation\(\);runManualBackup\(e\.currentTarget,\{downloadCopy:true\}\)\}\)/);
  assert.doesNotMatch(dashboard, /id="backupNowBtn"/);
  assert.match(dashboard, /Protected backup storage was unavailable, so a verified backup file was downloaded instead/);
});
