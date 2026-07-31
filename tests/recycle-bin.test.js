'use strict';

// Deleting a financial record used to be permanent: the row left Supabase
// immediately and only the weekly backup could bring it back. Every delete now
// parks a full copy in a device-local recycle bin first.
//
// The properties that actually matter, and are pinned here:
//   * a deleted record is recoverable, with its ORIGINAL id — otherwise a
//     restored credit would no longer belong to its customer;
//   * the bin survives a remote sync (loadTableDB rebuilds the whole db object
//     and would silently wipe it without an explicit carry-across);
//   * restoring re-queues the record for upload, so it comes back on the server
//     too rather than only on screen;
//   * a recycled customer never carries a PIN around in localStorage.

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

// Local (non-Supabase) mode keeps these tests focused on the recycle-bin logic
// rather than on transport.
function boot(role = 'admin') {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage({
      martai_final_session: JSON.stringify({ role, email: role + '@test.local' })
    }),
    navigator: {},
    addEventListener() {},
    MARTAI_SUPABASE: { mode: 'json' }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(STORE_SOURCE, sandbox);
  return sandbox.MartAI;
}

function seedCustomerWithCredit(A) {
  const db = A.getDB();
  const customer = A.addCustomer(db, { name: 'Ram Prasad', phone: '9800000001', pin: '1234' });
  const credit = A.addCredit(db, {
    customerId: customer.id, amount: 1500, items: 'Rice', date: '2026-07-28'
  });
  return { db: A.getDB(), customer, credit };
}

test('a deleted credit is recoverable instead of lost', () => {
  const A = boot();
  const { credit } = seedCustomerWithCredit(A);

  A.deleteCredit(A.getDB(), credit.id);
  assert.equal(A.getDB().credits.length, 0, 'the credit leaves the active list');

  const bin = A.listRecycleBin(A.getDB());
  assert.equal(bin.length, 1);
  assert.equal(bin[0].typeLabel, 'Credit entry');
  assert.match(bin[0].description, /Ram Prasad/);
  assert.match(bin[0].description, /1,500/, 'the amount is shown so the entry is identifiable');
});

test('restoring brings the record back with its original id', () => {
  const A = boot();
  const { customer, credit } = seedCustomerWithCredit(A);

  A.deleteCredit(A.getDB(), credit.id);
  const entry = A.listRecycleBin(A.getDB())[0];
  A.restoreRecord(A.getDB(), entry.id);

  const restored = A.getDB().credits;
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, credit.id, 'the id is preserved, not regenerated');
  assert.equal(restored[0].customerId, customer.id, 'it still belongs to the same customer');
  assert.equal(restored[0].amount, 1500);
  assert.equal(A.listRecycleBin(A.getDB()).length, 0, 'and it leaves the bin');
});

test("a restored credit still counts toward the customer's balance", () => {
  const A = boot();
  const { customer, credit } = seedCustomerWithCredit(A);
  const before = A.customerBalance(A.getDB(), customer.id).balance;

  A.deleteCredit(A.getDB(), credit.id);
  assert.equal(A.customerBalance(A.getDB(), customer.id).balance, 0);

  A.restoreRecord(A.getDB(), A.listRecycleBin(A.getDB())[0].id);
  assert.equal(
    A.customerBalance(A.getDB(), customer.id).balance,
    before,
    'restoring must rebuild the dues, not just the row'
  );
});

test('a restored record is re-queued for upload, not left local-only', () => {
  const A = boot();
  const { credit } = seedCustomerWithCredit(A);
  A.deleteCredit(A.getDB(), credit.id);
  A.restoreRecord(A.getDB(), A.listRecycleBin(A.getDB())[0].id);

  assert.equal(
    A.syncInfo().hasPending,
    true,
    'the restore must be pending sync so the server gets it back too'
  );
});

test('every deletable record type lands in the bin', () => {
  const A = boot();
  const db = A.getDB();
  const customer = A.addCustomer(db, { name: 'Sita', phone: '9800000002', pin: '1111' });

  A.addSale(A.getDB(), { amount: 500, party: 'Walk-in' });
  A.addDaily(A.getDB(), { pos: 100, cash: 200, date: '2026-07-28' });
  A.addPartyPayment(A.getDB(), { party: 'Supplier A', amount: 900, date: '2026-07-28' });
  A.addEstimateBill(A.getDB(), { customer: 'Hari', amount: 2500 });
  A.addChequeQueue(A.getDB(), { party: 'Supplier B', amount: 700 });
  A.addParty(A.getDB(), { name: 'Supplier C' });

  A.deleteSale(A.getDB(), A.getDB().sales[0].id);
  A.deleteDaily(A.getDB(), A.getDB().dailySales[0].id);
  A.deletePartyPayment(A.getDB(), A.getDB().partyPayments[0].id);
  A.deleteEstimateBill(A.getDB(), A.getDB().estimateBills[0].id);
  A.deleteChequeQueue(A.getDB(), A.getDB().chequeQueue[0].id);
  A.deleteParty(A.getDB(), A.getDB().parties[0].id);
  A.deleteCustomer(A.getDB(), customer.id);

  const collections = Array.from(A.listRecycleBin(A.getDB()), e => e.collection).sort();
  assert.deepEqual(collections, [
    'chequeQueue', 'customers', 'dailySales', 'estimateBills',
    'parties', 'partyPayments', 'sales'
  ], 'no delete path may bypass the recycle bin');
});

test('a recycled customer never carries a PIN in local storage', () => {
  const A = boot();
  const db = A.getDB();
  const customer = A.addCustomer(db, { name: 'Gita', phone: '9800000003', pin: '4321' });
  A.deleteCustomer(A.getDB(), customer.id);

  const entry = A.listRecycleBin(A.getDB())[0];
  assert.equal(entry.record.pin, '', 'the PIN is stripped before the record is stored');
});

test('the bin is not wiped by a normalize/reload cycle', () => {
  const A = boot();
  const { credit } = seedCustomerWithCredit(A);
  A.deleteCredit(A.getDB(), credit.id);
  assert.equal(A.listRecycleBin(A.getDB()).length, 1);

  // saveDB runs the record through normalizeDB, the same path a reload takes.
  A.saveDB(A.getDB());
  assert.equal(
    A.listRecycleBin(A.getDB()).length,
    1,
    'recycleBin must be a recognised collection, or normalize drops it'
  );
});

test('restoring the same record twice is refused rather than duplicating it', () => {
  const A = boot();
  const { credit } = seedCustomerWithCredit(A);
  A.deleteCredit(A.getDB(), credit.id);
  const entry = A.listRecycleBin(A.getDB())[0];
  A.restoreRecord(A.getDB(), entry.id);

  assert.throws(() => A.restoreRecord(A.getDB(), entry.id), /no longer available/);
  assert.equal(A.getDB().credits.length, 1, 'still exactly one copy');
});

test('staff cannot restore or purge', () => {
  const admin = boot();
  const { credit } = seedCustomerWithCredit(admin);
  admin.deleteCredit(admin.getDB(), credit.id);
  const entryId = admin.listRecycleBin(admin.getDB())[0].id;

  const staff = boot('staff');
  assert.throws(() => staff.restoreRecord(admin.getDB(), entryId), /Staff cannot restore/);
});

test('only the main admin can permanently purge', () => {
  const storeAdmin = boot('store_admin');
  const { credit } = seedCustomerWithCredit(storeAdmin);
  storeAdmin.deleteCredit(storeAdmin.getDB(), credit.id);
  const entryId = storeAdmin.listRecycleBin(storeAdmin.getDB())[0].id;

  assert.throws(
    () => storeAdmin.purgeRecycleEntry(storeAdmin.getDB(), entryId),
    /Only the main admin/
  );
  assert.throws(
    () => storeAdmin.clearRecycleBin(storeAdmin.getDB()),
    /Only the main admin/
  );
  // ...and a store admin can still restore, which is the point of the feature.
  assert.doesNotThrow(() => storeAdmin.restoreRecord(storeAdmin.getDB(), entryId));
});

test('the bin is capped so it cannot grow without bound', () => {
  const A = boot();
  const db = A.getDB();
  A.addCustomer(db, { name: 'Bulk', phone: '9800000004', pin: '1234' });
  const customerId = A.getDB().customers[0].id;
  for (let i = 0; i < 210; i++) {
    const credit = A.addCredit(A.getDB(), { customerId, amount: 10 + i });
    A.deleteCredit(A.getDB(), credit.id);
  }
  const size = A.listRecycleBin(A.getDB()).length;
  assert.ok(size <= 200, 'expected the bin to be capped at 200, got ' + size);
  assert.ok(size > 0);
});
