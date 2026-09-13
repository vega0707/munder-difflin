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
      calls.runs.push({ sessionId, prompt, model: opts?.model });
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
