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
    const expanded = rolesFromTemplate(t);
    const parsed = assertCreateProjectRoles(expanded);
    assert.ok(parsed.godCharacter);
    assert.equal(expanded.filter((r) => r.asGod).length, 1);
    assert.equal(canSubmitCreateProject(expanded), true);
    for (const r of expanded) {
      assert.ok(r.title, `${t.id}/${r.character} should have a title`);
      assert.ok(r.description, `${t.id}/${r.character} should have a description`);
    }
  }
});

test('product-rd may exceed the default live-PTY cap (seats 划水)', () => {
  const product = templateById(BUILTIN_PROJECT_TEMPLATES, 'product-rd');
  assert.ok(product);
  assert.ok(product.roles.length >= 5);
  const expanded = rolesFromTemplate(product);
  assert.equal(expanded.filter((r) => r.asGod).length, 1);
  assert.equal(expanded[0].title, '产品经理');
});

test('rolesFromTemplate keeps titles and descriptions', () => {
  const squad = templateById(BUILTIN_PROJECT_TEMPLATES, 'fullstack-squad');
  assert.ok(squad);
  const roles = rolesFromTemplate(squad);
  assert.equal(roles[1].title, 'Frontend');
  assert.match(roles[1].description || '', /UI/);
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
    roles: [
      { character: 'dwight', asGod: true, title: 'Lead' },
      { character: 'jim', title: 'Sales' }
    ]
  });
  assert.equal(parsed.name, 'Scranton');
  assert.equal(parsed.godCharacter, 'dwight');
  assert.deepEqual(parsed.roles[0], { character: 'dwight', asGod: true, title: 'Lead' });
  assert.deepEqual(parsed.roles[1], { character: 'jim', asGod: false, title: 'Sales' });
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
