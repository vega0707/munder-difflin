/**
 * Automation bridge — Unix-domain socket hub for stdio MCP scripts (browser + desktop).
 *
 * MCP child processes connect here; requests are multiplexed by `service`:
 *   { service: 'browser'|'desktop', method, params, id? }
 */
import { createServer, type Server } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { invokeBrowserTool, BridgeError } from './browserBridge';
import { invokeDesktopTool, DesktopError } from './desktopControl';
import type { BridgeErrorCode } from '../shared/browserBridgeProtocol';

export interface AutomationRequest {
  id?: string;
  service: 'browser' | 'desktop';
  method: string;
  params?: Record<string, unknown>;
}

export interface AutomationResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

const DEFAULT_TIMEOUT_MS = 30_000;

let server: Server | null = null;

function readHarnessHome(): string | null {
  // Lazy require keeps plain-node tests off Electron config unless production path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readConfig } = require('./config') as typeof import('./config');
  const home = readConfig().harnessHome;
  return typeof home === 'string' && home.trim() ? home : null;
}

/** Socket path MCP children connect to (also injected as MUNDER_AUTOMATION_SOCK). */
export function automationSocketPath(): string {
  if (process.env.MUNDER_AUTOMATION_SOCK) return process.env.MUNDER_AUTOMATION_SOCK;
  const home = readHarnessHome();
  if (!home) return join(homedir(), '.munder-difflin', 'sockets', 'automation.sock');
  if (process.platform === 'win32') {
    const id = createHash('sha1').update(home).digest('hex').slice(0, 12);
    return `\\\\.\\pipe\\munder-automation-${id}`;
  }
  return join(home, 'sockets', 'automation.sock');
}

function ensureSocketDir(sock: string): void {
  if (process.platform === 'win32') return;
  mkdirSync(dirname(sock), { recursive: true });
}

function badRequest(message: string): AutomationResponse {
  return {
    id: '',
    ok: false,
    error: { code: 'BROWSER_BRIDGE_BAD_REQUEST', message }
  };
}

async function dispatch(req: AutomationRequest): Promise<AutomationResponse> {
  const id = req.id ?? randomUUID();
  if (req.service !== 'browser' && req.service !== 'desktop') {
    return { ...badRequest(`unknown service: ${String(req.service)}`), id };
  }
  if (typeof req.method !== 'string' || !req.method) {
    return { ...badRequest('method required'), id };
  }
  if (req.params !== undefined && (typeof req.params !== 'object' || req.params === null || Array.isArray(req.params))) {
    return { ...badRequest('params must be an object'), id };
  }

  if (req.service === 'desktop') {
    try {
      const result = await invokeDesktopTool(req.method, req.params ?? {});
      return { id, ok: true, result };
    } catch (err) {
      const code = err instanceof DesktopError ? err.code : 'DESKTOP_UNAVAILABLE';
      const message = err instanceof Error ? err.message : 'desktop tool failed';
      return { id, ok: false, error: { code, message } };
    }
  }

  try {
    const result = await invokeBrowserTool(req.method, req.params ?? {}, DEFAULT_TIMEOUT_MS);
    return { id, ok: true, result };
  } catch (err) {
    const code = err instanceof BridgeError
      ? err.code
      : ('BROWSER_BRIDGE_DISCONNECTED' as BridgeErrorCode);
    const message = err instanceof Error ? err.message : 'browser tool failed';
    return { id, ok: false, error: { code, message } };
  }
}

function handleConnection(conn: import('node:net').Socket): void {
  let buf = '';
  conn.on('data', (chunk) => {
    buf += chunk.toString();
    const nl = buf.indexOf('\n');
    if (nl === -1) return;
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);

    void (async () => {
      let req: AutomationRequest;
      try {
        req = JSON.parse(line) as AutomationRequest;
      } catch {
        conn.end(JSON.stringify(badRequest('invalid JSON request')) + '\n');
        return;
      }
      const res = await dispatch(req);
      conn.end(JSON.stringify(res) + '\n');
    })().catch((e) => {
      conn.end(JSON.stringify({
        id: '',
        ok: false,
        error: { code: 'BROWSER_BRIDGE_DISCONNECTED', message: String(e) }
      }) + '\n');
    });
  });
  conn.on('error', () => { /* client hung up */ });
}

export function startAutomationBridge(): void {
  if (server) return;
  const sock = automationSocketPath();
  try {
    if (process.platform !== 'win32') {
      ensureSocketDir(sock);
      if (existsSync(sock)) rmSync(sock);
    }
  } catch { /* best-effort stale cleanup */ }

  server = createServer(handleConnection);
  server.on('error', (err) => console.error('[automation-bridge] server error:', err));
  server.listen(sock);
}

export function stopAutomationBridge(): void {
  if (server) {
    try { server.close(); } catch { /* best-effort */ }
    server = null;
  }
  const sock = automationSocketPath();
  try {
    if (process.platform !== 'win32' && existsSync(sock)) rmSync(sock);
  } catch { /* best-effort */ }
}
