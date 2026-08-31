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
    roles: [
      { character: 'dwight', asGod: true },
      { character: 'jim' },
      { character: 'pam' }
    ],
    cwd: home
  });
  const reg = hive.registry();
  assert.equal(reg.godId, 'god');
  assert.equal(reg.agents.god.isGod, true);
  assert.equal(reg.agents.god.name, 'Dwight');
  assert.equal(reg.agents.god.provider, 'builtin');
  assert.equal(!!reg.agents.jim.isGod, false);
  assert.equal(reg.agents.jim.provider, 'builtin');
  assert.equal(reg.agents.pam.name, 'Pam');
  assert.equal(reg.agents.pam.provider, 'builtin');
});

test('seedProjectCast god can use a CLI provider while extras stay builtin', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-seed-god-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home, undefined, 'p1');
  await seedProjectCast(hive, {
    roles: [
      { character: 'dwight', asGod: true, title: 'Tech Lead' },
      { character: 'jim', title: 'Engineer' }
    ],
    cwd: home,
    provider: 'claude'
  });
  const reg = hive.registry();
  assert.equal(reg.agents.god.provider, 'claude');
  assert.equal(reg.agents.god.role, 'Tech Lead');
  assert.equal(reg.agents.jim.provider, 'builtin');
  assert.equal(reg.agents.jim.role, 'Engineer');
});

test('seedProjectCast writes title into roster description', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-seed-title-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const projectRoot = path.join(home, 'projects', 'p1');
  fs.mkdirSync(projectRoot, { recursive: true });
  const hive = new HiveManager(() => projectRoot, undefined, 'p1');
  await seedProjectCast(hive, {
    roles: [
      { character: 'michael', asGod: true, title: '产品经理', description: '拆需求、排优先级、盯交付' },
      { character: 'oscar', title: '软件架构师', description: '定边界与关键决策' }
    ],
    cwd: projectRoot
  });
  const roster = JSON.parse(fs.readFileSync(path.join(projectRoot, 'roster.json'), 'utf8'));
  const god = roster.agents.find((a) => a.id === 'god');
  const oscar = roster.agents.find((a) => a.id === 'oscar');
  assert.equal(god.description, '拆需求、排优先级、盯交付');
  assert.equal(oscar.description, '定边界与关键决策');
  assert.equal(hive.registry().agents.god.role, '产品经理');
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
  assert.equal(reg.agents.god.provider, 'builtin');
  assert.equal(reg.agents.oscar.name, 'Oscar');
  assert.equal(reg.agents.oscar.provider, 'builtin');
  persist.close();
});
