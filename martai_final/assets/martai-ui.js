/*
 * Shared, dependency-free UI primitives for RD MART.
 *
 * The module is deliberately framework-agnostic and uses a small UMD wrapper:
 *   - Browser: window.MartAIUI
 *   - Node/tests: require('./martai-ui.js')
 */
(function initMartAIUI(globalScope, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.MartAIUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMartAIUI() {
  'use strict';

  let sequence = 0;

  function uniqueId(prefix) {
    sequence += 1;
    return String(prefix || 'martai-ui') + '-' + sequence;
  }

  function escapeHtml(value) {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return String(value == null ? '' : value).replace(/[&<>"']/g, function replace(character) {
      return entities[character];
    });
  }

  function debounce(callback, wait, options) {
    if (typeof callback !== 'function') throw new TypeError('debounce requires a function');

    const delay = Math.max(0, Number(wait) || 0);
    const settings = options || {};
    const leading = settings.leading === true;
    const trailing = settings.trailing !== false;
    let timer = null;
    let lastArguments;
    let lastContext;
    let lastResult;

    function invoke() {
      const args = lastArguments;
      const context = lastContext;
      lastArguments = undefined;
      lastContext = undefined;
      lastResult = callback.apply(context, args);
      return lastResult;
    }

    function onTimer() {
      timer = null;
      if (trailing && lastArguments) invoke();
      else {
        lastArguments = undefined;
        lastContext = undefined;
      }
    }

    function debounced() {
      const shouldInvokeLeading = leading && timer === null;
      lastArguments = arguments;
      lastContext = this;

      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(onTimer, delay);
      if (shouldInvokeLeading) invoke();
      return lastResult;
    }

    debounced.cancel = function cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      lastArguments = undefined;
      lastContext = undefined;
    };

    debounced.flush = function flush() {
      if (timer === null) return lastResult;
      clearTimeout(timer);
      timer = null;
      if (trailing && lastArguments) return invoke();
      lastArguments = undefined;
      lastContext = undefined;
      return lastResult;
    };

    debounced.pending = function pending() {
      return timer !== null;
    };

    return debounced;
  }

  function elementDocument(element, explicitDocument) {
    if (explicitDocument) return explicitDocument;
    if (element && element.ownerDocument) return element.ownerDocument;
    return typeof document !== 'undefined' ? document : null;
  }

  function resolveElement(target, explicitDocument) {
    if (!target) return null;
    if (typeof target !== 'string') return target;
    const doc = explicitDocument || (typeof document !== 'undefined' ? document : null);
    return doc && typeof doc.querySelector === 'function' ? doc.querySelector(target) : null;
  }

  function removeElement(element) {
    if (!element) return;
    if (typeof element.remove === 'function') element.remove();
    else if (element.parentNode && typeof element.parentNode.removeChild === 'function') {
      element.parentNode.removeChild(element);
    }
  }

  function announce(message, options) {
    const settings = options || {};
    const doc = elementDocument(settings.container, settings.document);
    if (!doc || typeof doc.createElement !== 'function') return null;

    const priority = settings.priority === 'assertive' ? 'assertive' : 'polite';
    const regionId = settings.id || 'martai-live-region-' + priority;
    let region = typeof doc.getElementById === 'function' ? doc.getElementById(regionId) : null;

    if (!region) {
      region = doc.createElement('div');
      region.id = regionId;
      region.className = settings.className || 'sr-only';
      if (!settings.className && region.style) {
        region.style.position = 'absolute';
        region.style.width = '1px';
        region.style.height = '1px';
        region.style.padding = '0';
        region.style.margin = '-1px';
        region.style.overflow = 'hidden';
        region.style.clip = 'rect(0, 0, 0, 0)';
        region.style.whiteSpace = 'nowrap';
        region.style.border = '0';
      }
      region.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
      region.setAttribute('aria-live', priority);
      region.setAttribute('aria-atomic', 'true');
      const parent = resolveElement(settings.container, doc) || doc.body || doc.documentElement;
      if (!parent || typeof parent.appendChild !== 'function') return null;
      parent.appendChild(region);
    }

    // Clearing first ensures assistive technology announces a repeated message.
    region.textContent = '';
    const write = function writeAnnouncement() {
      region.textContent = String(message == null ? '' : message);
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(write);
    else setTimeout(write, 0);
    return region;
  }

  function toast(message, options) {
    const settings = options || {};
    const doc = elementDocument(settings.container, settings.document);
    if (!doc || typeof doc.createElement !== 'function') {
      return { element: null, dismiss: function dismiss() {} };
    }

    let container = resolveElement(settings.container, doc);
    if (!container && typeof doc.querySelector === 'function') {
      container = doc.querySelector('[data-toast-container], #toasts');
    }
    if (!container) {
      container = doc.createElement('div');
      container.className = 'toast-box';
      container.setAttribute('data-toast-container', '');
      container.setAttribute('aria-label', 'Notifications');
      const parent = doc.body || doc.documentElement;
      if (parent && typeof parent.appendChild === 'function') parent.appendChild(container);
    }

    const type = String(settings.type || 'info').replace(/[^a-z0-9_-]/gi, '') || 'info';
    const element = doc.createElement('div');
    element.className = (settings.className || 'toast') + ' ' + type;
    element.textContent = String(message == null ? '' : message);
    element.setAttribute('role', type === 'error' || type === 'danger' || type === 'err' ? 'alert' : 'status');
    element.setAttribute('aria-live', type === 'error' || type === 'danger' || type === 'err' ? 'assertive' : 'polite');
    element.setAttribute('aria-atomic', 'true');
    if (container && typeof container.appendChild === 'function') container.appendChild(element);

    let removalTimer = null;
    let transitionTimer = null;
    let dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      if (removalTimer !== null) clearTimeout(removalTimer);
      if (element.classList && typeof element.classList.add === 'function') element.classList.add('is-leaving');
      const transition = settings.transitionMs == null ? 180 : Math.max(0, Number(settings.transitionMs) || 0);
      if (transition === 0) removeElement(element);
      else transitionTimer = setTimeout(function removeToast() { removeElement(element); }, transition);
    }

    const duration = settings.duration == null ? 3600 : Math.max(0, Number(settings.duration) || 0);
    if (duration > 0) removalTimer = setTimeout(dismiss, duration);

    return {
      element: element,
      dismiss: dismiss,
      cancelTimers: function cancelTimers() {
        if (removalTimer !== null) clearTimeout(removalTimer);
        if (transitionTimer !== null) clearTimeout(transitionTimer);
      }
    };
  }

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'iframe',
    'object',
    'embed',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function isFocusable(element) {
    if (!element || element.disabled || element.hidden) return false;
    if (typeof element.getAttribute === 'function') {
      if (element.getAttribute('aria-hidden') === 'true') return false;
      if (element.getAttribute('tabindex') === '-1') return false;
    }
    return true;
  }

  function focusableElements(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    return Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isFocusable);
  }

  function focusElement(element) {
    if (!element || typeof element.focus !== 'function') return false;
    try { element.focus({ preventScroll: true }); }
    catch (error) { element.focus(); }
    return true;
  }

  function createDialog(target, options) {
    const settings = options || {};
    const root = resolveElement(target, settings.document);
    if (!root) throw new Error('Dialog element was not found');

    const doc = elementDocument(root, settings.document);
    const panel = resolveElement(settings.panel, doc)
      || (typeof root.matches === 'function' && root.matches('dialog,[role="dialog"],.modal') ? root : null)
      || (typeof root.querySelector === 'function' ? root.querySelector('dialog,[role="dialog"],.modal') : null)
      || root.firstElementChild
      || root;
    const openClass = settings.openClass || 'active';
    let previousFocus = null;
    let opened = false;
    let destroyed = false;
    let controller = null;

    if (typeof panel.setAttribute === 'function') {
      if (!panel.getAttribute('role') && String(panel.tagName || '').toLowerCase() !== 'dialog') {
        panel.setAttribute('role', 'dialog');
      }
      panel.setAttribute('aria-modal', 'true');

      if (settings.label) panel.setAttribute('aria-label', String(settings.label));
      else if (settings.labelledBy) panel.setAttribute('aria-labelledby', String(settings.labelledBy));
      else if (!panel.getAttribute('aria-label') && !panel.getAttribute('aria-labelledby') && typeof panel.querySelector === 'function') {
        const title = panel.querySelector('[data-dialog-title],.modal-title,h1,h2,h3');
        if (title) {
          if (!title.id) title.id = uniqueId('dialog-title');
          panel.setAttribute('aria-labelledby', title.id);
        }
      }
    }

    function focusInitial() {
      let initial = resolveElement(settings.initialFocus, doc);
      if (!initial && typeof panel.querySelector === 'function') initial = panel.querySelector('[autofocus]');
      if (!initial) initial = focusableElements(panel)[0];
      if (!initial) {
        if (typeof panel.setAttribute === 'function' && !panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
        initial = panel;
      }
      focusElement(initial);
    }

    function handleKeydown(event) {
      if (!opened || !event) return;
      if (event.key === 'Escape' && settings.closeOnEscape !== false) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        close('escape');
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = focusableElements(panel);
      if (!focusables.length) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        focusElement(panel);
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = doc && doc.activeElement;
      if (event.shiftKey && (active === first || (typeof panel.contains === 'function' && !panel.contains(active)))) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        focusElement(last);
      } else if (!event.shiftKey && (active === last || (typeof panel.contains === 'function' && !panel.contains(active)))) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        focusElement(first);
      }
    }

    function handleClick(event) {
      if (!opened || !event) return;
      const clickedBackdrop = event.target === root;
      let closeButton = null;
      if (event.target && typeof event.target.closest === 'function') {
        closeButton = event.target.closest('[data-dialog-close],[data-close]');
      }
      if ((clickedBackdrop && settings.closeOnBackdrop !== false) || (closeButton && root.contains(closeButton))) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        close(clickedBackdrop ? 'backdrop' : 'button');
      }
    }

    function open(trigger) {
      if (destroyed) throw new Error('Dialog controller has been destroyed');
      if (opened) return controller;
      previousFocus = resolveElement(trigger, doc) || (doc && doc.activeElement) || null;
      opened = true;

      root.hidden = false;
      if (typeof root.removeAttribute === 'function') root.removeAttribute('aria-hidden');
      if (root.classList && typeof root.classList.add === 'function') root.classList.add(openClass);
      if (typeof root.showModal === 'function' && !root.open) root.showModal();
      if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('keydown', handleKeydown);
      focusInitial();
      if (typeof settings.onOpen === 'function') settings.onOpen({ root: root, panel: panel, trigger: previousFocus });
      return controller;
    }

    function close(reason) {
      if (!opened) return controller;
      opened = false;
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('keydown', handleKeydown);
      if (typeof root.close === 'function' && root.open) root.close();
      if (root.classList && typeof root.classList.remove === 'function') root.classList.remove(openClass);
      if (typeof root.setAttribute === 'function') root.setAttribute('aria-hidden', 'true');
      if (settings.hideOnClose !== false) root.hidden = true;

      const restoreTarget = previousFocus;
      previousFocus = null;
      if (settings.restoreFocus !== false && restoreTarget && restoreTarget.isConnected !== false) focusElement(restoreTarget);
      if (typeof settings.onClose === 'function') settings.onClose({ root: root, panel: panel, reason: reason || 'programmatic' });
      return controller;
    }

    function destroy() {
      if (opened) close('destroy');
      if (typeof root.removeEventListener === 'function') root.removeEventListener('click', handleClick);
      destroyed = true;
    }

    controller = {
      root: root,
      panel: panel,
      open: open,
      close: close,
      destroy: destroy,
      isOpen: function isOpen() { return opened; }
    };
    if (typeof root.addEventListener === 'function') root.addEventListener('click', handleClick);
    if (settings.initiallyOpen === true || (root.classList && root.classList.contains(openClass))) open();
    else {
      if (settings.hideOnClose !== false) root.hidden = true;
      if (typeof root.setAttribute === 'function') root.setAttribute('aria-hidden', 'true');
    }
    return controller;
  }

  function createTabs(target, options) {
    const settings = options || {};
    const tabList = resolveElement(target, settings.document);
    if (!tabList) throw new Error('Tab list element was not found');
    const doc = elementDocument(tabList, settings.document);
    const selectedClass = settings.selectedClass || 'active';
    const activation = settings.activation === 'manual' ? 'manual' : 'automatic';
    let tabs = [];
    let panels = [];
    let activeIndex = -1;
    let destroyed = false;

    function panelFor(tab, index, suppliedPanels) {
      let panelId = typeof tab.getAttribute === 'function' ? tab.getAttribute('aria-controls') : '';
      if (!panelId && tab.dataset) panelId = tab.dataset.tabTarget || tab.dataset.panel || '';
      if (!panelId && typeof tab.getAttribute === 'function') panelId = tab.getAttribute('href') || '';
      panelId = String(panelId || '').replace(/^#/, '');
      let panel = panelId && doc && typeof doc.getElementById === 'function' ? doc.getElementById(panelId) : null;
      if (!panel && suppliedPanels[index]) panel = suppliedPanels[index];
      if (panel && !panel.id) panel.id = uniqueId('tabpanel');
      if (panel && typeof tab.setAttribute === 'function') tab.setAttribute('aria-controls', panel.id);
      return panel;
    }

    function applyState(selectedIndex, shouldFocus, emitChange) {
      if (!tabs.length) return null;
      const safeIndex = Math.max(0, Math.min(Number(selectedIndex) || 0, tabs.length - 1));
      if (tabs[safeIndex].disabled || tabs[safeIndex].getAttribute('aria-disabled') === 'true') return null;
      activeIndex = safeIndex;

      tabs.forEach(function updateTab(tab, index) {
        const selected = index === activeIndex;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.setAttribute('tabindex', selected ? '0' : '-1');
        if (tab.classList && typeof tab.classList.toggle === 'function') tab.classList.toggle(selectedClass, selected);
        const panel = panels[index];
        if (panel) {
          panel.hidden = !selected;
          panel.setAttribute('role', 'tabpanel');
          panel.setAttribute('aria-labelledby', tab.id);
          if (settings.panelTabindex !== false && !panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '0');
        }
      });

      const selectedTab = tabs[activeIndex];
      if (shouldFocus) focusElement(selectedTab);
      if (emitChange && typeof settings.onChange === 'function') {
        settings.onChange({ tab: selectedTab, panel: panels[activeIndex] || null, index: activeIndex });
      }
      return selectedTab;
    }

    function activate(tabOrIndex, activationOptions) {
      const action = activationOptions || {};
      const index = typeof tabOrIndex === 'number' ? tabOrIndex : tabs.indexOf(tabOrIndex);
      if (index < 0) return null;
      return applyState(index, action.focus !== false, action.emit !== false);
    }

    function enabledIndex(start, delta) {
      if (!tabs.length) return -1;
      let index = start;
      for (let attempts = 0; attempts < tabs.length; attempts += 1) {
        index = (index + delta + tabs.length) % tabs.length;
        if (!tabs[index].disabled && tabs[index].getAttribute('aria-disabled') !== 'true') return index;
      }
      return start;
    }

    function handleClick(event) {
      if (destroyed || !event || !event.target || typeof event.target.closest !== 'function') return;
      const tab = event.target.closest('[role="tab"],[data-tab]');
      const index = tabs.indexOf(tab);
      if (index < 0) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      activate(index, { focus: true });
    }

    function handleKeydown(event) {
      if (destroyed || !event) return;
      const current = tabs.indexOf(event.target);
      if (current < 0) return;
      const orientation = tabList.getAttribute('aria-orientation') || settings.orientation || 'horizontal';
      let next = -1;
      if ((event.key === 'ArrowRight' && orientation !== 'vertical') || (event.key === 'ArrowDown' && orientation === 'vertical')) {
        next = enabledIndex(current, 1);
      } else if ((event.key === 'ArrowLeft' && orientation !== 'vertical') || (event.key === 'ArrowUp' && orientation === 'vertical')) {
        next = enabledIndex(current, -1);
      } else if (event.key === 'Home') next = enabledIndex(-1, 1);
      else if (event.key === 'End') next = enabledIndex(0, -1);
      else if ((event.key === 'Enter' || event.key === ' ') && activation === 'manual') {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        activate(current, { focus: true });
        return;
      }
      if (next < 0) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (activation === 'automatic') activate(next, { focus: true });
      else {
        tabs.forEach(function updateRovingIndex(tab, index) { tab.setAttribute('tabindex', index === next ? '0' : '-1'); });
        focusElement(tabs[next]);
      }
    }

    function refresh() {
      const suppliedTabs = settings.tabs ? Array.prototype.slice.call(settings.tabs) : [];
      tabs = suppliedTabs.length
        ? suppliedTabs
        : Array.prototype.slice.call(tabList.querySelectorAll(settings.tabSelector || '[role="tab"],[data-tab]'));
      const suppliedPanels = settings.panels ? Array.prototype.slice.call(settings.panels) : [];
      panels = tabs.map(function findPanel(tab, index) {
        if (!tab.id) tab.id = uniqueId('tab');
        return panelFor(tab, index, suppliedPanels);
      });
      tabList.setAttribute('role', 'tablist');
      if (settings.orientation) tabList.setAttribute('aria-orientation', settings.orientation);

      let initiallySelected = tabs.findIndex(function selected(tab) { return tab.getAttribute('aria-selected') === 'true'; });
      if (initiallySelected < 0) initiallySelected = Math.max(0, Number(settings.selectedIndex) || 0);
      if (tabs[initiallySelected] && (tabs[initiallySelected].disabled || tabs[initiallySelected].getAttribute('aria-disabled') === 'true')) {
        initiallySelected = enabledIndex(-1, 1);
      }
      applyState(initiallySelected, false, false);
      return controller;
    }

    function destroy() {
      destroyed = true;
      if (typeof tabList.removeEventListener === 'function') {
        tabList.removeEventListener('click', handleClick);
        tabList.removeEventListener('keydown', handleKeydown);
      }
    }

    if (typeof tabList.addEventListener === 'function') {
      tabList.addEventListener('click', handleClick);
      tabList.addEventListener('keydown', handleKeydown);
    }

    const controller = {
      element: tabList,
      activate: activate,
      refresh: refresh,
      destroy: destroy,
      activeTab: function activeTab() { return tabs[activeIndex] || null; },
      activePanel: function activePanel() { return panels[activeIndex] || null; },
      activeIndex: function getActiveIndex() { return activeIndex; },
      tabs: function getTabs() { return tabs.slice(); },
      panels: function getPanels() { return panels.slice(); }
    };
    refresh();
    return controller;
  }

  /*
   * Lightweight, accessible tooltip system. Declarative: add data-tooltip="text"
   * to any element and it's covered automatically, including elements rendered
   * later (event delegation, not a one-time scan) - no per-element wiring needed.
   * One shared bubble is reused for whichever element is currently active, so
   * this stays cheap even with many tooltipped elements on a busy dashboard page.
   *
   * Shows on hover AND focus (keyboard users get the same information, not just
   * mouse users), hides on mouseout/blur/Escape, and wires aria-describedby on
   * the trigger while visible rather than relying on the native title attribute
   * (which is inconsistently exposed to assistive tech and can't be styled).
   *
   * Idempotent: calling this more than once on the same document is a no-op
   * after the first call, returning the same controller. This does not replace
   * existing title="" attributes anywhere in the app - it's additive
   * infrastructure for new/updated UI that wants a styled, accessible tooltip.
   */
  function initTooltips(options) {
    const settings = options || {};
    const doc = settings.document || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.addEventListener !== 'function') return { destroy: function noopDestroy() {} };
    if (doc.__martaiTooltips) return doc.__martaiTooltips;

    let bubble = null;
    let currentTarget = null;
    let hideTimer = null;

    function ensureBubble() {
      if (bubble) return bubble;
      bubble = doc.createElement('div');
      bubble.className = 'ui-tooltip';
      bubble.setAttribute('role', 'tooltip');
      bubble.id = uniqueId('tooltip');
      bubble.hidden = true;
      (doc.body || doc.documentElement).appendChild(bubble);
      return bubble;
    }

    function place(target, el) {
      const rect = target.getBoundingClientRect();
      const gap = 8;
      const viewportWidth = doc.documentElement.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0);
      let top = rect.top - el.offsetHeight - gap;
      if (top < gap) top = rect.bottom + gap;
      let left = rect.left + (rect.width - el.offsetWidth) / 2;
      left = Math.max(gap, Math.min(left, viewportWidth - el.offsetWidth - gap));
      el.style.top = top + 'px';
      el.style.left = left + 'px';
    }

    function show(target) {
      const text = target.getAttribute('data-tooltip');
      if (!text) return;
      if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
      currentTarget = target;
      const el = ensureBubble();
      el.textContent = text;
      el.hidden = false;
      el.classList.remove('is-visible');
      place(target, el);
      target.setAttribute('aria-describedby', el.id);
      const scheduleFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (cb) { setTimeout(cb, 0); };
      scheduleFrame(function revealTooltip() { if (currentTarget === target) el.classList.add('is-visible'); });
    }

    function hide(target) {
      if (target && target !== currentTarget) return;
      if (!bubble) return;
      bubble.classList.remove('is-visible');
      if (currentTarget && typeof currentTarget.removeAttribute === 'function') currentTarget.removeAttribute('aria-describedby');
      currentTarget = null;
      hideTimer = setTimeout(function finishHide() { if (bubble) bubble.hidden = true; }, 120);
    }

    function targetOf(event) {
      return event && event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-tooltip]') : null;
    }
    function onShowEvent(event) { const target = targetOf(event); if (target) show(target); }
    function onHideEvent(event) { const target = targetOf(event); if (target) hide(target); }
    function onKeydown(event) { if (event && event.key === 'Escape' && currentTarget) hide(currentTarget); }

    doc.addEventListener('mouseover', onShowEvent);
    doc.addEventListener('mouseout', onHideEvent);
    doc.addEventListener('focusin', onShowEvent);
    doc.addEventListener('focusout', onHideEvent);
    doc.addEventListener('keydown', onKeydown);

    const controller = {
      destroy: function destroy() {
        doc.removeEventListener('mouseover', onShowEvent);
        doc.removeEventListener('mouseout', onHideEvent);
        doc.removeEventListener('focusin', onShowEvent);
        doc.removeEventListener('focusout', onHideEvent);
        doc.removeEventListener('keydown', onKeydown);
        if (bubble) removeElement(bubble);
        bubble = null;
        doc.__martaiTooltips = null;
      }
    };
    doc.__martaiTooltips = controller;
    return controller;
  }

  /*
   * Generic accessible confirmation dialog for dangerous/financial actions.
   * Builds its markup on the fly (matching the existing .modal-backdrop/.modal
   * convention) and layers on createDialog's focus-trap/Escape/backdrop-close.
   * Resolves a promise instead of taking a callback so call sites read as
   * `const result = await UI.confirmAction({...}); if (!result.confirmed) return;`
   *
   * options:
   *   title, body, impact (all plain text, auto-escaped)
   *   confirmLabel, cancelLabel
   *   danger: true -> red confirm button, for destructive/irreversible actions
   *   requireReason: true -> adds a required reason textarea (financial-safety rule)
   *   reasonPlaceholder
   *   requireTypedConfirmation: a string the user must type verbatim to enable
   *     confirming (for highly destructive actions) - omit to skip this step
   *   trigger: element to restore focus to on close (defaults to the active element)
   *
   * resolves: { confirmed: boolean, reason: string, typed: string }
   */
  function confirmAction(options) {
    const settings = options || {};
    const doc = elementDocument(settings.container, settings.document) || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.createElement !== 'function') {
      return Promise.resolve({ confirmed: false, reason: '', typed: '' });
    }

    const danger = settings.danger === true;
    const requireReason = settings.requireReason === true;
    const requiredPhrase = settings.requireTypedConfirmation ? String(settings.requireTypedConfirmation) : '';
    const titleId = uniqueId('confirm-title');
    const descId = uniqueId('confirm-desc');

    const backdrop = doc.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<form class="modal glass" novalidate>' +
        '<div class="modal-title" id="' + titleId + '">' + escapeHtml(settings.title || 'Confirm action') + '</div>' +
        '<p class="small" id="' + descId + '">' + escapeHtml(settings.body || 'Are you sure you want to continue?') + '</p>' +
        (settings.impact ? '<p class="small" style="opacity:.75">' + escapeHtml(settings.impact) + '</p>' : '') +
        (requireReason
          ? '<div class="field"><label>Reason<span> Required</span></label><textarea class="textarea" data-confirm-reason required placeholder="' + escapeHtml(settings.reasonPlaceholder || 'Explain why this action is needed…') + '"></textarea></div>'
          : '') +
        (requiredPhrase
          ? '<div class="field"><label>Type "' + escapeHtml(requiredPhrase) + '" to confirm</label><input class="input" data-confirm-typed autocomplete="off" required></div>'
          : '') +
        '<div class="modal-actions">' +
          '<button class="btn btn-soft" type="button" data-dialog-close>' + escapeHtml(settings.cancelLabel || 'Cancel') + '</button>' +
          '<button class="btn ' + (danger ? 'btn-red' : 'btn-primary') + '" type="submit">' + escapeHtml(settings.confirmLabel || 'Confirm') + '</button>' +
        '</div>' +
      '</form>';

    const panel = backdrop.querySelector('form');
    panel.setAttribute('aria-labelledby', titleId);
    panel.setAttribute('aria-describedby', descId);

    const parent = resolveElement(settings.container, doc) || doc.body || doc.documentElement;
    if (!parent || typeof parent.appendChild !== 'function') return Promise.resolve({ confirmed: false, reason: '', typed: '' });
    parent.appendChild(backdrop);

    return new Promise(function executor(resolve) {
      let pending = { confirmed: false, reason: '', typed: '' };
      const dialog = createDialog(backdrop, {
        hideOnClose: true,
        label: settings.title || undefined,
        onClose: function onClose() {
          removeElement(backdrop);
          resolve(pending);
        }
      });

      panel.addEventListener('submit', function onSubmit(event) {
        event.preventDefault();
        const reasonEl = panel.querySelector('[data-confirm-reason]');
        const typedEl = panel.querySelector('[data-confirm-typed]');
        const reason = reasonEl ? String(reasonEl.value || '').trim() : '';
        const typed = typedEl ? String(typedEl.value || '').trim() : '';

        if (requireReason && !reason) {
          if (reasonEl) { focusElement(reasonEl); if (typeof reasonEl.reportValidity === 'function') reasonEl.reportValidity(); }
          return;
        }
        if (requiredPhrase && typed !== requiredPhrase) {
          if (typedEl) {
            if (typeof typedEl.setCustomValidity === 'function') typedEl.setCustomValidity('Type "' + requiredPhrase + '" exactly to continue.');
            if (typeof typedEl.reportValidity === 'function') typedEl.reportValidity();
            focusElement(typedEl);
          }
          return;
        }
        pending = { confirmed: true, reason: reason, typed: typed };
        dialog.close('confirm');
      });

      const typedInput = panel.querySelector('[data-confirm-typed]');
      if (typedInput && typeof typedInput.addEventListener === 'function') {
        typedInput.addEventListener('input', function clearCustomError() {
          if (typeof typedInput.setCustomValidity === 'function') typedInput.setCustomValidity('');
        });
      }

      dialog.open(settings.trigger);
    });
  }

  return Object.freeze({
    announce: announce,
    confirmAction: confirmAction,
    createDialog: createDialog,
    createTabs: createTabs,
    debounce: debounce,
    escapeAttribute: escapeHtml,
    escapeHtml: escapeHtml,
    focusableElements: focusableElements,
    initTooltips: initTooltips,
    toast: toast
  });
});
