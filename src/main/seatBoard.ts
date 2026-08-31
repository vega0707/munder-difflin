import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyClaim,
  applyVacate,
  emptySeatBoard,
  occupancyFor,
  type SeatBoardState,
  type SeatHandoff,
  type SeatOccupancy,
  type SeatRecord
} from '../shared/seats';
import { projectRootOf } from './projectRegistry';

function seatsPath(projectRoot: string): string {
  return join(projectRoot, 'seats.json');
}

function readBoard(projectRoot: string): SeatBoardState {
  const p = seatsPath(projectRoot);
  if (!existsSync(p)) return emptySeatBoard();
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<SeatBoardState>;
    if (!raw || raw.version !== 1 || !raw.seats || typeof raw.seats !== 'object') {
      return emptySeatBoard();
    }
    return { version: 1, seats: raw.seats };
  } catch {
    return emptySeatBoard();
  }
}

function writeBoard(projectRoot: string, board: SeatBoardState): void {
  mkdirSync(projectRoot, { recursive: true });
  const p = seatsPath(projectRoot);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(board, null, 2), 'utf8');
  renameSync(tmp, p);
}

export class SeatBoard {
  constructor(private opts: {
    getHarnessHome: () => string | null;
    getRuntimeId: () => string;
    hostLabel: () => string;
  }) {}

  private projectRoot(projectId: string): string | null {
    const home = this.opts.getHarnessHome();
    return home ? projectRootOf(home, projectId) : null;
  }

  list(projectId: string): Array<{ agentId: string; occupancy: SeatOccupancy } & SeatRecord> {
    const root = this.projectRoot(projectId);
    if (!root) return [];
    const board = readBoard(root);
    const runtimeId = this.opts.getRuntimeId();
    return Object.entries(board.seats).map(([agentId, rec]) => ({
      agentId,
      ...rec,
      occupancy: occupancyFor(rec, runtimeId)
    }));
  }

  occupancy(projectId: string, agentId: string): SeatOccupancy {
    const root = this.projectRoot(projectId);
    if (!root) return 'vacant';
    const rec = readBoard(root).seats[agentId];
    return occupancyFor(rec, this.opts.getRuntimeId());
  }

  claim(projectId: string, agentId: string, opts: { provider?: string; force?: boolean } = {}):
    | { ok: true; occupancy: SeatOccupancy }
    | { ok: false; code: 'SEAT_TAKEN' | 'SEAT_NOT_HELD' | 'CREATE_FAILED'; error: string } {
    const root = this.projectRoot(projectId);
    if (!root) return { ok: false, code: 'CREATE_FAILED', error: 'no harnessHome' };
    const result = applyClaim(readBoard(root), agentId, this.opts.getRuntimeId(), {
      hostLabel: this.opts.hostLabel(),
      provider: opts.provider,
      force: opts.force
    });
    if (!result.ok) return { ok: false, code: result.code, error: result.error };
    writeBoard(root, result.board);
    return { ok: true, occupancy: result.occupancy };
  }

  vacate(projectId: string, agentId: string, opts: { force?: boolean } = {}):
    | { ok: true; occupancy: SeatOccupancy }
    | { ok: false; code: 'SEAT_TAKEN' | 'SEAT_NOT_HELD' | 'CREATE_FAILED'; error: string } {
    const root = this.projectRoot(projectId);
    if (!root) return { ok: false, code: 'CREATE_FAILED', error: 'no harnessHome' };
    const result = applyVacate(readBoard(root), agentId, this.opts.getRuntimeId(), { force: opts.force });
    if (!result.ok) return { ok: false, code: result.code, error: result.error };
    writeBoard(root, result.board);
    return { ok: true, occupancy: result.occupancy };
  }

  exportHandoff(input: {
    projectId: string;
    projectName?: string;
    agentId: string;
    agentName?: string;
    role?: string;
    provider?: string;
    identity?: string;
    memory?: string;
    hiveRootPath?: string;
  }): SeatHandoff {
    return {
      version: 1,
      exportedAt: Date.now(),
      runtimeId: this.opts.getRuntimeId(),
      hostLabel: this.opts.hostLabel(),
      ...input
    };
  }
}
