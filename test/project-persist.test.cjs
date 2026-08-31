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

const { MAX_ACTIVE_AGENTS, PROJECT_CHANNELS, canDeleteProject, wouldExceedActiveLimit, resolveMaxActiveAgents } = loadTs('src/shared/projectTypes.ts');
const { PersistStore } = loadTs('src/main/db.ts');

test('MAX_ACTIVE_AGENTS default is 5 and resolveMaxActiveAgents clamps', () => {
  assert.equal(MAX_ACTIVE_AGENTS, 5);
  assert.equal(resolveMaxActiveAgents(undefined), 5);
  assert.equal(resolveMaxActiveAgents(0), 1);
  assert.equal(resolveMaxActiveAgents(99), 32);
  assert.equal(resolveMaxActiveAgents(7), 7);
});

test('project channel names stay project:*', () => {
  assert.equal(PROJECT_CHANNELS.LIST, 'project:list');
  assert.equal(PROJECT_CHANNELS.CREATE, 'project:create');
});

test('canDeleteProject is false for a single project', () => {
  assert.equal(canDeleteProject([{ projectId: 'default' }]), false);
  assert.equal(canDeleteProject([{ projectId: 'a' }, { projectId: 'b' }]), true);
});

test('wouldExceedActiveLimit allows leaving a full project on posix', () => {
  assert.equal(wouldExceedActiveLimit({
    platform: 'darwin',
    currentActive: 5,
    oldProjectRunning: 5,
    targetProjectSessions: 2
  }), false);
  assert.equal(wouldExceedActiveLimit({
    platform: 'darwin',
    currentActive: 0,
    oldProjectRunning: 0,
    targetProjectSessions: 6
  }), true);
  assert.equal(wouldExceedActiveLimit({
    platform: 'win32',
    currentActive: 5,
    oldProjectRunning: 3,
    targetProjectSessions: 4
  }), false);
});

test('projects table round-trips and migration is idempotent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-persist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'harness.db');

  const store = new PersistStore(dbPath);
  store.open();
  store.insertProject({
    projectId: 'default',
    name: 'Default',
    createdAt: 1,
    status: 'active',
    defaultCwd: null,
    hiveRootPath: '/tmp/projects/default/hive',
    godCharacter: 'michael'
  });
  const row = store.getProject('default');
  assert.equal(row.name, 'Default');
  assert.equal(row.status, 'active');
  assert.equal(row.hiveRootPath, '/tmp/projects/default/hive');

  store.close();
  const again = new PersistStore(dbPath);
  again.open();
  assert.equal(again.listProjects().length, 1);
  again.close();
});

test('legacy command_history rows survive adding project_id', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-persist-v1-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Database = require('better-sqlite3');
  const dbPath = path.join(dir, 'harness.db');
  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE command_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      cwd TEXT,
      text TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
  raw.exec(`INSERT INTO command_history (agent_id, cwd, text, ts) VALUES ('a1', '/tmp', 'hello', 1)`);
  raw.pragma('user_version = 1');
  raw.close();

  const store = new PersistStore(dbPath);
  store.open();
  const rows = store.listHistory('a1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'hello');
  store.insertProject({
    projectId: 'p1',
    name: 'P',
    createdAt: 2,
    status: 'active',
    defaultCwd: null,
    hiveRootPath: '/x',
    godCharacter: 'jim'
  });
  assert.equal(store.getProject('p1').name, 'P');
  store.close();
});
