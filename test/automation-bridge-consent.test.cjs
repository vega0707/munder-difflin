'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  dispatchAutomationRequest,
  isAutomationServiceConsented,
  _setMcpDefaultsForTest,
  _resetMcpDefaultsForTest
} = loadTs('src/main/automationBridge.ts');

test.after(() => {
  _resetMcpDefaultsForTest();
});

test('isAutomationServiceConsented requires explicit mcpDefaults.enabled === true', () => {
  _setMcpDefaultsForTest({
    'browser-bridge': { enabled: true },
    'desktop-control': { enabled: false }
  });
  assert.equal(isAutomationServiceConsented('browser'), true);
  assert.equal(isAutomationServiceConsented('desktop'), false);

  _setMcpDefaultsForTest({});
  assert.equal(isAutomationServiceConsented('browser'), false);
  assert.equal(isAutomationServiceConsented('desktop'), false);
});

test('dispatch denies desktop when desktop-control consent is off', async () => {
  _setMcpDefaultsForTest({
    'browser-bridge': { enabled: true },
    'desktop-control': { enabled: false }
  });

  const res = await dispatchAutomationRequest({
    id: 't1',
    service: 'desktop',
    method: 'desktop_move',
    params: { x: 1, y: 2 }
  });

  assert.equal(res.ok, false);
  assert.equal(res.error?.code, 'CONSENT_DENIED');
  assert.match(res.error?.message ?? '', /desktop-control/);
});

test('dispatch allows browser when browser-bridge consent is on', async () => {
  _setMcpDefaultsForTest({
    'browser-bridge': { enabled: true },
    'desktop-control': { enabled: false }
  });

  const res = await dispatchAutomationRequest({
    id: 't2',
    service: 'browser',
    method: 'browser_tabs',
    params: {}
  });

  assert.notEqual(res.error?.code, 'CONSENT_DENIED');
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, 'BROWSER_BRIDGE_DISCONNECTED');
});

test('dispatch denies browser when browser-bridge consent is off', async () => {
  _setMcpDefaultsForTest({
    'browser-bridge': { enabled: false },
    'desktop-control': { enabled: true }
  });

  const res = await dispatchAutomationRequest({
    id: 't3',
    service: 'browser',
    method: 'browser_tabs',
    params: {}
  });

  assert.equal(res.ok, false);
  assert.equal(res.error?.code, 'CONSENT_DENIED');
  assert.match(res.error?.message ?? '', /browser-bridge/);
});
