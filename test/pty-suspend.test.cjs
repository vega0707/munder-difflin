'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  agentPtyId,
  parseAgentPtyId,
  planProjectSuspend,
  ptyStopSignal,
  ptyContinueSignal
} = loadTs('src/shared/projectTypes.ts');

test('agentPtyId is unambiguous for UUID project ids', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const id = agentPtyId(projectId, 'god');
  assert.equal(id, 'pty:550e8400-e29b-41d4-a716-446655440000:god');
  assert.deepEqual(parseAgentPtyId(id), { projectId, agentId: 'god' });
});

test('agentPtyId keeps character-name worker ids', () => {
  const parsed = parseAgentPtyId(agentPtyId('default', 'pam-beesly'));
  assert.deepEqual(parsed, { projectId: 'default', agentId: 'pam-beesly' });
});

test('planProjectSuspend skips already-suspended sessions', () => {
  const ids = planProjectSuspend([
    { id: 'a', projectId: 'p1', suspended: false },
    { id: 'b', projectId: 'p1', suspended: true },
    { id: 'c', projectId: 'p2', suspended: false }
  ], 'p1');
  assert.deepEqual(ids, ['a']);
});

test('Windows does not send SIGSTOP/SIGCONT', () => {
  assert.equal(ptyStopSignal('win32'), null);
  assert.equal(ptyContinueSignal('win32'), null);
  assert.equal(ptyStopSignal('darwin'), 'SIGSTOP');
  assert.equal(ptyContinueSignal('linux'), 'SIGCONT');
});
