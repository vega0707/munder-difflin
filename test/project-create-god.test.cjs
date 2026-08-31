'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  assertCreateProjectRoles,
  canSubmitCreateProject,
  toggleCreateRole
} = loadTs('src/shared/projectTypes.ts');

test('create project rejects an empty role list', () => {
  assert.throws(
    () => assertCreateProjectRoles([]),
    (err) => err && err.code === 'GOD_REQUIRED'
  );
  assert.equal(canSubmitCreateProject([]), false);
});

test('create project rejects roles with nobody marked as god', () => {
  assert.throws(
    () => assertCreateProjectRoles([{ character: 'jim' }, { character: 'pam' }]),
    (err) => err && err.code === 'GOD_REQUIRED'
  );
  assert.equal(canSubmitCreateProject([{ character: 'jim' }]), false);
});

test('create project rejects an unknown character', () => {
  assert.throws(
    () => assertCreateProjectRoles([{ character: 'not-a-cast-member', asGod: true }]),
    (err) => err && err.code === 'GOD_REQUIRED'
  );
});

test('create project accepts one god and optional extra workers', () => {
  const parsed = assertCreateProjectRoles([
    { character: 'dwight', asGod: true, title: 'Lead' },
    { character: 'jim', title: 'Sales' },
    { character: 'pam' }
  ]);
  assert.equal(parsed.godCharacter, 'dwight');
  assert.deepEqual(parsed.extraCharacters, ['jim', 'pam']);
  assert.equal(parsed.godName, 'Dwight');
  assert.equal(parsed.roles[0].title, 'Lead');
  assert.equal(parsed.roles[1].title, 'Sales');
  assert.equal(canSubmitCreateProject([{ character: 'dwight', asGod: true }]), true);
});

test('create project refuses two gods — hive has one orchestrator', () => {
  assert.throws(
    () => assertCreateProjectRoles([
      { character: 'michael', asGod: true },
      { character: 'jim', asGod: true }
    ]),
    (err) => err && err.code === 'TOO_MANY_GODS'
  );
});

test('toggleCreateRole picks a god when none is selected yet', () => {
  const next = toggleCreateRole([], 'pam');
  assert.deepEqual(next, [{ character: 'pam', asGod: true }]);
});

test('toggleCreateRole adding a second character keeps the existing god', () => {
  const next = toggleCreateRole([{ character: 'pam', asGod: true }], 'jim');
  assert.equal(next.find((r) => r.character === 'pam').asGod, true);
  assert.equal(next.find((r) => r.character === 'jim').asGod, false);
});

test('toggleCreateRole removing the god promotes the first remaining role', () => {
  const next = toggleCreateRole(
    [{ character: 'pam', asGod: true }, { character: 'jim' }],
    'pam'
  );
  assert.deepEqual(next, [{ character: 'jim', asGod: true }]);
});
