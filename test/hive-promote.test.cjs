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

const { HiveManager } = loadTs('src/main/hive.ts');
const { PersistStore } = loadTs('src/main/db.ts');
const { seedProjectCast } = loadTs('src/main/seedProjectCast.ts');
const { ProjectRegistry } = loadTs('src/main/projectRegistry.ts');

async function seededHive(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-promote-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home, undefined, 'p1');
  await seedProjectCast(hive, {
    godCharacter: 'michael',
    godName: 'Michael',
    extraCharacters: ['jim', 'pam'],
    cwd: home
  });
  return { home, hive };
}

test('promoteGod moves the orchestrator flag onto a worker', async (t) => {
  const { hive } = await seededHive(t);
  const res = hive.promoteGod('jim');
  assert.equal(res.ok, true);
  assert.equal(res.godId, 'jim');
  assert.equal(res.previousGodId, 'god');
  const reg = hive.registry();
  assert.equal(reg.godId, 'jim');
  assert.equal(reg.agents.jim.isGod, true);
  assert.equal(!!reg.agents.god.isGod, false);
  hive.send({ to: 'god', act: 'inform', subject: 'still finds the chair' }, 'pam');
  assert.equal(hive.inbox('jim').length, 1);
  assert.equal(hive.inbox('god').length, 0);
});

test('promoteGod refuses the send-only assistant', async (t) => {
  const { hive } = await seededHive(t);
  await hive.ensureAgent({
    id: 'prep', name: 'Prep', cwd: hive.root() ? path.dirname(hive.root()) : os.tmpdir(), isAssistant: true
  });
  const res = hive.promoteGod('prep');
  assert.equal(res.ok, false);
  assert.match(res.error, /assistant/);
});

test('registry.promote updates godCharacter from the roster', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reg-promote-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const persist = new PersistStore(path.join(root, 'harness.db'));
  persist.open();
  const registry = new ProjectRegistry({ persist, getHarnessHome: () => root });
  const created = await registry.createProject({
    name: 'Scranton',
    roles: [
      { character: 'michael', asGod: true },
      { character: 'jim' }
    ]
  });
  assert.equal(created.ok, true);
  const promoted = registry.promote(created.project.projectId, 'jim');
  assert.equal(promoted.ok, true);
  assert.equal(promoted.project.godCharacter, 'jim');
  assert.equal(registry.getProject(created.project.projectId).registry().godId, 'jim');
  persist.close();
});

test('spinOut opens a new floor with that character as god and stays put', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-spin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const persist = new PersistStore(path.join(root, 'harness.db'));
  persist.open();
  const registry = new ProjectRegistry({ persist, getHarnessHome: () => root });
  const created = await registry.createProject({
    name: 'Scranton',
    roles: [
      { character: 'michael', asGod: true },
      { character: 'dwight' }
    ]
  });
  const sourceId = created.project.projectId;
  const spun = await registry.spinOut({ sourceProjectId: sourceId, agentId: 'dwight' });
  assert.equal(spun.ok, true);
  assert.equal(spun.project.godCharacter, 'dwight');
  assert.notEqual(spun.project.projectId, sourceId);
  assert.equal(registry.getActiveProjectId(), sourceId, 'spin-out must not switch floors');
  const newHive = registry.getProject(spun.project.projectId);
  assert.equal(newHive.registry().agents.god.name, 'Dwight');
  assert.ok(registry.getProject(sourceId).registry().agents.dwight, 'source floor keeps Dwight');
  persist.close();
});
