'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BankCheques = require('../assets/martai-bank-cheques.js');
const Cheques = require('../assets/martai-cheques.js');

const monday = '2026-07-27';
const records = [
  { id: 'sat-1', party: 'MAA BAISHNAB DEVI ENTERPRISES', chequeDate: '2026-07-25', amount: 100000, status: 'hold' },
  { id: 'sun-1', party: 'MANGALAM INTERNATIONAL PVT.LTD', dueDate: '2026-07-26', chequeDate: '2026-07-26', amount: 80000, lifecycleStatus: 'on_hold', status: 'hold' },
  { id: 'mon-1', party: 'NEPAL DAIRY PVT.LTD', chequeDate: monday, amount: 60909, status: 'hold' },
  { id: 'other-1', party: 'Party 1', chequeDate: '2026-07-25', amount: 30000, status: 'hold' },
  { id: 'other-2', party: 'Party 2', chequeDate: '2026-07-26', amount: 20000, status: 'hold' },
  { id: 'other-3', party: 'Party 3', chequeDate: '2026-07-25', amount: 20000, status: 'hold' },
  { id: 'other-4', party: 'Party 4', chequeDate: '2026-07-26', amount: 20000, status: 'hold' },
  { id: 'other-5', party: 'Party 5', chequeDate: '2026-07-25', amount: 20000, status: 'hold' },
  { id: 'other-6', party: 'Party 6', chequeDate: '2026-07-26', amount: 20000, status: 'hold' },
  { id: 'other-7', party: 'Party 7', chequeDate: '2026-07-25', amount: 20000, status: 'hold' },
  { id: 'other-8', party: 'Party 8', chequeDate: '2026-07-26', amount: 20000, status: 'hold' },
  { id: 'done', party: 'Already cleared', chequeDate: '2026-07-25', amount: 99999, status: 'clear' },
  { id: 'bounce', party: 'Bounced', chequeDate: '2026-07-26', amount: 88888, status: 'bounce' }
];

test('Monday banking summary includes active Saturday and Sunday cheques', function () {
  const summary = BankCheques.summaryForDate(records, monday, { weekendDays: [0, 6] });
  assert.equal(summary.count, 11);
  assert.equal(summary.amount, 410909);
  assert.equal(summary.carriedCount, 10);
  assert.deepEqual(summary.items.slice(0, 3).map(function id(item) { return item.id; }), ['sat-1', 'sun-1', 'mon-1']);
});

test('Today records consume the exact same banking-day collection as the summary', function () {
  const summary = BankCheques.summaryForDate(records, monday, { weekendDays: [0, 6] });
  const source = BankCheques.forBankingViews(summary.items, { weekendDays: [0, 6] });
  const result = Cheques.queryRecords(source, { today: monday, view: 'all', page: 1, pageSize: 500 });
  assert.equal(result.total, summary.count);
  assert.equal(result.items.reduce(function sum(total, item) { return total + item.amount; }, 0), summary.amount);
  assert.equal(result.total, 11);
  assert.equal(summary.amount, 410909);
});

test('dashboard and Today records are wired to the shared banking-day source', function () {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  assert.match(dashboard, /todayChequeSummary=bankingChequeSummary\(d,today\)/);
  assert.match(dashboard, /BankCheques\.recordsForView\(d\.cheques,selected,today,bankCalendarOptions\(\)\)/);
  assert.match(dashboard, /todayCheques=todayChequeSummary\.items/);
});

test('cheque page defers hidden tools and avoids full-app redraws while filtering', function () {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  const start = dashboard.indexOf('function renderCheques(){');
  const end = dashboard.indexOf('function renderBankingWeekReport', start);
  const renderer = dashboard.slice(start, end);
  assert.ok(start >= 0 && end > start, 'renderCheques function should be present');
  assert.doesNotMatch(renderer, /renderChequePlanner\(d\)/);
  assert.doesNotMatch(renderer, /renderChequeQueue\(d\)/);
  assert.match(dashboard, /openChequePlannerBtn'\)\?\.addEventListener\('click',\(\)=>\{renderChequePlanner\(sdb\(\)\)/);
  assert.match(dashboard, /openChequeQueueBtn'\)\?\.addEventListener\('click',\(\)=>\{renderChequeQueue\(sdb\(\)\)/);
  assert.match(dashboard, /const schedulePageRender=UI\?UI\.debounce\(\(\)=>renderCurrentPage\(\),120\)/);
  assert.match(dashboard, /function nav\(page\).*renderCurrentPage\(\)/);
});

test('bank dates and scoped business totals use data-change caches', function () {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  assert.match(dashboard, /bankCalendarMemo\.effective\.has\(iso\)/);
  assert.match(dashboard, /scopedDbMemo\.revision===scopedDbRevision/);
  assert.match(dashboard, /function allCustomerBalances\(d\).*const grouped=new Map\(\)/s);
  assert.match(dashboard, /function chequeScheduleIndex\(d\)/);
});

test('banking views use the effective date but preserve the written date', function () {
  const rows = BankCheques.forBankingViews(records, { weekendDays: [0, 6] });
  const saturday = rows.find(function find(item) { return item.id === 'sat-1'; });
  assert.equal(saturday.originalDueDate, '2026-07-25');
  assert.equal(saturday.chequeDate, '2026-07-25');
  assert.equal(saturday.dueDate, monday);
});

test('configured holidays also roll forward without changing the cheque date', function () {
  const holidayRows = BankCheques.forBankingViews([
    { id: 'holiday', chequeDate: monday, amount: 10, status: 'hold' }
  ], { weekendDays: [0, 6], holidays: [monday] });
  assert.equal(holidayRows[0].originalDueDate, monday);
  assert.equal(holidayRows[0].dueDate, '2026-07-28');
});

test('a Monday holiday carries Saturday and Sunday cheques into Tuesday', function () {
  const calendar = { weekendDays: [0, 6], holidays: [monday] };
  const summary = BankCheques.summaryForDate(records, '2026-07-28', calendar);
  assert.equal(summary.count, 11);
  assert.equal(summary.amount, 410909);
  assert.equal(summary.carriedCount, 11);
  const saturday = BankCheques.dueInfo(records[0], '2026-07-28', calendar);
  assert.equal(saturday.originalDate, '2026-07-25');
  assert.equal(saturday.effectiveDate, '2026-07-28');
  assert.equal(saturday.status, 'today');
  assert.equal(saturday.rolloverReason, 'Weekend rollover');
});

test('overdue age counts open banking days rather than calendar days', function () {
  const cheque = { id: 'fri', chequeDate: '2026-07-24', amount: 100, status: 'hold' };
  const mondayInfo = BankCheques.dueInfo(cheque, monday, { weekendDays: [0, 6] });
  assert.equal(mondayInfo.status, 'overdue');
  assert.equal(mondayInfo.daysOverdue, 1);
  const tuesdayHoliday = BankCheques.dueInfo(cheque, '2026-07-28', { weekendDays: [0, 6], holidays: ['2026-07-28'] });
  assert.equal(tuesdayHoliday.daysOverdue, 1);
});

test('quick views return distinct upcoming, overdue, and cleared banking queues', function () {
  const asOf = '2026-07-28';
  const quickViewRecords = [
    { id: 'upcoming', chequeDate: '2026-07-30', amount: 100, status: 'hold' },
    { id: 'overdue', chequeDate: '2026-07-24', amount: 200, status: 'hold' },
    { id: 'cleared', chequeDate: '2026-07-30', amount: 300, lifecycleStatus: 'cleared', status: 'clear' },
    { id: 'bounced', chequeDate: '2026-07-24', amount: 400, status: 'bounce' }
  ];
  const ids = view => BankCheques.recordsForView(quickViewRecords, view, asOf, { weekendDays: [0, 6] }).map(item => item.id);
  assert.deepEqual(ids('upcoming'), ['upcoming']);
  assert.deepEqual(ids('overdue'), ['overdue']);
  assert.deepEqual(ids('cleared'), ['cleared']);
});

test('quick-view controls reset stale refinements and resync their active state', function () {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  assert.match(dashboard, /BankCheques\.recordsForView\(d\.cheques,selected,today,bankCalendarOptions\(\)\)/);
  assert.match(dashboard, /function applyChequeQuickView\(value,\{reset=true\}=\{\}\)/);
  assert.match(dashboard, /if\(reset\)resetChequeRefinements\(\)/);
  assert.match(dashboard, /function renderCheques\(\)\{\s*const d=sdb\(\);syncChequeQuickViews\(\)/);
  assert.match(dashboard, /button\.setAttribute\('aria-pressed',active\?'true':'false'\)/);
});
