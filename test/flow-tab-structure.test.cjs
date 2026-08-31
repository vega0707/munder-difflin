'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('flow tab registered alongside tasks and activity', () => {
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(cc, /key: 'flow'/);
  assert.match(cc, /key: 'tasks'/);
  assert.match(cc, /key: 'activity'/);
  assert.match(cc, /tab === 'flow' && <FlowTab/);
});

test('preload exports run flow IPC helpers', () => {
  const preload = read('src/preload/index.ts');
  assert.match(preload, /hiveRunFlowList/);
  assert.match(preload, /hiveRunFlowDefaultView/);
  assert.match(preload, /hiveRunFlowRetry/);
});

test('flow step click path does not auto-select agent', () => {
  const flow = read('src/renderer/src/components/FlowTab.tsx');
  assert.match(flow, /data-flow-step/);
  assert.doesNotMatch(flow, /onClick=\{\(\) => toggleStep[\s\S]*select\(/);
  assert.match(flow, /goToAssignee/);
});

test('flow overview and step detail regions exist', () => {
  const flow = read('src/renderer/src/components/FlowTab.tsx');
  assert.match(flow, /data-flow-overview/);
  assert.match(flow, /data-flow-step-detail/);
  assert.match(flow, /commandCenter\.flow\.emptyHint/);
});
