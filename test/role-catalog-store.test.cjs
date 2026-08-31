'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { listRoles, saveRole, deleteRole } = loadTs('src/main/roleCatalogStore.ts');
const { isBuiltinRoleId } = loadTs('src/shared/roleCatalog.ts');

test('listRoles includes builtins without harnessHome', () => {
  const roles = listRoles(null);
  assert.ok(roles.some((r) => r.id === 'pm'));
  assert.ok(roles.every((r) => r.builtin || r.id.startsWith('user-')));
});

test('saveRole + listRoles + deleteRole round-trip', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-roles-'));
  try {
    const saved = saveRole(home, {
      title: '合规官',
      description: '盯合规与审计',
      character: 'toby',
      source: 'ai-ui'
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(isBuiltinRoleId(saved.role.id), false);
    assert.equal(saved.role.source, 'ai-ui');

    const listed = listRoles(home);
    assert.ok(listed.some((r) => r.id === saved.role.id));

    const del = deleteRole(home, saved.role.id);
    assert.equal(del.ok, true);
    assert.equal(listRoles(home).some((r) => r.id === saved.role.id), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('cannot delete builtin roles', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-roles-'));
  try {
    assert.equal(deleteRole(home, 'pm').ok, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
