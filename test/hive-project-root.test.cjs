'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { HiveManager } = loadTs('src/main/hive.ts');

test('two HiveManagers keep separate registry files', async (t) => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pa-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pb-'));
  t.after(() => {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  });
  const hiveA = new HiveManager(() => a, undefined, 'proj-a');
  const hiveB = new HiveManager(() => b, undefined, 'proj-b');
  await hiveA.ensureAgent({ id: 'aa', name: 'A', provider: 'claude', cwd: a });
  await hiveB.ensureAgent({ id: 'bb', name: 'B', provider: 'claude', cwd: b });
  assert.ok(fs.existsSync(path.join(a, 'hive', 'registry.json')));
  assert.ok(fs.existsSync(path.join(b, 'hive', 'registry.json')));
  assert.equal(hiveA.registry().agents.bb, undefined);
  assert.equal(hiveB.registry().agents.aa, undefined);
  assert.equal(hiveA.projectId, 'proj-a');
  assert.equal(hiveB.projectId, 'proj-b');
});

test('emit payloads include projectId', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pe-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const seen = [];
  const hive = new HiveManager(() => home, (_channel, payload) => {
    seen.push(payload);
    return true;
  }, 'proj-e');
  await hive.ensureAgent({ id: 'from', name: 'From', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'to', name: 'To', provider: 'claude', cwd: home });
  hive.send({ from: 'from', to: 'to', act: 'note', subject: 'hi', body: 'x' }, 'from');
  const hit = seen.find((p) => p && typeof p === 'object' && p.projectId === 'proj-e');
  assert.ok(hit, 'routed message emit should carry projectId');
});
