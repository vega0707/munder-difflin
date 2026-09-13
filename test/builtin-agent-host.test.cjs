'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { BuiltinAgentHost } = loadTs('src/main/builtinAgentHost.ts');

const CHANNEL = { wire: 'openai', baseUrl: 'http://gw/v1', apiKey: 'k', source: 'test' };

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'munder-host-'));
}

/** A fake HiveManager covering just what the host touches. */
function fakeHive({ cwd, inbox = [], isGod = false, provider = 'builtin' }) {
  const hivesRoot = tempWorkspace();
  const sent = [];
  const cards = [];
  let pending = inbox.slice();
  return {
    projectId: 'default',
    root: () => hivesRoot,
    sent,
    get remaining() { return pending; },
    receive: (msg) => { pending = [...pending, msg]; },
    registry: () => ({
      agents: {
        worker: { id: 'worker', name: 'Worker', provider, cwd, archived: false, isGod }
      }
    }),
    // Task ledger, so the delegation tools have somewhere to write.
    tasks: () => ({ tasks: cards }),
    addTask: (task) => {
      if (cards.some((c) => c.id === task.id)) return false;
      cards.push(task);
      return true;
    },
    patchTask: (id, patch) => {
      const card = cards.find((c) => c.id === id);
      if (!card) return false;
      Object.assign(card, patch);
      return true;
    },
    inbox: (id) => (id === 'worker' ? pending : []),
    archiveInbox: (id, msgId) => {
      pending = pending.filter((m) => m.id !== msgId);
      return true;
    },
    send: (partial, from) => {
      const msg = { id: `out-${sent.length + 1}`, ...partial, from };
      sent.push(msg);
      return msg;
    }
  };
}

const MAIL = [
  { id: 'm1', from: 'michael', to: 'worker', act: 'request', subject: 'build it', body: 'please build' }
];

function hostFor(hive, extra = {}) {
  const runs = [];
  const host = new BuiltinAgentHost({
    listHives: () => [hive],
    occupancy: () => 'local',
    // Mirror the wiring in index.ts: the seat's own cwd is its workspace.
    seatWorkspace: (_h, _id, meta) => (typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : null),
    onRun: (info) => runs.push(info),
    ...extra
  });
  return { host, runs };
}

/** A scripted model: replays the given responses in order. */
function scriptedClient(responses) {
  const calls = [];
  return {
    calls,
    respond: async (system, turns, tools) => {
      calls.push({ system, turns: turns.map((t) => `${t.role}:${t.content}`), tools: tools.map((t) => t.name) });
      const i = Math.min(calls.length - 1, responses.length - 1);
      return typeof responses[i] === 'function' ? responses[i]({ turns }) : responses[i];
    }
  };
}

// ─────────────────────────── no channel → template reply ──────────────────────

test('with no model channel the seat still answers from its template', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const { host } = hostFor(hive, { llmConfig: () => null });

  const handled = await host.tick();

  assert.equal(handled, 1);
  assert.equal(hive.sent.length, 1, 'a reply went out');
  assert.equal(hive.remaining.length, 0, 'the mail was archived');
});

test('with no seatWorkspace the model path is skipped rather than half-run', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const { host } = hostFor(hive, {
    llmConfig: () => CHANNEL,
    seatWorkspace: () => null,
    createClient: () => {
      throw new Error('the client must not be built without a workspace');
    }
  });

  assert.equal(await host.tick(), 1);
  assert.equal(hive.sent.length, 1, 'fell back to the template reply');
});

// ──────────────────────────── channel → real agent ────────────────────────────

test('with a channel the seat works the mail through its tools', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const client = scriptedClient([
    { kind: 'tool', name: 'mail_send', input: { to: 'michael', subject: 'done', body: 'built', act: 'done' } },
    { kind: 'text', text: 'replied' }
  ]);
  const { host, runs } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  assert.equal(await host.tick(), 1);

  assert.equal(hive.sent.length, 1);
  assert.equal(hive.sent[0].to, 'michael');
  assert.equal(hive.sent[0].from, 'worker');
  assert.equal(hive.sent[0].body, 'built');
  assert.equal(hive.remaining.length, 0);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].ok, true);
  assert.equal(runs[0].agentId, 'worker');
  assert.deepEqual(runs[0].toolTrace.map((t) => t.name), ['mail_send']);
});

test('the seat is given the full tool set and a task naming the sender', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const client = scriptedClient([{ kind: 'text', text: 'ok' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  await host.tick();

  // A worker gets the board read/list tools but never task_create.
  assert.deepEqual(client.calls[0].tools, [
    'fs_list', 'fs_read', 'fs_write', 'shell_run', 'mail_send', 'mail_inbox', 'task_list', 'task_update'
  ]);
});

test('the god is the one seat that can add cards', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, isGod: true });
  const client = scriptedClient([{ kind: 'text', text: 'ok' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  await host.tick();

  assert.ok(client.calls[0].tools.includes('task_create'));
});

test('a seat-assembled system prompt reaches the model', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const client = scriptedClient([{ kind: 'text', text: 'ok' }]);
  const { host } = hostFor(hive, {
    llmConfig: () => CHANNEL,
    createClient: () => client,
    systemPrompt: (_hive, _id, name) => `FLOOR MANUAL for ${name}`
  });

  await host.tick();

  assert.equal(client.calls[0].system, 'FLOOR MANUAL for Worker');
});

test('a model that forgets to send mail still gets its answer delivered', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const client = scriptedClient([{ kind: 'text', text: 'here is the result' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  await host.tick();

  assert.equal(hive.sent.length, 1);
  assert.equal(hive.sent[0].to, 'michael');
  assert.equal(hive.sent[0].body, 'here is the result');
  assert.equal(hive.sent[0].act, 'done');
  assert.equal(hive.sent[0].in_reply_to, 'm1');
});

test('a query is answered with an inform, not a done', async () => {
  const hive = fakeHive({
    cwd: tempWorkspace(),
    inbox: [{ id: 'q1', from: 'michael', to: 'worker', act: 'query', subject: 'status?', body: '?' }]
  });
  const client = scriptedClient([{ kind: 'text', text: 'still going' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  await host.tick();

  assert.equal(hive.sent[0].act, 'inform');
});

test('a dead channel degrades to the template reply instead of stalling the floor', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const client = { respond: async () => { throw new Error('gateway down'); } };
  const { host, runs } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  assert.equal(await host.tick(), 1);

  assert.equal(hive.sent.length, 1, 'the seat still answered');
  assert.equal(hive.remaining.length, 0);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].ok, false);
  assert.match(runs[0].error, /gateway down/);
});

// ──────────────────────────── chat panel path ────────────────────────────────

test('chatting with a seat returns its answer and records both turns', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const client = scriptedClient([{ kind: 'text', text: 'on it' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  const res = await host.sendTurn('default', 'worker', 'what are you doing?');

  assert.equal(res.ok, true);
  assert.equal(res.text, 'on it');
  assert.deepEqual(
    host.chatHistory('default', 'worker').map((t) => [t.role, t.content]),
    [['user', 'what are you doing?'], ['assistant', 'on it']]
  );
});

test('a later turn carries the earlier conversation', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const client = scriptedClient([{ kind: 'text', text: 'first' }, { kind: 'text', text: 'second' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  await host.sendTurn('default', 'worker', 'one');
  await host.sendTurn('default', 'worker', 'two');

  // The second call must see turn one, or the seat answers every message cold.
  assert.deepEqual(client.calls[1].turns, ['user:one', 'assistant:first', 'user:two']);
  const history = host.chatHistory('default', 'worker');
  assert.equal(history.length, 4);
  assert.deepEqual(history.map((t) => t.content), ['one', 'first', 'two', 'second']);
});

test('chat history is per seat, not per floor', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const client = scriptedClient([{ kind: 'text', text: 'x' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  await host.sendTurn('default', 'worker', 'hi');

  assert.equal(host.chatHistory('default', 'other-seat').length, 0);
  assert.equal(host.chatHistory('other-floor', 'worker').length, 0);
});

test('a seat that failed still gets its answer recorded, without a phantom reply', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const client = { respond: async () => { throw new Error('gateway down'); } };
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  const res = await host.sendTurn('default', 'worker', 'are you there?');

  assert.equal(res.ok, false);
  assert.match(res.error, /gateway down/);
  // Only the user's turn: an empty assistant bubble would read as a silent answer.
  assert.deepEqual(host.chatHistory('default', 'worker').map((t) => t.role), ['user']);
});

test('chatting on a machine with no channel explains why, in words', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const { host } = hostFor(hive, { llmConfig: () => null });

  const res = await host.sendTurn('default', 'worker', 'hi');

  assert.equal(res.ok, false);
  assert.match(res.error, /no model channel configured/);
});

test('chatting with an unknown floor or seat is refused, not thrown', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => scriptedClient([{ kind: 'text', text: 'x' }]) });

  assert.match((await host.sendTurn('nope', 'worker', 'hi')).error, /no floor nope/);
  assert.match((await host.sendTurn('default', 'nobody', 'hi')).error, /no seat nobody/);
});

test('an empty message never reaches the model', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const client = scriptedClient([{ kind: 'text', text: 'x' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  assert.equal((await host.sendTurn('default', 'worker', '   ')).ok, false);
  assert.equal(client.calls.length, 0);
});

test('a seat with no workspace cannot be chatted with', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const { host } = hostFor(hive, {
    llmConfig: () => CHANNEL,
    seatWorkspace: () => null,
    createClient: () => scriptedClient([{ kind: 'text', text: 'x' }])
  });

  assert.match((await host.sendTurn('default', 'worker', 'hi')).error, /no workspace/);
});

test('the kept transcript is bounded, so a long-lived process cannot grow without limit', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const client = scriptedClient([{ kind: 'text', text: 'ok' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  for (let i = 0; i < 40; i += 1) await host.sendTurn('default', 'worker', `msg ${i}`);

  const history = host.chatHistory('default', 'worker');
  assert.equal(history.length, 60);
  // The tail is what survives: the newest exchange is still there.
  assert.equal(history.at(-1).content, 'ok');
  assert.equal(history.at(-2).content, 'msg 39');
});


test('a 程小帮 seat is served by the same host, not skipped as a non-builtin provider', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = scriptedClient([{ kind: 'text', text: 'answered' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  assert.equal(await host.tick(), 1);
  assert.equal(hive.sent.length, 1);
  assert.equal(hive.remaining.length, 0);
});

// ────────────────────────── 程小帮 seats (run protocol) ──────────────────────

function fakeCxbClient({ fail = false, text = '程小帮的回答' } = {}) {
  const calls = { created: [], runs: [], deleted: [] };
  return {
    calls,
    createSession: async (input) => {
      calls.created.push(input);
      return { id: `s_${calls.created.length}`, providerId: 'ctrip-chat' };
    },
    run: async (sessionId, prompt, opts) => {
      calls.runs.push({ sessionId, prompt, model: opts?.model, accessMode: opts?.accessMode });
      if (fail) return { ok: false, text: '', error: 'app down', events: [] };
      return { ok: true, text, status: 'completed', runId: 'run_1', events: ['run_started', 'delta', 'run_end'] };
    },
    deleteSession: async (id) => {
      calls.deleted.push(id);
      return true;
    }
  };
}

function cbHost(hive, client, extra = {}) {
  return hostFor(hive, {
    llmConfig: () => null,
    chengxiaobang: () => client,
    ...extra
  });
}

/** A client whose run blocks until the test releases it, so mid-run control can
 *  be exercised instead of guessed at. */
function controllableCxb() {
  let release;
  const gate = new Promise((r) => { release = r; });
  let started;
  const startedPromise = new Promise((r) => { started = r; });
  const calls = { runs: [], aborted: [], steered: [], deleted: [], approved: [], reverted: [] };
  return {
    calls,
    release,
    started: startedPromise,
    createSession: async () => ({ id: 's_1' }),
    run: async (sessionId, prompt, opts) => {
      calls.runs.push({ sessionId, prompt, accessMode: opts?.accessMode });
      // The real stream announces its run id before any work happens.
      opts?.onEvent?.({ type: 'run_started', runId: 'run_1' });
      // …and a tool call that stops for permission.
      opts?.onToolCall?.({ id: 'tc_1', name: 'Shell', status: 'pending_approval' });
      started();
      await gate;
      if (opts?.signal?.aborted) return { ok: false, text: '', error: 'cancelled', events: [] };
      opts?.onToolCall?.({ id: 'tc_1', name: 'Shell', status: 'completed' });
      opts?.onEvent?.({ type: 'run_end', runId: 'run_1' });
      return {
        ok: true,
        text: 'done',
        status: 'completed',
        runId: 'run_1',
        fileChanges: [{ path: '/tmp/x/hello.txt', operation: 'write', additions: 1, deletions: 0 }],
        events: ['run_started', 'run_end']
      };
    },
    abortRun: async (runId) => { calls.aborted.push(runId); return true; },
    steer: async (runId, prompt) => {
      calls.steered.push({ runId, prompt });
      return { ok: true, accepted: true, disposition: 'next_step' };
    },
    approve: async (toolCallId, opts) => {
      calls.approved.push({ toolCallId, ...opts });
      return { ok: true, accepted: true };
    },
    revertFileChanges: async (runId, opts) => {
      calls.reverted.push({ runId, ...opts });
      return { ok: true };
    },
    deleteSession: async (id) => { calls.deleted.push(id); return true; }
  };
}

test('a seat on a run reports that it is running, and stops when asked', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = controllableCxb();
  const { host } = cbHost(hive, client);

  const ticking = host.tick();
  await client.started;

  assert.equal(host.isSeatRunning('default', 'worker'), true);
  assert.equal(host.activeRunId('default', 'worker'), 'run_1');

  assert.equal(await host.abortSeat('default', 'worker'), true);
  assert.deepEqual(client.calls.aborted, ['run_1'], 'the run endpoint is told too');

  client.release();
  await ticking;
  assert.equal(host.isSeatRunning('default', 'worker'), false, 'and the seat is idle again');
});

test('a line typed at a running seat reaches the live run', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = controllableCxb();
  const { host } = cbHost(hive, client);

  const ticking = host.tick();
  await client.started;

  const res = await host.steerSeat('default', 'worker', '换个方向');

  assert.equal(res.ok, true);
  assert.equal(res.accepted, true);
  assert.deepEqual(client.calls.steered, [{ runId: 'run_1', prompt: '换个方向' }]);

  client.release();
  await ticking;
});

test('stopping or steering a seat that is on no run says so instead of pretending', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [], provider: 'chengxiaobang' });
  const client = controllableCxb();
  const { host } = cbHost(hive, client);

  assert.equal(await host.abortSeat('default', 'worker'), false);
  assert.deepEqual(client.calls.aborted, []);
  assert.match((await host.steerSeat('default', 'worker', 'x')).error, /not on a run/);
});

test('a typed turn on a 程小帮 seat goes to 程小帮, not to our own runtime', async () => {
  // Otherwise the same seat would behave differently depending on whether the
  // work arrived as mail or as typing, and stop/steer would only reach half of it.
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [], provider: 'chengxiaobang' });
  const client = fakeCxbClient({ text: '程小帮答的' });
  const { host } = cbHost(hive, client);

  const res = await host.sendTurn('default', 'worker', '你好');

  assert.equal(res.ok, true);
  assert.equal(res.text, '程小帮答的');
  assert.equal(client.calls.runs.length, 1);
  assert.match(client.calls.runs[0].prompt, /你好/);
  assert.deepEqual(host.chatHistory('default', 'worker').map((t) => t.content), ['你好', '程小帮答的']);
});

test('without the local app a typed turn says why, rather than failing silently', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [], provider: 'chengxiaobang' });
  const { host } = hostFor(hive, { llmConfig: () => null, chengxiaobang: () => null });

  const res = await host.sendTurn('default', 'worker', '你好');

  assert.equal(res.ok, false);
  assert.match(res.error, /程小帮 is not reachable/);
});

test('a 程小帮 seat runs the mail through the app and delivers its answer', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = fakeCxbClient({ text: '分析完成了' });
  const { host } = cbHost(hive, client);

  assert.equal(await host.tick(), 1);

  assert.equal(client.calls.created.length, 1);
  assert.equal(client.calls.runs.length, 1);
  assert.equal(client.calls.runs[0].sessionId, 's_1');
  assert.match(client.calls.runs[0].prompt, /please build/);

  assert.equal(hive.sent.length, 1);
  assert.equal(hive.sent[0].to, 'michael');
  assert.equal(hive.sent[0].from, 'worker');
  assert.equal(hive.sent[0].body, '分析完成了');
  assert.equal(hive.remaining.length, 0);
});

test('the seat keeps one session across turns so the conversation is continuous', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = fakeCxbClient();
  const { host } = cbHost(hive, client);

  await host.tick();
  hive.receive({ id: 'm2', from: 'michael', to: 'worker', act: 'request', subject: 'again', body: 'more' });
  await host.tick();

  assert.equal(client.calls.created.length, 1, 'the second turn reuses the session');
  assert.deepEqual(client.calls.runs.map((r) => r.sessionId), ['s_1', 's_1']);
});

test('the floor manual rides along once, not on every message', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = fakeCxbClient();
  const { host } = cbHost(hive, client, { systemPrompt: () => 'FLOOR MANUAL' });

  await host.tick();
  hive.receive({ id: 'm2', from: 'michael', to: 'worker', act: 'request', subject: 'again', body: 'more' });
  await host.tick();

  assert.match(client.calls.runs[0].prompt, /FLOOR MANUAL/);
  assert.ok(!client.calls.runs[1].prompt.includes('FLOOR MANUAL'), 'the session already has it');
});

test('no local app leaves the seat on the template reply', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const { host } = hostFor(hive, { llmConfig: () => null, chengxiaobang: () => null });

  assert.equal(await host.tick(), 1);
  assert.equal(hive.sent.length, 1, 'the seat still answered');
  assert.equal(hive.remaining.length, 0);
});

test('a failed run falls back to the template instead of stalling the floor', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = fakeCxbClient({ fail: true });
  const { host, runs } = cbHost(hive, client);

  assert.equal(await host.tick(), 1);

  assert.equal(hive.sent.length, 1, 'the seat still answered');
  assert.equal(hive.remaining.length, 0);
  assert.equal(runs[0].ok, false);
  assert.match(runs[0].error, /app down/);
});

test('stopping the host closes the sessions it opened', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = fakeCxbClient();
  const { host } = cbHost(hive, client);

  await host.tick();
  host.stop();

  assert.deepEqual(client.calls.deleted, ['s_1'], 'leaving it behind would litter 程小帮’s own list');
});

test('a tool call waiting for permission is exposed while the run is blocked', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = controllableCxb();
  const { host } = cbHost(hive, client);

  const ticking = host.tick();
  await client.started;

  assert.deepEqual(host.pendingApprovals('default', 'worker'), [
    { id: 'tc_1', name: 'Shell', status: 'pending_approval' }
  ]);

  const res = await host.approveSeat('default', 'worker', 'tc_1', { approved: true, approvalScope: 'project' });
  assert.equal(res.ok, true);
  assert.deepEqual(client.calls.approved, [{ toolCallId: 'tc_1', approved: true, approvalScope: 'project' }]);

  client.release();
  await ticking;
  assert.deepEqual(host.pendingApprovals('default', 'worker'), [], 'nothing is pending once it is over');
});

test('a seat on no run has nothing pending to approve', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [], provider: 'chengxiaobang' });
  const { host } = cbHost(hive, controllableCxb());

  assert.deepEqual(host.pendingApprovals('default', 'worker'), []);
});

test('the last run’s file changes are remembered, and revert uses its run id', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const client = fakeCxbClient({ text: 'ok' });
  client.revertFileChanges = async (runId, opts) => {
    client.reverted = { runId, ...opts };
    return { ok: true };
  };
  // Give this run something to have changed.
  client.run = async () => ({
    ok: true,
    text: 'ok',
    runId: 'run_9',
    fileChanges: [{ path: '/tmp/x/a.txt', additions: 2, deletions: 1 }],
    events: []
  });
  const { host } = cbHost(hive, client);

  await host.tick();

  assert.deepEqual(host.lastFileChanges('default', 'worker'), [
    { path: '/tmp/x/a.txt', additions: 2, deletions: 1 }
  ]);

  const res = await host.revertSeat('default', 'worker', { direction: 'undo' });
  assert.equal(res.ok, true);
  assert.deepEqual(client.reverted, { runId: 'run_9', direction: 'undo' });
});

test('reverting a seat with no finished changes says so', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [], provider: 'chengxiaobang' });
  const { host } = cbHost(hive, controllableCxb());

  assert.deepEqual(host.lastFileChanges('default', 'worker'), []);
  assert.match((await host.revertSeat('default', 'worker', { direction: 'undo' })).error, /no finished run with file changes/);
});

test('a typed turn asks for approval mode; a mail run is left on the app default', async () => {
  // Someone typing is present to answer a gate; a run woken by mail is not, and
  // blocking it on an answer nobody can give would just stall the floor.
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [], provider: 'chengxiaobang' });
  const client = fakeCxbClient();
  const { host } = cbHost(hive, client);

  await host.sendTurn('default', 'worker', 'kettle on');
  assert.equal(client.calls.runs[0].accessMode, 'approval');

  const mailHive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL, provider: 'chengxiaobang' });
  const mailClient = fakeCxbClient();
  const { host: mailHost } = cbHost(mailHive, mailClient);
  await mailHost.tick();
  assert.equal(mailClient.calls.runs[0].accessMode, undefined);
});

// ──────────────────────────────── other guards ────────────────────────────────

test('a seat leased to another machine is left alone', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const client = scriptedClient([{ kind: 'text', text: 'x' }]);
  const { host } = hostFor(hive, {
    llmConfig: () => CHANNEL,
    createClient: () => client,
    occupancy: () => 'remote'
  });

  assert.equal(await host.tick(), 0);
  assert.equal(hive.sent.length, 0);
  assert.equal(client.calls.length, 0);
});

test('an idle seat costs no model call', async () => {
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: [] });
  const client = scriptedClient([{ kind: 'text', text: 'x' }]);
  const { host } = hostFor(hive, { llmConfig: () => CHANNEL, createClient: () => client });

  assert.equal(await host.tick(), 0);
  assert.equal(client.calls.length, 0);
});

test('the client is reused across ticks until the channel changes', async () => {
  let built = 0;
  const hive = fakeHive({ cwd: tempWorkspace(), inbox: MAIL });
  const channel = { ...CHANNEL };
  const { host } = hostFor(hive, {
    llmConfig: () => channel,
    createClient: () => {
      built += 1;
      return scriptedClient([{ kind: 'text', text: 'ok' }]);
    }
  });

  await host.tick();
  hive.receive({ id: 'm2', from: 'michael', to: 'worker', act: 'request', subject: 'again', body: 'x' });
  await host.tick();
  assert.equal(built, 1, 'same channel reuses the client');

  hive.receive({ id: 'm3', from: 'michael', to: 'worker', act: 'request', subject: 'again', body: 'x' });
  channel.baseUrl = 'http://other/v1';
  await host.tick();
  assert.equal(built, 2, 'a new channel rebuilds the client');
});
