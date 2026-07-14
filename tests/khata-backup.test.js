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
