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

test('seedProjectCast registers exactly one god', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-seed-god-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home, undefined, 'p1');
  await seedProjectCast(hive, {
    godCharacter: 'dwight',
    godName: 'Dwight',
    extraCharacters: ['jim', 'pam'],
    cwd: home
  });
  const reg = hive.registry();
  assert.equal(reg.godId, 'god');
  assert.equal(reg.agents.god.isGod, true);
  assert.equal(reg.agents.god.name, 'Dwight');
  assert.equal(!!reg.agents.jim.isGod, false);
  assert.equal(reg.agents.pam.name, 'Pam');
});

test('createProject refuses to run without a god role', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reg-god-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const persist = new PersistStore(path.join(root, 'harness.db'));
  persist.open();
  const registry = new ProjectRegistry({
    persist,
    getHarnessHome: () => root
  });
  const res = await registry.createProject({ name: 'Acme', roles: [{ character: 'jim' }] });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'GOD_REQUIRED');
  persist.close();
});

test('createProject seeds the chosen god into the new hive', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reg-ok-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const persist = new PersistStore(path.join(root, 'harness.db'));
  persist.open();
  const registry = new ProjectRegistry({
    persist,
    getHarnessHome: () => root
  });
  const res = await registry.createProject({
    name: 'Paper',
    roles: [
      { character: 'angela', asGod: true },
      { character: 'oscar' }
    ]
  });
  assert.equal(res.ok, true);
  assert.equal(res.project.godCharacter, 'angela');
  const hiveRoot = path.join(root, 'projects', res.project.projectId);
  const hive = new HiveManager(() => hiveRoot, undefined, res.project.projectId);
  const reg = hive.registry();
  assert.equal(reg.godId, 'god');
  assert.equal(reg.agents.god.name, 'Angela');
  assert.equal(reg.agents.oscar.name, 'Oscar');
  persist.close();
});
