'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  COORDINATOR_SKILLS,
  COORDINATOR_MCP_SAFE,
  COORDINATOR_MCP_CONSENT,
  COORDINATOR_MCP_SERVERS,
  coordinatorKit,
  isCoordinatorAgent,
  isCoordinatorHire,
  withCoordinatorKit,
  partitionCoordinatorMcp,
  coordinatorToolkitPromptLine
} = loadTs('src/shared/coordinatorKit.ts');

const { validateHireManifest } = loadTs('src/shared/hire.ts');

test('kit lists hive sync + fetch skills and includes search MCP', () => {
  const kit = coordinatorKit();
  assert.deepEqual(kit.skills, [...COORDINATOR_SKILLS]);
  assert.ok(kit.skills.includes('md-hive-sync'));
  assert.ok(kit.skills.includes('md-fetch-summarize'));
  assert.ok(COORDINATOR_MCP_SERVERS.includes('search-with-key'));
  assert.ok(COORDINATOR_MCP_CONSENT.includes('search-with-key'));
  assert.ok(COORDINATOR_MCP_SAFE.every((id) => kit.mcpServers.includes(id)));
});

test('GOD is always a coordinator agent', () => {
  assert.equal(isCoordinatorAgent({ isGod: true }), true);
  assert.equal(isCoordinatorAgent({ isGod: false, description: 'docs writer' }), false);
});

test('triage / operations / manager hires classify as coordinators', () => {
  assert.equal(isCoordinatorHire({ capabilities: ['ticket-triage', 'escalation'] }), true);
  assert.equal(isCoordinatorHire({ capabilities: ['operations', 'monitoring'] }), true);
  assert.equal(isCoordinatorHire({ capabilities: ['triage'] }), true);
  assert.equal(
    isCoordinatorHire({ description: 'Social-media manager that plans and schedules' }),
    true
  );
  assert.equal(isCoordinatorHire({ capabilities: ['docs', 'writing'] }), false);
  assert.equal(isCoordinatorHire({ description: 'Full-stack developer' }), false);
});

test('withCoordinatorKit fills gaps without clobbering existing entries', () => {
  const merged = withCoordinatorKit({
    skills: ['md-audit'],
    mcpServers: ['context7']
  });
  assert.ok(merged.skills.includes('md-audit'));
  assert.ok(merged.skills.includes('md-hive-sync'));
  assert.ok(merged.mcpServers.includes('context7'));
  assert.ok(merged.mcpServers.includes('search-with-key'));
  // idempotent
  assert.deepEqual(withCoordinatorKit(merged), merged);
});

test('partitionCoordinatorMcp keeps search in the consent bucket', () => {
  const { safe, consent } = partitionCoordinatorMcp();
  assert.ok(safe.includes('fetch'));
  assert.ok(!safe.includes('search-with-key'));
  assert.deepEqual(consent, ['search-with-key']);
});

test('toolkit prompt line is cache-stable (no dates) and names search', () => {
  const line = coordinatorToolkitPromptLine();
  assert.match(line, /COORDINATOR TOOLKIT/);
  assert.match(line, /md-hive-sync/);
  assert.match(line, /search-with-key/);
  assert.doesNotMatch(line, /\d{4}-\d{2}-\d{2}/);
});

test('a coordinator hire manifest validates with the kit fields', () => {
  const kit = coordinatorKit();
  const result = validateHireManifest({
    spec: 'munder-difflin/hire@1',
    name: 'Erin',
    description: 'Front-line support that triages tickets',
    capabilities: ['ticket-triage', 'escalation'],
    skills: kit.skills,
    mcpServers: kit.mcpServers
  });
  assert.equal(result.ok, true, result.errors?.join('; '));
  assert.deepEqual(result.manifest.skills, kit.skills);
  assert.ok(result.consentRequired.includes('search-with-key'));
});

test('gallery coordinator hires ship the shared kit', () => {
  const dir = join('docs', 'hires', 'manifests');
  const files = readdirSync(dir).filter((f) => f.endsWith('.hire.json'));
  const coordinators = [];
  for (const f of files) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!isCoordinatorHire(m)) continue;
    coordinators.push(f);
    for (const skill of COORDINATOR_SKILLS) {
      assert.ok(
        (m.skills || []).includes(skill),
        `${f} missing skill ${skill}`
      );
    }
    for (const id of COORDINATOR_MCP_SERVERS) {
      assert.ok(
        (m.mcpServers || []).includes(id),
        `${f} missing mcp ${id}`
      );
    }
  }
  assert.ok(coordinators.length >= 3, `expected ≥3 coordinator hires, got ${coordinators.join(',')}`);
});
