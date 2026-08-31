'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  detectSlashQuery,
  filterSkills,
  insertSkillToken,
  segmentForHighlight,
  skillNameSet
} = loadTs('src/shared/slashSkillMenu.ts');

const SKILLS = [
  { name: 'today', description: 'Resolve today date range' },
  { name: 'brainstorming', description: 'Before creative work' },
  { name: 'md-audit', description: 'Audit markdown' }
];

test('detectSlashQuery at lone slash', () => {
  assert.deepEqual(detectSlashQuery('/', 1), { start: 0, end: 1, query: '' });
});

test('detectSlashQuery with partial name', () => {
  assert.deepEqual(detectSlashQuery('/tod', 4), { start: 0, end: 4, query: 'tod' });
  assert.deepEqual(detectSlashQuery('hi /brain', 9), { start: 3, end: 9, query: 'brain' });
});

test('detectSlashQuery ignores path-like segments', () => {
  assert.equal(detectSlashQuery('foo/bar', 7), null);
});

test('filterSkills matches name and description', () => {
  assert.deepEqual(filterSkills(SKILLS, 'tod').map((s) => s.name), ['today']);
  assert.deepEqual(filterSkills(SKILLS, 'creative').map((s) => s.name), ['brainstorming']);
  assert.equal(filterSkills(SKILLS, '').length, 3);
});

test('insertSkillToken replaces partial token', () => {
  const r = insertSkillToken('/tod extra', { start: 0, end: 4 }, 'today');
  assert.equal(r.text, '/today  extra');
  assert.equal(r.caret, 7);
});

test('segmentForHighlight marks known skills', () => {
  const names = skillNameSet(['today', 'brainstorming']);
  assert.deepEqual(segmentForHighlight('/today ok', names), [
    { kind: 'skill', text: '/today' },
    { kind: 'plain', text: ' ok' }
  ]);
  assert.deepEqual(segmentForHighlight('use /unknown', names), [
    { kind: 'plain', text: 'use' },
    { kind: 'plain', text: ' ' },
    { kind: 'plain', text: '/unknown' }
  ]);
});
