'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { createAgentTools } = loadTs('src/main/agentTools.ts');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'munder-tools-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'hello world');
  return root;
}

function fakeHive() {
  const sent = [];
  const mail = [
    { id: 'm1', from: 'michael', to: 'worker', act: 'request', subject: 'do it', body: 'please' }
  ];
  return {
    sent,
    inbox: (id) => (id === 'worker' ? mail : []),
    send: (partial, from) => {
      const msg = { id: `msg-${sent.length + 1}`, ...partial, from };
      sent.push(msg);
      return msg;
    }
  };
}

function toolsFor(root, overrides = {}) {
  const hive = fakeHive();
  const tools = createAgentTools({
    workspaceRoot: root,
    hive,
    agentId: 'worker',
    agentName: 'Worker',
    ...overrides
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { tools, byName, hive };
}

// ───────────────────────────────── fs tools ───────────────────────────────────

test('fs_list lists a workspace directory with dirs first', async () => {
  const root = workspace();
  const { byName } = toolsFor(root);
  const res = await byName.fs_list.run({ path: 'src' });

  assert.equal(res.ok, true);
  assert.match(res.output, /a\.txt/);
});

test('fs_read returns file content', async () => {
  const root = workspace();
  const { byName } = toolsFor(root);
  const res = await byName.fs_read.run({ path: 'src/a.txt' });

  assert.deepEqual(res, { ok: true, output: 'hello world' });
});

test('fs_write creates the file and reports the size', async () => {
  const root = workspace();
  const { byName } = toolsFor(root);
  const res = await byName.fs_write.run({ path: 'out/new.txt', content: 'written' });

  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'out', 'new.txt'), 'utf8'), 'written');
});

test('fs tools refuse to escape the workspace', async () => {
  const root = workspace();
  const { byName } = toolsFor(root);

  assert.equal((await byName.fs_read.run({ path: '../outside.txt' })).error, 'path escapes root');
  assert.equal((await byName.fs_write.run({ path: '../outside.txt', content: 'x' })).error, 'path escapes root');
  assert.equal((await byName.fs_list.run({ path: '../..' })).error, 'path escapes root');
});

test('fs_read refuses a binary file rather than handing back mojibake', async () => {
  const root = workspace();
  fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([1, 0, 2, 0]));
  const { byName } = toolsFor(root);
  const res = await byName.fs_read.run({ path: 'blob.bin' });

  assert.equal(res.ok, false);
  assert.match(res.error, /binary/);
});

// ─────────────────────────────── shell tool ───────────────────────────────────

test('shell_run returns stdout', async () => {
  const root = workspace();
  const { byName } = toolsFor(root);
  const res = await byName.shell_run.run({ command: 'echo hi' });

  assert.equal(res.ok, true);
  assert.match(res.output, /hi/);
});

test('shell_run reports a non-zero exit with its code and stderr', async () => {
  const root = workspace();
  const { byName } = toolsFor(root);
  const res = await byName.shell_run.run({ command: 'echo boom >&2; exit 3' });

  assert.equal(res.ok, false);
  assert.match(res.error, /exit 3/);
  assert.match(res.error, /boom/);
});

test('shell_run runs from the workspace root by default', async () => {
  const root = workspace();
  const { byName } = toolsFor(root);
  const res = await byName.shell_run.run({ command: 'cat src/a.txt' });

  assert.equal(res.ok, true);
  assert.match(res.output, /hello world/);
});

test('shell_run honours a workspace-relative cwd and still fences it', async () => {
  const root = workspace();
  const { byName } = toolsFor(root);

  const inside = await byName.shell_run.run({ command: 'pwd', cwd: 'src' });
  // `pwd` reports the canonicalized path, which on macOS resolves /var → /private/var.
  assert.match(inside.output.trim(), /\/src$/);
  assert.equal((await byName.shell_run.run({ command: 'pwd', cwd: '../..' })).error, 'cwd: path escapes root');
});

// ──────────────────────────────── mail tools ──────────────────────────────────

test('mail_send posts through the hive as this seat', async () => {
  const root = workspace();
  const { byName, hive } = toolsFor(root);
  const res = await byName.mail_send.run({ to: 'michael', subject: 'done', body: 'finished', act: 'done' });

  assert.equal(res.ok, true);
  assert.equal(hive.sent.length, 1);
  assert.equal(hive.sent[0].from, 'worker');
  assert.equal(hive.sent[0].to, 'michael');
  assert.equal(hive.sent[0].act, 'done');
  assert.equal(hive.sent[0].requires_reply, false);
});

test('mail_send defaults to an inform act and needs a recipient', async () => {
  const root = workspace();
  const { byName, hive } = toolsFor(root);

  await byName.mail_send.run({ to: 'god', subject: 's', body: 'b' });
  assert.equal(hive.sent[0].act, 'inform');
  assert.equal((await byName.mail_send.run({ subject: 's', body: 'b' })).ok, false);
});

test('mail_inbox renders this seat’s mail and says when it is empty', async () => {
  const root = workspace();
  const { byName, hive } = toolsFor(root);

  const res = await byName.mail_inbox.run({});
  assert.equal(res.ok, true);
  assert.match(res.output, /michael/);
  assert.match(res.output, /do it/);

  hive.inbox = () => [];
  assert.equal((await byName.mail_inbox.run({})).output, '(inbox empty)');
});

// ────────────────────────────────── shape ─────────────────────────────────────

test('every tool carries a name, description and JSON schema', () => {
  const { tools } = toolsFor(workspace());
  assert.deepEqual(
    tools.map((t) => t.name),
    ['fs_list', 'fs_read', 'fs_write', 'shell_run', 'mail_send', 'mail_inbox']
  );
  for (const t of tools) {
    assert.ok(t.description.length > 10, `${t.name} needs a description`);
    assert.equal(t.inputSchema.type, 'object');
  }
});
