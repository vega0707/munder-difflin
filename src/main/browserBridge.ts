/**
 * Browser bridge — localhost WebSocket server for the Chrome extension (Task 3).
 *
 * Binds 127.0.0.1 only. One extension session at a time; RPC via invokeBrowserTool.
 * Tests can set MUNDER_BROWSER_BRIDGE_PORT / MUNDER_BROWSER_BRIDGE_TOKEN to avoid Electron config.
 */
import { randomUUID } from 'node:crypto';
import WsRoot from 'ws';

type WsServer = import('ws').Server;
type WsSocket = InstanceType<typeof WsRoot>;
type WsRawData = import('ws').RawData;

type WsStatic = typeof WsRoot & {
  Server: new (options: { host?: string; port?: number }) => WsServer;
  OPEN: number;
};

const Ws = WsRoot as WsStatic;
import {
  parseBridgeMessage,
  isValidToken,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse,
  type ExtensionHello
} from '../shared/browserBridgeProtocol';

export interface BrowserBridgeStatus {
  listening: boolean;
  extensionConnected: boolean;
  port: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

let wss: WsServer | null = null;
let extensionWs: WsSocket | null = null;
let expectedToken = '';
let currentPort = 9777;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: BridgeError) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

export class BridgeError extends Error {
  code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

function resolveBridgeConfig(): { port: number; token: string } {
  const envPort = process.env.MUNDER_BROWSER_BRIDGE_PORT;
  const envToken = process.env.MUNDER_BROWSER_BRIDGE_TOKEN;
  if (envPort !== undefined && envToken !== undefined) {
    return { port: Number(envPort), token: envToken };
  }
  // Lazy require keeps plain-node tests off Electron config unless production path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readConfig } = require('./config') as typeof import('./config');
  const cfg = readConfig();
  return {
    port: cfg.browserBridgePort ?? 9777,
    token: cfg.browserBridgeToken ?? ''
  };
}

function rejectAllPending(code: BridgeErrorCode, message: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.reject(new BridgeError(code, message));
  }
}

function clearExtensionSession(): void {
  extensionWs = null;
  rejectAllPending('BROWSER_BRIDGE_DISCONNECTED', 'browser extension disconnected');
}

function handleExtensionMessage(raw: string): void {
  let msg: ReturnType<typeof parseBridgeMessage>;
  try {
    msg = parseBridgeMessage(raw);
  } catch {
    return;
  }
  if (!('ok' in msg)) return;
  const res = msg as BridgeResponse;
  const entry = pending.get(res.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(res.id);
  if (res.ok) {
    entry.resolve(res.result);
    return;
  }
  const code = (res.error?.code ?? 'BROWSER_BRIDGE_DISCONNECTED') as BridgeErrorCode;
  entry.reject(new BridgeError(code, res.error?.message ?? 'browser tool failed'));
}

function attachExtension(ws: WsSocket): void {
  extensionWs = ws;
  ws.on('close', () => {
    if (extensionWs === ws) clearExtensionSession();
  });
  ws.on('error', () => {
    if (extensionWs === ws) clearExtensionSession();
  });
}

export function startBrowserBridge(): void {
  if (wss) return;
  const { port, token } = resolveBridgeConfig();
  expectedToken = token;
  currentPort = port;
  const server = new Ws.Server({ host: '127.0.0.1', port });
  wss = server;
  server.on('listening', () => {
    const addr = server.address();
    if (addr && typeof addr === 'object') currentPort = addr.port;
  });
  server.on('connection', (ws: WsSocket) => {
    let authenticated = false;
    ws.on('message', (data: WsRawData) => {
      const raw = String(data);
      if (!authenticated) {
        let msg: ReturnType<typeof parseBridgeMessage>;
        try {
          msg = parseBridgeMessage(raw);
        } catch {
          ws.close();
          return;
        }
        if (!('type' in msg) || msg.type !== 'hello') {
          ws.close();
          return;
        }
        const hello = msg as ExtensionHello;
        if (!isValidToken(hello.token, expectedToken)) {
          ws.close();
          return;
        }
        if (extensionWs) {
          ws.close();
          return;
        }
        authenticated = true;
        attachExtension(ws);
        return;
      }
      handleExtensionMessage(raw);
    });
  });
  server.on('error', (err: Error) => {
    console.error('[browser-bridge] server error:', err);
  });
}

export function stopBrowserBridge(): void {
  if (extensionWs) {
    try { extensionWs.close(); } catch { /* best-effort */ }
    extensionWs = null;
  }
  if (wss) {
    try { wss.close(); } catch { /* best-effort */ }
    wss = null;
  }
  rejectAllPending('BROWSER_BRIDGE_DISCONNECTED', 'browser bridge stopped');
  expectedToken = '';
}

export function getBrowserBridgeStatus(): BrowserBridgeStatus {
  return {
    listening: wss !== null,
    extensionConnected: extensionWs !== null && extensionWs.readyState === Ws.OPEN,
    port: currentPort
  };
}

export function invokeBrowserTool(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  if (!extensionWs || extensionWs.readyState !== Ws.OPEN) {
    return Promise.reject(
      new BridgeError('BROWSER_BRIDGE_DISCONNECTED', 'browser extension not connected')
    );
  }
  const id = randomUUID();
  const req: BridgeRequest = { id, method, params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new BridgeError('BROWSER_BRIDGE_TIMEOUT', `browser tool timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      extensionWs!.send(JSON.stringify(req));
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      reject(new BridgeError('BROWSER_BRIDGE_DISCONNECTED', 'browser extension not connected'));
    }
  });
}
