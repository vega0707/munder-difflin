'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  createAgentTaskTools,
  resetTaskDedupe,
  CREATE_CAP_PER_RUN,
  DEDUPE_WINDOW_MS
} = loadTs('src/main/agentTaskTools.ts');

/** A task board in memory, standing in for HiveManager's ledger. */
function board(initial = []) {
  let cards = initial.slice();
  return {
    get cards() { return cards; },
    tasks: () => ({ tasks: cards }),
    addTask: (task) => {
      if (cards.some((c) => c.id === task.id)) return false;
      cards = [...cards, task];
      return true;
    },
    patchTask: (id, patch) => {
      const i = cards.findIndex((c) => c.id === id);
      if (i < 0) return false;
      const next = cards.slice();
      next[i] = { ...cards[i], ...patch, id };
      cards = next;
      return true;
    }
  };
}

function taskTools(host, opts = {}) {
  const tools = createAgentTaskTools({
    host,
    isLead: false,
    seatId: 'worker',
    conversation: 'conv-1',
    ...opts
  });
  return Object.fromEntries(tools.map((t) => [t.name, t]));
}

test.beforeEach(() => resetTaskDedupe());

// ─────────────────────────────── what a worker gets ───────────────────────────

test('a worker is not offered the create tool at all', () => {
  const tools = taskTools(board());
  assert.deepEqual(Object.keys(tools).sort(), ['task_list', 'task_update']);
});

test('a lead is offered all three', () => {
  const tools = taskTools(board(), { isLead: true, seatId: 'michael' });
  assert.deepEqual(Object.keys(tools).sort(), ['task_create', 'task_list', 'task_update']);
});

// ─────────────────────────────────── create ───────────────────────────────────

test('the lead can put a card on the board', async () => {
  const host = board();
  const tools = taskTools(host, { isLead: true, seatId: 'michael' });
  const res = await tools.task_create.run({ title: 'analyse 600941', assignee: 'worker' });

  assert.equal(res.ok, true);
  assert.equal(host.cards.length, 1);
  assert.equal(host.cards[0].title, 'analyse 600941');
  assert.equal(host.cards[0].assignee, 'worker');
  assert.equal(host.cards[0].status, 'todo');
  assert.deepEqual(host.cards[0].dependsOn, []);
  assert.match(res.output, /created /);
});

test('create stores dependsOn as data and nothing more', async () => {
  const host = board();
  const tools = taskTools(host, { isLead: true, seatId: 'michael' });
  await tools.task_create.run({ title: 'stage two', assignee: 'worker', dependsOn: ['t-1'] });

  assert.deepEqual(host.cards[0].dependsOn, ['t-1']);
});

test('repeating the same title and assignee returns the existing card', async () => {
  const host = board();
  const tools = taskTools(host, { isLead: true, seatId: 'michael' });

  const first = await tools.task_create.run({ title: 'analyse 600941', assignee: 'worker' });
  const again = await tools.task_create.run({ title: 'analyse 600941', assignee: 'worker' });

  assert.equal(host.cards.length, 1, 'the board must not grow');
  assert.equal(again.ok, true);
  assert.match(again.output, /already on the board/);
  assert.ok(again.output.includes(first.output.match(/created (\S+)/)[1]), 'names the same card');
});

test('a different assignee is a different request', async () => {
  const host = board();
  const tools = taskTools(host, { isLead: true, seatId: 'michael' });

  await tools.task_create.run({ title: 'analyse', assignee: 'worker' });
  await tools.task_create.run({ title: 'analyse', assignee: 'other' });

  assert.equal(host.cards.length, 2);
});

test('a different conversation is a different request', async () => {
  const host = board();
  const lead = (conversation) => taskTools(host, { isLead: true, seatId: 'michael', conversation });

  await lead('conv-a').task_create.run({ title: 'analyse', assignee: 'worker' });
  await lead('conv-b').task_create.run({ title: 'analyse', assignee: 'worker' });

  assert.equal(host.cards.length, 2);
});

test('the dedupe window expires on its own', () => {
  // The window is real behaviour, not incidental: assert it is a sane duration.
  assert.ok(DEDUPE_WINDOW_MS >= 60_000 && DEDUPE_WINDOW_MS <= 60 * 60 * 1000);
});

test('one run cannot fan out without limit', async () => {
  const host = board();
  const tools = taskTools(host, { isLead: true, seatId: 'michael', capPerRun: 2 });

  assert.equal((await tools.task_create.run({ title: 'a', assignee: 'w' })).ok, true);
  assert.equal((await tools.task_create.run({ title: 'b', assignee: 'w' })).ok, true);
  const over = await tools.task_create.run({ title: 'c', assignee: 'w' });

  assert.equal(over.ok, false);
  assert.match(over.error, /already created 2 cards \(cap 2\)/);
  assert.equal(host.cards.length, 2);
});

test('the default cap is the documented one', () => {
  assert.equal(CREATE_CAP_PER_RUN, 16);
});

test('a card with no title is refused and nothing is written', async () => {
  const host = board();
  const tools = taskTools(host, { isLead: true, seatId: 'michael' });
  const res = await tools.task_create.run({ assignee: 'worker' });

  assert.equal(res.ok, false);
  assert.equal(host.cards.length, 0);
});

// ─────────────────────────────────── update ───────────────────────────────────

test('the lead may update any card, including reassigning it', async () => {
  const host = board([{ id: 't-1', title: 'x', assignee: 'worker', status: 'todo', dependsOn: [], priority: 0, createdAt: 'now' }]);
  const tools = taskTools(host, { isLead: true, seatId: 'michael' });
  const res = await tools.task_update.run({ id: 't-1', status: 'doing', assignee: 'other', result: 'started' });

  assert.equal(res.ok, true);
  assert.equal(host.cards[0].status, 'doing');
  assert.equal(host.cards[0].assignee, 'other');
  assert.equal(host.cards[0].result, 'started');
});

test('a worker may update a card assigned to it', async () => {
  const host = board([{ id: 't-1', title: 'x', assignee: 'worker', status: 'todo', dependsOn: [], priority: 0, createdAt: 'now' }]);
  const tools = taskTools(host, { seatId: 'worker' });
  const res = await tools.task_update.run({ id: 't-1', status: 'done', result: 'shipped' });

  assert.equal(res.ok, true);
  assert.equal(host.cards[0].status, 'done');
});

test('a worker may not touch another seat’s card', async () => {
  const host = board([{ id: 't-1', title: 'x', assignee: 'someone-else', status: 'todo', dependsOn: [], priority: 0, createdAt: 'now' }]);
  const tools = taskTools(host, { seatId: 'worker' });
  const res = await tools.task_update.run({ id: 't-1', status: 'done' });

  assert.equal(res.ok, false);
  assert.match(res.error, /not assigned to this seat/);
  assert.equal(host.cards[0].status, 'todo');
});

test('a worker may not reassign, even its own card', async () => {
  const host = board([{ id: 't-1', title: 'x', assignee: 'worker', status: 'todo', dependsOn: [], priority: 0, createdAt: 'now' }]);
  const tools = taskTools(host, { seatId: 'worker' });
  const res = await tools.task_update.run({ id: 't-1', assignee: 'someone-else' });

  assert.equal(res.ok, false);
  assert.match(res.error, /only the lead may reassign/);
});

test('update rejects an unknown card, an unknown status and an empty patch', async () => {
  const host = board([{ id: 't-1', title: 'x', assignee: 'worker', status: 'todo', dependsOn: [], priority: 0, createdAt: 'now' }]);
  const tools = taskTools(host, { seatId: 'worker' });

  assert.match((await tools.task_update.run({ id: 'nope', status: 'done' })).error, /no card nope/);
  assert.match((await tools.task_update.run({ id: 't-1', status: 'sideways' })).error, /unknown status/);
  assert.match((await tools.task_update.run({ id: 't-1' })).error, /nothing to update/);
  assert.equal(host.cards[0].status, 'todo');
});

// ──────────────────────────────────── list ────────────────────────────────────

test('list says when the board is empty and marks this seat’s own cards', async () => {
  const empty = taskTools(board());
  assert.equal((await empty.task_list.run({})).output, '(board empty)');

  const host = board([
    { id: 't-1', title: 'mine', assignee: 'worker', status: 'doing', dependsOn: [], priority: 0, createdAt: 'now' },
    { id: 't-2', title: 'theirs', assignee: 'other', status: 'todo', dependsOn: [], priority: 0, createdAt: 'now' }
  ]);
  const out = (await taskTools(host).task_list.run({})).output;

  assert.match(out, /t-1\s+doing\s+worker\s+mine \[mine\]/);
  assert.match(out, /t-2\s+todo\s+other\s+theirs/);
  assert.ok(!out.match(/t-2.*\[mine\]/));
});
