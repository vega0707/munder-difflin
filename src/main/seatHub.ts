/**
 * SeatHub — coordination HTTP for MultiCA-style seat takeover.
 *
 * The hub remembers floors, who holds each seat, and the last handoff pack.
 * Coding CLIs (Claude Code, Cursor, …) still run on the machine that claimed
 * the seat. This module has no `electron` import so tests can drive it as
 * plain Node.
 *
 * Auth: every route except GET /health needs `x-md-seat-token` (or Bearer)
 * matching the configured token. An empty token fails closed.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  applyClaim,
  applyHeartbeat,
  applyVacate,
  emptySeatBoard,
  isSeatPathId,
  occupancyFor,
  seatListRows,
  type FloorCatalog,
  type SeatBoardState,
  type SeatHandoff
} from '../shared/seats';

const BODY_LIMIT = 1_500_000;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 120;

export interface SeatHubStore {
  readBoard(projectId: string): SeatBoardState;
  writeBoard(projectId: string, board: SeatBoardState): void;
  readHandoff(projectId: string, agentId: string): SeatHandoff | null;
  writeHandoff(projectId: string, agentId: string, pack: SeatHandoff): void;
  listFloors(): FloorCatalog[];
  putFloor(floor: FloorCatalog): void;
  getFloor(projectId: string): FloorCatalog | undefined;
}

export class MemorySeatStore implements SeatHubStore {
  boards = new Map<string, SeatBoardState>();
  handoffs = new Map<string, SeatHandoff>();
  floors = new Map<string, FloorCatalog>();

  readBoard(projectId: string): SeatBoardState {
    return this.boards.get(projectId) ?? emptySeatBoard();
  }
  writeBoard(projectId: string, board: SeatBoardState): void {
    this.boards.set(projectId, board);
  }
  readHandoff(projectId: string, agentId: string): SeatHandoff | null {
    return this.handoffs.get(`${projectId}/${agentId}`) ?? null;
  }
  writeHandoff(projectId: string, agentId: string, pack: SeatHandoff): void {
    this.handoffs.set(`${projectId}/${agentId}`, pack);
  }
  listFloors(): FloorCatalog[] {
    return [...this.floors.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  }
  putFloor(floor: FloorCatalog): void {
    this.floors.set(floor.projectId, floor);
  }
  getFloor(projectId: string): FloorCatalog | undefined {
    return this.floors.get(projectId);
  }
}

export interface SeatHubOpts {
  port?: number;
  bind?: string;
  token: () => string;
  store: SeatHubStore;
}

type ParsedPath =
  | { kind: 'health' }
  | { kind: 'floors' }
  | { kind: 'floor'; projectId: string }
  | { kind: 'seats'; projectId: string }
  | { kind: 'seat'; projectId: string; agentId: string; action: 'claim' | 'heartbeat' | 'vacate' | 'handoff' | '' };

export function parseSeatHubPath(url: string | undefined): ParsedPath | null {
  const path = (url ?? '/').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'health') return { kind: 'health' };
  if (parts[0] !== 'floors') return null;
  if (parts.length === 1) return { kind: 'floors' };
  const projectId = decodeURIComponent(parts[1] ?? '');
  if (!isSeatPathId(projectId)) return null;
  if (parts.length === 2) return { kind: 'floor', projectId };
  if (parts[2] !== 'seats') return null;
  if (parts.length === 3) return { kind: 'seats', projectId };
  const agentId = decodeURIComponent(parts[3] ?? '');
  if (!isSeatPathId(agentId)) return null;
  const actionRaw = parts[4] ?? '';
  const action =
    actionRaw === 'claim' || actionRaw === 'heartbeat' || actionRaw === 'vacate' || actionRaw === 'handoff'
      ? actionRaw
      : actionRaw === ''
        ? ''
        : null;
  if (action === null) return null;
  if (parts.length > 5) return null;
  return { kind: 'seat', projectId, agentId, action };
}

function tokenOk(expected: string, presented: string): boolean {
  if (!expected || !presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function readPresentedToken(req: IncomingMessage): string {
  const header = req.headers['x-md-seat-token'];
  if (typeof header === 'string' && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const q = (req.url ?? '').split('?')[1];
  if (q) {
    const params = new URLSearchParams(q);
    return params.get('token') ?? '';
  }
  return '';
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export class SeatHub {
  private server: Server | null = null;
  private port: number;
  private bind: string;
  private windows = new Map<string, { start: number; count: number }>();

  constructor(private opts: SeatHubOpts) {
    this.port = opts.port ?? 0;
    this.bind = opts.bind ?? '127.0.0.1';
  }

  address(): string | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') return null;
    const host = addr.address === '::' ? '127.0.0.1' : addr.address;
    return `http://${host}:${addr.port}`;
  }

  listeningPort(): number | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') return null;
    return addr.port;
  }

  async start(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    if (this.server) {
      const url = this.address();
      return url ? { ok: true, url } : { ok: false, error: 'already started without address' };
    }
    try {
      await this.listen();
      const url = this.address();
      if (!url) return { ok: false, error: 'listen succeeded but no address' };
      return { ok: true, url };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  stop(): void {
    if (!this.server) return;
    try { this.server.close(); } catch { /* best-effort */ }
    this.server = null;
  }

  private listen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      const onError = (e: Error): void => reject(e);
      server.once('error', onError);
      server.listen(this.port, this.bind, () => {
        server.off('error', onError);
        this.server = server;
        resolve();
      });
    });
  }

  private allowRequest(ip: string): boolean {
    const now = Date.now();
    const w = this.windows.get(ip);
    if (!w || now - w.start > RATE_WINDOW_MS) {
      this.windows.set(ip, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= RATE_LIMIT;
  }

  /** Public for unit tests that drive the handler without a socket. */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = req.socket?.remoteAddress ?? '';
    if (!this.allowRequest(ip)) {
      json(res, 429, { ok: false, error: 'rate limited' });
      return;
    }
    const parsed = parseSeatHubPath(req.url);
    if (!parsed) {
      json(res, 404, { ok: false, error: 'not found' });
      return;
    }
    if (parsed.kind === 'health') {
      json(res, 200, { ok: true, service: 'seathub' });
      return;
    }
    const expected = this.opts.token();
    if (!tokenOk(expected, readPresentedToken(req))) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const method = (req.method ?? 'GET').toUpperCase();
    try {
      if (parsed.kind === 'floors' && method === 'GET') {
        json(res, 200, { ok: true, floors: this.opts.store.listFloors() });
        return;
      }
      if (parsed.kind === 'floor' && method === 'GET') {
        const floor = this.opts.store.getFloor(parsed.projectId);
        if (!floor) {
          json(res, 404, { ok: false, error: 'floor not found' });
          return;
        }
        json(res, 200, { ok: true, floor });
        return;
      }
      if (parsed.kind === 'floor' && (method === 'PUT' || method === 'POST')) {
        const raw = await this.readJson(req);
        const floor = asFloorCatalog(raw, parsed.projectId);
        if (!floor) {
          json(res, 400, { ok: false, error: 'invalid floor catalog' });
          return;
        }
        this.opts.store.putFloor(floor);
        json(res, 200, { ok: true, floor });
        return;
      }
      if (parsed.kind === 'seats' && method === 'GET') {
        const board = this.opts.store.readBoard(parsed.projectId);
        json(res, 200, { ok: true, board, seats: board.seats });
        return;
      }
      if (parsed.kind === 'seat') {
        await this.handleSeat(req, res, method, parsed.projectId, parsed.agentId, parsed.action);
        return;
      }
      json(res, 405, { ok: false, error: 'method not allowed' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, msg === 'body too large' ? 413 : 400, { ok: false, error: msg });
    }
  }

  private async handleSeat(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    projectId: string,
    agentId: string,
    action: 'claim' | 'heartbeat' | 'vacate' | 'handoff' | ''
  ): Promise<void> {
    const store = this.opts.store;
    if (action === 'handoff' && method === 'GET') {
      const pack = store.readHandoff(projectId, agentId);
      if (!pack) {
        json(res, 404, { ok: false, error: 'no handoff' });
        return;
      }
      json(res, 200, { ok: true, handoff: pack });
      return;
    }
    if (action === 'handoff' && (method === 'PUT' || method === 'POST')) {
      const raw = await this.readJson(req);
      const pack = asHandoff(raw, projectId, agentId);
      if (!pack) {
        json(res, 400, { ok: false, error: 'invalid handoff' });
        return;
      }
      store.writeHandoff(projectId, agentId, pack);
      json(res, 200, { ok: true });
      return;
    }
    if (action === 'claim' && method === 'POST') {
      const raw = (await this.readJson(req)) as {
        runtimeId?: unknown; hostLabel?: unknown; provider?: unknown; force?: unknown; now?: unknown;
      };
      const runtimeId = typeof raw.runtimeId === 'string' ? raw.runtimeId : '';
      if (!runtimeId) {
        json(res, 400, { ok: false, error: 'runtimeId required' });
        return;
      }
      const result = applyClaim(store.readBoard(projectId), agentId, runtimeId, {
        hostLabel: typeof raw.hostLabel === 'string' ? raw.hostLabel : undefined,
        provider: typeof raw.provider === 'string' ? raw.provider : undefined,
        force: raw.force === true,
        now: typeof raw.now === 'number' ? raw.now : undefined
      });
      if (result.ok) store.writeBoard(projectId, result.board);
      json(res, result.ok ? 200 : 409, result.ok
        ? { ok: true, occupancy: result.occupancy, board: result.board }
        : { ok: false, code: result.code, error: result.error, board: result.board });
      return;
    }
    if (action === 'heartbeat' && method === 'POST') {
      const raw = (await this.readJson(req)) as {
        runtimeId?: unknown; hostLabel?: unknown; provider?: unknown; now?: unknown;
      };
      const runtimeId = typeof raw.runtimeId === 'string' ? raw.runtimeId : '';
      if (!runtimeId) {
        json(res, 400, { ok: false, error: 'runtimeId required' });
        return;
      }
      const result = applyHeartbeat(store.readBoard(projectId), agentId, runtimeId, {
        hostLabel: typeof raw.hostLabel === 'string' ? raw.hostLabel : undefined,
        provider: typeof raw.provider === 'string' ? raw.provider : undefined,
        now: typeof raw.now === 'number' ? raw.now : undefined
      });
      if (result.ok) store.writeBoard(projectId, result.board);
      json(res, result.ok ? 200 : 409, result.ok
        ? { ok: true, occupancy: result.occupancy }
        : { ok: false, code: result.code, error: result.error });
      return;
    }
    if (action === 'vacate' && method === 'POST') {
      const raw = (await this.readJson(req)) as { runtimeId?: unknown; force?: unknown; now?: unknown };
      const runtimeId = typeof raw.runtimeId === 'string' ? raw.runtimeId : '';
      if (!runtimeId) {
        json(res, 400, { ok: false, error: 'runtimeId required' });
        return;
      }
      const result = applyVacate(store.readBoard(projectId), agentId, runtimeId, {
        force: raw.force === true,
        now: typeof raw.now === 'number' ? raw.now : undefined
      });
      if (result.ok) store.writeBoard(projectId, result.board);
      json(res, result.ok ? 200 : 409, result.ok
        ? { ok: true, occupancy: result.occupancy }
        : { ok: false, code: result.code, error: result.error });
      return;
    }
    if (action === '' && method === 'GET') {
      const rec = store.readBoard(projectId).seats[agentId];
      json(res, 200, {
        ok: true,
        seat: rec ?? {},
        occupancy: occupancyFor(rec, ''),
        rows: seatListRows(store.readBoard(projectId), '')
      });
      return;
    }
    json(res, 405, { ok: false, error: 'method not allowed' });
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    const text = await readBody(req, BODY_LIMIT);
    if (!text.trim()) return {};
    return JSON.parse(text) as unknown;
  }
}

function asFloorCatalog(raw: unknown, projectId: string): FloorCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const godCharacter = typeof o.godCharacter === 'string' ? o.godCharacter : '';
  if (!name || !godCharacter) return null;
  const agentsIn = Array.isArray(o.agents) ? o.agents : [];
  const agents = [];
  for (const a of agentsIn) {
    if (!a || typeof a !== 'object') continue;
    const row = a as Record<string, unknown>;
    if (typeof row.agentId !== 'string' || !isSeatPathId(row.agentId)) continue;
    if (typeof row.name !== 'string') continue;
    agents.push({
      agentId: row.agentId,
      name: row.name,
      role: typeof row.role === 'string' ? row.role : undefined,
      character: typeof row.character === 'string' ? row.character : undefined,
      provider: typeof row.provider === 'string' ? row.provider : undefined
    });
  }
  return {
    projectId,
    name,
    godCharacter,
    defaultCwd: typeof o.defaultCwd === 'string' ? o.defaultCwd : undefined,
    agents,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now()
  };
}

function asHandoff(raw: unknown, projectId: string, agentId: string): SeatHandoff | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as SeatHandoff;
  if (typeof o.runtimeId !== 'string' || typeof o.agentId !== 'string') return null;
  return {
    ...o,
    version: o.version === 2 ? 2 : 1,
    exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : Date.now(),
    projectId,
    agentId
  };
}
