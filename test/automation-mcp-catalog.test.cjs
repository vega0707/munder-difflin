'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { MCP_CATALOG } = loadTs('src/shared/mcpCatalog.ts');

test('browser-bridge catalog entry is write-tier and off by default', () => {
  const entry = MCP_CATALOG.find((e) => e.id === 'browser-bridge');
  assert.ok(entry);
  assert.equal(entry.tier, 'write');
  assert.equal(entry.defaultEnabled, false);
  assert.equal(entry.spec.command, 'node');
  assert.deepEqual(entry.spec.args, ['<mcp-browser-bridge>']);
  assert.equal(entry.spec.env?.MUNDER_AUTOMATION_SOCK, '<sock>');
});

test('desktop-control catalog entry is write-tier and off by default', () => {
  const entry = MCP_CATALOG.find((e) => e.id === 'desktop-control');
  assert.ok(entry);
  assert.equal(entry.tier, 'write');
  assert.equal(entry.defaultEnabled, false);
  assert.equal(entry.spec.command, 'node');
  assert.deepEqual(entry.spec.args, ['<mcp-desktop-control>']);
  assert.equal(entry.spec.env?.MUNDER_AUTOMATION_SOCK, '<sock>');
});
