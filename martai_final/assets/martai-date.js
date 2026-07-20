/*
 * Shared Nepal-aware date helpers for RD MART.
 *
 * All timestamp-to-day conversions are explicit about Asia/Kathmandu. Bikram
 * Sambat conversion is intentionally strict: dates outside the bundled
 * 2070-2090 BS table throw instead of being silently clamped.
 *
 * Browser: window.MartAIDate
 * Node/tests: require('./martai-date.js')
 */
(function initMartAIDate(globalScope, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.MartAIDate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMartAIDate() {
  'use strict';

  const KATHMANDU_TIME_ZONE = 'Asia/Kathmandu';
  const MS_PER_DAY = 86400000;
  const BS_ANCHOR = Object.freeze({ bsYear: 2070, bsMonth: 1, bsDay: 1, ad: '2013-04-14' });
  const BS_MONTH_NAMES_EN = Object.freeze([
    'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Aswin',
    'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'
  ]);
  const BS_MONTH_NAMES_NE = Object.freeze([
    'बैशाख', 'जेठ', 'असार', 'श्रावण', 'भाद्र', 'आश्विन',
    'कार्तिक', 'मंसिर', 'पौष', 'माघ', 'फाल्गुण', 'चैत्र'
  ]);
  const BS_MONTHS = Object.freeze({
    2070: Object.freeze([31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30]),
    2071: Object.freeze([31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30]),
    2072: Object.freeze([31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30]),
    2073: Object.freeze([31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31]),
    2074: Object.freeze([31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30]),
    2075: Object.freeze([31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30]),
    2076: Object.freeze([31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30]),
    2077: Object.freeze([31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31]),
    2078: Object.freeze([31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30]),
    2079: Object.freeze([31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30]),
    2080: Object.freeze([31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30]),
    2081: Object.freeze([31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31]),
    2082: Object.freeze([31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30]),
    2083: Object.freeze([31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30]),
    2084: Object.freeze([31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31]),
    2085: Object.freeze([30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31]),
    2086: Object.freeze([31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30]),
    2087: Object.freeze([31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30]),
    2088: Object.freeze([30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30]),
    2089: Object.freeze([30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30]),
    2090: Object.freeze([30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30])
  });
  // This matches the app's existing cheque workload rule and remains
  // configurable for stores that process Sunday banking.
  const DEFAULT_BANK_WEEKEND_DAYS = Object.freeze([0, 6]);
  const BS_YEARS = Object.freeze(Object.keys(BS_MONTHS).map(Number).sort(function sort(a, b) { return a - b; }));
  const dayFormatterCache = new Map();

  function pad2(number) {
    return String(number).padStart(2, '0');
  }

  function normalizeNepaliDigits(value) {
    const devanagari = '०१२३४५६७८९';
    return String(value == null ? '' : value).replace(/[०-९]/g, function replaceDigit(digit) {
      return String(devanagari.indexOf(digit));
    });
  }

  function toNepaliDigits(value) {
    const devanagari = '०१२३४५६७८९';
    return String(value == null ? '' : value).replace(/\d/g, function replaceDigit(digit) {
      return devanagari[Number(digit)];
    });
  }

  function parseAdKey(value) {
    const match = normalizeNepaliDigits(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new TypeError('Expected an AD date in YYYY-MM-DD format');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) {
      throw new RangeError('Invalid AD date: ' + value);
    }
    return { year: year, month: month, day: day, key: match[1] + '-' + match[2] + '-' + match[3] };
  }

  function utcMilliseconds(dayKeyValue) {
    const parts = parseAdKey(dayKeyValue);
    return Date.UTC(parts.year, parts.month - 1, parts.day);
  }

  function formatTimestampDay(value, timeZone) {
    const zone = timeZone || KATHMANDU_TIME_ZONE;
    let formatter = dayFormatterCache.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      dayFormatterCache.set(zone, formatter);
    }
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value == null ? Date.now() : value);
    if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date or timestamp: ' + value);
    const fields = {};
    formatter.formatToParts(date).forEach(function collect(part) {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') fields[part.type] = part.value;
    });
    return parseAdKey(fields.year + '-' + fields.month + '-' + fields.day).key;
  }

  function extractDateValue(value) {
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    if (value.chequeDate != null) return value.chequeDate;
    if (value.dueDate != null) return value.dueDate;
    if (value.date != null) return value.date;
    return value;
  }

  function dayKey(value, options) {
    const settings = options || {};
    const raw = extractDateValue(value);
    if (typeof raw === 'string') {
      const normalized = normalizeNepaliDigits(raw).trim();
      const dateOnly = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (dateOnly) return parseAdKey(dateOnly[1] + '-' + pad2(dateOnly[2]) + '-' + pad2(dateOnly[3])).key;

      // A timestamp without an offset is treated as Kathmandu wall time. Its
      // day component is therefore stable even when tests or deployments run
      // in a different machine timezone.
      const localTimestamp = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/);
      if (localTimestamp) {
        return parseAdKey(localTimestamp[1] + '-' + pad2(localTimestamp[2]) + '-' + pad2(localTimestamp[3])).key;
      }
      return formatTimestampDay(normalized, settings.timeZone || KATHMANDU_TIME_ZONE);
    }
    return formatTimestampDay(raw, settings.timeZone || KATHMANDU_TIME_ZONE);
  }

  function kathmanduDayKey(value) {
    return dayKey(value, { timeZone: KATHMANDU_TIME_ZONE });
  }

  function addDays(dayKeyValue, amount) {
    const days = Number(amount);
    if (!Number.isFinite(days) || !Number.isInteger(days)) throw new TypeError('Day offset must be an integer');
    const date = new Date(utcMilliseconds(dayKeyValue) + days * MS_PER_DAY);
    return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  }

  function daysBetween(start, end) {
    return Math.round((utcMilliseconds(dayKey(end)) - utcMilliseconds(dayKey(start))) / MS_PER_DAY);
  }

  function dayOfWeek(value) {
    return new Date(utcMilliseconds(dayKey(value))).getUTCDay();
  }

  function totalDaysInBsTable() {
    return BS_YEARS.reduce(function addYear(total, year) {
      return total + BS_MONTHS[year].reduce(function addMonth(sum, length) { return sum + length; }, 0);
    }, 0);
  }

  const TOTAL_BS_DAYS = totalDaysInBsTable();
  const LAST_SUPPORTED_AD = addDays(BS_ANCHOR.ad, TOTAL_BS_DAYS - 1);
  const BS_RANGE = Object.freeze({
    firstBs: BS_YEARS[0] + '-01-01',
    lastBs: BS_YEARS[BS_YEARS.length - 1] + '-12-' + pad2(BS_MONTHS[BS_YEARS[BS_YEARS.length - 1]][11]),
    firstAd: BS_ANCHOR.ad,
    lastAd: LAST_SUPPORTED_AD
  });

  function bsOutOfRangeError(value) {
    return new RangeError(
      'Date ' + value + ' is outside the supported BS range ' + BS_RANGE.firstBs + ' through ' + BS_RANGE.lastBs
    );
  }

  function adToBs(value) {
    const ad = dayKey(value);
    let remaining = Math.round((utcMilliseconds(ad) - utcMilliseconds(BS_ANCHOR.ad)) / MS_PER_DAY);
    if (remaining < 0 || remaining >= TOTAL_BS_DAYS) throw bsOutOfRangeError(ad);

    let year = BS_YEARS[0];
    for (let index = 0; index < BS_YEARS.length; index += 1) {
      const candidate = BS_YEARS[index];
      const yearLength = BS_MONTHS[candidate].reduce(function add(sum, length) { return sum + length; }, 0);
      if (remaining < yearLength) {
        year = candidate;
        break;
      }
      remaining -= yearLength;
    }

    let month = 1;
    for (let index = 0; index < BS_MONTHS[year].length; index += 1) {
      const monthLength = BS_MONTHS[year][index];
      if (remaining < monthLength) {
        month = index + 1;
        break;
      }
      remaining -= monthLength;
    }
    const day = remaining + 1;
    return { year: year, month: month, day: day, key: year + '-' + pad2(month) + '-' + pad2(day), ad: ad };
  }

  function parseBs(value, monthValue, dayValue) {
    let year;
    let month;
    let day;
    if (typeof value === 'object' && value !== null) {
      year = Number(normalizeNepaliDigits(value.year));
      month = Number(normalizeNepaliDigits(value.month));
      day = Number(normalizeNepaliDigits(value.day));
    } else if (monthValue != null || dayValue != null) {
      year = Number(normalizeNepaliDigits(value));
      month = Number(normalizeNepaliDigits(monthValue));
      day = Number(normalizeNepaliDigits(dayValue));
    } else {
      const match = normalizeNepaliDigits(value).trim().replace(/[/.]/g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) throw new TypeError('Expected a BS date in YYYY-MM-DD format');
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    }

    if (!Object.prototype.hasOwnProperty.call(BS_MONTHS, year)) throw bsOutOfRangeError(year + '-' + pad2(month) + '-' + pad2(day));
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('Invalid BS month: ' + month);
    const monthLength = BS_MONTHS[year][month - 1];
    if (!Number.isInteger(day) || day < 1 || day > monthLength) {
      throw new RangeError('Invalid BS day ' + day + ' for ' + year + '-' + pad2(month) + ' (maximum ' + monthLength + ')');
    }
    return { year: year, month: month, day: day, key: year + '-' + pad2(month) + '-' + pad2(day) };
  }

  function bsToAd(value, monthValue, dayValue) {
    const bs = parseBs(value, monthValue, dayValue);
    let offset = 0;
    for (let year = BS_YEARS[0]; year < bs.year; year += 1) {
      offset += BS_MONTHS[year].reduce(function add(sum, length) { return sum + length; }, 0);
    }
    for (let month = 1; month < bs.month; month += 1) offset += BS_MONTHS[bs.year][month - 1];
    offset += bs.day - 1;
    return addDays(BS_ANCHOR.ad, offset);
  }

  function toBsKey(value) {
    return adToBs(value).key;
  }

  function formatBs(value, options) {
    const settings = options || {};
    const locale = String(settings.locale || 'en-NP').toLowerCase();
    const nepali = locale.indexOf('ne') === 0;
    const bs = settings.inputCalendar === 'bs' ? parseBs(value) : adToBs(value);
    const style = settings.style || 'medium';
    const suffix = settings.suffix === false ? '' : (nepali ? ' बि.सं.' : ' BS');
    let output;

    if (style === 'numeric') output = bs.year + '-' + pad2(bs.month) + '-' + pad2(bs.day);
    else if (style === 'long') {
      output = nepali
        ? bs.day + ' ' + BS_MONTH_NAMES_NE[bs.month - 1] + ' ' + bs.year
        : bs.day + ' ' + BS_MONTH_NAMES_EN[bs.month - 1] + ' ' + bs.year;
    } else {
      output = nepali
        ? bs.year + ' ' + BS_MONTH_NAMES_NE[bs.month - 1] + ' ' + bs.day
        : bs.year + ' ' + BS_MONTH_NAMES_EN[bs.month - 1] + ' ' + bs.day;
    }
    return (nepali ? toNepaliDigits(output) : output) + suffix;
  }

  function formatNepaliDate(value, options) {
    return formatBs(value, Object.assign({}, options || {}, { locale: (options && options.locale) || 'ne-NP' }));
  }

  function formatNepaliNumber(value, options) {
    const settings = options || {};
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError('Expected a finite number');
    return new Intl.NumberFormat(settings.locale || 'ne-NP', {
      minimumFractionDigits: settings.minimumFractionDigits,
      maximumFractionDigits: settings.maximumFractionDigits
    }).format(number);
  }

  function formatNepaliCurrency(value, options) {
    const settings = options || {};
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError('Expected a finite amount');
    return new Intl.NumberFormat(settings.locale || 'en-NP', {
      style: 'currency',
      currency: settings.currency || 'NPR',
      currencyDisplay: settings.currencyDisplay || 'symbol',
      minimumFractionDigits: settings.minimumFractionDigits == null ? 0 : settings.minimumFractionDigits,
      maximumFractionDigits: settings.maximumFractionDigits == null ? 2 : settings.maximumFractionDigits
    }).format(number);
  }

  function normalizeWeekendDays(value) {
    const source = value == null
      ? DEFAULT_BANK_WEEKEND_DAYS
      : (typeof value === 'number' || typeof value === 'string' ? [value] : Array.from(value));
    const result = Array.from(new Set(source.map(Number)));
    if (result.some(function invalid(day) { return !Number.isInteger(day) || day < 0 || day > 6; })) {
      throw new RangeError('Weekend days must contain JavaScript weekday numbers from 0 (Sunday) to 6 (Saturday)');
    }
    return result;
  }

  function normalizeHolidays(values) {
    const result = new Set();
    if (values == null) return result;
    const source = typeof values === 'string' || values instanceof Date || typeof values[Symbol.iterator] !== 'function'
      ? [values]
      : Array.from(values);
    source.forEach(function addHoliday(value) {
      result.add(dayKey(value && typeof value === 'object' && value.date != null ? value.date : value));
    });
    return result;
  }

  function bankingRules(options) {
    const settings = options || {};
    return {
      weekendDays: normalizeWeekendDays(settings.weekendDays == null ? settings.weekends : settings.weekendDays),
      holidays: normalizeHolidays(settings.holidays == null ? settings.holidayDates : settings.holidays),
      isHoliday: typeof settings.isHoliday === 'function' ? settings.isHoliday : null
    };
  }

  function isBankingDayWithRules(date, rules) {
    if (rules.weekendDays.indexOf(dayOfWeek(date)) >= 0) return false;
    if (rules.holidays.has(date)) return false;
    if (rules.isHoliday && rules.isHoliday(date) === true) return false;
    return true;
  }

  function isBankingDay(value, options) {
    const date = dayKey(value);
    return isBankingDayWithRules(date, bankingRules(options));
  }

  function bankEffectiveDateInfo(value, options) {
    const settings = options || {};
    const originalDate = dayKey(value);
    const rules = bankingRules(settings);
    const roll = String(settings.roll || settings.direction || 'following').toLowerCase();
    if (roll === 'none') {
      return Object.freeze({
        originalDate: originalDate,
        effectiveDate: originalDate,
        shifted: false,
        daysShifted: 0,
        closedDates: Object.freeze([])
      });
    }
    const direction = roll === 'preceding' || roll === 'previous' || roll === 'backward' ? -1 : 1;
    const limit = Math.max(1, Math.floor(Number(settings.maxSearchDays) || 366));
    const closedDates = [];
    let effectiveDate = originalDate;
    let attempts = 0;
    while (!isBankingDayWithRules(effectiveDate, rules)) {
      closedDates.push(effectiveDate);
      attempts += 1;
      if (attempts > limit) throw new RangeError('No banking day found within ' + limit + ' days of ' + originalDate);
      effectiveDate = addDays(effectiveDate, direction);
    }
    return Object.freeze({
      originalDate: originalDate,
      effectiveDate: effectiveDate,
      shifted: effectiveDate !== originalDate,
      daysShifted: daysBetween(originalDate, effectiveDate),
      closedDates: Object.freeze(closedDates.slice())
    });
  }

  function bankEffectiveDate(value, options) {
    return bankEffectiveDateInfo(value, options).effectiveDate;
  }

  return Object.freeze({
    BS_ANCHOR: BS_ANCHOR,
    BS_MONTHS: BS_MONTHS,
    BS_MONTH_NAMES_EN: BS_MONTH_NAMES_EN,
    BS_MONTH_NAMES_NE: BS_MONTH_NAMES_NE,
    BS_RANGE: BS_RANGE,
    DEFAULT_BANK_WEEKEND_DAYS: DEFAULT_BANK_WEEKEND_DAYS,
    KATHMANDU_TIME_ZONE: KATHMANDU_TIME_ZONE,
    adToBs: adToBs,
    addDays: addDays,
    bankEffectiveDate: bankEffectiveDate,
    bankEffectiveDateInfo: bankEffectiveDateInfo,
    bsToAd: bsToAd,
    dayKey: dayKey,
    dayOfWeek: dayOfWeek,
    daysBetween: daysBetween,
    formatBs: formatBs,
    formatNepaliCurrency: formatNepaliCurrency,
    formatNepaliDate: formatNepaliDate,
    formatNepaliNumber: formatNepaliNumber,
    isBankingDay: isBankingDay,
    kathmanduDayKey: kathmanduDayKey,
    normalizeNepaliDigits: normalizeNepaliDigits,
    parseBs: parseBs,
    toBsKey: toBsKey,
    toNepaliDigits: toNepaliDigits
  });
});
