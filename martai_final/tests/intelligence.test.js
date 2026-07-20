'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const intelligence = require('../assets/martai-intelligence.js');

function cheque(overrides) {
  return Object.assign({
    id: 'current',
    party: 'Himal Traders',
    chequeNo: '000-123',
    amount: 50000,
    bank: 'Nabil Bank',
    issueDate: '2026-07-01',
    dueDate: '2026-07-20',
    status: 'hold',
    direction: 'incoming',
    assignedTo: 'Asha'
  }, overrides || {});
}

test('normalization is stable and the public model contract is versioned', () => {
  assert.equal(intelligence.normalizeChequeNumber(' ०००-१२३ / a '), '000123A');
  assert.match(intelligence.RISK_MODEL_VERSION, /^cheque-risk-rules-v\d+\.\d+\.\d+$/);
  assert.equal(intelligence.normalizeStatus('clear'), 'cleared');
  assert.equal(intelligence.normalizeDirection('issued'), 'outgoing');
});

test('anomaly detection identifies duplicates, exact repeats, robust outliers, and date errors', () => {
  const history = [
    cheque({ id: 'duplicate', chequeNo: '000 123', amount: 9000, dueDate: '2026-07-08' }),
    cheque({ id: 'repeat', chequeNo: '999', amount: 1000000, dueDate: '2026-07-10' }),
    ...[9000, 9500, 10000, 10200, 10500, 11000, 11500].map((amount, index) => cheque({
      id: `sample-${index}`,
      chequeNo: `S-${index}`,
      party: `Sample ${index}`,
      amount,
      dueDate: `2026-06-${String(index + 1).padStart(2, '0')}`
    }))
  ];
  const current = cheque({ amount: 1000000, dueDate: '2026-07-10', issueDate: '2026-07-15' });
  const result = intelligence.detectChequeAnomalies(current, history, { asOf: '2026-07-20' });
  const codes = result.anomalies.map(item => item.code);

  assert.ok(codes.includes('DUPLICATE_CHEQUE_NUMBER'));
  assert.ok(codes.includes('PARTY_AMOUNT_DATE_REPEAT'));
  assert.ok(codes.includes('ROBUST_AMOUNT_OUTLIER'));
  assert.ok(codes.includes('DUE_BEFORE_ISSUE'));
  assert.ok(codes.includes('PAST_DUE_OPEN'));
  assert.equal(result.diagnostics.amountOutlier.status, 'evaluated');
});

test('risk scoring is explainable, bounded, deterministic, and does not mutate records', () => {
  const current = cheque({ party: '', amount: 0, bank: '', direction: '', dueDate: 'invalid' });
  const before = JSON.stringify(current);
  const first = intelligence.assessChequeRisk(current, [], { asOf: '2026-07-20' });
  const second = intelligence.assessChequeRisk(current, [], { asOf: '2026-07-20' });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(current), before);
  assert.ok(first.score >= 0 && first.score <= 100);
  assert.ok(first.factors.every(factor => Number.isInteger(factor.points) && factor.reason));
  assert.ok(first.dataCompleteness.score < 50);
  assert.match(first.basis, /not a probability/i);
});

test('priority rules recommend human follow-up and require confirmation', () => {
  const result = intelligence.scoreChequePriority(
    cheque({ dueDate: '2026-07-01', assignedTo: '', status: 'hold' }),
    { asOf: '2026-07-20', history: [] }
  );

  assert.ok(result.score >= 50);
  assert.equal(result.recommendedAction.code, 'FOLLOW_UP_TODAY');
  assert.equal(result.requiresConfirmationBeforeFinancialChange, true);
});

test('forecast refuses to invent results when history or direction data is inadequate', () => {
  const result = intelligence.forecastChequeCashFlow([
    cheque({ status: 'cleared', dueDate: '2026-06-01', direction: '' }),
    cheque({ status: 'cleared', dueDate: '2026-06-08', direction: 'incoming' })
  ], { asOf: '2026-07-20' });

  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.forecast, null);
  assert.ok(result.reasons.some(reason => reason.code === 'INSUFFICIENT_COMPLETED_HISTORY'));
});

test('forecast uses a transparent cleared-cheque run rate only after adequate history', () => {
  const records = [];
  for (let index = 0; index < 8; index += 1) {
    records.push(cheque({
      id: `history-${index}`,
      chequeNo: `H-${index}`,
      amount: index % 2 ? 2000 : 3000,
      status: 'cleared',
      direction: index % 2 ? 'outgoing' : 'incoming',
      dueDate: intelligence.addDays('2026-05-01', index * 7)
    }));
  }
  records.push(cheque({ id: 'scheduled', status: 'hold', direction: 'incoming', dueDate: '2026-07-25', amount: 25000 }));

  const result = intelligence.forecastChequeCashFlow(records, { asOf: '2026-07-20' });
  assert.equal(result.status, 'ready');
  assert.equal(result.forecast.method, 'cleared_cheque_daily_run_rate');
  assert.equal(result.knownSchedule.incoming, 25000);
  assert.equal('confidence' in result, false);
});

test('natural language parsing returns a validated whitelist AST and never query code', () => {
  const result = intelligence.parseNaturalLanguageFilter(
    'top 5 bounced incoming due next 7 days amount over Rs 1 lakh; DROP TABLE cheques',
    { asOf: '2026-07-20' }
  );

  assert.equal(result.ok, true);
  assert.equal(intelligence.validateFilterAst(result.ast), true);
  assert.equal(result.ast.limit, 5);
  assert.deepEqual(result.ast.conditions.find(item => item.field === 'status'), { field: 'status', operator: 'eq', value: 'bounced' });
  assert.deepEqual(result.ast.conditions.find(item => item.field === 'amount'), { field: 'amount', operator: 'gte', value: 100000 });
  assert.ok(result.warnings.includes('UNSUPPORTED_SYNTAX_IGNORED'));
  assert.doesNotMatch(JSON.stringify(result.ast), /drop|table|select/i);
});

test('respectful message templates sanitize party data and require review', () => {
  const english = intelligence.generateChequeMessage(
    cheque({ party: '<img onerror=alert(1)> Ram', amount: 12500 }),
    { locale: 'en', purpose: 'reminder' }
  );
  const nepali = intelligence.generateChequeMessage(cheque(), { locale: 'ne', purpose: 'bounced' });
  const incomplete = intelligence.generateChequeMessage(cheque({ amount: '' }), { purpose: 'reminder' });

  assert.equal(english.status, 'ready');
  assert.doesNotMatch(english.text, /[<>]/);
  assert.match(english.text, /friendly reminder/i);
  assert.equal(english.requiresReviewBeforeSending, true);
  assert.match(nepali.text, /कृपया/);
  assert.equal(incomplete.status, 'needs_data');
  assert.equal(incomplete.text, '');
});
