'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { shouldAutoselectCtrip } = loadTs('src/main/freeflow.ts');

test('token + groq + !flag → autoselect', () => {
  assert.equal(
    shouldAutoselectCtrip({ freeflowProvider: 'groq', freeflowCtripAutoselected: false }, true),
    true
  );
});

test('token + null provider + !flag → autoselect', () => {
  assert.equal(
    shouldAutoselectCtrip({ freeflowProvider: undefined, freeflowCtripAutoselected: false }, true),
    true
  );
});

test('siliconflow → no autoselect', () => {
  assert.equal(
    shouldAutoselectCtrip({ freeflowProvider: 'siliconflow', freeflowCtripAutoselected: false }, true),
    false
  );
});

test('ctrip already selected → no autoselect', () => {
  assert.equal(
    shouldAutoselectCtrip({ freeflowProvider: 'ctrip', freeflowCtripAutoselected: false }, true),
    false
  );
});

test('flag already set → no autoselect', () => {
  assert.equal(
    shouldAutoselectCtrip({ freeflowProvider: 'groq', freeflowCtripAutoselected: true }, true),
    false
  );
});

test('no token → no autoselect', () => {
  assert.equal(
    shouldAutoselectCtrip({ freeflowProvider: 'groq', freeflowCtripAutoselected: false }, false),
    false
  );
});
