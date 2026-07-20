/*
 * Smart Insights presentation helpers for RD MART.
 *
 * This module is deliberately side-effect free: it does not mount HTML, attach
 * events, mutate records, call a provider, save drafts, or send messages. It
 * turns MartAIIntelligence results and MartAIAIClient states into an escaped page
 * model that the dashboard can wire using the returned action descriptors.
 */
(function (root, factory) {
  'use strict';
  let nodeIntelligence = null;
  let nodeAIClient = null;
  if (typeof module === 'object' && module.exports) {
    try { nodeIntelligence = require('./martai-intelligence.js'); } catch (_) { /* Browser bundle. */ }
    try { nodeAIClient = require('./martai-ai-client.js'); } catch (_) { /* Optional client. */ }
  }
  const api = factory(
    () => (root && root.MartAIIntelligence) || nodeIntelligence,
    () => (root && root.MartAIAIClient) || nodeAIClient
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MartAIInsightsUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (getDefaultIntelligence, getDefaultAIClient) {
  'use strict';

  const VERSION = '1.0.0';
  const AI_STATES = Object.freeze([
    'READY', 'NOT_CONFIGURED', 'UNAVAILABLE', 'UNAUTHENTICATED', 'FORBIDDEN',
    'INVALID_REQUEST', 'NOT_CHECKED'
  ]);
  const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);
  const PRIORITY_LEVELS = Object.freeze(['low', 'medium', 'high', 'urgent']);
  const TONES = Object.freeze(['success', 'neutral', 'warning', 'danger']);
  const MAX_PRIORITY_ITEMS = 20;

  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
  }

  function localSafeText(value, maximumLength) {
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

  function titleFromCode(value) {
    return localSafeText(value, 80)
      .toLocaleLowerCase('en')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  function assertIntelligence(intelligence) {
    const required = [
      'sanitizeText', 'sanitizeChequeRecord', 'assessChequeRisk', 'detectChequeAnomalies',
      'scoreChequePriority', 'forecastChequeCashFlow', 'parseNaturalLanguageFilter',
      'validateFilterAst', 'generateChequeMessage', 'formatNpr', 'parseDateOnly'
    ];
    if (!intelligence || required.some(name => typeof intelligence[name] !== 'function')) {
      throw new Error('MartAIIntelligence must be loaded before building Smart Insights.');
    }
    return intelligence;
  }

  function normalizeAIState(value, clientAvailable) {
    const source = plainObject(value) ? value : typeof value === 'string' ? { state: value } : {};
    let state = localSafeText(source.state, 32).toUpperCase();
    if (!AI_STATES.includes(state)) state = clientAvailable ? 'NOT_CHECKED' : 'NOT_CONFIGURED';
    const labels = {
      READY: {
        tone: 'success',
        label: 'Optional AI configured',
        detail: 'Provider assistance is available for review-only requests. Nothing is applied automatically.',
        ocrLabel: 'OCR available after explicit image consent.'
      },
      NOT_CONFIGURED: {
        tone: 'neutral',
        label: 'Optional AI is not configured',
        detail: 'Offline risk, anomaly, priority, forecast, search, and message tools remain available.',
        ocrLabel: 'OCR unavailable until a server-side provider is configured.'
      },
      UNAVAILABLE: {
        tone: 'warning',
        label: 'Optional AI is temporarily unavailable',
        detail: 'Deterministic offline insights are still working. Try provider assistance again later.',
        ocrLabel: 'OCR is currently unavailable.'
      },
      UNAUTHENTICATED: {
        tone: 'warning',
        label: 'Sign-in required for optional AI',
        detail: 'Sign in again to request provider assistance. Offline insights remain available.',
        ocrLabel: 'OCR is unavailable until sign-in is verified.'
      },
      FORBIDDEN: {
        tone: 'danger',
        label: 'Optional AI access is restricted',
        detail: 'Your current RD MART role cannot use provider assistance.',
        ocrLabel: 'OCR is unavailable for this role.'
      },
      INVALID_REQUEST: {
        tone: 'warning',
        label: 'Optional AI request needs review',
        detail: 'The provider request was not sent because its data did not pass validation.',
        ocrLabel: 'OCR requires a valid supported cheque image.'
      },
      NOT_CHECKED: {
        tone: 'neutral',
        label: 'Optional AI status not checked',
        detail: 'Offline insights are ready. Check provider status only when assistance is needed.',
        ocrLabel: 'OCR availability has not been checked.'
      }
    };
    const presentation = labels[state];
    return {
      state,
      tone: presentation.tone,
      label: presentation.label,
      detail: presentation.detail,
      ocrLabel: presentation.ocrLabel,
      configured: state === 'READY',
      provider: localSafeText(source.provider, 40),
      model: localSafeText(source.model, 128),
      code: localSafeText(source.code, 64)
    };
  }

  function safeQueryResult(intelligence, query, asOf) {
    const safeQuery = intelligence.sanitizeText(query, 240);
    const parsed = intelligence.parseNaturalLanguageFilter(safeQuery, { asOf });
    const astIsSafe = parsed && parsed.ast && intelligence.validateFilterAst(parsed.ast);
    return {
      query: safeQuery,
      ok: Boolean(parsed && parsed.ok && astIsSafe),
      ast: astIsSafe ? parsed.ast : {
        version: intelligence.FILTER_AST_VERSION || 'martai-filter-ast-v1',
        type: 'filter',
        logic: 'and',
        conditions: [],
        sort: null,
        limit: null
      },
      warnings: Array.isArray(parsed && parsed.warnings)
        ? parsed.warnings.map(item => localSafeText(item, 64)).filter(Boolean).slice(0, 10)
        : ['NO_SUPPORTED_FILTERS'],
      execution: 'none',
      note: 'Validated filter data only; no SQL or code was produced or executed.'
    };
  }

  function buildBilingualDraft(intelligence, record, options) {
    const settings = plainObject(options) ? options : {};
    const purpose = ['reminder', 'due_today', 'overdue', 'bounced', 'confirmation'].includes(settings.purpose)
      ? settings.purpose
      : 'reminder';
    function draft(locale) {
      const generated = intelligence.generateChequeMessage(record || {}, { locale, purpose });
      return {
        locale,
        languageLabel: locale === 'ne' ? 'नेपाली' : 'English',
        status: generated.status === 'ready' ? 'ready' : 'needs_data',
        text: generated.status === 'ready' ? localSafeText(generated.text, 1600) : '',
        missingFields: Array.isArray(generated.missingFields)
          ? generated.missingFields.map(item => localSafeText(item, 40)).filter(Boolean)
          : [],
        editable: true,
        sendEnabled: false,
        requiresReviewBeforeSending: true,
        generatedBy: 'deterministic-template'
      };
    }
    return {
      purpose,
      english: draft('en'),
      nepali: draft('ne'),
      note: 'Edit and review locally. This page does not send messages.'
    };
  }

  function summarizeRecord(intelligence, record, sourceIndex, history, asOf) {
    const safe = intelligence.sanitizeChequeRecord(record);
    const risk = intelligence.assessChequeRisk(record, history, { asOf });
    const anomaly = intelligence.detectChequeAnomalies(record, history, { asOf });
    const priority = intelligence.scoreChequePriority(record, { asOf, history, riskAssessment: risk });
    return {
      id: safe.id || `insight-record-${sourceIndex + 1}`,
      sourceIndex,
      party: safe.party || 'Unnamed party',
      chequeNumber: safe.chequeNumber,
      amount: safe.amount,
      bank: safe.bank,
      issueDate: safe.issueDate,
      dueDate: safe.dueDate,
      status: safe.status || 'unknown',
      direction: safe.direction || 'unknown',
      assignedTo: safe.assignedTo,
      risk,
      anomaly,
      priority
    };
  }

  function buildActions(state, aiClientModule) {
    const selected = state.selected;
    const aiReady = Boolean(state.ai && state.ai.configured);
    const clientCanValidate = Boolean(aiClientModule && typeof aiClientModule.validateInput === 'function');
    const actions = [
      {
        id: 'parse-insights-query',
        kind: 'local-compute',
        enabled: Boolean(state.query.query),
        writesRecords: false,
        sendsMessage: false,
        result: 'validated-filter-ast'
      },
      {
        id: 'apply-insights-filter',
        kind: 'view-only',
        enabled: Boolean(state.query.ok),
        writesRecords: false,
        sendsMessage: false,
        payload: state.query.ok ? state.query.ast : null
      },
      {
        id: 'select-insight-record',
        kind: 'view-only',
        enabled: state.priorityItems.length > 0,
        writesRecords: false,
        sendsMessage: false
      }
    ];

    const riskInput = selected ? {
      score: selected.risk.score,
      category: selected.risk.category,
      dataCompleteness: selected.risk.dataCompleteness.score,
      factors: selected.risk.factors.map(factor => ({ code: factor.code, points: factor.points })).slice(0, 20)
    } : null;
    const riskValidation = riskInput && clientCanValidate ? aiClientModule.validateInput('explain-risk', riskInput) : { ok: false };
    actions.push({
      id: 'request-ai-risk-explanation',
      kind: 'optional-provider-request',
      action: 'explain-risk',
      enabled: Boolean(aiReady && riskValidation.ok),
      requiresExplicitConfirmation: true,
      writesRecords: false,
      sendsMessage: false,
      requestInput: riskValidation.ok ? riskValidation.value : null
    });

    for (const locale of ['en', 'ne']) {
      const draft = locale === 'ne' ? state.messageDraft.nepali : state.messageDraft.english;
      const messageInput = selected ? {
        locale,
        purpose: state.messageDraft.purpose,
        amount: selected.amount,
        dueDate: selected.dueDate,
        status: selected.status === 'unknown' ? '' : selected.status,
        direction: selected.direction === 'unknown' ? '' : selected.direction
      } : null;
      const validation = messageInput && clientCanValidate ? aiClientModule.validateInput('draft-message', messageInput) : { ok: false };
      actions.push({
        id: `request-ai-message-${locale}`,
        kind: 'optional-provider-request',
        action: 'draft-message',
        enabled: Boolean(aiReady && draft.status === 'ready' && validation.ok),
        requiresExplicitConfirmation: true,
        writesRecords: false,
        sendsMessage: false,
        requestInput: validation.ok ? validation.value : null
      });
    }

    actions.push({
      id: 'request-cheque-ocr',
      kind: 'optional-provider-request',
      action: 'extract-cheque',
      enabled: aiReady && clientCanValidate,
      inputRequired: 'consented-cheque-image',
      acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      requiresExplicitConsent: true,
      writesRecords: false,
      sendsMessage: false,
      resultRequiresReview: true
    });
    return actions;
  }

  function buildInsightsStateWith(intelligence, aiClientModule, input) {
    const settings = plainObject(input) ? input : {};
    const records = Array.isArray(settings.cheques) ? settings.cheques.slice() : [];
    const asOf = intelligence.parseDateOnly(settings.asOf) || intelligence.parseDateOnly(new Date());
    const maxItems = clamp(Math.round(settings.maxPriorityItems || 8), 1, MAX_PRIORITY_ITEMS);
    const assessments = records.map((record, index) => summarizeRecord(intelligence, record, index, records, asOf));
    assessments.sort((left, right) => (
      right.priority.score - left.priority.score ||
      right.risk.score - left.risk.score ||
      String(left.dueDate || '9999-99-99').localeCompare(String(right.dueDate || '9999-99-99')) ||
      left.sourceIndex - right.sourceIndex
    ));
    const requestedId = intelligence.sanitizeText(settings.selectedChequeId, 80);
    const selected = assessments.find(item => requestedId && item.id === requestedId) || assessments[0] || null;
    const selectedSource = selected ? records[selected.sourceIndex] : null;
    const query = safeQueryResult(intelligence, settings.query || '', asOf);
    const messageDraft = buildBilingualDraft(intelligence, selectedSource || {}, { purpose: settings.messagePurpose });
    const ai = normalizeAIState(settings.aiState, Boolean(aiClientModule && typeof aiClientModule.createClient === 'function'));
    const completenessValues = assessments.map(item => Number(item.risk.dataCompleteness.score) || 0);
    const state = {
      version: VERSION,
      asOf,
      summary: {
        chequeCount: assessments.length,
        urgentCount: assessments.filter(item => item.priority.level === 'urgent').length,
        anomalyCount: assessments.reduce((sum, item) => sum + item.anomaly.anomalyCount, 0),
        recordsNeedingReview: assessments.filter(item => item.priority.score >= 25 || item.anomaly.anomalyCount > 0).length,
        averageDataCompleteness: completenessValues.length
          ? Math.round(completenessValues.reduce((sum, value) => sum + value, 0) / completenessValues.length)
          : 0
      },
      priorityItems: assessments.slice(0, maxItems),
      selected,
      forecasts: {
        sevenDays: intelligence.forecastChequeCashFlow(records, { asOf, horizonDays: 7 }),
        thirtyDays: intelligence.forecastChequeCashFlow(records, { asOf, horizonDays: 30 })
      },
      query,
      messageDraft,
      ai,
      methodology: {
        riskVersion: intelligence.RISK_MODEL_VERSION || '',
        anomalyVersion: intelligence.ANOMALY_MODEL_VERSION || '',
        priorityVersion: intelligence.PRIORITY_MODEL_VERSION || '',
        forecastVersion: intelligence.FORECAST_MODEL_VERSION || '',
        modelInfo: intelligence.MODEL_INFO || null,
        statement: 'All default insights use fixed, versioned offline rules. Scores are review priorities, not probabilities or credit ratings.'
      },
      invariants: {
        recordsMutated: false,
        networkRequestsMade: false,
        messagesSent: false,
        financialActionsPerformed: false
      }
    };
    state.actions = buildActions(state, aiClientModule);
    return state;
  }

  function humanForecastReason(reason) {
    const code = localSafeText(reason && reason.code, 80);
    const labels = {
      INSUFFICIENT_COMPLETED_HISTORY: 'More cleared-cheque history is needed.',
      HISTORY_WINDOW_TOO_SHORT: 'The available history covers too few days.',
      INSUFFICIENT_INCOMING_HISTORY: 'More incoming cheque history is needed.',
      INSUFFICIENT_OUTGOING_HISTORY: 'More outgoing cheque history is needed.',
      TOO_MANY_MISSING_DIRECTIONS: 'Too many historical cheques are missing a direction.'
    };
    return labels[code] || 'The available data is not sufficient for this forecast.';
  }

  function formatMoney(intelligence, value) {
    const formatted = intelligence.formatNpr(value, 'en');
    return formatted || 'Not available';
  }

  function renderSummary(state) {
    const summary = state.summary || {};
    const cards = [
      ['Cheques reviewed', Number(summary.chequeCount) || 0, 'Current filtered data'],
      ['Urgent priorities', Number(summary.urgentCount) || 0, 'Rule-based review queue'],
      ['Anomaly signals', Number(summary.anomalyCount) || 0, 'Data checks, not accusations'],
      ['Data completeness', `${clamp(summary.averageDataCompleteness, 0, 100)}%`, 'Across required cheque fields']
    ];
    return `<div class="insights-summary" aria-label="Smart insight summary">${cards.map(card => `
      <article class="insights-metric">
        <p class="insights-eyebrow">${escapeHtml(card[0])}</p>
        <strong class="insights-metric-value">${escapeHtml(card[1])}</strong>
        <p>${escapeHtml(card[2])}</p>
      </article>`).join('')}
    </div>`;
  }

  function renderAIStatus(state) {
    const ai = plainObject(state.ai) ? state.ai : normalizeAIState('NOT_CHECKED', false);
    const tone = TONES.includes(ai.tone) ? ai.tone : 'neutral';
    const ready = ai.state === 'READY';
    const providerLine = ready && (ai.provider || ai.model)
      ? `<p class="insights-provider">Provider: ${escapeHtml(ai.provider || 'Configured')} · Model: ${escapeHtml(ai.model || 'Configured')}</p>`
      : '';
    return `<section class="insights-ai-status insights-tone-${tone}" aria-labelledby="insights-ai-title">
      <div>
        <p class="insights-eyebrow">Optional provider assistance</p>
        <h2 id="insights-ai-title">${escapeHtml(ai.label)}</h2>
        <p>${escapeHtml(ai.detail)}</p>
        ${providerLine}
      </div>
      <div class="insights-ocr-status" role="status" aria-live="polite">
        <strong>${ready ? 'OCR review available' : 'OCR unavailable'}</strong>
        <span>${escapeHtml(ai.ocrLabel)}</span>
        <button type="button" class="insights-button insights-button-secondary" data-action="request-cheque-ocr"${ready ? '' : ' disabled aria-disabled="true"'}>Choose cheque image for review</button>
      </div>
    </section>`;
  }

  function renderQuery(state) {
    const query = plainObject(state.query) ? state.query : { query: '', ok: false, ast: null, warnings: [] };
    const astSafe = query.ast && query.ast.type === 'filter' && Array.isArray(query.ast.conditions);
    const conditions = astSafe ? query.ast.conditions : [];
    const fieldLabels = {
      status: 'Status', direction: 'Direction', party: 'Party', bank: 'Bank', amount: 'Amount',
      dueDate: 'Due date', riskLevel: 'Risk level', assignedTo: 'Assigned to', chequeNumber: 'Cheque number'
    };
    const operatorLabels = {
      eq: 'is', in: 'is one of', contains: 'contains', gte: 'at least', lte: 'at most',
      before: 'before', after: 'after', between: 'between'
    };
    const chips = conditions.map(condition => {
      const rawValue = Array.isArray(condition.value) ? condition.value.join(' – ') : condition.value;
      return `<li><span>${escapeHtml(fieldLabels[condition.field] || titleFromCode(condition.field))}</span> ${escapeHtml(operatorLabels[condition.operator] || condition.operator)} <strong>${escapeHtml(rawValue)}</strong></li>`;
    }).join('');
    const result = query.query
      ? query.ok
        ? `<div class="insights-query-result" role="status"><p>${conditions.length} safe filter${conditions.length === 1 ? '' : 's'} recognized.</p><ul>${chips}</ul><button type="button" class="insights-button insights-button-secondary" data-action="apply-insights-filter">Apply to this view</button></div>`
        : '<p class="insights-query-empty" role="status">No supported filters were recognized. Try “bounced incoming due next 7 days”.</p>'
      : '<p class="insights-query-empty">Try “high risk incoming due next 7 days” or “amount over Rs 1 lakh”.</p>';
    return `<section class="insights-panel" aria-labelledby="insights-query-title">
      <div class="insights-section-heading">
        <div><p class="insights-eyebrow">Safe natural-language filter</p><h2 id="insights-query-title">Find the cheques that need attention</h2></div>
        <span class="insights-badge">No SQL · No execution</span>
      </div>
      <form class="insights-query-form" data-insights-form="query">
        <label for="insights-query-input">Describe a filter</label>
        <div class="insights-query-controls">
          <input id="insights-query-input" name="insights-query" type="search" value="${escapeHtml(query.query)}" maxlength="240" autocomplete="off">
          <button type="submit" class="insights-button" data-action="parse-insights-query">Build safe filter</button>
        </div>
      </form>
      ${result}
    </section>`;
  }

  function renderPriorityQueue(intelligence, state) {
    const items = Array.isArray(state.priorityItems) ? state.priorityItems : [];
    const content = items.length ? items.map(item => {
      const level = PRIORITY_LEVELS.includes(item.priority && item.priority.level) ? item.priority.level : 'low';
      return `<li class="insights-priority-item">
        <div>
          <span class="insights-badge insights-priority-${level}">${escapeHtml(level)}</span>
          <strong>${escapeHtml(item.party)}</strong>
          <p>${escapeHtml(formatMoney(intelligence, item.amount))} · ${escapeHtml(item.dueDate || 'No comparable due date')}</p>
        </div>
        <div class="insights-priority-action">
          <span>${clamp(item.priority && item.priority.score, 0, 100)}/100</span>
          <button type="button" class="insights-button insights-button-quiet" data-action="select-insight-record" data-record-id="${escapeHtml(item.id)}">Inspect</button>
        </div>
      </li>`;
    }).join('') : '<li class="insights-empty">No cheques are available for priority review.</li>';
    return `<section class="insights-panel" aria-labelledby="insights-priority-title">
      <div class="insights-section-heading">
        <div><p class="insights-eyebrow">Action centre</p><h2 id="insights-priority-title">Priority queue</h2></div>
        <span class="insights-badge">Deterministic</span>
      </div>
      <ol class="insights-priority-list">${content}</ol>
    </section>`;
  }

  function renderSelectedRisk(intelligence, state) {
    const selected = state.selected;
    if (!selected) return `<section class="insights-panel" aria-labelledby="insights-risk-title"><h2 id="insights-risk-title">Risk transparency</h2><p class="insights-empty">Select or add a cheque to see its rule-based explanation.</p></section>`;
    const risk = selected.risk;
    const category = RISK_LEVELS.includes(risk.category) ? risk.category : 'low';
    const factors = Array.isArray(risk.factors) && risk.factors.length
      ? risk.factors.map(factor => `<li><div><strong>${escapeHtml(titleFromCode(factor.code))}</strong><p>${escapeHtml(factor.reason)}</p></div><span>+${clamp(factor.points, 0, 100)}</span></li>`).join('')
      : '<li class="insights-empty">No scored risk factors were found.</li>';
    const anomalies = selected.anomaly && Array.isArray(selected.anomaly.anomalies) && selected.anomaly.anomalies.length
      ? selected.anomaly.anomalies.map(anomaly => `<li><span class="insights-badge">${escapeHtml(anomaly.severity)}</span><div><strong>${escapeHtml(titleFromCode(anomaly.code))}</strong><p>${escapeHtml(anomaly.message)}</p></div></li>`).join('')
      : '<li class="insights-empty">No anomaly signals were found.</li>';
    const completeness = clamp(risk.dataCompleteness && risk.dataCompleteness.score, 0, 100);
    return `<section class="insights-panel" aria-labelledby="insights-risk-title">
      <div class="insights-section-heading">
        <div><p class="insights-eyebrow">Selected cheque · ${escapeHtml(selected.party)}</p><h2 id="insights-risk-title">Risk transparency</h2></div>
        <span class="insights-badge insights-risk-${category}">${escapeHtml(category)} · ${clamp(risk.score, 0, 100)}/100</span>
      </div>
      <p>${escapeHtml(risk.basis)}</p>
      <div class="insights-completeness">
        <label for="insights-completeness-meter">Required-data completeness</label>
        <meter id="insights-completeness-meter" min="0" max="100" value="${completeness}">${completeness}%</meter>
        <span>${completeness}%</span>
      </div>
      <div class="insights-risk-columns">
        <div><h3>Scored factors</h3><ul class="insights-factor-list">${factors}</ul></div>
        <div><h3>Anomaly checks</h3><ul class="insights-anomaly-list">${anomalies}</ul></div>
      </div>
      <div class="insights-review-action">
        <p>Optional AI may explain these supplied rule codes, but cannot change the score or any record.</p>
        <button type="button" class="insights-button insights-button-secondary" data-action="request-ai-risk-explanation"${state.ai.configured ? '' : ' disabled aria-disabled="true"'}>Review optional AI explanation</button>
      </div>
    </section>`;
  }

  function renderForecastCard(intelligence, forecast, label) {
    const item = plainObject(forecast) ? forecast : { status: 'insufficient_data', reasons: [] };
    const ready = item.status === 'ready' && plainObject(item.forecast);
    const known = plainObject(item.knownSchedule) ? item.knownSchedule : { incoming: 0, outgoing: 0, net: 0, count: 0 };
    const body = ready ? `<div class="insights-forecast-values">
        <div><span>Historical run-rate inflow</span><strong>${escapeHtml(formatMoney(intelligence, item.forecast.projectedInflow))}</strong></div>
        <div><span>Historical run-rate outflow</span><strong>${escapeHtml(formatMoney(intelligence, item.forecast.projectedOutflow))}</strong></div>
        <div><span>Run-rate net</span><strong>${escapeHtml(formatMoney(intelligence, item.forecast.projectedNet))}</strong></div>
      </div>` : `<div class="insights-insufficient" role="status">
        <strong>Insufficient history for a responsible forecast</strong>
        <ul>${(Array.isArray(item.reasons) && item.reasons.length ? item.reasons : [{ code: '' }]).map(reason => `<li>${escapeHtml(humanForecastReason(reason))}</li>`).join('')}</ul>
      </div>`;
    return `<article class="insights-forecast-card">
      <div class="insights-section-heading"><h3>${escapeHtml(label)}</h3><span class="insights-badge">${ready ? 'Run-rate ready' : 'Needs data'}</span></div>
      ${body}
      <div class="insights-known-schedule">
        <p>Known schedule in this window · ${Number(known.count) || 0} cheque(s)</p>
        <span>Incoming ${escapeHtml(formatMoney(intelligence, known.incoming))}</span>
        <span>Outgoing ${escapeHtml(formatMoney(intelligence, known.outgoing))}</span>
      </div>
    </article>`;
  }

  function renderForecasts(intelligence, state) {
    const forecasts = state.forecasts || {};
    return `<section class="insights-panel" aria-labelledby="insights-forecast-title">
      <div class="insights-section-heading">
        <div><p class="insights-eyebrow">Cash-flow planning</p><h2 id="insights-forecast-title">7 and 30 day outlook</h2></div>
        <span class="insights-badge">No invented confidence</span>
      </div>
      <p>Projections appear only when completed history, date coverage, and incoming/outgoing direction are sufficient. Known scheduled cheques stay separate.</p>
      <div class="insights-forecast-grid">
        ${renderForecastCard(intelligence, forecasts.sevenDays, 'Next 7 days')}
        ${renderForecastCard(intelligence, forecasts.thirtyDays, 'Next 30 days')}
      </div>
    </section>`;
  }

  function renderMessages(state) {
    const drafts = state.messageDraft || {};
    const cards = [drafts.english, drafts.nepali].filter(Boolean).map(draft => {
      const text = draft.status === 'ready' ? draft.text : `Add ${draft.missingFields.join(' and ')} to prepare this draft.`;
      return `<article class="insights-draft-card">
        <div class="insights-section-heading"><h3>${escapeHtml(draft.languageLabel)}</h3><span class="insights-badge">Editable · Not sent</span></div>
        <label for="insights-draft-${escapeHtml(draft.locale)}">Message draft</label>
        <textarea id="insights-draft-${escapeHtml(draft.locale)}" data-draft-locale="${escapeHtml(draft.locale)}" rows="6" maxlength="1600">${escapeHtml(text)}</textarea>
        <p id="insights-draft-${escapeHtml(draft.locale)}-note">Review tone, amount, and date before using this text anywhere.</p>
        <button type="button" class="insights-button insights-button-secondary" data-action="request-ai-message-${escapeHtml(draft.locale)}"${state.ai.configured && draft.status === 'ready' ? '' : ' disabled aria-disabled="true"'}>Review optional AI rewrite</button>
      </article>`;
    }).join('');
    return `<section class="insights-panel" aria-labelledby="insights-message-title">
      <div class="insights-section-heading">
        <div><p class="insights-eyebrow">Respectful follow-up</p><h2 id="insights-message-title">Bilingual message workspace</h2></div>
        <span class="insights-badge">Review required</span>
      </div>
      <p>${escapeHtml(drafts.note || 'This page does not send messages.')}</p>
      <div class="insights-draft-grid">${cards || '<p class="insights-empty">Select a cheque to prepare a draft.</p>'}</div>
    </section>`;
  }

  function renderMethodology(state) {
    const method = state.methodology || {};
    const versions = [method.riskVersion, method.anomalyVersion, method.priorityVersion, method.forecastVersion].filter(Boolean);
    return `<details class="insights-methodology">
      <summary>How these insights were calculated</summary>
      <p>${escapeHtml(method.statement || '')}</p>
      <p>Versioned models: ${escapeHtml(versions.join(' · ') || 'Not available')}</p>
      <p>No records were changed, no provider request was made, and no message was sent while building this page.</p>
    </details>`;
  }

  function renderInsightsPageWith(intelligence, state) {
    const safeState = plainObject(state) ? state : {};
    return `<section class="smart-insights-page" aria-labelledby="smart-insights-title" data-insights-version="${VERSION}">
      <header class="insights-hero">
        <div>
          <p class="insights-eyebrow">Smart Insights</p>
          <h1 id="smart-insights-title">See what needs attention—and why</h1>
          <p>Transparent offline rules first. Optional AI stays clearly labelled, review-only, and separate from financial actions.</p>
        </div>
        <span class="insights-as-of">As of <time datetime="${escapeHtml(safeState.asOf || '')}">${escapeHtml(safeState.asOf || 'today')}</time></span>
      </header>
      ${renderSummary(safeState)}
      ${renderAIStatus(safeState)}
      ${renderQuery(safeState)}
      <div class="insights-main-grid">
        ${renderPriorityQueue(intelligence, safeState)}
        ${renderSelectedRisk(intelligence, safeState)}
      </div>
      ${renderForecasts(intelligence, safeState)}
      ${renderMessages(safeState)}
      ${renderMethodology(safeState)}
    </section>`;
  }

  function createInsightsUI(dependencies) {
    const settings = plainObject(dependencies) ? dependencies : {};
    const intelligence = assertIntelligence(settings.intelligence || getDefaultIntelligence());
    const aiClientModule = settings.aiClientModule || getDefaultAIClient() || null;

    function buildInsightsState(input) {
      return buildInsightsStateWith(intelligence, aiClientModule, input);
    }

    function renderInsightsPage(state) {
      return renderInsightsPageWith(intelligence, state);
    }

    function buildSmartInsightsPage(input) {
      const state = buildInsightsState(input);
      return {
        state,
        markup: renderInsightsPage(state),
        actions: state.actions.slice(),
        contract: {
          mountPerformed: false,
          eventHandlersAttached: false,
          networkRequestsMade: false,
          recordsMutated: false,
          messagesSent: false
        }
      };
    }

    function validateAIRequest(action, input) {
      if (!aiClientModule || typeof aiClientModule.validateInput !== 'function') {
        return { ok: false, state: 'NOT_CONFIGURED', error: 'Optional AI client is unavailable.', request: null };
      }
      const validated = aiClientModule.validateInput(action, input);
      return validated.ok
        ? { ok: true, state: 'READY_FOR_EXPLICIT_CONFIRMATION', request: { action, input: validated.value }, executes: false }
        : { ok: false, state: 'INVALID_REQUEST', error: localSafeText(validated.error, 240), request: null };
    }

    return Object.freeze({
      buildInsightsState,
      renderInsightsPage,
      buildSmartInsightsPage,
      safeNaturalLanguageQuery: (query, asOf) => safeQueryResult(intelligence, query, intelligence.parseDateOnly(asOf) || intelligence.parseDateOnly(new Date())),
      buildBilingualDraft: (record, options) => buildBilingualDraft(intelligence, record, options),
      validateAIRequest,
      normalizeAIState: value => normalizeAIState(value, Boolean(aiClientModule))
    });
  }

  function defaultUI() {
    return createInsightsUI();
  }

  return Object.freeze({
    VERSION,
    AI_STATES,
    escapeHtml,
    normalizeAIState,
    createInsightsUI,
    buildInsightsState: input => defaultUI().buildInsightsState(input),
    renderInsightsPage: state => defaultUI().renderInsightsPage(state),
    buildSmartInsightsPage: input => defaultUI().buildSmartInsightsPage(input),
    safeNaturalLanguageQuery: (query, asOf) => defaultUI().safeNaturalLanguageQuery(query, asOf),
    buildBilingualDraft: (record, options) => defaultUI().buildBilingualDraft(record, options),
    validateAIRequest: (action, input) => defaultUI().validateAIRequest(action, input)
  });
});
