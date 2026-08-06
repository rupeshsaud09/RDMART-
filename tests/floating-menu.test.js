'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../martai_final/assets/martai-ui.js');

const root = path.join(__dirname, '..', 'martai_final');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('floating placement aligns to the trigger end and shifts inside the viewport', function () {
  const position = UI.computeFloatingPosition(
    { left: 980, right: 1020, top: 20, bottom: 52 },
    { width: 220, height: 150 },
    { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0 },
    { align: 'end', gap: 8, margin: 8 }
  );
  assert.equal(position.left, 796);
  assert.equal(position.top, 60);
  assert.equal(position.placement, 'bottom-end');
});

test('floating placement flips above when the lower viewport has insufficient room', function () {
  const position = UI.computeFloatingPosition(
    { left: 700, right: 740, top: 530, bottom: 562 },
    { width: 210, height: 180 },
    { width: 800, height: 600, offsetLeft: 0, offsetTop: 0 },
    { align: 'end', gap: 8, margin: 8 }
  );
  assert.equal(position.left, 530);
  assert.equal(position.top, 342);
  assert.equal(position.placement, 'top-end');
});

test('cheque and reusable dropdowns are wired to the body portal controller', function () {
  const dashboard = read('dashboard.html');
  const css = read('assets/martai.css');
  const ui = read('assets/martai-ui.js');
  assert.match(dashboard, /id="chequePageMenuBtn"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  assert.match(dashboard, /id="chequePageMenu" role="menu"/);
  assert.match(dashboard, /dropdown\('chequePageMenuBtn','chequePageMenu'\)/);
  assert.match(dashboard, /UI\.createFloatingMenu\(summary,menu/);
  assert.match(ui, /portal\.appendChild\(menu\)/);
  assert.match(ui, /visualViewport/);
  assert.match(ui, /handleOutsidePointer/);
  assert.match(css, /body>\.ui-floating-menu\{[\s\S]*position:fixed!important/);
  assert.match(css, /z-index:9999!important/);
  assert.match(css, /transition:opacity 180ms ease-out,transform 180ms ease-out/);
});

test('cheque dates are manual and dialogs are portalled above page scrolling', function () {
  const dashboard = read('dashboard.html');
  assert.match(dashboard, /name="chequeDate"[^>]+data-manual-date[^>]+placeholder="Select Nepali date"/);
  assert.match(dashboard, /setTodayInputs\(\)[\s\S]*?!i\.hasAttribute\('data-manual-date'\)/);
  assert.match(dashboard, /Select the cheque date before saving\./);
  assert.match(dashboard, /document\.body\.appendChild\(root\)/);
});
