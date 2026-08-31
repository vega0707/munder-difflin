'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
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
    const st = bridge.getBrowserBridgeStatus();
    if (st.listening && st.port > 0) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  return bridge;
}

function bridgeUrl(bridge) {
  const { port } = bridge.getBrowserBridgeStatus();
  return `ws://127.0.0.1:${port}`;
}

function helloPayload(token = TEST_TOKEN) {
  return JSON.stringify({ type: 'hello', token, extensionVersion: '0.1.0' });
}

function openClient(bridge) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(bridgeUrl(bridge));
    ws.on('error', reject);
    ws.on('open', () => resolve(ws));
  });
}

function waitForClose(ws, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), ms);
    ws.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function connectAndHello(bridge, { token = TEST_TOKEN } = {}) {
  const ws = new WebSocket(bridgeUrl(bridge));
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('open', resolve);
  });
  ws.send(helloPayload(token));
  for (let i = 0; i < 30; i++) {
    if (bridge.getBrowserBridgeStatus().extensionConnected) return ws;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('extension not attached after hello');
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
  /** @type {ReturnType<typeof loadTs>} */
  let bridge;

  after(async () => {
    if (bridge) bridge.stopBrowserBridge();
  });

  it('invokeBrowserTool rejects when extension offline', async () => {
    bridge = await loadBridge();
    await assert.rejects(
      () => bridge.invokeBrowserTool('browser_tabs', {}),
      (err) => err.code === 'BROWSER_BRIDGE_DISCONNECTED'
    );
  });

  it('closes connection on wrong token and does not attach extension', async () => {
    bridge = await loadBridge();
    const ws = await openClient(bridge);
    const closed = waitForClose(ws);
    ws.send(helloPayload('wrong-token-thirty-two-chars-xxxxx'));
    await closed;
    assert.equal(bridge.getBrowserBridgeStatus().extensionConnected, false);
  });

  it('rejects duplicate extension while first is connected', async () => {
    bridge = await loadBridge();
    const first = await connectAndHello(bridge);
    assert.equal(bridge.getBrowserBridgeStatus().extensionConnected, true);

    const duplicate = await openClient(bridge);
    const duplicateClosed = waitForClose(duplicate);
    duplicate.send(helloPayload());
    await duplicateClosed;
    assert.equal(bridge.getBrowserBridgeStatus().extensionConnected, true);
    first.close();
  });

  it('rejects pending RPC when extension disconnects mid-flight', async () => {
    bridge = await loadBridge();
    const ext = await connectAndHello(bridge);
    const pending = bridge.invokeBrowserTool('browser_tabs', {});
    ext.close();
    await assert.rejects(
      pending,
      (err) => err.code === 'BROWSER_BRIDGE_DISCONNECTED'
    );
  });
});
