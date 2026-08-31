'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  BUILTIN_PROJECT_TEMPLATES,
  CUSTOM_TEMPLATE_ID,
  rolesFromTemplate,
  parseUserTemplateDraft,
  mergeTemplates,
  isBuiltinTemplateId,
  templateById
} = loadTs('src/shared/projectTemplates.ts');
const { canSubmitCreateProject, assertCreateProjectRoles } = loadTs('src/shared/projectTypes.ts');

test('every builtin template except custom has exactly one god', () => {
  for (const t of BUILTIN_PROJECT_TEMPLATES) {
    if (t.id === CUSTOM_TEMPLATE_ID) {
      assert.deepEqual(t.roles, []);
      assert.equal(canSubmitCreateProject(t.roles), false);
      continue;
    }
    const parsed = assertCreateProjectRoles(t.roles);
    assert.ok(parsed.godCharacter);
    assert.equal(t.roles.filter((r) => r.asGod).length, 1);
    assert.equal(canSubmitCreateProject(rolesFromTemplate(t)), true);
  }
});

test('corporate template stays at the five-agent live cap', () => {
  const corporate = templateById(BUILTIN_PROJECT_TEMPLATES, 'corporate');
  assert.ok(corporate);
  assert.equal(corporate.roles.length, 5);
});

test('parseUserTemplateDraft rejects a floor with no god', () => {
  assert.throws(
    () => parseUserTemplateDraft({ name: 'X', roles: [{ character: 'jim' }] }),
    (err) => err && err.code === 'GOD_REQUIRED'
  );
});

test('parseUserTemplateDraft keeps extras and names the god', () => {
  const parsed = parseUserTemplateDraft({
    name: '  Scranton  ',
    roles: [{ character: 'dwight', asGod: true }, { character: 'jim' }]
  });
  assert.equal(parsed.name, 'Scranton');
  assert.equal(parsed.godCharacter, 'dwight');
  assert.deepEqual(parsed.roles[0], { character: 'dwight', asGod: true });
  assert.deepEqual(parsed.roles[1], { character: 'jim', asGod: false });
});

test('mergeTemplates appends user templates and never duplicates builtin ids', () => {
  const merged = mergeTemplates([
    { id: 'solo', name: 'fake', blurb: '', roles: [], builtin: false },
    { id: 'user-1', name: 'Mine', blurb: 'x', roles: [{ character: 'pam', asGod: true }], builtin: false }
  ]);
  assert.equal(merged.filter((t) => t.id === 'solo').length, 1);
  assert.equal(templateById(merged, 'solo')?.builtin, true);
  assert.equal(templateById(merged, 'user-1')?.name, 'Mine');
  assert.equal(isBuiltinTemplateId('user-1'), false);
});
