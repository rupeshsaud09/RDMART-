'use strict';

// Clearing a cheque asks for confirmation only — no written reason.
//
// Clearing is the normal, expected end of a cheque's life, so demanding a
// justification for it was pure friction. Bouncing and cancelling are adverse
// and irreversible, so those still require a reason. The canonical policy lives
// in martai-cheques.js (REASON_REQUIRED_STATUSES); martai-store.js and
// dashboard.html had each drifted out of sync with it and demanded a reason for
// 'cleared' as well, which is what users actually hit.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const Cheques = require('../martai_final/assets/martai-cheques.js');

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

// Local (non-Supabase) mode: exercises the store's own audit gate directly.
function bootStore() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage({
      martai_final_session: JSON.stringify({ role: 'admin', email: 'admin@test.local' })
    }),
    navigator: {},
    addEventListener() {},
    MARTAI_SUPABASE: { mode: 'json' }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read('martai_final/assets/martai-store.js'), sandbox);
  return sandbox.MartAI;
}

function withCheque(A, lifecycleStatus) {
  const db = A.getDB();
  db.cheques = [{
    id: 'chq-1', storeId: 'default', party: 'Nepal Dairy', chequeNo: '000123',
    amount: 60909, bank: 'NIC Asia', chequeDate: '2026-07-27', dueDate: '2026-07-27',
    lifecycleStatus, status: 'hold', direction: 'incoming', statusHistory: [],
    notes: [], followUps: [], attachments: [], createdAt: new Date().toISOString()
  }];
  return db;
}

test('clearing a cheque needs confirmation but no reason', () => {
  const A = bootStore();
  const db = withCheque(A, 'on_hold');
  const cheque = A.updateChequeStatus(db, 'chq-1', 'cleared', { confirmed: true, source: 'manual' });
  assert.equal(cheque.lifecycleStatus, 'cleared');
  assert.equal(cheque.status, 'clear');
});

test('clearing without confirmation is still refused', () => {
  const A = bootStore();
  const db = withCheque(A, 'on_hold');
  assert.throws(
    () => A.updateChequeStatus(db, 'chq-1', 'cleared', { source: 'manual' }),
    /Review and confirm/
  );
});

test('a reasonless clear still writes a meaningful audit entry', () => {
  const A = bootStore();
  const db = withCheque(A, 'on_hold');
  const cheque = A.updateChequeStatus(db, 'chq-1', 'cleared', { confirmed: true, source: 'manual' });
  assert.equal(cheque.statusHistory.length, 1);
  const event = cheque.statusHistory[0];
  assert.equal(event.from, 'on_hold');
  assert.equal(event.to, 'cleared');
  assert.ok(event.reason, 'the audit trail is never left blank');
  assert.ok(event.time, 'the change is timestamped');
});

test('bouncing and cancelling still demand a reason', () => {
  for (const status of ['bounced', 'on_hold']) {
    const A = bootStore();
    const db = withCheque(A, status === 'on_hold' ? 'cleared' : 'on_hold');
    assert.throws(
      () => A.updateChequeStatus(db, 'chq-1', status, { confirmed: true, source: 'manual' }),
      /Add a reason or evidence/,
      status + ' must still require a reason'
    );
  }
});

test('cancel-and-remove still demands a reason', () => {
  const A = bootStore();
  const db = withCheque(A, 'on_hold');
  assert.throws(() => A.deleteCheque(db, 'chq-1', { confirmed: true }), /cancellation reason/);
});

test('the cheque module agrees that clearing needs no reason', () => {
  assert.equal(Cheques.REASON_REQUIRED_STATUSES.includes('cleared'), false);
  assert.equal(Cheques.REASON_REQUIRED_STATUSES.includes('bounced'), true);
  assert.equal(Cheques.REASON_REQUIRED_STATUSES.includes('cancelled'), true);
  // ...but clearing is still an important transition, so it is confirmed.
  assert.equal(Cheques.IMPORTANT_TRANSITIONS.includes('cleared'), true);
});

test('a reasonless clear passes the cheque module transition gate', () => {
  const record = { id: 'chq-1', party: 'Nepal Dairy', chequeNo: '000123', amount: 60909, lifecycleStatus: 'on_hold', status: 'hold', direction: 'incoming', chequeDate: '2026-07-27' };
  const proposal = Cheques.transitionProposal(record, 'cleared', { today: '2026-07-27', direction: 'incoming', confirmed: true });
  assert.equal(proposal.ok, true, 'clearing with no reason is allowed');
  assert.equal(proposal.requiresReason, false);
});

test('the dashboard modal hides reason and checkbox unless a reason is required', () => {
  const dashboard = read('martai_final/dashboard.html');
  // 'cleared' must not be in the list that triggers the reason field.
  assert.match(dashboard, /const needsReason=mode==='delete'\|\|\['bounced','cancelled','hold'\]/);
  assert.doesNotMatch(dashboard, /\['cleared','bounced','cancelled','hold'\]/);
  // Both controls are toggled, and neither is hard-coded `required` in markup —
  // a hidden required control blocks submit and cannot be focused to explain why.
  assert.match(dashboard, /reasonField\.hidden=!needsReason/);
  assert.match(dashboard, /confirmCheck\.hidden=!needsReason/);
  assert.match(dashboard, /cb\.required=needsReason;cb\.checked=!needsReason/);
  assert.match(dashboard, /<textarea class="textarea" id="chequeTransitionReason" name="reason" placeholder=/);
  assert.match(dashboard, /<input type="checkbox" name="confirmed"> I reviewed/);
});

test('the assistant passes confirmation so its clear action works at all', () => {
  const bot = read('martai_final/assets/martai-bot.js');
  assert.match(bot, /updateChequeStatus\(d,cid,st,\{confirmed:true,source:'assistant'\}\)/);
});

// Setting `hidden` on these did nothing visible until the guard existed: both
// classes declare `display:flex`, and an author rule outranks the browser's own
// [hidden] rule. Confirmed in a real browser — the field measured as visible
// while JS believed it was hidden.
test('classes toggled via hidden actually collapse when hidden', () => {
  const css = read('martai_final/assets/martai.css');
  assert.match(css, /\.field\[hidden\]/, '.field needs an explicit [hidden] guard');
  assert.match(css, /\.confirmation-check\[hidden\]/, '.confirmation-check needs an explicit [hidden] guard');
  // Guard must come after the display:flex declarations it overrides.
  assert.ok(css.indexOf('.field[hidden]') > css.indexOf('.field{display:flex'),
    'the guard must appear after the rule it overrides');
});
