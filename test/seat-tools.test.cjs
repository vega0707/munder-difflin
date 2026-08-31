'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  parseSeatAllowlist,
  seatMcpEnabledMap,
  seatSkillAllowed
} = loadTs('src/shared/seatTools.ts');

test('parseSeatAllowlist trims and dedups', () => {
  assert.equal(parseSeatAllowlist(undefined), undefined);
  assert.deepEqual(parseSeatAllowlist([' fetch ', 'time', 'fetch']), ['fetch', 'time']);
  assert.deepEqual(parseSeatAllowlist([]), []);
});

test('seatMcpEnabledMap inherits floor when seat omit', () => {
  const map = seatMcpEnabledMap(
    { fetch: { enabled: true }, git: { enabled: false } },
    ['fetch', 'git', 'time'],
    (id) => id === 'time',
    undefined
  );
  assert.equal(map.fetch.enabled, true);
  assert.equal(map.git.enabled, false);
  assert.equal(map.time.enabled, true);
});

test('seatMcpEnabledMap intersects allowlist with floor', () => {
  const map = seatMcpEnabledMap(
    { fetch: { enabled: true }, time: { enabled: true } },
    ['fetch', 'time', 'git'],
    () => false,
    ['fetch']
  );
  assert.equal(map.fetch.enabled, true);
  assert.equal(map.time.enabled, false);
  assert.equal(map.git.enabled, false);
});

test('seatSkillAllowed', () => {
  assert.equal(seatSkillAllowed('today', undefined), true);
  assert.equal(seatSkillAllowed('today', []), false);
  assert.equal(seatSkillAllowed('today', ['today', 'yesterday']), true);
  assert.equal(seatSkillAllowed('temporal', ['today']), false);
});
