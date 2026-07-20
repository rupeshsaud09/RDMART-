'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../assets/martai-ui.js');
const DateTools = require('../assets/martai-date.js');

function wait(milliseconds) {
  return new Promise(function resolveAfter(resolve) { setTimeout(resolve, milliseconds); });
}

class FakeClassList {
  constructor(initial) {
    this.values = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const shouldAdd = force == null ? !this.contains(value) : Boolean(force);
    if (shouldAdd) this.add(value);
    else this.remove(value);
    return shouldAdd;
  }
  toString() { return Array.from(this.values).join(' '); }
}

class FakeElement {
  constructor(tagName, ownerDocument, className) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList(className);
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.textContent = '';
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get firstElementChild() { return this.children[0] || null; }
  set className(value) { this.classList = new FakeClassList(value); }
  get className() { return this.classList.toString(); }
  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter(function keep(item) { return item !== child; });
    child.parentNode = null;
    child.isConnected = false;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  hasAttribute(name) { return this.attributes.has(String(name)); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(callback);
  }
  emit(type, event) {
    const payload = Object.assign({ target: this }, event || {});
    Array.from(this.listeners.get(type) || []).forEach(function notify(callback) { callback(payload); });
    return payload;
  }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  contains(element) {
    if (element === this) return true;
    return this.children.some(function hasChild(child) { return child.contains(element); });
  }
  descendants() {
    return this.children.reduce(function flatten(result, child) {
      return result.concat(child, child.descendants());
    }, []);
  }
  matches(selector) {
    return String(selector).split(',').some((raw) => {
      const part = raw.trim();
      if (part === 'dialog') return this.tagName === 'DIALOG';
      if (part === '.modal') return this.classList.contains('modal');
      if (part === '.modal-title') return this.classList.contains('modal-title');
      if (part === 'h1' || part === 'h2' || part === 'h3') return this.tagName === part.toUpperCase();
      if (part === '[role="dialog"]') return this.getAttribute('role') === 'dialog';
      if (part === '[role="tab"]') return this.getAttribute('role') === 'tab';
      if (part === '[data-tab]') return this.hasAttribute('data-tab');
      if (part === '[data-dialog-title]') return this.hasAttribute('data-dialog-title');
      if (part === '[autofocus]') return this.hasAttribute('autofocus');
      if (part === '[data-dialog-close]') return this.hasAttribute('data-dialog-close');
      if (part === '[data-close]') return this.hasAttribute('data-close');
      if (part.indexOf('button:not') === 0) return this.tagName === 'BUTTON' && !this.disabled;
      if (part.indexOf('input:not') === 0) return this.tagName === 'INPUT' && !this.disabled;
      if (part.indexOf('select:not') === 0) return this.tagName === 'SELECT' && !this.disabled;
      if (part.indexOf('textarea:not') === 0) return this.tagName === 'TEXTAREA' && !this.disabled;
      if (part === '[tabindex]:not([tabindex="-1"])') return this.hasAttribute('tabindex') && this.getAttribute('tabindex') !== '-1';
      return false;
    });
  }
  querySelectorAll(selector) { return this.descendants().filter(function match(element) { return element.matches(selector); }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.body = new FakeElement('body', this);
    this.documentElement = this.body;
    this.activeElement = this.body;
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  getElementById(id) {
    if (this.body.id === id) return this.body;
    return this.body.descendants().find(function find(element) { return element.id === id; }) || null;
  }
  querySelector(selector) { return this.body.querySelector(selector); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(callback);
  }
  emit(type, event) {
    Array.from(this.listeners.get(type) || []).forEach(function notify(callback) { callback(event); });
  }
}

function keyboardEvent(key, target, extra) {
  return Object.assign({
    key: key,
    target: target,
    defaultPrevented: false,
    preventDefault: function preventDefault() { this.defaultPrevented = true; },
    stopPropagation: function stopPropagation() {}
  }, extra || {});
}

test('escapeHtml safely handles text and attributes', function () {
  assert.equal(UI.escapeHtml('<button title="x">Tom & Jerry\'s</button>'), '&lt;button title=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/button&gt;');
  assert.equal(UI.escapeAttribute(null), '');
});

test('debounce coalesces calls and exposes cancel, flush, and pending', async function () {
  const calls = [];
  const receiver = { value: 7 };
  const debounced = UI.debounce(function record(value) {
    calls.push([this.value, value]);
    return value * 2;
  }, 15);

  debounced.call(receiver, 1);
  debounced.call(receiver, 3);
  assert.equal(debounced.pending(), true);
  await wait(30);
  assert.deepEqual(calls, [[7, 3]]);
  assert.equal(debounced.pending(), false);

  debounced.call(receiver, 4);
  assert.equal(debounced.flush(), 8);
  assert.deepEqual(calls, [[7, 3], [7, 4]]);
  debounced.call(receiver, 5);
  debounced.cancel();
  await wait(25);
  assert.deepEqual(calls, [[7, 3], [7, 4]]);
});

test('toast and announcement helpers expose messages without HTML injection', async function () {
  const doc = new FakeDocument();
  const region = UI.announce('<strong>Saved</strong>', { document: doc });
  await Promise.resolve();
  assert.equal(region.textContent, '<strong>Saved</strong>');
  assert.equal(region.getAttribute('role'), 'status');
  assert.equal(region.getAttribute('aria-live'), 'polite');

  const notice = UI.toast('<img src=x onerror=alert(1)>', {
    document: doc,
    type: 'error',
    duration: 0,
    transitionMs: 0
  });
  assert.equal(notice.element.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(notice.element.getAttribute('role'), 'alert');
  assert.equal(notice.element.isConnected, true);
  notice.dismiss();
  assert.equal(notice.element.isConnected, false);
});

test('dialog controller adds semantics, traps focus, closes, and restores focus', function () {
  const doc = new FakeDocument();
  const trigger = doc.createElement('button');
  const backdrop = doc.createElement('div');
  const panel = new FakeElement('section', doc, 'modal');
  const title = new FakeElement('h2', doc, 'modal-title');
  const first = doc.createElement('button');
  const last = doc.createElement('button');
  last.setAttribute('data-dialog-close', '');
  doc.body.appendChild(trigger);
  doc.body.appendChild(backdrop);
  backdrop.appendChild(panel);
  panel.appendChild(title);
  panel.appendChild(first);
  panel.appendChild(last);
  trigger.focus();

  const dialog = UI.createDialog(backdrop, { document: doc });
  assert.equal(backdrop.hidden, true);
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.getAttribute('aria-modal'), 'true');
  assert.equal(panel.getAttribute('aria-labelledby'), title.id);

  dialog.open(trigger);
  assert.equal(dialog.isOpen(), true);
  assert.equal(backdrop.hidden, false);
  assert.equal(backdrop.classList.contains('active'), true);
  assert.equal(doc.activeElement, first);

  last.focus();
  const forwardTab = keyboardEvent('Tab', last);
  doc.emit('keydown', forwardTab);
  assert.equal(forwardTab.defaultPrevented, true);
  assert.equal(doc.activeElement, first);

  first.focus();
  const reverseTab = keyboardEvent('Tab', first, { shiftKey: true });
  doc.emit('keydown', reverseTab);
  assert.equal(doc.activeElement, last);

  doc.emit('keydown', keyboardEvent('Escape', last));
  assert.equal(dialog.isOpen(), false);
  assert.equal(backdrop.hidden, true);
  assert.equal(backdrop.getAttribute('aria-hidden'), 'true');
  assert.equal(doc.activeElement, trigger);

  dialog.open(trigger);
  backdrop.emit('click', keyboardEvent('', backdrop));
  assert.equal(dialog.isOpen(), false);
  dialog.destroy();
});

test('tabs helper wires ARIA state and supports arrow-key navigation', function () {
  const doc = new FakeDocument();
  const tabList = doc.createElement('div');
  const firstTab = doc.createElement('button');
  const secondTab = doc.createElement('button');
  const firstPanel = doc.createElement('section');
  const secondPanel = doc.createElement('section');
  firstTab.setAttribute('aria-selected', 'true');
  tabList.appendChild(firstTab);
  tabList.appendChild(secondTab);
  doc.body.appendChild(tabList);
  doc.body.appendChild(firstPanel);
  doc.body.appendChild(secondPanel);

  const tabs = UI.createTabs(tabList, {
    document: doc,
    tabs: [firstTab, secondTab],
    panels: [firstPanel, secondPanel]
  });
  assert.equal(tabList.getAttribute('role'), 'tablist');
  assert.equal(firstTab.getAttribute('role'), 'tab');
  assert.equal(firstTab.getAttribute('aria-selected'), 'true');
  assert.equal(secondTab.getAttribute('aria-selected'), 'false');
  assert.equal(firstPanel.hidden, false);
  assert.equal(secondPanel.hidden, true);
  assert.equal(firstPanel.getAttribute('aria-labelledby'), firstTab.id);

  const right = tabList.emit('keydown', keyboardEvent('ArrowRight', firstTab));
  assert.equal(right.defaultPrevented, true);
  assert.equal(tabs.activeIndex(), 1);
  assert.equal(secondTab.getAttribute('aria-selected'), 'true');
  assert.equal(secondPanel.hidden, false);
  assert.equal(doc.activeElement, secondTab);

  tabList.emit('keydown', keyboardEvent('Home', secondTab));
  assert.equal(tabs.activeIndex(), 0);
  tabs.destroy();
});

test('Kathmandu day keys do not depend on the machine timezone', function () {
  assert.equal(DateTools.kathmanduDayKey('2026-01-01T18:14:59.999Z'), '2026-01-01');
  assert.equal(DateTools.kathmanduDayKey('2026-01-01T18:15:00.000Z'), '2026-01-02');
  assert.equal(DateTools.kathmanduDayKey('2026-01-01T23:59:00'), '2026-01-01');
  assert.equal(DateTools.dayKey('2026-7-2'), '2026-07-02');
  assert.equal(DateTools.dayKey('२०२६-०७-२०'), '2026-07-20');
  assert.throws(function invalidDate() { DateTools.dayKey('2026-02-30'); }, RangeError);
});

test('BS conversion round-trips strictly across the supported table', function () {
  assert.deepEqual(DateTools.adToBs('2013-04-14'), {
    year: 2070,
    month: 1,
    day: 1,
    key: '2070-01-01',
    ad: '2013-04-14'
  });
  assert.equal(DateTools.bsToAd('२०७०-१-१'), '2013-04-14');
  assert.equal(DateTools.bsToAd(DateTools.adToBs('2026-07-20')), '2026-07-20');
  assert.equal(DateTools.bsToAd(DateTools.BS_RANGE.lastBs), DateTools.BS_RANGE.lastAd);
  assert.throws(function beforeRange() { DateTools.adToBs('2013-04-13'); }, RangeError);
  assert.throws(function afterRange() { DateTools.adToBs(DateTools.addDays(DateTools.BS_RANGE.lastAd, 1)); }, RangeError);
  assert.throws(function unsupportedBsYear() { DateTools.bsToAd('2091-01-01'); }, RangeError);
  assert.throws(function invalidBsDay() { DateTools.bsToAd('2083-01-32'); }, RangeError);
});

test('Nepali date formatting supports English and Devanagari output', function () {
  assert.equal(DateTools.formatBs('2013-04-14'), '2070 Baisakh 1 BS');
  assert.equal(DateTools.formatBs('2070-01-01', { inputCalendar: 'bs', style: 'numeric' }), '2070-01-01 BS');
  assert.equal(DateTools.formatNepaliDate('2013-04-14'), '२०७० बैशाख १ बि.सं.');
  assert.equal(DateTools.toNepaliDigits('Rs 12,345'), 'Rs १२,३४५');
});

test('bank-effective dates support weekends, holidays, and store-specific rules', function () {
  const weekend = DateTools.bankEffectiveDateInfo('2026-07-18'); // Saturday
  assert.deepEqual(weekend, {
    originalDate: '2026-07-18',
    effectiveDate: '2026-07-20',
    shifted: true,
    daysShifted: 2,
    closedDates: ['2026-07-18', '2026-07-19']
  });
  assert.equal(DateTools.bankEffectiveDate('2026-07-18', {
    holidays: ['2026-07-20']
  }), '2026-07-21');
  assert.equal(DateTools.bankEffectiveDate('2026-07-18', {
    weekendDays: [6]
  }), '2026-07-19');
  assert.equal(DateTools.bankEffectiveDate('2026-07-18', {
    weekends: 6,
    holidays: '2026-07-19'
  }), '2026-07-20');
  assert.equal(DateTools.bankEffectiveDate('2026-07-18', {
    weekendDays: []
  }), '2026-07-18');
  assert.equal(DateTools.bankEffectiveDate('2026-07-20', {
    holidays: ['2026-07-20'],
    roll: 'preceding'
  }), '2026-07-17');
  assert.equal(DateTools.isBankingDay('2026-07-20'), true);
  assert.equal(DateTools.isBankingDay('2026-07-20', { isHoliday: function isHoliday(date) { return date === '2026-07-20'; } }), false);
});
