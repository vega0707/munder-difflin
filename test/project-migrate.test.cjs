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

const { DEFAULT_PROJECT_ID, LEGACY_HIVE_BACKUP, LEGACY_ROSTER_BACKUP } = loadTs('src/shared/projectTypes.ts');
const { PersistStore } = loadTs('src/main/db.ts');
const { ProjectRegistry } = loadTs('src/main/projectRegistry.ts');
const { resolveHive } = loadTs('src/main/hiveRouter.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

function openRegistry(root) {
  const persist = new PersistStore(path.join(root, 'harness.db'));
  persist.open();
  const registry = new ProjectRegistry({
    persist,
    getHarnessHome: () => root
  });
  return { persist, registry };
}

test('legacy hive is copied into projects/default and renamed aside', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-migrate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'hive', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hive', 'registry.json'), JSON.stringify({ godId: 'god', agents: {} }));
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({
    version: 1, savedAt: 't', agents: [{ id: 'god', name: 'Michael' }], archived: [], restorable: [], queues: {}, selectedId: 'god'
  }));

  const { persist, registry } = openRegistry(root);
  const result = registry.bootstrap();
  assert.equal(result.migrated, true);
  assert.equal(result.activeProjectId, DEFAULT_PROJECT_ID);
  assert.ok(fs.existsSync(path.join(root, 'projects', 'default', 'hive', 'registry.json')));
  assert.ok(fs.existsSync(path.join(root, LEGACY_HIVE_BACKUP)));
  assert.ok(fs.existsSync(path.join(root, LEGACY_ROSTER_BACKUP)));
  assert.equal(fs.existsSync(path.join(root, 'hive')), false);
  const meta = registry.getMeta(DEFAULT_PROJECT_ID);
  assert.equal(meta.name, 'Default');
  assert.equal(meta.godCharacter, 'michael');
  persist.close();
});

test('bootstrap is a no-op when there is no legacy hive and no projects', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-migrate-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { persist, registry } = openRegistry(root);
  const result = registry.bootstrap();
  assert.equal(result.migrated, false);
  assert.equal(result.activeProjectId, null);
  assert.equal(registry.listProjects().length, 0);
  persist.close();
});

test('cannot delete the last project', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-del-last-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { persist, registry } = openRegistry(root);
  const created = await registry.createProject({
    name: 'Only',
    roles: [{ character: 'jim', asGod: true }]
  });
  assert.equal(created.ok, true);
  const del = registry.deleteProject(created.project.projectId);
  assert.equal(del.ok, false);
  assert.equal(del.code, 'LAST_PROJECT');
  persist.close();
});

test('delete succeeds once a second project exists', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-del-ok-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { persist, registry } = openRegistry(root);
  const a = await registry.createProject({
    name: 'A',
    roles: [{ character: 'angela', asGod: true }]
  });
  const b = await registry.createProject({
    name: 'B',
    roles: [{ character: 'oscar', asGod: true }]
  });
  assert.equal(a.ok && b.ok, true);
  const del = registry.deleteProject(a.project.projectId);
  assert.equal(del.ok, true);
  assert.equal(registry.listProjects().length, 1);
  assert.equal(registry.getActiveProjectId(), b.project.projectId);
  persist.close();
});

test('activate refuses when resume would exceed the running-agent cap', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-resume-cap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const persist = new PersistStore(path.join(root, 'harness.db'));
  persist.open();
  const pty = {
    getActivePtyCount: () => 5,
    countProjectSessions: (id, opts) => {
      if (id === 'busy' && opts?.runningOnly) return 0;
      if (id === 'target') return 6;
      return 0;
    },
    suspendProject: () => ({ stopped: 0 }),
    resumeProject: () => ({ ok: true, resumed: 0 }),
    killProject: () => {}
  };
  const registry = new ProjectRegistry({
    persist,
    getHarnessHome: () => root,
    pty
  });
  const a = await registry.createProject({ name: 'Busy', roles: [{ character: 'dwight', asGod: true }] });
  const b = await registry.createProject({ name: 'Target', roles: [{ character: 'pam', asGod: true }] });
  assert.equal(a.ok && b.ok, true);
  // Pretend those ids are busy/target for the fake pty by mapping through real ids.
  pty.countProjectSessions = (id, opts) => {
    if (id === a.project.projectId && opts?.runningOnly) return 0;
    if (id === b.project.projectId) return 6;
    return 0;
  };
  registry.activate(a.project.projectId);
  const res = registry.activate(b.project.projectId);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'RESUME_LIMIT_REACHED');
  persist.close();
});

test('resolveHive prefers an explicit projectId then the active hive', () => {
  const fallback = { projectId: 'fallback' };
  const hives = new Map([
    ['a', { projectId: 'a' }],
    ['b', { projectId: 'b' }]
  ]);
  const registry = {
    getProject: (id) => hives.get(id),
    getActiveProjectId: () => 'b'
  };
  assert.equal(resolveHive(registry, fallback, 'a').projectId, 'a');
  assert.equal(resolveHive(registry, fallback).projectId, 'b');
  assert.equal(resolveHive(registry, fallback, 'missing').projectId, 'b');
});

test('HiveManager still exists for fallback in resolveHive', () => {
  const hive = new HiveManager(() => null, undefined, 'x');
  const registry = {
    getProject: () => undefined,
    getActiveProjectId: () => null
  };
  assert.equal(resolveHive(registry, hive), hive);
});
