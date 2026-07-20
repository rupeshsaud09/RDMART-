/*
 * RD MART deterministic intelligence utilities.
 *
 * Model contract (v1): every result is derived from the supplied record set and
 * the documented rules below. Scores are prioritisation aids, not probabilities,
 * credit ratings, or instructions to change financial records. This module has no
 * network, storage, DOM, eval, or write capability and therefore works offline.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MartAIIntelligence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const RISK_MODEL_VERSION = 'cheque-risk-rules-v1.0.0';
  const ANOMALY_MODEL_VERSION = 'cheque-anomaly-rules-v1.0.0';
  const PRIORITY_MODEL_VERSION = 'cheque-priority-rules-v1.0.0';
  const FORECAST_MODEL_VERSION = 'cheque-cashflow-run-rate-v1.0.0';
  const FILTER_AST_VERSION = 'martai-filter-ast-v1';
  const MESSAGE_TEMPLATE_VERSION = 'cheque-message-v1.0.0';

  const STATUS_ALIASES = Object.freeze({
    clear: 'cleared', cleared: 'cleared', bounce: 'bounced', bounced: 'bounced',
    hold: 'hold', pending: 'hold', draft: 'draft', 'to write': 'to_write',
    to_write: 'to_write', written: 'written', issue: 'issued', issued: 'issued',
    receive: 'received', received: 'received', deposit: 'deposited', deposited: 'deposited',
    cancel: 'cancelled', canceled: 'cancelled', cancelled: 'cancelled', overdue: 'overdue'
  });
  const STATUSES = Object.freeze([
    'draft', 'to_write', 'written', 'issued', 'received', 'deposited', 'hold',
    'cleared', 'bounced', 'cancelled', 'overdue'
  ]);
  const CLOSED_STATUSES = new Set(['cleared', 'cancelled']);
  const DIRECTIONS = Object.freeze(['incoming', 'outgoing']);
  const FILTER_FIELDS = Object.freeze([
    'status', 'direction', 'party', 'bank', 'amount', 'dueDate', 'riskLevel',
    'assignedTo', 'chequeNumber'
  ]);
  const FILTER_OPERATORS = Object.freeze([
    'eq', 'in', 'contains', 'gte', 'lte', 'before', 'after', 'between'
  ]);
  const SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1, info: 0 });
  const MODEL_INFO = Object.freeze({
    risk: Object.freeze({
      version: RISK_MODEL_VERSION,
      meaning: 'Operational review priority; never a probability of bounce, loss, or creditworthiness.',
      bands: Object.freeze({ low: '0-24', medium: '25-49', high: '50-74', critical: '75-100' }),
      maximumScore: 100,
      notableRules: Object.freeze({
        duplicateChequeNumber: 30,
        exactPartyAmountDateRepeat: 20,
        robustAmountOutlier: 12,
        currentlyBounced: 25,
        dueWithinThreeDays: 5,
        missingRequiredField: '2 each, capped at 14',
        overdue: '15 + 3 per started week, capped at 35'
      })
    }),
    anomaly: Object.freeze({
      version: ANOMALY_MODEL_VERSION,
      outlierMinimumComparableRecords: 7,
      madThreshold: 3.5,
      fallback: 'Outer IQR fence (three times IQR) when MAD is zero but IQR is usable.'
    }),
    forecast: Object.freeze({
      version: FORECAST_MODEL_VERSION,
      defaultMinimumCompletedRecords: 8,
      defaultMinimumHistoryDays: 28,
      defaultMinimumPerDirection: 3,
      method: 'Daily run rate from cleared cheques; known scheduled cheques remain a separate total.'
    })
  });

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return minimum;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function toAsciiDigits(value) {
    return String(value == null ? '' : value)
      .replace(/[०-९]/g, digit => String('०१२३४५६७८९'.indexOf(digit)));
  }

  function sanitizeText(value, maximumLength) {
    const limit = clamp(maximumLength == null ? 160 : maximumLength, 1, 2000);
    let text = String(value == null ? '' : value);
    try { text = text.normalize('NFKC'); } catch (_) { /* Older browsers. */ }
    return text
      .replace(/<[^>]{0,500}>/g, ' ')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function comparableText(value) {
    return sanitizeText(value, 160)
      .toLocaleLowerCase('en')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function normalizeChequeNumber(value) {
    return toAsciiDigits(sanitizeText(value, 64))
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  function normalizeStatus(value) {
    const normalized = comparableText(value).replace(/\s+/g, '_');
    return STATUS_ALIASES[normalized] || STATUS_ALIASES[normalized.replace(/_/g, ' ')] || '';
  }

  function normalizeDirection(value) {
    const normalized = comparableText(value);
    if (['incoming', 'inward', 'received', 'receivable', 'customer', 'आउने'].includes(normalized)) return 'incoming';
    if (['outgoing', 'outward', 'issued', 'payable', 'supplier', 'जाने'].includes(normalized)) return 'outgoing';
    return '';
  }

  function parseAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? roundMoney(value) : null;
    const normalized = toAsciiDigits(value)
      .replace(/(?:npr|rs\.?|रु\.?|रूपैयाँ)/gi, '')
      .replace(/,/g, '')
      .trim();
    if (!normalized || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? roundMoney(number) : null;
  }

  function parseHumanAmount(value, unit) {
    const number = parseAmount(value);
    if (number == null) return null;
    const multiplier = ({ k: 1000, thousand: 1000, lakh: 100000, lac: 100000, crore: 10000000 })[
      comparableText(unit)
    ] || 1;
    const result = number * multiplier;
    return Number.isSafeInteger(Math.trunc(result)) || result < Number.MAX_SAFE_INTEGER ? roundMoney(result) : null;
  }

  function parseDateOnly(value) {
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) return '';
      return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
    }
    const text = sanitizeText(value, 40);
    const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:$|[T\s])/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function utcDate(value) {
    const date = parseDateOnly(value);
    return date ? new Date(`${date}T00:00:00.000Z`) : null;
  }

  function dayDifference(later, earlier) {
    const laterDate = utcDate(later);
    const earlierDate = utcDate(earlier);
    return laterDate && earlierDate ? Math.round((laterDate - earlierDate) / 86400000) : null;
  }

  function addDays(value, days) {
    const date = utcDate(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return parseDateOnly(date);
  }

  function todayUtc() {
    return parseDateOnly(new Date());
  }

  function getField(record, names) {
    const object = record && typeof record === 'object' ? record : {};
    for (const name of names) {
      if (object[name] !== undefined && object[name] !== null && String(object[name]).trim() !== '') return object[name];
    }
    return '';
  }

  function chequeParty(record) {
    return getField(record, ['partyName', 'party_name', 'party', 'customerName', 'customer_name']);
  }

  function chequeNumber(record) {
    return getField(record, ['chequeNumber', 'cheque_number', 'chequeNo', 'cheque_no']);
  }

  function chequeAmount(record) {
    return parseAmount(getField(record, ['amount', 'chequeAmount', 'cheque_amount']));
  }

  function chequeDueDate(record) {
    const explicitAd = getField(record, ['dueDateAD', 'due_date_ad', 'chequeDateAD', 'cheque_date_ad']);
    if (explicitAd) return parseDateOnly(explicitAd);
    const value = getField(record, ['dueDate', 'due_date', 'chequeDate', 'cheque_date']);
    if (isLikelyBsDate(value, record)) return '';
    return parseDateOnly(value);
  }

  function chequeIssueDate(record) {
    const explicitAd = getField(record, ['issueDateAD', 'issue_date_ad']);
    if (explicitAd) return parseDateOnly(explicitAd);
    const value = getField(record, ['issueDate', 'issue_date']);
    if (isLikelyBsDate(value, record)) return '';
    return parseDateOnly(value);
  }

  function isLikelyBsDate(value, record) {
    const calendar = comparableText(getField(record, ['dateCalendar', 'date_calendar', 'calendar']));
    if (calendar === 'bs' || calendar.includes('bikram')) return true;
    const match = sanitizeText(value, 40).match(/^(\d{4})[-/]/);
    const year = match ? Number(match[1]) : 0;
    return year >= 2070 && year <= 2100;
  }

  function recordId(record) {
    return sanitizeText(getField(record, ['id', 'chequeId', 'cheque_id']), 80);
  }

  function sameRecord(left, right) {
    if (left === right) return true;
    const leftId = recordId(left);
    const rightId = recordId(right);
    return Boolean(leftId && rightId && leftId === rightId);
  }

  function sanitizeChequeRecord(record) {
    const source = record && typeof record === 'object' ? record : {};
    return {
      id: recordId(source),
      party: sanitizeText(chequeParty(source), 120),
      chequeNumber: normalizeChequeNumber(chequeNumber(source)),
      amount: chequeAmount(source),
      bank: sanitizeText(getField(source, ['bank', 'bankName', 'bank_name']), 100),
      issueDate: chequeIssueDate(source),
      dueDate: chequeDueDate(source),
      status: normalizeStatus(getField(source, ['status'])),
      direction: normalizeDirection(getField(source, ['direction', 'chequeDirection', 'cheque_direction'])),
      assignedTo: sanitizeText(getField(source, ['assignedTo', 'assigned_to']), 100),
      nextActionAt: parseDateOnly(getField(source, ['nextActionAt', 'next_action_at']))
    };
  }

  function assessDataCompleteness(record) {
    const safe = sanitizeChequeRecord(record);
    const checks = [
      ['party', Boolean(safe.party)],
      ['chequeNumber', Boolean(safe.chequeNumber)],
      ['amount', safe.amount != null && safe.amount > 0],
      ['bank', Boolean(safe.bank)],
      ['dueDate', Boolean(safe.dueDate)],
      ['status', Boolean(safe.status)],
      ['direction', Boolean(safe.direction)]
    ];
    const presentFields = checks.filter(item => item[1]).map(item => item[0]);
    const missingFields = checks.filter(item => !item[1]).map(item => item[0]);
    return {
      score: Math.round((presentFields.length / checks.length) * 100),
      presentCount: presentFields.length,
      totalCount: checks.length,
      presentFields,
      missingFields
    };
  }

  function median(values) {
    if (!Array.isArray(values) || !values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function quantile(values, fraction) {
    if (!Array.isArray(values) || !values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function detectChequeAnomalies(record, history, options) {
    const cheque = record && typeof record === 'object' ? record : {};
    const peers = (Array.isArray(history) ? history : []).filter(item => item && typeof item === 'object' && !sameRecord(item, cheque));
    const settings = options && typeof options === 'object' ? options : {};
    const asOf = parseDateOnly(settings.asOf) || todayUtc();
    const safe = sanitizeChequeRecord(cheque);
    const completeness = assessDataCompleteness(cheque);
    const anomalies = [];

    function add(code, severity, message, evidence) {
      if (anomalies.some(item => item.code === code)) return;
      anomalies.push({ code, severity, message, evidence: evidence || {} });
    }

    if (completeness.missingFields.length) {
      add('MISSING_REQUIRED_FIELDS', 'medium', 'Required cheque details are incomplete.', {
        fields: completeness.missingFields.slice()
      });
    }
    if (safe.amount == null || safe.amount <= 0) {
      add('INVALID_AMOUNT', 'high', 'The amount is missing, zero, or invalid.', {});
    }

    const rawDueDate = getField(cheque, ['dueDateAD', 'due_date_ad', 'dueDate', 'due_date', 'chequeDateAD', 'cheque_date_ad', 'chequeDate', 'cheque_date']);
    const rawIssueDate = getField(cheque, ['issueDateAD', 'issue_date_ad', 'issueDate', 'issue_date']);
    if (rawDueDate && !safe.dueDate) {
      if (isLikelyBsDate(rawDueDate, cheque)) add('UNRESOLVED_BS_DUE_DATE', 'medium', 'The BS due date needs a verified AD counterpart before date-based scoring.', {});
      else add('INVALID_DUE_DATE', 'high', 'The due date is not a valid date.', {});
    }
    if (rawIssueDate && !safe.issueDate) {
      if (isLikelyBsDate(rawIssueDate, cheque)) add('UNRESOLVED_BS_ISSUE_DATE', 'low', 'The BS issue date needs a verified AD counterpart before date-based scoring.', {});
      else add('INVALID_ISSUE_DATE', 'medium', 'The issue date is not a valid date.', {});
    }

    if (safe.issueDate && safe.dueDate && dayDifference(safe.dueDate, safe.issueDate) < 0) {
      add('DUE_BEFORE_ISSUE', 'high', 'The due date is earlier than the issue date.', {
        issueDate: safe.issueDate,
        dueDate: safe.dueDate
      });
    }
    if (safe.issueDate && dayDifference(safe.issueDate, asOf) > 0) {
      add('FUTURE_ISSUE_DATE', 'medium', 'The issue date is later than the assessment date.', {
        issueDate: safe.issueDate,
        assessmentDate: asOf
      });
    }
    const overdueDays = safe.dueDate ? dayDifference(asOf, safe.dueDate) : null;
    if (overdueDays > 0 && !CLOSED_STATUSES.has(safe.status) && safe.status !== 'bounced') {
      add('PAST_DUE_OPEN', overdueDays > 14 ? 'high' : 'medium', 'The cheque is past due and still open.', {
        overdueDays,
        dueDate: safe.dueDate
      });
    }

    if (safe.chequeNumber) {
      const duplicates = peers.filter(item => normalizeChequeNumber(chequeNumber(item)) === safe.chequeNumber);
      if (duplicates.length) {
        add('DUPLICATE_CHEQUE_NUMBER', 'critical', 'The normalized cheque number already exists.', {
          matchCount: duplicates.length,
          matchingRecordIds: duplicates.map(recordId).filter(Boolean).slice(0, 10)
        });
      }
    }

    if (safe.party && safe.amount != null && safe.dueDate) {
      const partyKey = comparableText(safe.party);
      const repeats = peers.filter(item => (
        comparableText(chequeParty(item)) === partyKey &&
        chequeAmount(item) === safe.amount &&
        chequeDueDate(item) === safe.dueDate
      ));
      if (repeats.length) {
        add('PARTY_AMOUNT_DATE_REPEAT', 'high', 'The same party, amount, and date combination already exists.', {
          matchCount: repeats.length,
          matchingRecordIds: repeats.map(recordId).filter(Boolean).slice(0, 10)
        });
      }
    }

    const direction = safe.direction;
    const comparableAmounts = peers
      .filter(item => !direction || normalizeDirection(getField(item, ['direction', 'chequeDirection', 'cheque_direction'])) === direction)
      .map(chequeAmount)
      .filter(amount => amount != null && amount > 0);
    const outlier = {
      status: 'not_evaluated',
      method: null,
      sampleSize: comparableAmounts.length,
      reason: comparableAmounts.length < 7 ? 'NEEDS_AT_LEAST_7_COMPARABLE_RECORDS' : null
    };
    if (safe.amount != null && safe.amount > 0 && comparableAmounts.length >= 7) {
      const center = median(comparableAmounts);
      const absoluteDeviations = comparableAmounts.map(value => Math.abs(value - center));
      const mad = median(absoluteDeviations);
      if (mad > 0) {
        const robustZ = 0.6745 * (safe.amount - center) / mad;
        Object.assign(outlier, { status: 'evaluated', method: 'median_absolute_deviation', median: roundMoney(center), mad: roundMoney(mad), robustZ: Math.round(robustZ * 100) / 100, reason: null });
        if (Math.abs(robustZ) >= 3.5) {
          add('ROBUST_AMOUNT_OUTLIER', 'medium', 'The amount is far outside the comparable cheque distribution.', {
            method: outlier.method,
            sampleSize: outlier.sampleSize,
            median: outlier.median,
            robustZ: outlier.robustZ
          });
        }
      } else {
        const firstQuartile = quantile(comparableAmounts, 0.25);
        const thirdQuartile = quantile(comparableAmounts, 0.75);
        const iqr = thirdQuartile - firstQuartile;
        if (iqr > 0) {
          const lowerFence = firstQuartile - 3 * iqr;
          const upperFence = thirdQuartile + 3 * iqr;
          Object.assign(outlier, { status: 'evaluated', method: 'outer_iqr_fence', lowerFence: roundMoney(lowerFence), upperFence: roundMoney(upperFence), reason: null });
          if (safe.amount < lowerFence || safe.amount > upperFence) {
            add('ROBUST_AMOUNT_OUTLIER', 'medium', 'The amount is far outside the comparable cheque distribution.', {
              method: outlier.method,
              sampleSize: outlier.sampleSize,
              lowerFence: outlier.lowerFence,
              upperFence: outlier.upperFence
            });
          }
        } else {
          outlier.reason = 'COMPARABLE_AMOUNTS_HAVE_NO_ROBUST_VARIATION';
        }
      }
    } else if (safe.amount == null || safe.amount <= 0) {
      outlier.reason = 'CURRENT_AMOUNT_IS_INVALID';
    }

    anomalies.sort((left, right) => (SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity]) || left.code.localeCompare(right.code));
    return {
      version: ANOMALY_MODEL_VERSION,
      assessmentDate: asOf,
      anomalies,
      anomalyCount: anomalies.length,
      dataCompleteness: completeness,
      diagnostics: { amountOutlier: outlier },
      disclaimer: 'Deterministic data-quality signals only; no record was changed.'
    };
  }

  function riskCategory(score) {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }

  function assessChequeRisk(record, history, options) {
    const cheque = record && typeof record === 'object' ? record : {};
    const peers = Array.isArray(history) ? history : [];
    const settings = options && typeof options === 'object' ? options : {};
    const anomalyResult = detectChequeAnomalies(cheque, peers, settings);
    const safe = sanitizeChequeRecord(cheque);
    const factors = [];

    const staticPoints = {
      INVALID_AMOUNT: 15,
      INVALID_DUE_DATE: 10,
      INVALID_ISSUE_DATE: 6,
      UNRESOLVED_BS_DUE_DATE: 4,
      UNRESOLVED_BS_ISSUE_DATE: 2,
      DUE_BEFORE_ISSUE: 12,
      FUTURE_ISSUE_DATE: 6,
      DUPLICATE_CHEQUE_NUMBER: 30,
      PARTY_AMOUNT_DATE_REPEAT: 20,
      ROBUST_AMOUNT_OUTLIER: 12
    };
    for (const anomaly of anomalyResult.anomalies) {
      let points = staticPoints[anomaly.code] || 0;
      if (anomaly.code === 'MISSING_REQUIRED_FIELDS') points = Math.min(14, anomaly.evidence.fields.length * 2);
      if (anomaly.code === 'PAST_DUE_OPEN') points = Math.min(35, 15 + Math.ceil(anomaly.evidence.overdueDays / 7) * 3);
      if (points) factors.push({ code: anomaly.code, points, reason: anomaly.message, evidence: anomaly.evidence });
    }

    if (safe.status === 'bounced') {
      factors.push({ code: 'CURRENTLY_BOUNCED', points: 25, reason: 'The cheque is currently marked bounced.', evidence: {} });
    }

    const partyKey = comparableText(safe.party);
    const partyOutcomes = partyKey ? peers.filter(item => {
      const status = normalizeStatus(getField(item, ['status']));
      return comparableText(chequeParty(item)) === partyKey && ['cleared', 'bounced'].includes(status) && !sameRecord(item, cheque);
    }) : [];
    const partyBounces = partyOutcomes.filter(item => normalizeStatus(getField(item, ['status'])) === 'bounced').length;
    if (partyOutcomes.length >= 2 && partyBounces > 0) {
      const ratio = partyBounces / partyOutcomes.length;
      const points = Math.min(20, Math.round(partyBounces * 5 + ratio * 10));
      factors.push({
        code: 'PARTY_BOUNCE_HISTORY',
        points,
        reason: 'Comparable history for this party includes bounced cheques.',
        evidence: { bounced: partyBounces, outcomes: partyOutcomes.length, ratio: Math.round(ratio * 100) / 100 }
      });
    }

    const daysUntilDue = safe.dueDate ? dayDifference(safe.dueDate, anomalyResult.assessmentDate) : null;
    if (daysUntilDue != null && daysUntilDue >= 0 && daysUntilDue <= 3 && !CLOSED_STATUSES.has(safe.status)) {
      factors.push({ code: 'DUE_SOON', points: 5, reason: 'The cheque is due within three days.', evidence: { daysUntilDue } });
    }

    const score = clamp(Math.round(factors.reduce((sum, factor) => sum + factor.points, 0)), 0, 100);
    return {
      version: RISK_MODEL_VERSION,
      assessmentDate: anomalyResult.assessmentDate,
      score,
      category: riskCategory(score),
      factors,
      dataCompleteness: anomalyResult.dataCompleteness,
      anomalySummary: anomalyResult.anomalies.map(item => ({ code: item.code, severity: item.severity })),
      basis: 'Fixed, versioned rules. The score is an operational review priority, not a probability of loss or bounce.',
      requiresHumanReview: true
    };
  }

  function recommendedAction(safe, timing) {
    if (safe.status === 'bounced') return { code: 'CONTACT_AND_RESOLVE', label: 'Contact the party and record an agreed next step.' };
    if (timing.overdueDays > 0) return { code: 'FOLLOW_UP_TODAY', label: 'Follow up today and record the outcome.' };
    if (['draft', 'to_write'].includes(safe.status)) return { code: 'PREPARE_CHEQUE', label: 'Prepare and verify the cheque details.' };
    if (timing.daysUntilDue === 0 && safe.direction === 'incoming') return { code: 'CONFIRM_DEPOSIT', label: 'Confirm deposit readiness and bank details.' };
    if (timing.daysUntilDue === 0 && safe.direction === 'outgoing') return { code: 'VERIFY_FUNDS', label: 'Verify funds and approval before issue.' };
    if (safe.status === 'deposited') return { code: 'VERIFY_CLEARANCE', label: 'Check clearance status with the bank.' };
    if (safe.status === 'hold') return { code: 'REVIEW_HOLD', label: 'Review the hold reason and set the next follow-up.' };
    if (CLOSED_STATUSES.has(safe.status)) return { code: 'NO_ACTION', label: 'No active follow-up is required.' };
    return { code: 'SCHEDULE_FOLLOW_UP', label: 'Set a clear next action and follow-up date.' };
  }

  function scoreChequePriority(record, context) {
    const settings = context && typeof context === 'object' ? context : {};
    const asOf = parseDateOnly(settings.asOf) || todayUtc();
    const safe = sanitizeChequeRecord(record);
    const risk = settings.riskAssessment && Number.isFinite(settings.riskAssessment.score)
      ? settings.riskAssessment
      : assessChequeRisk(record, settings.history || [], { asOf });
    const daysUntilDue = safe.dueDate ? dayDifference(safe.dueDate, asOf) : null;
    const overdueDays = daysUntilDue == null ? 0 : Math.max(0, -daysUntilDue);
    const factors = [];

    if (CLOSED_STATUSES.has(safe.status)) {
      return {
        version: PRIORITY_MODEL_VERSION,
        assessmentDate: asOf,
        score: 0,
        level: 'low',
        factors: [{ code: 'CLOSED_RECORD', points: 0, reason: 'The cheque lifecycle is closed.' }],
        recommendedAction: recommendedAction(safe, { daysUntilDue, overdueDays }),
        requiresConfirmationBeforeFinancialChange: true
      };
    }

    const riskContribution = Math.round(clamp(risk.score, 0, 100) * 0.35);
    if (riskContribution) factors.push({ code: 'RISK_REVIEW', points: riskContribution, reason: `Risk rules contributed ${riskContribution} priority points.` });
    if (safe.status === 'bounced') factors.push({ code: 'BOUNCED', points: 35, reason: 'A bounced cheque needs a documented resolution.' });
    if (overdueDays > 0) factors.push({ code: 'OVERDUE', points: Math.min(40, 24 + Math.ceil(overdueDays / 7) * 5), reason: `The cheque is ${overdueDays} day(s) overdue.` });
    else if (daysUntilDue === 0) factors.push({ code: 'DUE_TODAY', points: 28, reason: 'The cheque is due today.' });
    else if (daysUntilDue != null && daysUntilDue <= 3) factors.push({ code: 'DUE_WITHIN_3_DAYS', points: 20, reason: 'The cheque is due within three days.' });
    else if (daysUntilDue != null && daysUntilDue <= 7) factors.push({ code: 'DUE_WITHIN_7_DAYS', points: 12, reason: 'The cheque is due within seven days.' });
    if (['draft', 'to_write'].includes(safe.status)) factors.push({ code: 'NEEDS_PREPARATION', points: 18, reason: 'The cheque still needs to be prepared.' });
    if (safe.nextActionAt && dayDifference(asOf, safe.nextActionAt) > 0) factors.push({ code: 'MISSED_NEXT_ACTION', points: 15, reason: 'The recorded next-action date has passed.' });
    if (!safe.assignedTo) factors.push({ code: 'UNASSIGNED', points: 5, reason: 'No owner is assigned.' });

    const score = clamp(Math.round(factors.reduce((sum, factor) => sum + factor.points, 0)), 0, 100);
    const level = score >= 75 ? 'urgent' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
    return {
      version: PRIORITY_MODEL_VERSION,
      assessmentDate: asOf,
      score,
      level,
      factors,
      recommendedAction: recommendedAction(safe, { daysUntilDue, overdueDays }),
      requiresConfirmationBeforeFinancialChange: true
    };
  }

  function forecastChequeCashFlow(records, options) {
    const list = Array.isArray(records) ? records : [];
    const settings = options && typeof options === 'object' ? options : {};
    const asOf = parseDateOnly(settings.asOf) || todayUtc();
    const horizonDays = clamp(Math.round(settings.horizonDays || 30), 7, 90);
    const horizonEnd = addDays(asOf, horizonDays);
    const minHistory = clamp(Math.round(settings.minHistory || 8), 4, 100);
    const minSpanDays = clamp(Math.round(settings.minSpanDays || 28), 14, 365);
    const minPerDirection = clamp(Math.round(settings.minPerDirection || 3), 2, 50);
    const requiredDirections = Array.isArray(settings.requiredDirections)
      ? settings.requiredDirections.map(normalizeDirection).filter((value, index, array) => value && array.indexOf(value) === index)
      : DIRECTIONS.slice();

    const scheduled = { incoming: 0, outgoing: 0, count: 0 };
    const historicalCandidates = [];
    for (const record of list) {
      const safe = sanitizeChequeRecord(record);
      const amount = safe.amount;
      const direction = safe.direction;
      const status = safe.status;
      const explicitMovementDate = getField(record, [
        'clearedAt', 'cleared_at', 'settledAt', 'settled_at', 'transactionDate', 'transaction_date'
      ]);
      const movementDate = parseDateOnly(explicitMovementDate) || safe.dueDate;
      if (status === 'cleared' && movementDate && dayDifference(asOf, movementDate) >= 0) {
        historicalCandidates.push({ amount, direction, date: movementDate });
      }
      if (amount > 0 && direction && safe.dueDate && !CLOSED_STATUSES.has(status) && status !== 'bounced') {
        const startsAfterAsOf = dayDifference(safe.dueDate, asOf) >= 0;
        const withinHorizon = dayDifference(horizonEnd, safe.dueDate) >= 0;
        if (startsAfterAsOf && withinHorizon) {
          scheduled[direction] += amount;
          scheduled.count += 1;
        }
      }
    }
    scheduled.incoming = roundMoney(scheduled.incoming);
    scheduled.outgoing = roundMoney(scheduled.outgoing);
    scheduled.net = roundMoney(scheduled.incoming - scheduled.outgoing);

    const usable = historicalCandidates.filter(item => item.amount > 0 && item.direction && item.date);
    const missingDirectionCount = historicalCandidates.filter(item => item.amount > 0 && !item.direction).length;
    const counts = {
      incoming: usable.filter(item => item.direction === 'incoming').length,
      outgoing: usable.filter(item => item.direction === 'outgoing').length
    };
    const dates = usable.map(item => item.date).sort();
    const spanDays = dates.length ? dayDifference(dates[dates.length - 1], dates[0]) + 1 : 0;
    const reasons = [];
    if (usable.length < minHistory) reasons.push({ code: 'INSUFFICIENT_COMPLETED_HISTORY', needed: minHistory, available: usable.length });
    if (spanDays < minSpanDays) reasons.push({ code: 'HISTORY_WINDOW_TOO_SHORT', neededDays: minSpanDays, availableDays: spanDays });
    for (const direction of requiredDirections) {
      if ((counts[direction] || 0) < minPerDirection) reasons.push({
        code: `INSUFFICIENT_${direction.toUpperCase()}_HISTORY`,
        needed: minPerDirection,
        available: counts[direction] || 0
      });
    }
    const missingDirectionRatio = historicalCandidates.length ? missingDirectionCount / historicalCandidates.length : 0;
    if (missingDirectionRatio > 0.05) reasons.push({
      code: 'TOO_MANY_MISSING_DIRECTIONS',
      missing: missingDirectionCount,
      candidates: historicalCandidates.length
    });

    const common = {
      version: FORECAST_MODEL_VERSION,
      asOfDate: asOf,
      horizonDays,
      horizonEndDate: horizonEnd,
      sample: { usable: usable.length, incoming: counts.incoming, outgoing: counts.outgoing, spanDays, missingDirection: missingDirectionCount },
      knownSchedule: scheduled,
      disclaimer: 'Run-rate planning aid only. Scheduled items are shown separately and no payment outcome is assumed.'
    };
    if (reasons.length) return Object.assign(common, { status: 'insufficient_data', reasons, forecast: null });

    const totals = usable.reduce((result, item) => {
      result[item.direction] += item.amount;
      return result;
    }, { incoming: 0, outgoing: 0 });
    const projectedInflow = roundMoney((totals.incoming / spanDays) * horizonDays);
    const projectedOutflow = roundMoney((totals.outgoing / spanDays) * horizonDays);
    return Object.assign(common, {
      status: 'ready',
      reasons: [],
      forecast: {
        method: 'cleared_cheque_daily_run_rate',
        historicalInflow: roundMoney(totals.incoming),
        historicalOutflow: roundMoney(totals.outgoing),
        projectedInflow,
        projectedOutflow,
        projectedNet: roundMoney(projectedInflow - projectedOutflow)
      }
    });
  }

  function safeFilterValue(value) {
    const text = sanitizeText(value, 80).replace(/[^\p{L}\p{N} .&'_-]/gu, '').trim();
    return /\b(?:select|drop|delete|update|insert|alter|script|javascript)\b/i.test(text) ? '' : text;
  }

  function validateFilterAst(ast) {
    if (!ast || typeof ast !== 'object' || ast.version !== FILTER_AST_VERSION || ast.type !== 'filter' || ast.logic !== 'and') return false;
    if (!Array.isArray(ast.conditions) || ast.conditions.length > 20) return false;
    const conditionsValid = ast.conditions.every(condition => {
      if (!condition || !FILTER_FIELDS.includes(condition.field) || !FILTER_OPERATORS.includes(condition.operator)) return false;
      const value = condition.value;
      const values = Array.isArray(value) ? value : [value];
      if (!values.length || values.length > 20 || !values.every(item => ['string', 'number'].includes(typeof item))) return false;
      if (condition.field === 'status' && !values.every(item => STATUSES.includes(item))) return false;
      if (condition.field === 'direction' && !values.every(item => DIRECTIONS.includes(item))) return false;
      if (condition.field === 'riskLevel' && !values.every(item => ['low', 'medium', 'high', 'critical'].includes(item))) return false;
      if (condition.field === 'amount' && !values.every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0)) return false;
      if (condition.field === 'dueDate' && !values.every(item => typeof item === 'string' && Boolean(parseDateOnly(item)))) return false;
      if (['party', 'bank', 'assignedTo', 'chequeNumber'].includes(condition.field) && !values.every(item => typeof item === 'string' && item.length <= 80)) return false;
      return true;
    });
    const sortValid = ast.sort == null || (
      typeof ast.sort === 'object' && ['amount', 'dueDate'].includes(ast.sort.field) && ['asc', 'desc'].includes(ast.sort.direction)
    );
    const limitValid = ast.limit == null || (Number.isInteger(ast.limit) && ast.limit >= 1 && ast.limit <= 100);
    return conditionsValid && sortValid && limitValid;
  }

  function parseNaturalLanguageFilter(input, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const asOf = parseDateOnly(settings.asOf) || todayUtc();
    const original = sanitizeText(input, 240);
    const query = toAsciiDigits(original).toLocaleLowerCase('en');
    const conditions = [];
    const warnings = [];
    let sort = null;
    let limit = null;

    function addCondition(field, operator, value) {
      if (!FILTER_FIELDS.includes(field) || !FILTER_OPERATORS.includes(operator)) return;
      const signature = JSON.stringify([field, operator, value]);
      if (!conditions.some(item => JSON.stringify([item.field, item.operator, item.value]) === signature)) conditions.push({ field, operator, value });
    }

    const statusPatterns = [
      ['bounced', /\b(?:bounced?|return(?:ed)?)\b|बाउन्स/],
      ['cleared', /\bclear(?:ed)?\b|क्लियर/],
      ['hold', /\b(?:hold|on hold|pending)\b|होल्ड/],
      ['deposited', /\bdeposit(?:ed)?\b|जम्मा/],
      ['to_write', /\b(?:to write|unwritten)\b|लेख्न/],
      ['written', /\bwritten\b/],
      ['issued', /\bissued?\b/],
      ['received', /\breceived?\b/],
      ['cancelled', /\bcancell?ed\b|रद्द/],
      ['overdue', /\boverdue\b|म्याद नाघेको/]
    ];
    const matchedStatuses = statusPatterns.filter(item => item[1].test(query)).map(item => item[0]);
    if (matchedStatuses.length === 1) addCondition('status', 'eq', matchedStatuses[0]);
    else if (matchedStatuses.length > 1) addCondition('status', 'in', matchedStatuses);

    if (/\b(?:incoming|inward|receivable)\b|आउने/.test(query)) addCondition('direction', 'eq', 'incoming');
    if (/\b(?:outgoing|outward|payable)\b|जाने/.test(query)) addCondition('direction', 'eq', 'outgoing');

    if (/\b(?:due\s+)?today\b|आज/.test(query)) addCondition('dueDate', 'eq', asOf);
    else if (/\b(?:due\s+)?tomorrow\b|भोलि/.test(query)) addCondition('dueDate', 'eq', addDays(asOf, 1));
    else {
      const nextDays = query.match(/(?:next|within|आउँदो)\s+(\d{1,2})\s*(?:days?|दिन)/);
      if (nextDays) addCondition('dueDate', 'between', [asOf, addDays(asOf, clamp(Number(nextDays[1]), 1, 90))]);
    }

    const betweenAmount = query.match(/(?:amount|रकम)?\s*between\s+([\d,.]+)\s*(k|thousand|lakh|lac|crore)?\s+(?:and|to)\s+([\d,.]+)\s*(k|thousand|lakh|lac|crore)?/);
    if (betweenAmount) {
      const minimum = parseHumanAmount(betweenAmount[1], betweenAmount[2]);
      const maximum = parseHumanAmount(betweenAmount[3], betweenAmount[4]);
      if (minimum != null && maximum != null) addCondition('amount', 'between', [Math.min(minimum, maximum), Math.max(minimum, maximum)]);
    } else {
      const above = query.match(/(?:amount|रकम)?\s*(?:above|over|more than|greater than|भन्दा बढी|>)\s*(?:rs\.?|npr|रु\.?)?\s*([\d,.]+)\s*(k|thousand|lakh|lac|crore)?/);
      const below = query.match(/(?:amount|रकम)?\s*(?:below|under|less than|भन्दा कम|<)\s*(?:rs\.?|npr|रु\.?)?\s*([\d,.]+)\s*(k|thousand|lakh|lac|crore)?/);
      if (above) {
        const amount = parseHumanAmount(above[1], above[2]);
        if (amount != null) addCondition('amount', 'gte', amount);
      }
      if (below) {
        const amount = parseHumanAmount(below[1], below[2]);
        if (amount != null) addCondition('amount', 'lte', amount);
      }
    }

    const riskPatterns = [
      ['critical', /\bcritical\s+risk\b|अति उच्च जोखिम/],
      ['high', /\bhigh\s+risk\b|उच्च जोखिम/],
      ['medium', /\bmedium\s+risk\b|मध्यम जोखिम/],
      ['low', /\blow\s+risk\b|न्यून जोखिम/]
    ];
    const risks = riskPatterns.filter(item => item[1].test(query)).map(item => item[0]);
    if (risks.length === 1) addCondition('riskLevel', 'eq', risks[0]);

    const structuredFields = [
      ['party', /\bparty\s*:\s*["']([^"']+)["']/i],
      ['bank', /\bbank\s*:\s*["']([^"']+)["']/i],
      ['assignedTo', /\bassigned(?:\s+to)?\s*:\s*["']([^"']+)["']/i],
      ['chequeNumber', /\bcheque(?:\s+(?:number|no\.?))?\s*:\s*["']([^"']+)["']/i]
    ];
    for (const item of structuredFields) {
      const match = original.match(item[1]);
      if (!match) continue;
      const value = item[0] === 'chequeNumber' ? normalizeChequeNumber(match[1]) : safeFilterValue(match[1]);
      if (value) addCondition(item[0], item[0] === 'chequeNumber' ? 'eq' : 'contains', value);
      else warnings.push('UNSAFE_STRUCTURED_VALUE_IGNORED');
    }

    if (/\b(?:highest|largest)\s+amount\b/.test(query)) sort = { field: 'amount', direction: 'desc' };
    else if (/\b(?:lowest|smallest)\s+amount\b/.test(query)) sort = { field: 'amount', direction: 'asc' };
    else if (/\b(?:earliest|soonest)\s+(?:due|date)\b/.test(query)) sort = { field: 'dueDate', direction: 'asc' };
    else if (/\blatest\s+(?:due|date)\b/.test(query)) sort = { field: 'dueDate', direction: 'desc' };

    const limitMatch = query.match(/\b(?:top|first|limit)\s+(\d{1,3})\b/);
    if (limitMatch) limit = clamp(Number(limitMatch[1]), 1, 100);
    if (/\b(?:select|drop|delete|update|insert|alter)\b|[;{}]|javascript\s*:|<\/?script/.test(original)) warnings.push('UNSUPPORTED_SYNTAX_IGNORED');
    if (!conditions.length && !sort && !limit) warnings.push('NO_SUPPORTED_FILTERS');

    const ast = {
      version: FILTER_AST_VERSION,
      type: 'filter',
      logic: 'and',
      conditions,
      sort,
      limit
    };
    return {
      version: VERSION,
      ok: validateFilterAst(ast) && Boolean(conditions.length || sort || limit),
      ast,
      warnings: Array.from(new Set(warnings)),
      note: 'Whitelisted filter data only. This parser does not produce SQL, code, or execute a query.'
    };
  }

  function formatNpr(value, locale) {
    const amount = parseAmount(value);
    if (amount == null) return '';
    const language = locale === 'ne' ? 'en-IN' : 'en-IN';
    let formatted;
    try {
      formatted = new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(amount);
    } catch (_) {
      formatted = String(amount);
    }
    return locale === 'ne' ? `रु ${formatted}` : `Rs ${formatted}`;
  }

  function generateChequeMessage(record, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const locale = settings.locale === 'ne' ? 'ne' : 'en';
    const purpose = ['reminder', 'due_today', 'overdue', 'bounced', 'confirmation'].includes(settings.purpose)
      ? settings.purpose
      : 'reminder';
    const safe = sanitizeChequeRecord(record);
    const amount = formatNpr(safe.amount, locale);
    const dueDate = sanitizeText(getField(record, [
      'dueDateDisplay', 'due_date_display', 'dueDateBS', 'due_date_bs',
      'dueDate', 'due_date', 'chequeDate', 'cheque_date'
    ]), 30) || safe.dueDate;
    const number = safe.chequeNumber;
    const missingFields = [];
    if (!amount) missingFields.push('amount');
    if (['reminder', 'overdue'].includes(purpose) && !dueDate) missingFields.push('dueDate');
    if (missingFields.length) {
      return {
        version: MESSAGE_TEMPLATE_VERSION,
        status: 'needs_data',
        locale,
        purpose,
        text: '',
        missingFields,
        generatedBy: 'deterministic-template',
        requiresReviewBeforeSending: true
      };
    }

    const partyEn = safe.party ? `${safe.party}` : 'Sir/Madam';
    const partyNe = safe.party ? `${safe.party}ज्यू` : 'ग्राहकज्यू';
    const numberEn = number ? ` (no. ${number})` : '';
    const numberNe = number ? ` (नं. ${number})` : '';
    let text = '';
    if (locale === 'ne') {
      if (purpose === 'due_today') text = `नमस्ते ${partyNe}। ${amount} को चेक${numberNe} आज भुक्तानीका लागि तय भएको विनम्र सम्झना गराउन चाहन्छौँ। कुनै जानकारी आवश्यक भए कृपया भन्नुहोला। धन्यवाद।`;
      if (purpose === 'reminder') text = `नमस्ते ${partyNe}। ${amount} को चेक${numberNe} ${dueDate} मा भुक्तानीका लागि तय भएको विनम्र सम्झना गराउन चाहन्छौँ। कुनै जानकारी आवश्यक भए कृपया भन्नुहोला। धन्यवाद।`;
      if (purpose === 'overdue') text = `नमस्ते ${partyNe}। ${dueDate} मा तय भएको ${amount} को चेक${numberNe} सम्बन्धमा विनम्र फलो-अप हो। कृपया सुविधाअनुसार अर्को कदम पुष्टि गरिदिनुहोला। धन्यवाद।`;
      if (purpose === 'bounced') text = `नमस्ते ${partyNe}। ${amount} को चेक${numberNe} क्लियर हुन सकेन। कृपया अर्को उपयुक्त कदम पुष्टि गर्न हामीसँग सम्पर्क गरिदिनुहोला। धन्यवाद।`;
      if (purpose === 'confirmation') text = `नमस्ते ${partyNe}। ${amount} को चेक${numberNe} सम्बन्धी विवरण हामीले प्राप्त गरेका छौँ। कृपया विवरण ठीक छ कि छैन पुष्टि गरिदिनुहोला। धन्यवाद।`;
    } else {
      if (purpose === 'due_today') text = `Namaste ${partyEn}. This is a friendly reminder that the ${amount} cheque${numberEn} is due today. Please let us know if you need any clarification. Thank you.`;
      if (purpose === 'reminder') text = `Namaste ${partyEn}. This is a friendly reminder that the ${amount} cheque${numberEn} is due on ${dueDate}. Please let us know if you need any clarification. Thank you.`;
      if (purpose === 'overdue') text = `Namaste ${partyEn}. This is a respectful follow-up about the ${amount} cheque${numberEn} that was due on ${dueDate}. Please confirm a suitable next step when convenient. Thank you.`;
      if (purpose === 'bounced') text = `Namaste ${partyEn}. The ${amount} cheque${numberEn} could not be cleared. Please contact us so we can confirm the next suitable step. Thank you.`;
      if (purpose === 'confirmation') text = `Namaste ${partyEn}. We have received the details for the ${amount} cheque${numberEn}. Please confirm that the information is correct. Thank you.`;
    }
    return {
      version: MESSAGE_TEMPLATE_VERSION,
      status: 'ready',
      locale,
      purpose,
      text,
      missingFields: [],
      generatedBy: 'deterministic-template',
      requiresReviewBeforeSending: true
    };
  }

  return Object.freeze({
    VERSION,
    RISK_MODEL_VERSION,
    ANOMALY_MODEL_VERSION,
    PRIORITY_MODEL_VERSION,
    FORECAST_MODEL_VERSION,
    FILTER_AST_VERSION,
    MESSAGE_TEMPLATE_VERSION,
    MODEL_INFO,
    STATUSES,
    DIRECTIONS,
    FILTER_FIELDS,
    FILTER_OPERATORS,
    sanitizeText,
    escapeHtml,
    normalizeChequeNumber,
    normalizeStatus,
    normalizeDirection,
    parseAmount,
    parseDateOnly,
    addDays,
    dayDifference,
    formatNpr,
    sanitizeChequeRecord,
    assessDataCompleteness,
    detectChequeAnomalies,
    assessChequeRisk,
    scoreChequePriority,
    forecastChequeCashFlow,
    parseNaturalLanguageFilter,
    validateFilterAst,
    generateChequeMessage
  });
});
