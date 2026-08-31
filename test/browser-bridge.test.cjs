'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { parseBridgeMessage, isValidToken } = require('../out/main/browserBridgeProtocol.cjs');

const TEST_TOKEN = '0123456789abcdef0123456789abcdef';

async function loadBridge() {
  process.env.MUNDER_BROWSER_BRIDGE_PORT = '0';
  process.env.MUNDER_BROWSER_BRIDGE_TOKEN = TEST_TOKEN;
  const bridge = loadTs('src/main/browserBridge.ts');
  bridge.stopBrowserBridge();
  bridge.startBrowserBridge();
  for (let i = 0; i < 50; i++) {
    if (bridge.getBrowserBridgeStatus().listening) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  return bridge;
}

after(() => {
  try {
    const bridge = loadTs('src/main/browserBridge.ts');
    bridge.stopBrowserBridge();
  } catch { /* module may not have loaded */ }
  delete process.env.MUNDER_BROWSER_BRIDGE_PORT;
  delete process.env.MUNDER_BROWSER_BRIDGE_TOKEN;
});

describe('browserBridgeProtocol', () => {
  it('parses hello message', () => {
    const msg = parseBridgeMessage(JSON.stringify({ type: 'hello', token: 'abc', extensionVersion: '0.1.0' }));
    assert.equal(msg.type, 'hello');
  });
  it('rejects missing token', () => {
    assert.equal(isValidToken('', 'abc'), false);
    assert.equal(isValidToken('abc', 'abc'), true);
  });
});

describe('browserBridge server', () => {
  it('invokeBrowserTool rejects when extension offline', async () => {
    const { invokeBrowserTool } = await loadBridge();
    await assert.rejects(
      () => invokeBrowserTool('browser_tabs', {}),
      (err) => err.code === 'BROWSER_BRIDGE_DISCONNECTED'
    );
  });
});
