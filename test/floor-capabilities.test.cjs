'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  FLOOR_CAPABILITIES_FILENAME,
  MAX_MANUAL_CHARS,
  FLOOR_CAPABILITIES_SKELETON,
  readFloorCapabilities,
  floorCapabilitiesPath,
  starterFloorCapabilities,
  assembleSeatPrompt
} = loadTs('src/main/floorCapabilities.ts');

function hiveRootWithManual(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'munder-floor-'));
  if (body !== undefined) fs.writeFileSync(path.join(root, FLOOR_CAPABILITIES_FILENAME), body);
  return root;
}

// ───────────────────────────────── reading ────────────────────────────────────

test('a floor with no manual reports it is absent instead of erroring', () => {
  const root = hiveRootWithManual(undefined);
  assert.deepEqual(readFloorCapabilities(root), { text: '', present: false });
});

test('a floor with no root at all is the same as no manual', () => {
  assert.deepEqual(readFloorCapabilities(null), { text: '', present: false });
  assert.deepEqual(readFloorCapabilities(undefined), { text: '', present: false });
});

test('an empty manual counts as absent', () => {
  assert.equal(readFloorCapabilities(hiveRootWithManual('   \n\n')).present, false);
});

test('a manual is read back verbatim', () => {
  const root = hiveRootWithManual('# Floor\n- build: npm run build\n');
  const manual = readFloorCapabilities(root);

  assert.equal(manual.present, true);
  assert.match(manual.text, /npm run build/);
});

test('an oversized manual is truncated rather than handed over whole', () => {
  const root = hiveRootWithManual('x'.repeat(MAX_MANUAL_CHARS + 500));
  const manual = readFloorCapabilities(root);

  assert.equal(manual.present, true);
  assert.ok(manual.text.length < MAX_MANUAL_CHARS + 100);
  assert.match(manual.text, /truncated/);
});

test('the manual path is the floor root plus the known filename', () => {
  assert.equal(floorCapabilitiesPath('/tmp/floor'), `/tmp/floor/${FLOOR_CAPABILITIES_FILENAME}`);
});

// ──────────────────────────────── assembling ──────────────────────────────────

test('the skeleton is on every floor, manual or not', () => {
  const bare = assembleSeatPrompt({ agentName: 'Worker' });
  const withManual = assembleSeatPrompt({
    agentName: 'Worker',
    manual: { text: 'CUSTOM', present: true }
  });

  for (const prompt of [bare, withManual]) {
    assert.ok(prompt.includes(FLOOR_CAPABILITIES_SKELETON), 'skeleton must always be present');
  }
  // …and it carries no business content of its own.
  assert.ok(!FLOOR_CAPABILITIES_SKELETON.match(/market|ticker|quant/i));
});

test('the floor manual is injected under its own heading', () => {
  const prompt = assembleSeatPrompt({
    agentName: 'Worker',
    role: 'analyst',
    manual: { text: 'PRICE: call quant_market_brief', present: true }
  });

  assert.match(prompt, /You are Worker, analyst/);
  assert.match(prompt, /THIS FLOOR/);
  assert.match(prompt, /call quant_market_brief/);
});

test('a floor without a manual is told so, and told where it looked', () => {
  const prompt = assembleSeatPrompt({
    agentName: 'Worker',
    hiveRoot: '/tmp/floor-x',
    manual: { text: '', present: false }
  });

  assert.match(prompt, new RegExp(`No ${FLOOR_CAPABILITIES_FILENAME} exists`));
  assert.match(prompt, /\/tmp\/floor-x/);
  // The honest-gap instruction is the point: no pretending about sources.
  assert.match(prompt, /Do not imply this project has a data source/);
});

test('the god is told what its job is on top of the shared rules', () => {
  const god = assembleSeatPrompt({ agentName: 'Michael', isGod: true });
  const worker = assembleSeatPrompt({ agentName: 'Worker' });

  assert.match(god, /You run the floor/);
  assert.ok(!worker.match(/You run the floor/));
});

test('a seat with no role still gets a readable first line', () => {
  assert.match(assembleSeatPrompt({ agentName: 'Worker' }), /^You are Worker, a seat on this office floor\./);
});

// ───────────────────────────────── starter ────────────────────────────────────

test('the starter manual names the floor and leaves the content to fill in', () => {
  const starter = starterFloorCapabilities('Quant');

  assert.match(starter, /# Quant — floor capabilities/);
  assert.match(starter, /## Data sources/);
  assert.match(starter, /## Entry points/);
  assert.match(starter, /## Work this floor does not do/);
});
