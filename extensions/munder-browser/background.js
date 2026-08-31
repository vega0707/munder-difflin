/**
 * Munder Difflin Browser Bridge — MV3 service worker.
 * Connects to localhost WebSocket, handles BridgeRequest RPC via chrome.debugger CDP.
 */

const EXTENSION_VERSION = '0.1.0';
const DEFAULT_PORT = 9777;
const RECONNECT_MS = 3000;
const AUTH_GRACE_MS = 500;

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
  'menuitem', 'tab', 'switch', 'slider', 'listbox', 'option', 'textarea',
  'spinbutton', 'menu', 'menuitemcheckbox', 'menuitemradio', 'treeitem'
]);

/** @type {WebSocket | null} */
let ws = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let reconnectTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let authTimer = null;
let helloSent = false;
let authConfirmed = false;
/** @type {{ port: number, token: string }} */
let config = { port: DEFAULT_PORT, token: '' };
/** @type {Map<number, Map<string, object>>} tabId -> ref -> entry */
const refMaps = new Map();
/** @type {Set<number>} */
const attachedTabs = new Set();

// ---------------------------------------------------------------------------
// Config & connection
// ---------------------------------------------------------------------------

function setBridgeStatus(status, detail = '') {
  chrome.storage.local.set({ bridgeStatus: status, bridgeStatusDetail: detail });
}

function loadConfigAndConnect() {
  chrome.storage.local.get(['bridgePort', 'bridgeToken'], (data) => {
    config.port = data.bridgePort ?? DEFAULT_PORT;
    config.token = data.bridgeToken ?? '';
    connect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function clearAuthTimer() {
  if (authTimer) {
    clearTimeout(authTimer);
    authTimer = null;
  }
}

function resetAuthState() {
  clearAuthTimer();
  helloSent = false;
  authConfirmed = false;
}

function confirmAuth() {
  if (authConfirmed) return;
  authConfirmed = true;
  clearAuthTimer();
  setBridgeStatus('connected');
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  resetAuthState();
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
  setBridgeStatus('disconnected');
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (!config.token) {
    setBridgeStatus('disconnected', 'Token not configured');
    scheduleReconnect();
    return;
  }

  setBridgeStatus('connecting');
  const url = `ws://127.0.0.1:${config.port}`;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    setBridgeStatus('disconnected', String(err.message || err));
    scheduleReconnect();
    return;
  }

  resetAuthState();

  ws.onopen = () => {
    helloSent = true;
    ws.send(JSON.stringify({
      type: 'hello',
      token: config.token,
      extensionVersion: EXTENSION_VERSION
    }));
    setBridgeStatus('connecting');
    authTimer = setTimeout(() => {
      authTimer = null;
      if (ws && ws.readyState === WebSocket.OPEN) confirmAuth();
    }, AUTH_GRACE_MS);
  };

  ws.onmessage = (event) => {
    handleMessage(String(event.data));
  };

  ws.onclose = () => {
    const failedAuth = helloSent && !authConfirmed;
    ws = null;
    resetAuthState();
    setBridgeStatus(
      'disconnected',
      failedAuth ? 'Auth failed — check token' : ''
    );
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose follows
  };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let shouldReconnect = false;
  if (changes.bridgePort) {
    config.port = changes.bridgePort.newValue ?? DEFAULT_PORT;
    shouldReconnect = true;
  }
  if (changes.bridgeToken) {
    config.token = changes.bridgeToken.newValue ?? '';
    shouldReconnect = true;
  }
  if (shouldReconnect) {
    disconnect();
    connect();
  }
});

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

function sendResponse(response) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response));
  }
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg.id !== 'string' || typeof msg.method !== 'string') return;

  dispatchMethod(msg.id, msg.method, msg.params || {})
    .then((result) => {
      confirmAuth();
      sendResponse({ id: msg.id, ok: true, result });
    })
    .catch((err) => {
      const code = err.code || 'BROWSER_BRIDGE_BAD_REQUEST';
      sendResponse({
        id: msg.id,
        ok: false,
        error: { code, message: err.message || String(err) }
      });
    });
}

function bridgeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function badRequest(message) {
  return bridgeError('BROWSER_BRIDGE_BAD_REQUEST', message);
}

// ---------------------------------------------------------------------------
// Tab & debugger helpers
// ---------------------------------------------------------------------------

async function resolveTabId(tabId) {
  if (tabId != null) return tabId;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw badRequest('no active tab');
  return tab.id;
}

function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    if (attachedTabs.has(tabId)) {
      resolve();
      return;
    }
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      attachedTabs.add(tabId);
      resolve();
    });
  });
}

function sendCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

async function ensureTabReady(tabId) {
  await attachDebugger(tabId);
  try {
    await sendCommand(tabId, 'Page.enable');
  } catch { /* may already be enabled */ }
  try {
    await sendCommand(tabId, 'Runtime.enable');
  } catch { /* may already be enabled */ }
  try {
    await sendCommand(tabId, 'DOM.enable');
  } catch { /* may already be enabled */ }
}

function getRefEntry(tabId, ref) {
  const map = refMaps.get(tabId);
  if (!map || !map.has(ref)) {
    throw bridgeError('STALE_REF', `ref not found: ${ref}`);
  }
  return map.get(ref);
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

async function browser_tabs(params) {
  const { action, tabId, url } = params;

  switch (action) {
    case 'list': {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          active: t.active,
          windowId: t.windowId
        }))
      };
    }
    case 'focus': {
      if (tabId == null) throw badRequest('tabId required for focus');
      const tab = await chrome.tabs.update(tabId, { active: true });
      return { tabId: tab.id, url: tab.url, title: tab.title };
    }
    case 'open': {
      const tab = await chrome.tabs.create({ url: url || 'about:blank' });
      return { tabId: tab.id, url: tab.url };
    }
    case 'close': {
      if (tabId == null) throw badRequest('tabId required for close');
      await chrome.tabs.remove(tabId);
      attachedTabs.delete(tabId);
      refMaps.delete(tabId);
      return { ok: true };
    }
    default:
      throw badRequest(`unknown browser_tabs action: ${action}`);
  }
}

async function browser_navigate(params) {
  const { url } = params;
  if (!url) throw badRequest('url required');
  const tabId = await resolveTabId(params.tabId);
  const tab = await chrome.tabs.update(tabId, { url });
  return { tabId: tab.id, url: tab.url ?? url };
}

async function browser_snapshot(params) {
  const tabId = await resolveTabId(params.tabId);
  await ensureTabReady(tabId);

  await sendCommand(tabId, 'Accessibility.enable');
  let tree;
  try {
    tree = await sendCommand(tabId, 'Accessibility.getFullAXTree');
  } catch (err) {
    throw badRequest(`Accessibility.getFullAXTree failed: ${err.message || err}`);
  }

  const nodes = tree.nodes || [];
  if (nodes.length === 0) {
    throw badRequest('accessibility tree empty after Accessibility.enable');
  }
  const refs = [];
  const refMap = new Map();
  let counter = 1;

  for (const node of nodes) {
    const role = node.role?.value || '';
    const name = node.name?.value || '';
    const backendDOMNodeId = node.backendDOMNodeId;

    if (!backendDOMNodeId) continue;
    const isInteractive = INTERACTIVE_ROLES.has(role);
    const hasName = name.length > 0;
    if (!isInteractive && !hasName) continue;

    const ref = `e${counter++}`;
    let bounds;
    if (Array.isArray(node.bounds) && node.bounds.length === 4) {
      const [x, y, w, h] = node.bounds;
      bounds = { x, y, width: w, height: h };
    } else {
      try {
        const { model } = await sendCommand(tabId, 'DOM.getBoxModel', { backendNodeId: backendDOMNodeId });
        if (model?.content?.length >= 8) {
          const c = model.content;
          const x = Math.min(c[0], c[2], c[4], c[6]);
          const y = Math.min(c[1], c[3], c[5], c[7]);
          const x2 = Math.max(c[0], c[2], c[4], c[6]);
          const y2 = Math.max(c[1], c[3], c[5], c[7]);
          bounds = { x, y, width: x2 - x, height: y2 - y };
        }
      } catch { /* bounds optional */ }
    }

    const entry = { ref, role, name, backendDOMNodeId, bounds };
    refs.push({ ref, role, name, ...(bounds ? { bounds } : {}) });
    refMap.set(ref, entry);
  }

  if (refs.length === 0) {
    throw badRequest('no interactable elements in accessibility tree');
  }

  refMaps.set(tabId, refMap);
  return { refs };
}

async function clickAt(tabId, x, y) {
  const opts = { x, y, button: 'left', clickCount: 1 };
  await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...opts });
  await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...opts });
  await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...opts });
}

async function browser_click(params) {
  const tabId = await resolveTabId(params.tabId);
  await ensureTabReady(tabId);

  if (params.ref) {
    const entry = getRefEntry(tabId, params.ref);
    let x;
    let y;
    if (entry.bounds) {
      x = entry.bounds.x + entry.bounds.width / 2;
      y = entry.bounds.y + entry.bounds.height / 2;
    } else {
      const { model } = await sendCommand(tabId, 'DOM.getBoxModel', {
        backendNodeId: entry.backendDOMNodeId
      });
      const c = model.content;
      x = (c[0] + c[4]) / 2;
      y = (c[1] + c[5]) / 2;
    }
    await clickAt(tabId, x, y);
  } else if (params.x != null && params.y != null) {
    await clickAt(tabId, params.x, params.y);
  } else {
    throw badRequest('ref or x/y required');
  }
  return { ok: true };
}

async function browser_type(params) {
  const { text } = params;
  if (text == null) throw badRequest('text required');
  const tabId = await resolveTabId(params.tabId);
  await ensureTabReady(tabId);

  if (params.ref) {
    const entry = getRefEntry(tabId, params.ref);
    await sendCommand(tabId, 'DOM.focus', { backendNodeId: entry.backendDOMNodeId });
  }
  await sendCommand(tabId, 'Input.insertText', { text: String(text) });
  return { ok: true };
}

const KEY_DEFS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 34 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }
};

function keyDef(key) {
  if (KEY_DEFS[key]) return KEY_DEFS[key];
  if (key.length === 1) {
    const code = `Key${key.toUpperCase()}`;
    return {
      key,
      code,
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      nativeVirtualKeyCode: key.toUpperCase().charCodeAt(0)
    };
  }
  return { key, code: key, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 };
}

async function browser_press(params) {
  const { key } = params;
  if (!key) throw badRequest('key required');
  const tabId = await resolveTabId(params.tabId);
  await ensureTabReady(tabId);

  const def = keyDef(key);
  const base = { ...def, modifiers: 0 };
  await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  return { ok: true };
}

async function browser_screenshot(params) {
  const tabId = await resolveTabId(params.tabId);
  await ensureTabReady(tabId);

  const captureParams = { format: 'png' };
  if (params.fullPage) {
    const metrics = await sendCommand(tabId, 'Page.getLayoutMetrics');
    const { width, height } = metrics.contentSize;
    captureParams.captureBeyondViewport = true;
    captureParams.clip = { x: 0, y: 0, width, height, scale: 1 };
  }

  const { data } = await sendCommand(tabId, 'Page.captureScreenshot', captureParams);
  return { base64: data };
}

async function browser_evaluate(params) {
  const { expression } = params;
  if (!expression) throw badRequest('expression required');
  const tabId = await resolveTabId(params.tabId);
  await ensureTabReady(tabId);

  const result = await sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });

  if (result.exceptionDetails) {
    throw badRequest(result.exceptionDetails.text || 'evaluation failed');
  }
  return { value: result.result?.value };
}

const METHODS = {
  browser_tabs,
  browser_navigate,
  browser_snapshot,
  browser_click,
  browser_type,
  browser_press,
  browser_screenshot,
  browser_evaluate
};

async function dispatchMethod(id, method, params) {
  const handler = METHODS[method];
  if (!handler) throw badRequest(`unknown method: ${method}`);
  return handler(params);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  refMaps.delete(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attachedTabs.delete(source.tabId);
});

loadConfigAndConnect();
