'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('root npm start always serves the martai_final application', function () {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts.start, 'node martai_final/server.js');
  assert.equal(packageJson.scripts.dev, packageJson.scripts.start);
});

test('localhost server disables caching and identifies its source release', function () {
  const server = read('martai_final/server.js');
  assert.match(server, /const root = __dirname/);
  assert.match(server, /no-store, no-cache, must-revalidate/);
  assert.match(server, /X-Khata-Local-Release/);
  assert.match(server, /\/__khata_local\.json/);
});

test('localhost removes production service workers and MartAI caches', function () {
  const store = read('martai_final/assets/martai-store.js');
  assert.match(store, /location\.hostname==='localhost'/);
  assert.match(store, /location\.hostname==='127\.0\.0\.1'/);
  assert.match(store, /registration=>registration\.unregister\(\)/);
  assert.match(store, /key=>key\.startsWith\('martai-'\)/);
  assert.match(store, /setTimeout\(\(\)=>clearCaches\(\).*750\)/);
  assert.match(read('martai_final/dashboard.html'), /martai-store\.js\?v=36/);
});
