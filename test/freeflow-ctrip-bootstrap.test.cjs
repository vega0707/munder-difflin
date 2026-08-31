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

test('loadCxbAsrTokenFromEnvFile sets CXB_ASR_TOKEN from .env.local text', () => {
  const { loadCxbAsrTokenFromEnvFile, readCxbAsrToken } = loadTs('src/main/freeflow.ts');
  const env = {};
  const ok = loadCxbAsrTokenFromEnvFile(
    '/fake/.env.local',
    env,
    () => '# comment\nFOO=bar\nCXB_ASR_TOKEN=cxb_tok_test_value_here\n'
  );
  assert.equal(ok, true);
  assert.equal(readCxbAsrToken(env), 'cxb_tok_test_value_here');
});

test('loadCxbAsrTokenFromEnvFile does not overwrite existing env', () => {
  const { loadCxbAsrTokenFromEnvFile } = loadTs('src/main/freeflow.ts');
  const env = { CXB_ASR_TOKEN: 'already' };
  const ok = loadCxbAsrTokenFromEnvFile('/fake/.env.local', env, () => 'CXB_ASR_TOKEN=new\n');
  assert.equal(ok, false);
  assert.equal(env.CXB_ASR_TOKEN, 'already');
});
