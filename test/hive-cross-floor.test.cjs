'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: { app: { getPath: () => os.tmpdir() } }
};

const { PersistStore } = loadTs('src/main/db.ts');
const { ProjectRegistry } = loadTs('src/main/projectRegistry.ts');
const { formatFloorAddress } = loadTs('src/shared/floorAddress.ts');
const { BuiltinAgentHost } = loadTs('src/main/builtinAgentHost.ts');

async function twoFloors(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-xfloor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const persist = new PersistStore(path.join(root, 'harness.db'));
  persist.open();
  t.after(() => persist.close());
  const registry = new ProjectRegistry({ persist, getHarnessHome: () => root });
  const a = await registry.createProject({
    name: 'Floor A',
    roles: [{ character: 'michael', asGod: true }, { character: 'jim' }]
  });
  const b = await registry.createProject({
    name: 'Floor B',
    roles: [{ character: 'angela', asGod: true }, { character: 'oscar' }],
    activate: false
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  return { root, persist, registry, a: a.project, b: b.project };
}

test('floor: address delivers into the other hive without switching the active floor', async (t) => {
  const { registry, a, b } = await twoFloors(t);
  const src = registry.getProject(a.projectId);
  const dest = registry.getProject(b.projectId);
  src.send(
    { to: formatFloorAddress(b.projectId, 'oscar'), act: 'request', subject: 'need numbers', body: 'Q3' },
    'jim'
  );
  const inbox = dest.inbox('oscar');
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].subject, 'need numbers');
  assert.equal(inbox[0].from, formatFloorAddress(a.projectId, 'jim'));
  assert.equal(registry.getActiveProjectId(), a.projectId);
});

test('floor:.../god resolves to the target floor\'s current orchestrator', async (t) => {
  const { registry, a, b } = await twoFloors(t);
  const src = registry.getProject(a.projectId);
  const dest = registry.getProject(b.projectId);
  src.send(
    { to: formatFloorAddress(b.projectId, 'god'), act: 'inform', subject: 'heads up', body: 'hi' },
    'human'
  );
  assert.equal(dest.inbox('god').length, 1);
  assert.equal(dest.inbox('oscar').length, 0);
});

test('unknown floor bounces to the sending floor\'s god', async (t) => {
  const { registry, a } = await twoFloors(t);
  const src = registry.getProject(a.projectId);
  src.send(
    { to: formatFloorAddress('missing-floor', 'jim'), act: 'request', subject: 'lost', body: 'x' },
    'jim'
  );
  const bounced = src.inbox('god');
  assert.equal(bounced.length, 1);
  assert.match(bounced[0].subject, /undeliverable/);
});

test('builtin host drains inbox and replies without a PTY', async (t) => {
  const { registry, a } = await twoFloors(t);
  const hive = registry.getProject(a.projectId);
  await hive.ensureAgent({
    id: 'creed',
    name: 'Creed',
    cwd: path.dirname(hive.root()),
    provider: 'builtin'
  });
  hive.send({ to: 'creed', act: 'request', subject: 'cover the phones', body: 'please' }, 'god');
  const host = new BuiltinAgentHost({
    listHives: () => [hive],
    occupancy: () => 'local'
  });
  const n = await host.tick();
  assert.equal(n, 1);
  assert.equal(hive.inbox('creed').length, 0);
  const reply = hive.inbox('god');
  assert.equal(reply.length, 1);
  assert.equal(reply[0].act, 'done');
  assert.match(reply[0].body, /built-in office agent/i);
});
