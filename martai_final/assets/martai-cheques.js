/*
 * Pure cheque-domain helpers for RD MART.
 *
 * This module never writes to storage or mutates a supplied cheque. Status
 * changes are returned as proposals so the UI can obtain confirmation and the
 * persistence layer can save the record and audit event transactionally.
 *
 * Browser: window.MartAICheques
 * Node/tests: require('./martai-cheques.js')
 */
(function initMartAICheques(globalScope, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.MartAICheques = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMartAICheques() {
  'use strict';

  const STATUS = Object.freeze({
    DRAFT: 'draft',
    TO_WRITE: 'to_write',
    WRITTEN: 'written',
    ISSUED: 'issued',
    RECEIVED: 'received',
    DEPOSITED: 'deposited',
    HOLD: 'hold',
    CLEARED: 'cleared',
    BOUNCED: 'bounced',
    CANCELLED: 'cancelled',
    OVERDUE: 'overdue'
  });
  const LIFECYCLE_STATUSES = Object.freeze(Object.keys(STATUS).map(function value(key) { return STATUS[key]; }));
  const STATUS_LABELS = Object.freeze({
    draft: 'Draft',
    to_write: 'To Write',
    written: 'Written',
    issued: 'Issued',
    received: 'Received',
    deposited: 'Deposited',
    hold: 'On Hold',
    cleared: 'Cleared',
    bounced: 'Bounced',
    cancelled: 'Cancelled',
    overdue: 'Overdue'
  });
  const LEGACY_STATUS = Object.freeze({ HOLD: 'hold', CLEAR: 'clear', BOUNCE: 'bounce' });
  const LEGACY_STATUSES = Object.freeze(Object.keys(LEGACY_STATUS).map(function value(key) { return LEGACY_STATUS[key]; }));
  const DIRECTION = Object.freeze({ INCOMING: 'incoming', OUTGOING: 'outgoing', UNSPECIFIED: 'unspecified' });
  const DIRECTIONS = Object.freeze([DIRECTION.INCOMING, DIRECTION.OUTGOING, DIRECTION.UNSPECIFIED]);
  const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);
  const TERMINAL_STATUSES = Object.freeze([STATUS.CLEARED, STATUS.BOUNCED, STATUS.CANCELLED]);
  const IMPORTANT_TRANSITIONS = Object.freeze([
    STATUS.CLEARED,
    STATUS.BOUNCED,
    STATUS.CANCELLED
  ]);
  const REASON_REQUIRED_STATUSES = Object.freeze([
    STATUS.BOUNCED,
    STATUS.CANCELLED
  ]);
  const ALLOWED_TRANSITIONS = Object.freeze({
    draft: Object.freeze(['to_write', 'cancelled']),
    to_write: Object.freeze(['written', 'cancelled']),
    written: Object.freeze(['issued', 'received', 'deposited', 'hold', 'cancelled']),
    issued: Object.freeze(['hold', 'deposited', 'cleared', 'bounced', 'cancelled', 'overdue']),
    received: Object.freeze(['deposited', 'hold', 'cleared', 'bounced', 'cancelled', 'overdue']),
    deposited: Object.freeze(['hold', 'cleared', 'bounced', 'overdue']),
    hold: Object.freeze(['issued', 'received', 'deposited', 'cleared', 'bounced', 'cancelled', 'overdue']),
    cleared: Object.freeze([]),
    bounced: Object.freeze([]),
    cancelled: Object.freeze([]),
    overdue: Object.freeze(['hold', 'deposited', 'cleared', 'bounced', 'cancelled'])
  });
  const SMART_VIEWS = Object.freeze([
    'action_needed',
    'due_today',
    'upcoming',
    'to_write',
    'deposited',
    'hold',
    'cleared',
    'bounced',
    'all'
  ]);
  const SMART_VIEW_LABELS = Object.freeze({
    action_needed: 'Action Needed',
    due_today: 'Due Today',
    upcoming: 'Upcoming',
    to_write: 'To Write',
    deposited: 'Deposited',
    hold: 'On Hold',
    cleared: 'Cleared',
    bounced: 'Bounced',
    all: 'All Cheques'
  });
  const DEFAULT_ATTACHMENT_TYPES = Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]);
  const MIME_EXTENSIONS = Object.freeze({
    'image/jpeg': Object.freeze(['jpg', 'jpeg']),
    'image/png': Object.freeze(['png']),
    'image/webp': Object.freeze(['webp']),
    'application/pdf': Object.freeze(['pdf'])
  });
  const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
  const MS_PER_DAY = 86400000;

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function firstDefined(object, keys) {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (own(object, key) && object[key] != null) return object[key];
    }
    return undefined;
  }

  function safeString(value, maximumLength) {
    if (value == null) return '';
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
    const text = String(value).replace(/\u0000/g, '').trim();
    return maximumLength && text.length > maximumLength ? text.slice(0, maximumLength) : text;
  }

  function rawString(value) {
    return safeString(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  function normalizeToken(value) {
    return safeString(value).toLowerCase().replace(/[\s-]+/g, '_');
  }

  const STATUS_ALIASES = Object.freeze({
    draft: 'draft',
    to_write: 'to_write',
    towrite: 'to_write',
    queued: 'to_write',
    written: 'written',
    issued: 'issued',
    received: 'received',
    deposited: 'deposited',
    hold: 'hold',
    on_hold: 'hold',
    pending: 'hold',
    clear: 'cleared',
    cleared: 'cleared',
    bounce: 'bounced',
    bounced: 'bounced',
    cancel: 'cancelled',
    canceled: 'cancelled',
    cancelled: 'cancelled',
    overdue: 'overdue'
  });

  function recognizedStatus(value) {
    const token = normalizeToken(value);
    return token && own(STATUS_ALIASES, token) ? STATUS_ALIASES[token] : null;
  }

  function normalizeStatus(value, fallback) {
    return recognizedStatus(value) || (fallback === undefined ? STATUS.HOLD : fallback);
  }

  function statusLabel(value) {
    const status = normalizeStatus(value, null);
    return status ? STATUS_LABELS[status] : 'Unknown';
  }

  function toLegacyStatus(value) {
    const status = normalizeStatus(value, STATUS.HOLD);
    if (status === STATUS.CLEARED) return LEGACY_STATUS.CLEAR;
    if (status === STATUS.BOUNCED) return LEGACY_STATUS.BOUNCE;
    return LEGACY_STATUS.HOLD;
  }

  function normalizeDirection(value) {
    const token = normalizeToken(value);
    if (['incoming', 'inbound', 'inflow', 'receivable', 'customer'].indexOf(token) >= 0) return DIRECTION.INCOMING;
    if (['outgoing', 'outbound', 'outflow', 'payable', 'supplier', 'vendor'].indexOf(token) >= 0) return DIRECTION.OUTGOING;
    return DIRECTION.UNSPECIFIED;
  }

  function parseAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value
      .replace(/\u00A0/g, ' ')
      .replace(/(?:NPR|Rs\.?|रु\.?)/gi, '')
      .replace(/,/g, '')
      .trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function isDayKey(value) {
    const match = safeString(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  }

  function timestampToKathmanduDay(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value == null ? Date.now() : value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kathmandu',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).forEach(function collect(part) {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') parts[part.type] = part.value;
    });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  function dayKey(value) {
    if (typeof value === 'string') {
      const text = value.trim();
      if (isDayKey(text)) return text;
      if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return timestampToKathmanduDay(text);
      return '';
    }
    return timestampToKathmanduDay(value);
  }

  function utcDayMilliseconds(value) {
    if (!isDayKey(value)) return NaN;
    const parts = value.split('-').map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(value, amount) {
    const date = new Date(utcDayMilliseconds(value) + Number(amount || 0) * MS_PER_DAY);
    return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  }

  function daysBetween(start, end) {
    return Math.round((utcDayMilliseconds(end) - utcDayMilliseconds(start)) / MS_PER_DAY);
  }

  function normalizeDateValue(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) return dayKey(value);
    const text = safeString(value);
    if (isDayKey(text)) return text;
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return dayKey(text);
    return text.slice(0, 64);
  }

  function validTimestamp(value) {
    return !value || !Number.isNaN(new Date(value).getTime());
  }

  function riskLevelForScore(value) {
    if (value == null || value === '') return '';
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 100) return '';
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  function normalizeRiskLevel(value, score) {
    const token = normalizeToken(value);
    return RISK_LEVELS.indexOf(token) >= 0 ? token : riskLevelForScore(score);
  }

  function attachmentIndicator(input) {
    const raw = firstDefined(input, [
      'attachment', 'attachmentMeta', 'attachment_meta', 'attachmentName', 'attachment_name',
      'attachmentPath', 'attachment_path', 'attachmentUrl', 'attachment_url'
    ]);
    if (!raw) return null;
    if (typeof raw === 'string') {
      return { id: '', name: 'Attachment', type: '', size: null, storagePath: safeString(raw, 500), referenceOnly: true };
    }
    if (typeof raw !== 'object') return null;
    return {
      id: safeString(firstDefined(raw, ['id', 'attachmentId', 'attachment_id']), 120),
      name: safeString(firstDefined(raw, ['name', 'fileName', 'filename']), 180) || 'Attachment',
      type: safeString(firstDefined(raw, ['type', 'mimeType', 'mime_type']), 120).toLowerCase(),
      size: parseAmount(firstDefined(raw, ['size', 'sizeBytes', 'size_bytes'])),
      storagePath: safeString(firstDefined(raw, ['storagePath', 'storage_path', 'path']), 500),
      sha256: safeString(firstDefined(raw, ['sha256', 'checksum']), 128).toLowerCase(),
      referenceOnly: Boolean(firstDefined(raw, ['referenceOnly', 'reference_only']))
    };
  }

  function normalizeRecord(input, options) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Cheque record must be an object');
    const settings = options || {};
    const lifecycleSource = firstDefined(input, ['lifecycleStatus', 'lifecycle_status', 'status']);
    const status = normalizeStatus(lifecycleSource, STATUS.HOLD);
    const amount = parseAmount(firstDefined(input, ['amount', 'chequeAmount', 'cheque_amount']));
    const dueDate = normalizeDateValue(firstDefined(input, ['dueDate', 'due_date', 'chequeDate', 'cheque_date']));
    const issueDate = normalizeDateValue(firstDefined(input, ['issueDate', 'issue_date']));
    const riskScoreRaw = parseAmount(firstDefined(input, ['riskScore', 'risk_score']));
    const riskScore = riskScoreRaw == null ? null : riskScoreRaw;
    const riskLevel = normalizeRiskLevel(firstDefined(input, ['riskLevel', 'risk_level']), riskScore);
    const party = safeString(firstDefined(input, [
      'party', 'partyName', 'party_name', 'customerName', 'customer_name', 'supplierName', 'supplier_name', 'payee'
    ]), 240);
    const today = dayKey(settings.today) || dayKey();
    const record = {
      id: safeString(firstDefined(input, ['id', 'chequeId', 'cheque_id']), 160),
      storeId: safeString(firstDefined(input, ['storeId', 'store_id']), 160),
      party: party,
      partyId: safeString(firstDefined(input, ['partyId', 'party_id']), 160),
      customerId: safeString(firstDefined(input, ['customerId', 'customer_id']), 160),
      supplierId: safeString(firstDefined(input, ['supplierId', 'supplier_id']), 160),
      drawerName: safeString(firstDefined(input, ['drawerName', 'drawer_name', 'accountHolder', 'account_holder']), 200),
      direction: normalizeDirection(firstDefined(input, ['direction', 'flowDirection', 'flow_direction'])),
      bank: safeString(firstDefined(input, ['bank', 'bankName', 'bank_name']), 200),
      chequeNo: safeString(firstDefined(input, ['chequeNo', 'cheque_no', 'number']), 100),
      amount: amount,
      issueDate: issueDate,
      dueDate: dueDate,
      bsDate: safeString(firstDefined(input, ['bsDate', 'bs_date', 'dueDateBs', 'due_date_bs', 'chequeDateBs', 'cheque_date_bs']), 32),
      status: status,
      lifecycleStatus: status,
      legacyStatus: toLegacyStatus(status),
      riskScore: riskScore,
      riskLevel: riskLevel,
      riskFactors: Array.isArray(firstDefined(input, ['riskFactors', 'risk_factors']))
        ? firstDefined(input, ['riskFactors', 'risk_factors']).slice(0, 20).map(function factor(value) { return safeString(value, 240); }).filter(Boolean)
        : [],
      assignedTo: safeString(firstDefined(input, ['assignedTo', 'assigned_to', 'assignedUser', 'assigned_user']), 160),
      lastFollowUpAt: safeString(firstDefined(input, ['lastFollowUpAt', 'last_follow_up_at']), 64),
      nextActionAt: safeString(firstDefined(input, ['nextActionAt', 'next_action_at']), 64),
      nextAction: safeString(firstDefined(input, ['nextAction', 'next_action']), 300),
      note: rawString(firstDefined(input, ['note', 'notes'])).slice(0, 4000),
      amountInWords: safeString(firstDefined(input, ['amountInWords', 'amount_in_words']), 500),
      signaturePresent: firstDefined(input, ['signaturePresent', 'signature_present']) === true,
      visibleCorrectionPresent: firstDefined(input, ['visibleCorrectionPresent', 'visible_correction_present']) === true,
      ocrVerifiedAt: safeString(firstDefined(input, ['ocrVerifiedAt', 'ocr_verified_at']), 64),
      attachment: attachmentIndicator(input),
      createdAt: safeString(firstDefined(input, ['createdAt', 'created_at']), 64),
      updatedAt: safeString(firstDefined(input, ['updatedAt', 'updated_at']), 64),
      deletedAt: safeString(firstDefined(input, ['deletedAt', 'deleted_at']), 64)
    };
    const overdue = overdueInfo(record, { today: today, graceDays: settings.graceDays });
    record.isOverdue = overdue.isOverdue;
    record.daysOverdue = overdue.daysOverdue;
    record.effectiveStatus = overdue.effectiveStatus;
    record.isFinal = TERMINAL_STATUSES.indexOf(record.status) >= 0;
    return record;
  }

  function projectLegacy(input, options) {
    const settings = options || {};
    const record = normalizeRecord(input, settings);
    const projected = {
      id: record.id,
      storeId: record.storeId,
      party: record.party,
      chequeNo: record.chequeNo,
      amount: record.amount,
      bank: record.bank,
      chequeDate: record.dueDate || record.issueDate,
      status: record.legacyStatus,
      note: record.note,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
    if (settings.includeCanonical !== false) {
      projected.lifecycleStatus = record.status;
      projected.lifecycle_status = record.status;
      projected.direction = record.direction;
      projected.issueDate = record.issueDate;
      projected.dueDate = record.dueDate;
    }
    return projected;
  }

  function overdueInfo(input, options) {
    const settings = options || {};
    const record = input && input.lifecycleStatus
      ? input
      : (input && typeof input === 'object' ? {
          status: normalizeStatus(firstDefined(input, ['lifecycleStatus', 'lifecycle_status', 'status']), STATUS.HOLD),
          dueDate: normalizeDateValue(firstDefined(input, ['dueDate', 'due_date', 'chequeDate', 'cheque_date']))
        } : { status: STATUS.HOLD, dueDate: '' });
    const today = dayKey(settings.today) || dayKey();
    const graceDays = Math.max(0, Math.floor(Number(settings.graceDays) || 0));
    const terminal = TERMINAL_STATUSES.indexOf(record.status) >= 0;
    let daysOverdue = isDayKey(record.dueDate) ? daysBetween(record.dueDate, today) - graceDays : 0;
    if (daysOverdue < 0 || !Number.isFinite(daysOverdue)) daysOverdue = 0;
    const isOverdue = !terminal && (record.status === STATUS.OVERDUE || (isDayKey(record.dueDate) && daysOverdue > 0));
    return Object.freeze({
      isOverdue: isOverdue,
      daysOverdue: isOverdue ? daysOverdue : 0,
      dueDate: record.dueDate || '',
      effectiveStatus: isOverdue ? STATUS.OVERDUE : record.status
    });
  }

  function isOverdue(input, options) {
    return overdueInfo(input, options).isOverdue;
  }

  function directionAllowsTransition(direction, toStatus) {
    if (direction === DIRECTION.INCOMING && [STATUS.TO_WRITE, STATUS.WRITTEN, STATUS.ISSUED].indexOf(toStatus) >= 0) return false;
    if (direction === DIRECTION.OUTGOING && toStatus === STATUS.RECEIVED) return false;
    return true;
  }

  function canTransition(fromValue, toValue, options) {
    const from = recognizedStatus(fromValue);
    const to = recognizedStatus(toValue);
    if (!from || !to || from === to || !own(ALLOWED_TRANSITIONS, from)) return false;
    if (ALLOWED_TRANSITIONS[from].indexOf(to) < 0) return false;
    const direction = normalizeDirection(options && options.direction);
    return directionAllowsTransition(direction, to);
  }

  function immutableCopy(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
    const copy = {};
    Object.keys(value).forEach(function clone(key) { copy[key] = immutableCopy(value[key]); });
    return Object.freeze(copy);
  }

  function proposalError(code, message) {
    return Object.freeze({ code: code, message: message });
  }

  function transitionProposal(input, toValue, metadata) {
    const details = metadata || {};
    let record;
    try { record = normalizeRecord(input, { today: details.today }); }
    catch (error) {
      return immutableCopy({ ok: false, allowed: false, errors: [proposalError('invalid_record', 'A valid cheque record is required.')], patch: null, event: null });
    }
    const to = recognizedStatus(toValue);
    const allowed = Boolean(to) && canTransition(record.status, to, { direction: record.direction });
    const requiresConfirmation = Boolean(to) && IMPORTANT_TRANSITIONS.indexOf(to) >= 0;
    const requiresReason = Boolean(to) && REASON_REQUIRED_STATUSES.indexOf(to) >= 0;
    const reason = rawString(details.reason).slice(0, 1000);
    const errors = [];
    if (!to) errors.push(proposalError('unknown_status', 'The requested cheque status is not supported.'));
    else if (!allowed) errors.push(proposalError('transition_not_allowed', 'A cheque cannot move from ' + statusLabel(record.status) + ' to ' + statusLabel(to) + '.'));
    if (requiresConfirmation && details.confirmed !== true) {
      errors.push(proposalError('confirmation_required', 'Explicit confirmation is required for this financial status change.'));
    }
    if (requiresReason && reason.length < 3) {
      errors.push(proposalError('reason_required', 'A short reason is required for this status change.'));
    }
    const at = safeString(details.at, 64) || new Date().toISOString();
    if (!validTimestamp(at)) errors.push(proposalError('invalid_timestamp', 'The audit timestamp is invalid.'));
    if (errors.length) {
      return immutableCopy({
        ok: false,
        allowed: allowed,
        fromStatus: record.status,
        toStatus: to || '',
        requiresConfirmation: requiresConfirmation,
        requiresReason: requiresReason,
        errors: errors,
        patch: null,
        event: null
      });
    }
    const actorId = safeString(firstDefined(details, ['actorId', 'actor_id']), 160);
    const actorName = safeString(firstDefined(details, ['actorName', 'actor_name']), 200);
    const eventId = safeString(firstDefined(details, ['eventId', 'event_id']), 160);
    const patch = {
      lifecycleStatus: to,
      lifecycle_status: to,
      status: toLegacyStatus(to),
      updatedAt: at,
      updated_at: at
    };
    const event = {
      id: eventId,
      chequeId: record.id,
      type: 'status_change',
      at: at,
      fromStatus: record.status,
      toStatus: to,
      actorId: actorId,
      actorName: actorName,
      reason: reason,
      confirmed: details.confirmed === true,
      confirmationId: safeString(firstDefined(details, ['confirmationId', 'confirmation_id']), 160),
      label: statusLabel(record.status) + ' → ' + statusLabel(to)
    };
    return immutableCopy({
      ok: true,
      allowed: true,
      fromStatus: record.status,
      toStatus: to,
      requiresConfirmation: requiresConfirmation,
      requiresReason: requiresReason,
      auditRequired: true,
      errors: [],
      patch: patch,
      event: event
    });
  }

  function activeForDueMetrics(record) {
    return !record.deletedAt && TERMINAL_STATUSES.indexOf(record.status) < 0;
  }

  function matchesSmartView(input, viewValue, options) {
    const settings = options || {};
    const record = input && input.lifecycleStatus && own(input, 'isOverdue') ? input : normalizeRecord(input, settings);
    const view = normalizeToken(viewValue || 'all');
    const today = dayKey(settings.today) || dayKey();
    const upcomingDays = Math.max(1, Math.floor(Number(settings.upcomingDays) || 7));
    if (record.deletedAt && settings.includeDeleted !== true) return false;
    if (view === 'all') return true;
    if (view === 'action_needed') {
      const actionDue = record.nextActionAt && !Number.isNaN(new Date(record.nextActionAt).getTime())
        ? new Date(record.nextActionAt).getTime() <= new Date(today + 'T23:59:59+05:45').getTime()
        : false;
      if (record.status === STATUS.BOUNCED) return true;
      if (record.status === STATUS.CLEARED || record.status === STATUS.CANCELLED) return false;
      return (
        record.isOverdue
        || [STATUS.TO_WRITE, STATUS.HOLD].indexOf(record.status) >= 0
        || (record.dueDate === today && activeForDueMetrics(record))
        || actionDue
      );
    }
    if (view === 'due_today') return activeForDueMetrics(record) && record.dueDate === today;
    if (view === 'upcoming') {
      return activeForDueMetrics(record) && isDayKey(record.dueDate)
        && record.dueDate > today && record.dueDate <= addDays(today, upcomingDays);
    }
    if (view === 'to_write') return record.status === STATUS.TO_WRITE;
    if (view === 'deposited') return record.status === STATUS.DEPOSITED;
    if (view === 'hold' || view === 'on_hold') return record.status === STATUS.HOLD;
    if (view === 'cleared') return record.status === STATUS.CLEARED;
    if (view === 'bounced') return record.status === STATUS.BOUNCED;
    return false;
  }

  function smartViewPredicate(view, options) {
    return function predicate(record) { return matchesSmartView(record, view, options); };
  }

  function smartViewCounts(records, options) {
    const list = Array.isArray(records) ? records : [];
    const result = {};
    SMART_VIEWS.forEach(function countView(view) {
      result[view] = list.reduce(function count(total, record) {
        try { return total + (matchesSmartView(record, view, options) ? 1 : 0); }
        catch (error) { return total; }
      }, 0);
    });
    return Object.freeze(result);
  }

  function listFilter(value) {
    if (value == null || value === '') return [];
    const source = Array.isArray(value) || value instanceof Set ? Array.from(value) : [value];
    return source.map(function normalize(item) { return safeString(item).toLowerCase(); }).filter(Boolean);
  }

  function includesFilter(filters, value) {
    return !filters.length || filters.indexOf(safeString(value).toLowerCase()) >= 0;
  }

  function searchText(record) {
    return [
      record.party,
      record.drawerName,
      record.bank,
      record.chequeNo,
      record.status,
      statusLabel(record.status),
      record.direction,
      record.assignedTo,
      record.nextAction,
      record.note
    ].join(' ').toLowerCase();
  }

  function sortValue(record, field, options) {
    if (field === 'priority') {
      if (record.isOverdue) return 0;
      if (record.status === STATUS.BOUNCED) return 1;
      if (record.status === STATUS.HOLD) return 2;
      if (record.dueDate === options.today) return 3;
      if (record.status === STATUS.TO_WRITE) return 4;
      return 5;
    }
    if (field === 'status') return LIFECYCLE_STATUSES.indexOf(record.status);
    if (field === 'riskScore') return record.riskScore == null ? -1 : record.riskScore;
    if (field === 'amount') return record.amount == null ? -1 : record.amount;
    if (field === 'party' || field === 'bank' || field === 'chequeNo' || field === 'direction') return safeString(record[field]).toLowerCase();
    const allowedDates = ['dueDate', 'issueDate', 'createdAt', 'updatedAt', 'nextActionAt', 'lastFollowUpAt'];
    if (allowedDates.indexOf(field) >= 0) return safeString(record[field]);
    return safeString(record.dueDate);
  }

  function queryRecords(records, query) {
    const settings = query || {};
    const today = dayKey(settings.today) || dayKey();
    const search = safeString(settings.search, 300).toLowerCase();
    const statuses = listFilter(settings.statuses == null ? settings.status : settings.statuses).map(function status(value) {
      return normalizeStatus(value, value);
    });
    const directions = listFilter(settings.directions == null ? settings.direction : settings.directions).map(normalizeDirection);
    const banks = listFilter(settings.banks == null ? settings.bank : settings.banks);
    const parties = listFilter(settings.parties == null ? settings.party : settings.parties);
    const riskLevels = listFilter(settings.riskLevels == null ? settings.riskLevel : settings.riskLevels);
    const assignedUsers = listFilter(settings.assignedTo);
    const amountMin = settings.amountMin == null || settings.amountMin === '' ? null : parseAmount(settings.amountMin);
    const amountMax = settings.amountMax == null || settings.amountMax === '' ? null : parseAmount(settings.amountMax);
    const dateFrom = normalizeDateValue(settings.dateFrom || settings.from);
    const dateTo = normalizeDateValue(settings.dateTo || settings.to);
    const dateField = ['issueDate', 'createdAt', 'updatedAt', 'nextActionAt'].indexOf(settings.dateField) >= 0
      ? settings.dateField
      : 'dueDate';
    const source = Array.isArray(records) ? records : [];
    const normalized = source.map(function normalize(record, index) {
      try { return { record: normalizeRecord(record, { today: today }), index: index }; }
      catch (error) { return null; }
    }).filter(Boolean);
    let filtered = normalized.filter(function match(item) {
      const record = item.record;
      const date = safeString(record[dateField]).slice(0, 10);
      if (record.deletedAt && settings.includeDeleted !== true) return false;
      if (settings.view && !matchesSmartView(record, settings.view, { today: today, upcomingDays: settings.upcomingDays, includeDeleted: settings.includeDeleted })) return false;
      if (search && searchText(record).indexOf(search) < 0) return false;
      if (!includesFilter(statuses, record.status)) return false;
      if (!includesFilter(directions, record.direction)) return false;
      if (!includesFilter(banks, record.bank)) return false;
      if (!includesFilter(parties, record.party) && !includesFilter(parties, record.partyId) && !includesFilter(parties, record.customerId) && !includesFilter(parties, record.supplierId)) return false;
      if (!includesFilter(riskLevels, record.riskLevel)) return false;
      if (!includesFilter(assignedUsers, record.assignedTo)) return false;
      if (amountMin != null && (record.amount == null || record.amount < amountMin)) return false;
      if (amountMax != null && (record.amount == null || record.amount > amountMax)) return false;
      if (dateFrom && (!date || date < dateFrom)) return false;
      if (dateTo && (!date || date > dateTo)) return false;
      if (settings.hasAttachment === true && !record.attachment) return false;
      if (settings.hasAttachment === false && record.attachment) return false;
      if (settings.overdue === true && !record.isOverdue) return false;
      if (settings.overdue === false && record.isOverdue) return false;
      return true;
    });
    const sortBy = ['priority', 'amount', 'party', 'bank', 'chequeNo', 'status', 'direction', 'riskScore', 'dueDate', 'issueDate', 'createdAt', 'updatedAt', 'nextActionAt', 'lastFollowUpAt'].indexOf(settings.sortBy) >= 0
      ? settings.sortBy
      : 'dueDate';
    const direction = String(settings.sortDirection || settings.order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
    filtered = filtered.slice().sort(function compare(left, right) {
      const a = sortValue(left.record, sortBy, { today: today });
      const b = sortValue(right.record, sortBy, { today: today });
      if (a < b) return -1 * direction;
      if (a > b) return 1 * direction;
      return left.index - right.index;
    });
    const total = filtered.length;
    const requestedSize = Math.floor(Number(settings.pageSize) || 25);
    const pageSize = Math.max(1, Math.min(500, requestedSize));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const requestedPage = Math.floor(Number(settings.page) || 1);
    const page = Math.max(1, Math.min(totalPages, requestedPage));
    const offset = (page - 1) * pageSize;
    return Object.freeze({
      items: Object.freeze(filtered.slice(offset, offset + pageSize).map(function unwrap(item) { return item.record; })),
      total: total,
      page: page,
      pageSize: pageSize,
      totalPages: totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages
    });
  }

  function metric(records) {
    return Object.freeze({
      count: records.length,
      amount: records.reduce(function sum(total, record) { return total + (record.amount || 0); }, 0)
    });
  }

  function summaryMetrics(records, options) {
    const settings = options || {};
    const today = dayKey(settings.today) || dayKey();
    const withinDays = Math.max(1, Math.floor(Number(settings.withinDays) || 7));
    const end = addDays(today, withinDays);
    const month = /^\d{4}-\d{2}$/.test(settings.month || '') ? settings.month : today.slice(0, 7);
    const list = (Array.isArray(records) ? records : []).map(function normalize(record) {
      try { return normalizeRecord(record, { today: today }); }
      catch (error) { return null; }
    }).filter(function active(record) { return record && (!record.deletedAt || settings.includeDeleted === true); });
    const open = list.filter(activeForDueMetrics);
    const dueToday = open.filter(function due(record) { return record.dueDate === today; });
    const dueWithin = open.filter(function due(record) {
      return isDayKey(record.dueDate) && record.dueDate >= today && record.dueDate <= end;
    });
    const overdue = open.filter(function overdue(record) { return record.isOverdue; });
    const hold = list.filter(function held(record) { return record.status === STATUS.HOLD; });
    const deposited = list.filter(function deposited(record) { return record.status === STATUS.DEPOSITED; });
    const bounced = list.filter(function bounced(record) { return record.status === STATUS.BOUNCED; });
    const expectedStatuses = LIFECYCLE_STATUSES.filter(function expected(status) {
      return TERMINAL_STATUSES.indexOf(status) < 0;
    });
    const expectedMonthlyInflow = list.filter(function expected(record) {
      return record.direction === DIRECTION.INCOMING
        && isDayKey(record.dueDate)
        && record.dueDate.slice(0, 7) === month
        && expectedStatuses.indexOf(record.status) >= 0;
    });
    const expectedMonthlyOutflow = list.filter(function expected(record) {
      return record.direction === DIRECTION.OUTGOING
        && isDayKey(record.dueDate)
        && record.dueDate.slice(0, 7) === month
        && expectedStatuses.indexOf(record.status) >= 0;
    });
    return Object.freeze({
      asOf: today,
      month: month,
      total: metric(list),
      open: metric(open),
      dueToday: metric(dueToday),
      dueWithinSevenDays: metric(dueWithin),
      overdue: metric(overdue),
      hold: metric(hold),
      deposited: metric(deposited),
      bounced: metric(bounced),
      expectedMonthlyInflow: metric(expectedMonthlyInflow),
      expectedMonthlyOutflow: metric(expectedMonthlyOutflow),
      unspecifiedDirection: metric(list.filter(function unspecified(record) { return record.direction === DIRECTION.UNSPECIFIED; }))
    });
  }

  function timelineType(value) {
    const token = normalizeToken(value);
    const known = ['created', 'status_change', 'note', 'follow_up', 'reminder', 'attachment', 'payment', 'edited'];
    if (known.indexOf(token) >= 0) return token;
    if (token === 'status' || token === 'status_changed') return 'status_change';
    if (token === 'followup' || token === 'follow_up_scheduled') return 'follow_up';
    return 'note';
  }

  function timelineLabel(type, fromStatus, toStatus) {
    if (type === 'created') return 'Cheque created';
    if (type === 'status_change') return statusLabel(fromStatus) + ' → ' + statusLabel(toStatus);
    if (type === 'follow_up') return 'Follow-up';
    if (type === 'reminder') return 'Reminder';
    if (type === 'attachment') return 'Attachment added';
    if (type === 'payment') return 'Related payment';
    if (type === 'edited') return 'Cheque edited';
    return 'Note added';
  }

  function safeTimelineMetadata(event) {
    const source = firstDefined(event, ['metadata', 'meta']);
    const metadata = source && typeof source === 'object' && !Array.isArray(source) ? source : event;
    return {
      channel: safeString(firstDefined(metadata, ['channel']), 60),
      outcome: safeString(firstDefined(metadata, ['outcome']), 120),
      reference: safeString(firstDefined(metadata, ['reference']), 160),
      amount: parseAmount(firstDefined(metadata, ['amount'])),
      attachmentName: safeString(firstDefined(metadata, ['attachmentName', 'attachment_name']), 180),
      confirmationId: safeString(firstDefined(metadata, ['confirmationId', 'confirmation_id']), 160)
    };
  }

  function eventListFromInput(input) {
    if (Array.isArray(input)) return input.slice();
    if (!input || typeof input !== 'object') return [];
    let events = [];
    ['timeline', 'statusEvents', 'status_events', 'events', 'activity', 'followUps', 'follow_ups'].forEach(function collect(key) {
      if (Array.isArray(input[key])) events = events.concat(input[key]);
    });
    const createdAt = firstDefined(input, ['createdAt', 'created_at']);
    if (createdAt) events.push({ id: 'created-' + safeString(input.id, 120), type: 'created', at: createdAt });
    return events;
  }

  function normalizeTimeline(input, options) {
    const settings = options || {};
    const seen = new Set();
    const events = eventListFromInput(input).map(function normalize(event, index) {
      if (!event || typeof event !== 'object') return null;
      const type = timelineType(firstDefined(event, ['type', 'eventType', 'event_type', 'action']));
      const fromStatus = normalizeStatus(firstDefined(event, ['fromStatus', 'from_status', 'oldStatus', 'old_status']), '');
      const toStatus = normalizeStatus(firstDefined(event, ['toStatus', 'to_status', 'newStatus', 'new_status', 'status']), '');
      const at = safeString(firstDefined(event, ['at', 'createdAt', 'created_at', 'time', 'timestamp']), 64);
      const id = safeString(firstDefined(event, ['id', 'eventId', 'event_id']), 160) || 'timeline-' + index;
      const duplicateKey = id + '|' + type + '|' + at;
      if (seen.has(duplicateKey)) return null;
      seen.add(duplicateKey);
      return {
        id: id,
        type: type,
        at: validTimestamp(at) ? at : '',
        actorId: safeString(firstDefined(event, ['actorId', 'actor_id', 'userId', 'user_id']), 160),
        actorName: safeString(firstDefined(event, ['actorName', 'actor_name', 'userName', 'user_name']), 200),
        fromStatus: fromStatus,
        toStatus: toStatus,
        label: safeString(firstDefined(event, ['label', 'title']), 300) || timelineLabel(type, fromStatus, toStatus),
        description: rawString(firstDefined(event, ['description', 'message', 'note', 'reason'])).slice(0, 2000),
        confirmed: firstDefined(event, ['confirmed']) === true,
        metadata: safeTimelineMetadata(event)
      };
    }).filter(Boolean);
    events.sort(function chronological(a, b) {
      const aTime = a.at ? new Date(a.at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.at ? new Date(b.at).getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    });
    if (settings.descending === true) events.reverse();
    return events;
  }

  const CSV_COLUMNS = Object.freeze({
    party: Object.freeze({ label: 'Customer or Supplier', value: function value(record) { return record.party; } }),
    drawerName: Object.freeze({ label: 'Account Holder', value: function value(record) { return record.drawerName; } }),
    direction: Object.freeze({ label: 'Direction', value: function value(record) { return record.direction; } }),
    bank: Object.freeze({ label: 'Bank', value: function value(record) { return record.bank; } }),
    chequeNo: Object.freeze({ label: 'Cheque Number', value: function value(record) { return record.chequeNo; } }),
    amount: Object.freeze({ label: 'Amount', value: function value(record) { return record.amount == null ? '' : record.amount; }, numeric: true }),
    issueDate: Object.freeze({ label: 'Issue Date AD', value: function value(record) { return record.issueDate; } }),
    dueDate: Object.freeze({ label: 'Due Date AD', value: function value(record) { return record.dueDate; } }),
    bsDate: Object.freeze({ label: 'Date BS', value: function value(record) { return record.bsDate; } }),
    status: Object.freeze({ label: 'Status', value: function value(record) { return statusLabel(record.status); } }),
    riskLevel: Object.freeze({ label: 'Risk Level', value: function value(record) { return record.riskLevel; } }),
    riskScore: Object.freeze({ label: 'Risk Score', value: function value(record) { return record.riskScore == null ? '' : record.riskScore; }, numeric: true }),
    assignedTo: Object.freeze({ label: 'Assigned User', value: function value(record) { return record.assignedTo; } }),
    lastFollowUpAt: Object.freeze({ label: 'Last Follow-up', value: function value(record) { return record.lastFollowUpAt; } }),
    nextActionAt: Object.freeze({ label: 'Next Action', value: function value(record) { return record.nextActionAt; } }),
    attachment: Object.freeze({ label: 'Attachment', value: function value(record) { return record.attachment ? record.attachment.name || 'Yes' : 'No'; } }),
    note: Object.freeze({ label: 'Note', value: function value(record) { return record.note; } })
  });
  const DEFAULT_CSV_COLUMNS = Object.freeze(Object.keys(CSV_COLUMNS));

  function csvCell(value, options) {
    const settings = options || {};
    let text = value == null ? '' : String(value);
    text = text.replace(/\r\n?/g, '\n');
    if (settings.numeric !== true && settings.preventFormulaInjection !== false && /^[\s\t\r\n]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function serializeCsv(records, options) {
    const settings = options || {};
    const requested = Array.isArray(settings.columns) && settings.columns.length ? settings.columns : DEFAULT_CSV_COLUMNS;
    const columns = requested.filter(function allowed(key) { return own(CSV_COLUMNS, key); });
    if (!columns.length) throw new Error('At least one supported CSV column is required');
    const newline = settings.newline === '\n' ? '\n' : '\r\n';
    const rows = [columns.map(function heading(key) { return csvCell(CSV_COLUMNS[key].label); }).join(',')];
    (Array.isArray(records) ? records : []).forEach(function row(input) {
      let record;
      try { record = normalizeRecord(input, { today: settings.today }); }
      catch (error) { return; }
      rows.push(columns.map(function cell(key) {
        const column = CSV_COLUMNS[key];
        return csvCell(column.value(record), { numeric: column.numeric, preventFormulaInjection: settings.preventFormulaInjection });
      }).join(','));
    });
    return (settings.includeBom === true ? '\uFEFF' : '') + rows.join(newline) + newline;
  }

  function attachmentError(field, code, message) {
    return Object.freeze({ field: field, code: code, message: message });
  }

  function validateAttachmentMetadata(input, options) {
    const settings = options || {};
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return Object.freeze({ valid: false, errors: Object.freeze([attachmentError('attachment', 'invalid_attachment', 'Attachment metadata must be an object.')]), value: null });
    }
    const name = safeString(firstDefined(input, ['name', 'fileName', 'filename']), 500);
    const type = safeString(firstDefined(input, ['type', 'mimeType', 'mime_type']), 200).split(';')[0].trim().toLowerCase();
    const size = parseAmount(firstDefined(input, ['size', 'sizeBytes', 'size_bytes']));
    const maxSize = Math.max(1, Math.floor(Number(settings.maxSizeBytes) || DEFAULT_MAX_ATTACHMENT_BYTES));
    const allowedTypes = (Array.isArray(settings.allowedMimeTypes) && settings.allowedMimeTypes.length
      ? settings.allowedMimeTypes
      : DEFAULT_ATTACHMENT_TYPES).map(function lower(value) { return safeString(value).toLowerCase(); });
    if (!name) errors.push(attachmentError('name', 'name_required', 'Attachment filename is required.'));
    else {
      if (name.length > 180) errors.push(attachmentError('name', 'name_too_long', 'Attachment filename must be 180 characters or fewer.'));
      if (/[\\/\u0000-\u001F\u007F]/.test(name)) errors.push(attachmentError('name', 'unsafe_name', 'Attachment filename contains a path or control character.'));
    }
    if (!type || allowedTypes.indexOf(type) < 0) errors.push(attachmentError('type', 'type_not_allowed', 'Attachment type is not allowed.'));
    if (!Number.isInteger(size) || size <= 0) errors.push(attachmentError('size', 'invalid_size', 'Attachment size must be a positive whole number of bytes.'));
    else if (size > maxSize) errors.push(attachmentError('size', 'file_too_large', 'Attachment exceeds the ' + maxSize + '-byte limit.'));
    const extension = name.indexOf('.') >= 0 ? name.split('.').pop().toLowerCase() : '';
    if (type && own(MIME_EXTENSIONS, type) && extension && MIME_EXTENSIONS[type].indexOf(extension) < 0) {
      errors.push(attachmentError('name', 'extension_mismatch', 'Attachment extension does not match its MIME type.'));
    }
    if (['data', 'base64', 'content', 'bytes', 'buffer', 'blob'].some(function binary(key) { return own(input, key) && input[key] != null; })) {
      errors.push(attachmentError('attachment', 'binary_payload_rejected', 'Only attachment metadata is accepted here; upload bytes separately.'));
    }
    const sha256 = safeString(firstDefined(input, ['sha256', 'checksum']), 128).toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) errors.push(attachmentError('sha256', 'invalid_checksum', 'SHA-256 must contain 64 hexadecimal characters.'));
    const value = errors.length ? null : Object.freeze({
      id: safeString(firstDefined(input, ['id', 'attachmentId', 'attachment_id']), 160),
      name: name,
      type: type,
      size: size,
      lastModified: parseAmount(firstDefined(input, ['lastModified', 'last_modified'])),
      sha256: sha256,
      storagePath: safeString(firstDefined(input, ['storagePath', 'storage_path']), 500)
    });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), value: value });
  }

  function validationIssue(field, code, message) {
    return Object.freeze({ field: field, code: code, message: message });
  }

  function validateRecord(input, options) {
    const settings = options || {};
    const errors = [];
    const warnings = [];
    let record = null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return Object.freeze({ valid: false, errors: Object.freeze([validationIssue('record', 'invalid_record', 'Cheque record must be an object.')]), warnings: Object.freeze([]), record: null });
    }
    try { record = normalizeRecord(input, { today: settings.today }); }
    catch (error) {
      return Object.freeze({ valid: false, errors: Object.freeze([validationIssue('record', 'invalid_record', 'Cheque record could not be normalized safely.')]), warnings: Object.freeze([]), record: null });
    }
    const sourceStatus = firstDefined(input, ['lifecycleStatus', 'lifecycle_status', 'status']);
    const sourceDirection = firstDefined(input, ['direction', 'flowDirection', 'flow_direction']);
    if (!record.party) errors.push(validationIssue('party', 'party_required', 'Customer or supplier is required.'));
    else if (record.party.length > 160) errors.push(validationIssue('party', 'party_too_long', 'Customer or supplier must be 160 characters or fewer.'));
    if (!record.chequeNo) errors.push(validationIssue('chequeNo', 'cheque_number_required', 'Cheque number is required.'));
    else if (record.chequeNo.length > 64) errors.push(validationIssue('chequeNo', 'cheque_number_too_long', 'Cheque number must be 64 characters or fewer.'));
    const maxAmount = Math.max(1, Number(settings.maxAmount) || 1000000000000);
    if (record.amount == null || record.amount <= 0) errors.push(validationIssue('amount', 'invalid_amount', 'Cheque amount must be greater than zero.'));
    else if (record.amount > maxAmount) errors.push(validationIssue('amount', 'amount_too_large', 'Cheque amount exceeds the configured limit.'));
    if (sourceStatus == null || sourceStatus === '') warnings.push(validationIssue('status', 'legacy_status_defaulted', 'Missing status was treated as On Hold for legacy compatibility.'));
    else if (!recognizedStatus(sourceStatus)) errors.push(validationIssue('status', 'unknown_status', 'Cheque status is not supported.'));
    if (sourceDirection == null || sourceDirection === '') warnings.push(validationIssue('direction', 'direction_unspecified', 'Direction is unspecified, so this cheque is excluded from expected inflow and outflow.'));
    else if (normalizeDirection(sourceDirection) === DIRECTION.UNSPECIFIED && normalizeToken(sourceDirection) !== DIRECTION.UNSPECIFIED) {
      errors.push(validationIssue('direction', 'unknown_direction', 'Cheque direction must be incoming, outgoing, or unspecified.'));
    }
    if (record.issueDate && !isDayKey(record.issueDate)) errors.push(validationIssue('issueDate', 'invalid_issue_date', 'Issue date must be a valid YYYY-MM-DD date.'));
    if (record.dueDate && !isDayKey(record.dueDate)) errors.push(validationIssue('dueDate', 'invalid_due_date', 'Due date must be a valid YYYY-MM-DD date.'));
    if (!record.dueDate) {
      if ([STATUS.DRAFT, STATUS.TO_WRITE].indexOf(record.status) >= 0) warnings.push(validationIssue('dueDate', 'due_date_missing', 'Add a due date before issuing or receiving this cheque.'));
      else errors.push(validationIssue('dueDate', 'due_date_required', 'Due date is required for this cheque status.'));
    }
    if (isDayKey(record.issueDate) && isDayKey(record.dueDate) && record.issueDate > record.dueDate) {
      errors.push(validationIssue('dueDate', 'due_before_issue', 'Due date cannot be earlier than issue date.'));
    }
    if (record.riskScore != null && (!Number.isInteger(record.riskScore) || record.riskScore < 0 || record.riskScore > 100)) {
      errors.push(validationIssue('riskScore', 'invalid_risk_score', 'Risk score must be a whole number from 0 to 100.'));
    }
    const suppliedRiskLevel = normalizeToken(firstDefined(input, ['riskLevel', 'risk_level']));
    if (suppliedRiskLevel && RISK_LEVELS.indexOf(suppliedRiskLevel) < 0) errors.push(validationIssue('riskLevel', 'invalid_risk_level', 'Risk level is not supported.'));
    else if (record.riskScore != null && suppliedRiskLevel && riskLevelForScore(record.riskScore) !== suppliedRiskLevel) {
      warnings.push(validationIssue('riskLevel', 'risk_band_mismatch', 'Risk level does not match the score band.'));
    }
    if (record.lastFollowUpAt && !validTimestamp(record.lastFollowUpAt)) errors.push(validationIssue('lastFollowUpAt', 'invalid_timestamp', 'Last follow-up timestamp is invalid.'));
    if (record.nextActionAt && !validTimestamp(record.nextActionAt)) errors.push(validationIssue('nextActionAt', 'invalid_timestamp', 'Next-action timestamp is invalid.'));
    if (record.ocrVerifiedAt && !validTimestamp(record.ocrVerifiedAt)) errors.push(validationIssue('ocrVerifiedAt', 'invalid_timestamp', 'OCR verification timestamp is invalid.'));
    const attachmentSource = firstDefined(input, ['attachment', 'attachmentMeta', 'attachment_meta']);
    if (attachmentSource) {
      const attachmentResult = validateAttachmentMetadata(attachmentSource, settings.attachmentOptions);
      attachmentResult.errors.forEach(function attachment(issue) {
        errors.push(validationIssue('attachment.' + issue.field, issue.code, issue.message));
      });
      if (attachmentResult.valid) record.attachment = attachmentResult.value;
    }
    if (Array.isArray(settings.existingRecords) && record.chequeNo) {
      const number = record.chequeNo.toLowerCase();
      const bank = record.bank.toLowerCase();
      const duplicate = settings.existingRecords.some(function match(existing) {
        let other;
        try { other = normalizeRecord(existing, { today: settings.today }); }
        catch (error) { return false; }
        if (record.id && other.id === record.id) return false;
        const sameNumber = other.chequeNo.toLowerCase() === number;
        const sameScope = settings.duplicateScope === 'global' || !bank || !other.bank || other.bank.toLowerCase() === bank;
        return sameNumber && sameScope;
      });
      if (duplicate) errors.push(validationIssue('chequeNo', 'duplicate_cheque_number', 'This cheque number already exists in the selected bank scope.'));
    }
    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      record: record
    });
  }

  return Object.freeze({
    ALLOWED_TRANSITIONS: ALLOWED_TRANSITIONS,
    CSV_COLUMNS: CSV_COLUMNS,
    DEFAULT_ATTACHMENT_TYPES: DEFAULT_ATTACHMENT_TYPES,
    DEFAULT_MAX_ATTACHMENT_BYTES: DEFAULT_MAX_ATTACHMENT_BYTES,
    DIRECTION: DIRECTION,
    DIRECTIONS: DIRECTIONS,
    IMPORTANT_TRANSITIONS: IMPORTANT_TRANSITIONS,
    LEGACY_STATUS: LEGACY_STATUS,
    LEGACY_STATUSES: LEGACY_STATUSES,
    LIFECYCLE_STATUSES: LIFECYCLE_STATUSES,
    REASON_REQUIRED_STATUSES: REASON_REQUIRED_STATUSES,
    RISK_LEVELS: RISK_LEVELS,
    SMART_VIEWS: SMART_VIEWS,
    SMART_VIEW_LABELS: SMART_VIEW_LABELS,
    STATUS: STATUS,
    STATUS_LABELS: STATUS_LABELS,
    TERMINAL_STATUSES: TERMINAL_STATUSES,
    canTransition: canTransition,
    csvCell: csvCell,
    isOverdue: isOverdue,
    matchesSmartView: matchesSmartView,
    normalizeDirection: normalizeDirection,
    normalizeRecord: normalizeRecord,
    normalizeStatus: normalizeStatus,
    normalizeTimeline: normalizeTimeline,
    overdueInfo: overdueInfo,
    parseAmount: parseAmount,
    projectLegacy: projectLegacy,
    queryRecords: queryRecords,
    riskLevelForScore: riskLevelForScore,
    serializeCsv: serializeCsv,
    smartViewCounts: smartViewCounts,
    smartViewPredicate: smartViewPredicate,
    statusLabel: statusLabel,
    summaryMetrics: summaryMetrics,
    toLegacyStatus: toLegacyStatus,
    transitionProposal: transitionProposal,
    validateAttachmentMetadata: validateAttachmentMetadata,
    validateRecord: validateRecord
  });
});
