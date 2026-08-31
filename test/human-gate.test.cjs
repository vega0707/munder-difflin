'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { ControlRegistry } = loadTs('src/main/control.ts');
const {
  agentsAwaitingHuman,
  syncAwaitingHuman,
  taskWaitsOnHuman
} = loadTs('src/main/humanGate.ts');

test('awaitingHuman denies tools and survives resume()', () => {
  const control = new ControlRegistry();
  control.setAwaitingHuman('dev1', true);
  assert.equal(control.isAwaitingHuman('dev1'), true);
  assert.equal(control.snapshot('dev1').awaitingHuman, true);

  const d = control.toolDecision('dev1', 'Bash');
  assert.equal(d.deny, true);
  assert.match(d.reason ?? '', /Ask Me/);

  control.resume('dev1');
  assert.equal(control.isAwaitingHuman('dev1'), true, 'resume must not clear Ask Me gate');
  assert.equal(control.toolDecision('dev1', 'Bash').deny, true);

  control.setAwaitingHuman('dev1', false);
  assert.equal(control.toolDecision('dev1', 'Bash').deny, false);
});

test('taskWaitsOnHuman requires blocked + open ask', () => {
  assert.equal(taskWaitsOnHuman({ status: 'blocked', humanQA: [{ q: 'need key' }] }), true);
  assert.equal(taskWaitsOnHuman({ status: 'doing', humanQA: [{ q: 'need key' }] }), false);
  assert.equal(taskWaitsOnHuman({ status: 'blocked', humanQA: [{ q: 'need key', a: 'done' }] }), false);
  assert.equal(taskWaitsOnHuman({ status: 'blocked', humanQA: [{ q: 'need key', dismissedAt: 't' }] }), false);
});

test('syncAwaitingHuman sets and clears per agent', () => {
  const control = new ControlRegistry();
  control.setAwaitingHuman('old', true);
  syncAwaitingHuman(control, new Set(['dev2']), ['old', 'dev2', 'dev3']);
  assert.equal(control.isAwaitingHuman('old'), false);
  assert.equal(control.isAwaitingHuman('dev2'), true);
  assert.equal(control.isAwaitingHuman('dev3'), false);
});

test('agentsAwaitingHuman collects assignees', () => {
  const set = agentsAwaitingHuman([
    { status: 'blocked', assignee: 'pam', humanQA: [{ q: 'ok?' }] },
    { status: 'blocked', assignee: 'jim', humanQA: [{ q: 'x', a: 'y' }] },
    { status: 'todo', assignee: 'dwight', humanQA: [{ q: 'z' }] }
  ]);
  assert.deepEqual([...set], ['pam']);
});
