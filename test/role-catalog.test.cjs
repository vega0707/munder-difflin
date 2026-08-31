'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  BUILTIN_ROLES,
  isBuiltinRoleId,
  mergeRoleCatalog,
  roleById,
  resolveRoleToCreateProjectRole,
  expandTemplateRoles,
  assertRoleDraft,
  findRoleByTitle
} = loadTs('src/shared/roleCatalog.ts');
const {
  BUILTIN_PROJECT_TEMPLATES,
  CUSTOM_TEMPLATE_ID,
  rolesFromTemplate,
  templateById
} = loadTs('src/shared/projectTemplates.ts');
const { assertCreateProjectRoles } = loadTs('src/shared/projectTypes.ts');

test('builtin roles have stable ids and cast characters', () => {
  assert.ok(BUILTIN_ROLES.length >= 10);
  for (const r of BUILTIN_ROLES) {
    assert.ok(r.id);
    assert.ok(r.title);
    assert.ok(r.description);
    assert.equal(r.builtin, true);
    assert.equal(isBuiltinRoleId(r.id), true);
  }
  assert.equal(roleById(BUILTIN_ROLES, 'pm')?.title, '产品经理');
  assert.equal(roleById(BUILTIN_ROLES, 'architect')?.title, '软件架构师');
});

test('every builtin floor template roleId resolves', () => {
  for (const t of BUILTIN_PROJECT_TEMPLATES) {
    if (t.id === CUSTOM_TEMPLATE_ID) continue;
    const roles = rolesFromTemplate(t);
    assert.equal(roles.length, t.roles.length);
    assertCreateProjectRoles(roles);
    for (const r of roles) {
      assert.ok(r.title, `${t.id} missing title`);
      assert.ok(r.description, `${t.id} missing description`);
    }
  }
});

test('product-rd expands to expected Chinese titles', () => {
  const product = templateById(BUILTIN_PROJECT_TEMPLATES, 'product-rd');
  const roles = rolesFromTemplate(product);
  assert.equal(roles[0].title, '产品经理');
  assert.equal(roles[0].asGod, true);
  assert.equal(roles[1].title, '软件架构师');
  assert.ok(roles[1].skills?.includes('md-audit'));
});

test('resolveRoleToCreateProjectRole copies skills/mcp', () => {
  const arch = roleById(BUILTIN_ROLES, 'architect');
  const role = resolveRoleToCreateProjectRole(arch, false);
  assert.equal(role.character, 'oscar');
  assert.deepEqual(role.skills, arch.skills);
  assert.equal(role.asGod, false);
});

test('mergeRoleCatalog never duplicates builtin ids', () => {
  const merged = mergeRoleCatalog([
    { id: 'pm', title: 'fake', description: 'x', character: 'jim', builtin: false },
    { id: 'user-1', title: '合规官', description: '管合规', character: 'toby', builtin: false, source: 'user' }
  ]);
  assert.equal(merged.filter((r) => r.id === 'pm').length, 1);
  assert.equal(roleById(merged, 'pm')?.builtin, true);
  assert.equal(roleById(merged, 'user-1')?.title, '合规官');
});

test('assertRoleDraft validates required fields', () => {
  assert.throws(() => assertRoleDraft({ title: '', description: 'x', character: 'jim' }));
  assert.throws(() => assertRoleDraft({ title: 'X', description: 'y', character: 'not-a-cast' }));
  const ok = assertRoleDraft({ title: ' 安全官 ', description: '审安全', character: 'toby', source: 'ai-ui' });
  assert.equal(ok.title, '安全官');
  assert.equal(ok.source, 'ai-ui');
});

test('findRoleByTitle is case-insensitive', () => {
  assert.equal(findRoleByTitle(BUILTIN_ROLES, '产品经理')?.id, 'pm');
  assert.equal(findRoleByTitle(BUILTIN_ROLES, 'TECH LEAD')?.id, 'tech-lead');
});

test('expandTemplateRoles accepts legacy inline roles', () => {
  const roles = expandTemplateRoles([
    { character: 'michael', asGod: true, title: 'Boss', description: 'runs' },
    { roleId: 'frontend' }
  ]);
  assert.equal(roles[0].title, 'Boss');
  assert.equal(roles[1].title, 'Frontend');
});
