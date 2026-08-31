/**
 * LocalGateway — loopback-only read surface for headless / scripting clients.
 *
 * Binds 127.0.0.1 exclusively. Optional bearer token (Authorization: Bearer … or
 * x-md-gateway-token). Never placed behind a public tunnel. Default OFF via
 * config; when enabled without a token, a random token is minted once and
 * persisted so operators can copy it from Settings / logs.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

export interface LocalGatewayTask {
  id?: string;
  title?: string;
  status?: string;
  assignee?: string;
  priority?: number;
  createdAt?: string;
  humanQA?: unknown;
}

export interface LocalGatewayOptions {
  /** Preferred port; 0 = OS-assigned. */
  port?: number;
  /** When set, every request must present this token. */
  token?: string | null;
  getTasks: () => LocalGatewayTask[] | { tasks?: LocalGatewayTask[] };
  getHealthExtra?: () => Record<string, unknown>;
}

function isLoopback(addr: string): boolean {
  const a = addr.replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(raw)
  });
  res.end(raw);
}

export function mintGatewayToken(): string {
  return randomBytes(24).toString('hex');
}

export class LocalGateway {
  private server: Server | null = null;
  private port = 0;
  private readonly token: string | null;
  private readonly getTasks: LocalGatewayOptions['getTasks'];
  private readonly getHealthExtra?: LocalGatewayOptions['getHealthExtra'];
  private readonly preferredPort: number;

  constructor(opts: LocalGatewayOptions) {
    this.preferredPort = opts.port ?? 0;
    this.token = opts.token?.trim() || null;
    this.getTasks = opts.getTasks;
    this.getHealthExtra = opts.getHealthExtra;
  }

  get boundPort(): number { return this.port; }
  get authToken(): string | null { return this.token; }

  start(): Promise<{ ok: boolean; port?: number; error?: string }> {
    return new Promise((resolve) => {
      if (this.server) { resolve({ ok: false, error: 'already running' }); return; }
      const server = createServer((req, res) => this.handle(req, res));
      const onError = (e: Error): void => {
        server.off('listening', onListening);
        resolve({ ok: false, error: e.message });
      };
      const onListening = (): void => {
        server.off('error', onError);
        this.server = server;
        const addr = server.address();
        this.port = addr && typeof addr === 'object' ? addr.port : this.preferredPort;
        resolve({ ok: true, port: this.port });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.preferredPort, '127.0.0.1');
    });
  }

  stop(): void {
    try { this.server?.close(); } catch { /* best-effort */ }
    this.server = null;
    this.port = 0;
  }

  private checkAuth(req: IncomingMessage): boolean {
    if (!this.token) return true;
    const header = req.headers['authorization'];
    if (typeof header === 'string') {
      const m = /^Bearer\s+(.+)$/i.exec(header.trim());
      if (m && m[1] === this.token) return true;
    }
    const alt = req.headers['x-md-gateway-token'];
    if (typeof alt === 'string' && alt === this.token) return true;
    return false;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (!isLoopback(req.socket.remoteAddress ?? '')) {
      json(res, 403, { ok: false, error: 'loopback only' });
      return;
    }
    if (req.method !== 'GET') {
      json(res, 405, { ok: false, error: 'GET only' });
      return;
    }
    const path = (req.url ?? '/').split('?')[0];
    if (!this.checkAuth(req)) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    if (path === '/health') {
      json(res, 200, {
        ok: true,
        service: 'munder-local-gateway',
        port: this.port,
        ...(this.getHealthExtra?.() ?? {})
      });
      return;
    }
    if (path === '/tasks') {
      let raw: LocalGatewayTask[] | { tasks?: LocalGatewayTask[] };
      try { raw = this.getTasks(); }
      catch (e) {
        json(res, 500, { ok: false, error: (e as Error).message });
        return;
      }
      const tasks = Array.isArray(raw) ? raw : (Array.isArray(raw?.tasks) ? raw.tasks : []);
      json(res, 200, { ok: true, tasks });
      return;
    }
    json(res, 404, { ok: false, error: 'not found' });
  }
}
