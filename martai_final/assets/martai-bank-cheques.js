/*
 * Shared cheque banking-calendar helpers.
 *
 * The written cheque date is never changed. For workload views, a cheque
 * written for a closed day is assigned to the next open banking day.
 *
 * Browser: window.MartAIBankCheques
 * Node/tests: require('./martai-bank-cheques.js')
 */
(function initMartAIBankCheques(globalScope, factory) {
  'use strict';

  const dateTools = typeof module === 'object' && module.exports
    ? require('./martai-date.js')
    : globalScope && globalScope.MartAIDate;
  const api = factory(dateTools);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.MartAIBankCheques = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMartAIBankCheques(DateTools) {
  'use strict';

  if (!DateTools) throw new Error('MartAIDate is required');

  const TERMINAL_STATUSES = Object.freeze([
    'clear', 'cleared', 'bounce', 'bounced', 'cancel', 'cancelled', 'canceled'
  ]);

  function firstValue(record, keys) {
    for (let index = 0; index < keys.length; index += 1) {
      const value = record && record[keys[index]];
      if (value != null && String(value).trim() !== '') return value;
    }
    return '';
  }

  function writtenDate(record) {
    const value = firstValue(record, ['dueDate', 'due_date', 'chequeDate', 'cheque_date']);
    if (!value) return '';
    try { return DateTools.dayKey(value); } catch (_) { return ''; }
  }

  function lifecycleStatus(record) {
    return String(firstValue(record, ['lifecycleStatus', 'lifecycle_status', 'status']) || 'hold').trim().toLowerCase();
  }

  function isActive(record) {
    return TERMINAL_STATUSES.indexOf(lifecycleStatus(record)) < 0 && !firstValue(record, ['deletedAt', 'deleted_at']);
  }

  function effectiveDate(record, options) {
    const original = writtenDate(record);
    return original ? DateTools.bankEffectiveDate(original, options || {}) : '';
  }

  function dueInfo(record, asOfDate, options) {
    const settings = options || {};
    const originalDate = writtenDate(record);
    const today = DateTools.dayKey(asOfDate == null ? Date.now() : asOfDate);
    const calendar = originalDate
      ? DateTools.bankEffectiveDateInfo(originalDate, settings)
      : { originalDate: '', effectiveDate: '', shifted: false, daysShifted: 0, closedDates: [] };
    const lifecycle = lifecycleStatus(record);
    let status = lifecycle;
    let daysOverdue = 0;
    let businessDaysUntil = 0;
    if (isActive(record) && calendar.effectiveDate) {
      const difference = DateTools.daysBetween(calendar.effectiveDate, today);
      if (difference > 0) {
        status = 'overdue';
        daysOverdue = Math.max(0, DateTools.businessDaysBetween(calendar.effectiveDate, today, settings));
      } else if (difference === 0) {
        status = 'today';
      } else {
        status = 'upcoming';
        businessDaysUntil = Math.max(0, DateTools.businessDaysBetween(today, calendar.effectiveDate, settings));
      }
    }
    const configuredWeekends = settings.weekendDays == null
      ? (settings.weekends == null ? DateTools.DEFAULT_BANK_WEEKEND_DAYS : settings.weekends)
      : settings.weekendDays;
    const weekendDays = Array.from(
      typeof configuredWeekends === 'number' || typeof configuredWeekends === 'string'
        ? [configuredWeekends]
        : (configuredWeekends || [])
    ).map(Number);
    const hasWeekendClosure = calendar.closedDates.some(function isWeekend(date) {
      return weekendDays.indexOf(DateTools.dayOfWeek(date)) >= 0;
    });
    const rolloverReason = calendar.shifted
      ? (hasWeekendClosure ? 'Weekend rollover' : 'Public holiday rollover')
      : '';
    return Object.freeze({
      originalDate: calendar.originalDate,
      effectiveDate: calendar.effectiveDate,
      shifted: calendar.shifted,
      daysShifted: calendar.daysShifted,
      closedDates: calendar.closedDates,
      rolloverReason: rolloverReason,
      lifecycleStatus: lifecycle,
      status: status,
      daysOverdue: daysOverdue,
      businessDaysUntil: businessDaysUntil
    });
  }

  function recordsForDate(records, targetDate, options) {
    const settings = options || {};
    const target = DateTools.dayKey(targetDate);
    return (Array.isArray(records) ? records : []).filter(function matches(record) {
      if (settings.includeTerminal !== true && !isActive(record)) return false;
      return effectiveDate(record, settings) === target;
    });
  }

  function summaryForDate(records, targetDate, options) {
    const items = recordsForDate(records, targetDate, options);
    return Object.freeze({
      date: DateTools.dayKey(targetDate),
      count: items.length,
      amount: items.reduce(function sum(total, item) {
        const amount = Number(item && item.amount);
        return total + (Number.isFinite(amount) ? amount : 0);
      }, 0),
      carriedCount: items.filter(function carried(item) {
        return writtenDate(item) !== effectiveDate(item, options);
      }).length,
      items: Object.freeze(items.slice())
    });
  }

  function forBankingViews(records, options) {
    return (Array.isArray(records) ? records : []).map(function mapRecord(record) {
      const originalDueDate = writtenDate(record);
      return Object.assign({}, record, {
        originalDueDate: originalDueDate,
        dueDate: effectiveDate(record, options),
        chequeDate: originalDueDate
      });
    });
  }

  return Object.freeze({
    TERMINAL_STATUSES: TERMINAL_STATUSES,
    dueInfo: dueInfo,
    effectiveDate: effectiveDate,
    forBankingViews: forBankingViews,
    isActive: isActive,
    lifecycleStatus: lifecycleStatus,
    recordsForDate: recordsForDate,
    summaryForDate: summaryForDate,
    writtenDate: writtenDate
  });
});
