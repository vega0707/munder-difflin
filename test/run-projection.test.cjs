'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const runFlow = loadTs('src/shared/runFlow.ts');
const { RunProjectionStore } = loadTs('src/main/runProjection.ts');

const {
  buildStepsFromTasks,
  syncRunStepsFromTasks,
  computeDefaultView,
  createRunFromRequest,
  prepareRetry,
  deriveRunStatus,
  markStepFailed,
  clearRetryLatch
} = runFlow;

function card(id, extra = {}) {
  return {
    id,
    title: id,
    status: 'todo',
    dependsOn: [],
    createdAt: '2026-08-31T08:00:00.000Z',
    ...extra
  };
}

test('empty store lists no runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-run-'));
  const store = new RunProjectionStore(() => dir);
  assert.deepEqual(store.list(), []);
  assert.equal(computeDefaultView([]).mode, 'empty');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dependsOn chain yields ordered steps one task each', () => {
  const tasks = [
    card('b', { dependsOn: ['a'], status: 'doing' }),
    card('a', { status: 'done' })
  ];
  const steps = buildStepsFromTasks(tasks, ['a', 'b'], 'plan');
  assert.deepEqual(steps.map((s) => s.taskId), ['a', 'b']);
  assert.equal(steps[0].source, 'plan');
  assert.equal(steps[1].status, 'running');
});

test('hybrid keeps source tags when syncing', () => {
  const run = createRunFromRequest('conv-1', 'Demo', 'msg-1', () => 1, () => 'abc');
  run.steps = [{ taskId: 'a', status: 'pending', source: 'plan', title: 'a' }];
  const synced = syncRunStepsFromTasks(run, [card('a', { status: 'done' })]);
  assert.equal(synced.steps[0].source, 'plan');
  assert.equal(synced.status, 'success');
});

test('default view: single in-flight, overview when >=2, ended when none', () => {
  const r1 = { ...createRunFromRequest('c1', 'A', undefined, () => 1, () => 'a'), status: 'in_progress' };
  const r2 = { ...createRunFromRequest('c2', 'B', undefined, () => 2, () => 'b'), status: 'in_progress' };
  const ended = { ...r1, id: 'e1', status: 'success', endedAt: '2026-08-31T09:00:00.000Z' };
  assert.equal(computeDefaultView([r1]).mode, 'single');
  assert.equal(computeDefaultView([r1, r2]).mode, 'overview');
  assert.equal(computeDefaultView([ended]).mode, 'ended');
});

test('durable reload preserves runs on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-run-'));
  const store = new RunProjectionStore(() => dir);
  const run = createRunFromRequest('conv-x', 'Persist', undefined, () => 3, () => 'x');
  store.upsertRun(run);
  const again = new RunProjectionStore(() => dir);
  assert.equal(again.list().length, 1);
  assert.equal(again.get(run.id)?.conversation, 'conv-x');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('failure preserves completed steps', () => {
  let run = createRunFromRequest('c', 'Fail demo', undefined, () => 4, () => 'f');
  run.steps = [
    { taskId: 'a', status: 'done', source: 'plan', title: 'a' },
    { taskId: 'b', status: 'running', source: 'plan', title: 'b' }
  ];
  run = markStepFailed(run, 'b');
  assert.equal(run.status, 'failed');
  assert.equal(run.steps[0].status, 'done');
  assert.equal(run.failedStepIndex, 1);
});

test('retry from failed step onward resets tail only and uses latch', () => {
  let run = createRunFromRequest('c', 'Retry', undefined, () => 5, () => 'r');
  run.steps = [
    { taskId: 'a', status: 'done', source: 'plan', title: 'a' },
    { taskId: 'b', status: 'failed', source: 'plan', title: 'b' },
    { taskId: 'c', status: 'pending', source: 'plan', title: 'c' }
  ];
  run = deriveRunStatus(run);
  const prep = prepareRetry(run);
  assert.equal(prep.ok, true);
  if (!prep.ok) return;
  assert.deepEqual(prep.taskIdsToReset, ['b', 'c']);
  assert.equal(prep.run.retryInFlight, true);
  assert.equal(prep.run.steps[0].status, 'done');
  assert.equal(prep.run.steps[1].status, 'pending');
  const again = prepareRetry(prep.run);
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.error, 'retry-in-flight');
  clearRetryLatch(prep.run);
});

test('rebuild from tasks realigns drifted steps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-run-'));
  const store = new RunProjectionStore(() => dir);
  const run = createRunFromRequest('conv-r', 'Rebuild', undefined, () => 6, () => 'z');
  run.steps = [{ taskId: 'ghost', status: 'pending', source: 'auto', title: 'ghost' }];
  store.upsertRun(run);
  store.syncFromTasks([
    card('real', { runId: run.id, status: 'doing' })
  ]);
  const got = store.get(run.id);
  assert.ok(got.steps.some((s) => s.taskId === 'real'));
  assert.ok(!got.steps.some((s) => s.taskId === 'ghost'));
  fs.rmSync(dir, { recursive: true, force: true });
});
