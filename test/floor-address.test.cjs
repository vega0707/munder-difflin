'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  parseFloorAddress,
  formatFloorAddress,
  isFloorAddress,
  stampFloorFrom
} = loadTs('src/shared/floorAddress.ts');

test('parseFloorAddress reads floor:<projectId>/<agentId>', () => {
  const addr = parseFloorAddress('floor:11111111-2222-3333-4444-555555555555/jim');
  assert.deepEqual(addr, {
    projectId: '11111111-2222-3333-4444-555555555555',
    agentId: 'jim'
  });
});

test('parseFloorAddress accepts god as the agent id', () => {
  const addr = parseFloorAddress('floor:default/god');
  assert.deepEqual(addr, { projectId: 'default', agentId: 'god' });
});

test('parseFloorAddress rejects local ids and missing pieces', () => {
  assert.equal(parseFloorAddress('jim'), null);
  assert.equal(parseFloorAddress('floor:/jim'), null);
  assert.equal(parseFloorAddress('floor:abc/'), null);
  assert.equal(parseFloorAddress('floor:abc'), null);
  assert.equal(isFloorAddress('god'), false);
  assert.equal(isFloorAddress('floor:abc/jim'), true);
});

test('stampFloorFrom does not double-wrap an existing floor address', () => {
  assert.equal(stampFloorFrom('p1', 'jim'), 'floor:p1/jim');
  assert.equal(stampFloorFrom('p1', 'floor:p2/pam'), 'floor:p2/pam');
  assert.equal(formatFloorAddress('p1', 'god'), 'floor:p1/god');
});
