import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  applyClaim,
  applyHeartbeat,
  applyVacate,
  emptySeatBoard,
  occupancyFor,
  seatListRows,
  SEAT_HANDOFF_SYNC_NOTE,
  type FloorCatalog,
  type SeatBoardState,
  type SeatHandoff,
  type SeatListRow,
  type SeatOccupancy,
  type SeatRecord
} from '../shared/seats';
import { projectRootOf } from './projectRegistry';
import type { SeatHubStore } from './seatHub';

function seatsPath(projectRoot: string): string {
  return join(projectRoot, 'seats.json');
}

function handoffPath(projectRoot: string, agentId: string): string {
  return join(projectRoot, 'handoff', `${agentId}.json`);
}

function floorsPath(home: string): string {
  return join(home, 'seat-hub', 'floors.json');
}

function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export class FileSeatStore implements SeatHubStore {
  constructor(private opts: { getHarnessHome: () => string | null }) {}

  private projectRoot(projectId: string): string | null {
    const home = this.opts.getHarnessHome();
    return home ? projectRootOf(home, projectId) : null;
  }

  readBoard(projectId: string): SeatBoardState {
    const root = this.projectRoot(projectId);
    if (!root) return emptySeatBoard();
    const raw = readJsonFile<Partial<SeatBoardState>>(seatsPath(root));
    if (!raw || raw.version !== 1 || !raw.seats || typeof raw.seats !== 'object') {
      return emptySeatBoard();
    }
    return { version: 1, seats: raw.seats };
  }

  writeBoard(projectId: string, board: SeatBoardState): void {
    const root = this.projectRoot(projectId);
    if (!root) return;
    mkdirSync(root, { recursive: true });
    const p = seatsPath(root);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(board, null, 2), 'utf8');
    renameSync(tmp, p);
  }

  readHandoff(projectId: string, agentId: string): SeatHandoff | null {
    const root = this.projectRoot(projectId);
    if (!root) return null;
    const raw = readJsonFile<SeatHandoff>(handoffPath(root, agentId));
    if (!raw || (raw.version !== 1 && raw.version !== 2)) return null;
    return raw;
  }

  writeHandoff(projectId: string, agentId: string, pack: SeatHandoff): void {
    const root = this.projectRoot(projectId);
    if (!root) return;
    mkdirSync(join(root, 'handoff'), { recursive: true });
    atomicWrite(handoffPath(root, agentId), JSON.stringify(pack, null, 2));
  }

  listFloors(): FloorCatalog[] {
    const home = this.opts.getHarnessHome();
    if (!home) return [];
    const raw = readJsonFile<{ floors?: FloorCatalog[] }>(floorsPath(home));
    if (!raw || !Array.isArray(raw.floors)) return [];
    return raw.floors.filter((f) => f && typeof f.projectId === 'string');
  }

  putFloor(floor: FloorCatalog): void {
    const home = this.opts.getHarnessHome();
    if (!home) return;
    const floors = this.listFloors().filter((f) => f.projectId !== floor.projectId);
    floors.push(floor);
    mkdirSync(join(home, 'seat-hub'), { recursive: true });
    atomicWrite(floorsPath(home), JSON.stringify({ version: 1, floors }, null, 2));
  }

  getFloor(projectId: string): FloorCatalog | undefined {
    return this.listFloors().find((f) => f.projectId === projectId);
  }
}

type HubJson = Record<string, unknown>;

async function hubRequest(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: HubJson }> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-md-seat-token': token
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  let parsed: HubJson = {};
  try {
    parsed = (await res.json()) as HubJson;
  } catch {
    parsed = {};
  }
  return { status: res.status, json: parsed };
}

export type SeatOpResult =
  | { ok: true; occupancy: SeatOccupancy }
  | { ok: false; code: 'SEAT_TAKEN' | 'SEAT_NOT_HELD' | 'CREATE_FAILED' | 'HUB_UNREACHABLE'; error: string };

export class SeatBoard {
  constructor(private opts: {
    store: FileSeatStore;
    getRuntimeId: () => string;
    hostLabel: () => string;
    getHubUrl: () => string | null;
    getHubToken: () => string;
  }) {}

  private hub(): { url: string; token: string } | null {
    const url = this.opts.getHubUrl();
    if (!url || !/^https?:\/\//i.test(url)) return null;
    return { url, token: this.opts.getHubToken() };
  }

  list(projectId: string): Promise<SeatListRow[]> {
    return this.withBoard(projectId, (board, runtimeId) =>
      seatListRows(board, runtimeId));
  }

  async occupancy(projectId: string, agentId: string): Promise<SeatOccupancy> {
    const rec = await this.readSeat(projectId, agentId);
    return occupancyFor(rec, this.opts.getRuntimeId());
  }

  async claim(projectId: string, agentId: string, opts: {
    provider?: string; force?: boolean; sessionId?: string;
  } = {}): Promise<SeatOpResult> {
    const hub = this.hub();
    if (hub) {
      try {
        const { status, json } = await hubRequest(
          hub.url, hub.token, 'POST',
          `/floors/${encodeURIComponent(projectId)}/seats/${encodeURIComponent(agentId)}/claim`,
          {
            runtimeId: this.opts.getRuntimeId(),
            hostLabel: this.opts.hostLabel(),
            provider: opts.provider,
            force: opts.force === true
          }
        );
        if (json.ok === true) {
          this.cacheBoard(projectId, json.board);
          return { ok: true, occupancy: (json.occupancy as SeatOccupancy) || 'local' };
        }
        if (status === 401) return { ok: false, code: 'HUB_UNREACHABLE', error: 'seat hub unauthorized' };
        const code = json.code === 'SEAT_NOT_HELD' ? 'SEAT_NOT_HELD' : 'SEAT_TAKEN';
        return {
          ok: false,
          code,
          error: typeof json.error === 'string' ? json.error : 'claim failed'
        };
      } catch (err) {
        return { ok: false, code: 'HUB_UNREACHABLE', error: err instanceof Error ? err.message : String(err) };
      }
    }
    const store = this.opts.store;
    const result = applyClaim(store.readBoard(projectId), agentId, this.opts.getRuntimeId(), {
      hostLabel: this.opts.hostLabel(),
      provider: opts.provider,
      force: opts.force,
      sessionId: opts.sessionId
    });
    if (!result.ok) return { ok: false, code: result.code, error: result.error };
    store.writeBoard(projectId, result.board);
    return { ok: true, occupancy: result.occupancy };
  }

  async heartbeat(projectId: string, agentId: string, opts: { provider?: string } = {}): Promise<SeatOpResult> {
    const hub = this.hub();
    if (hub) {
      try {
        const { json } = await hubRequest(
          hub.url, hub.token, 'POST',
          `/floors/${encodeURIComponent(projectId)}/seats/${encodeURIComponent(agentId)}/heartbeat`,
          {
            runtimeId: this.opts.getRuntimeId(),
            hostLabel: this.opts.hostLabel(),
            provider: opts.provider
          }
        );
        if (json.ok === true) return { ok: true, occupancy: 'local' };
        return {
          ok: false,
          code: 'SEAT_NOT_HELD',
          error: typeof json.error === 'string' ? json.error : 'heartbeat failed'
        };
      } catch (err) {
        return { ok: false, code: 'HUB_UNREACHABLE', error: err instanceof Error ? err.message : String(err) };
      }
    }
    const store = this.opts.store;
    const result = applyHeartbeat(store.readBoard(projectId), agentId, this.opts.getRuntimeId(), {
      hostLabel: this.opts.hostLabel(),
      provider: opts.provider
    });
    if (!result.ok) return { ok: false, code: result.code, error: result.error };
    store.writeBoard(projectId, result.board);
    return { ok: true, occupancy: result.occupancy };
  }

  async vacate(projectId: string, agentId: string, opts: { force?: boolean } = {}): Promise<SeatOpResult> {
    const hub = this.hub();
    if (hub) {
      try {
        const { json } = await hubRequest(
          hub.url, hub.token, 'POST',
          `/floors/${encodeURIComponent(projectId)}/seats/${encodeURIComponent(agentId)}/vacate`,
          { runtimeId: this.opts.getRuntimeId(), force: opts.force === true }
        );
        if (json.ok === true) return { ok: true, occupancy: 'vacant' };
        return {
          ok: false,
          code: 'SEAT_NOT_HELD',
          error: typeof json.error === 'string' ? json.error : 'vacate failed'
        };
      } catch (err) {
        return { ok: false, code: 'HUB_UNREACHABLE', error: err instanceof Error ? err.message : String(err) };
      }
    }
    const store = this.opts.store;
    const result = applyVacate(store.readBoard(projectId), agentId, this.opts.getRuntimeId(), { force: opts.force });
    if (!result.ok) return { ok: false, code: result.code, error: result.error };
    store.writeBoard(projectId, result.board);
    return { ok: true, occupancy: result.occupancy };
  }

  exportHandoff(input: Omit<SeatHandoff, 'version' | 'exportedAt' | 'runtimeId' | 'syncNote'> & {
    syncNote?: string;
  }): SeatHandoff {
    return {
      version: 2,
      exportedAt: Date.now(),
      runtimeId: this.opts.getRuntimeId(),
      hostLabel: this.opts.hostLabel(),
      syncNote: input.syncNote ?? SEAT_HANDOFF_SYNC_NOTE,
      ...input
    };
  }

  async putHandoff(projectId: string, agentId: string, pack: SeatHandoff): Promise<void> {
    this.opts.store.writeHandoff(projectId, agentId, pack);
    const hub = this.hub();
    if (!hub) return;
    try {
      await hubRequest(
        hub.url, hub.token, 'PUT',
        `/floors/${encodeURIComponent(projectId)}/seats/${encodeURIComponent(agentId)}/handoff`,
        pack
      );
    } catch {
      /* local copy is already written */
    }
  }

  async getHandoff(projectId: string, agentId: string): Promise<SeatHandoff | null> {
    const hub = this.hub();
    if (hub) {
      try {
        const { json } = await hubRequest(
          hub.url, hub.token, 'GET',
          `/floors/${encodeURIComponent(projectId)}/seats/${encodeURIComponent(agentId)}/handoff`
        );
        if (json.ok === true && json.handoff && typeof json.handoff === 'object') {
          return json.handoff as SeatHandoff;
        }
      } catch { /* fall through to local cache */ }
    }
    return this.opts.store.readHandoff(projectId, agentId);
  }

  async listFloors(): Promise<FloorCatalog[]> {
    const hub = this.hub();
    if (hub) {
      try {
        const { json } = await hubRequest(hub.url, hub.token, 'GET', '/floors');
        if (Array.isArray(json.floors)) return json.floors as FloorCatalog[];
      } catch { /* local catalog */ }
    }
    return this.opts.store.listFloors();
  }

  async putFloor(floor: FloorCatalog): Promise<void> {
    this.opts.store.putFloor(floor);
    const hub = this.hub();
    if (!hub) return;
    try {
      await hubRequest(
        hub.url, hub.token, 'PUT',
        `/floors/${encodeURIComponent(floor.projectId)}`,
        floor
      );
    } catch { /* local copy written */ }
  }

  async getFloor(projectId: string): Promise<FloorCatalog | undefined> {
    const hub = this.hub();
    if (hub) {
      try {
        const { json } = await hubRequest(
          hub.url, hub.token, 'GET',
          `/floors/${encodeURIComponent(projectId)}`
        );
        if (json.ok === true && json.floor && typeof json.floor === 'object') {
          return json.floor as FloorCatalog;
        }
      } catch { /* local */ }
    }
    return this.opts.store.getFloor(projectId);
  }

  private cacheBoard(projectId: string, board: unknown): void {
    if (!board || typeof board !== 'object') return;
    const raw = board as Partial<SeatBoardState>;
    if (raw.version !== 1 || !raw.seats || typeof raw.seats !== 'object') return;
    this.opts.store.writeBoard(projectId, { version: 1, seats: raw.seats });
  }

  private async readSeat(projectId: string, agentId: string): Promise<SeatRecord | undefined> {
    const hub = this.hub();
    if (hub) {
      try {
        const { json } = await hubRequest(
          hub.url, hub.token, 'GET',
          `/floors/${encodeURIComponent(projectId)}/seats`
        );
        if (json.board && typeof json.board === 'object') this.cacheBoard(projectId, json.board);
        const seats = (json.seats && typeof json.seats === 'object')
          ? json.seats as Record<string, SeatRecord>
          : undefined;
        if (seats) return seats[agentId];
      } catch { /* local */ }
    }
    return this.opts.store.readBoard(projectId).seats[agentId];
  }

  private async withBoard<T>(projectId: string, fn: (board: SeatBoardState, runtimeId: string) => T): Promise<T> {
    const hub = this.hub();
    const runtimeId = this.opts.getRuntimeId();
    if (hub) {
      try {
        const { json } = await hubRequest(
          hub.url, hub.token, 'GET',
          `/floors/${encodeURIComponent(projectId)}/seats`
        );
        if (json.board && typeof json.board === 'object') {
          this.cacheBoard(projectId, json.board);
          return fn(this.opts.store.readBoard(projectId), runtimeId);
        }
      } catch { /* local */ }
    }
    return fn(this.opts.store.readBoard(projectId), runtimeId);
  }
}
