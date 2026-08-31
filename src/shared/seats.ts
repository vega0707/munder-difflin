/**
 * Per-agent seat occupancy. Source of truth is `claimedBy` (a runtime id),
 * not the word "local"/"remote" — those are derived for the machine reading
 * the file. A paused PTY still holds the seat; only a real exit vacates.
 */

export type SeatOccupancy = 'local' | 'vacant' | 'remote';

export interface SeatRecord {
  claimedBy?: string;
  claimedAt?: number;
  hostLabel?: string;
  provider?: string;
}

export interface SeatBoardState {
  version: 1;
  seats: Record<string, SeatRecord>;
}

export function emptySeatBoard(): SeatBoardState {
  return { version: 1, seats: {} };
}

export function occupancyFor(record: SeatRecord | undefined, runtimeId: string): SeatOccupancy {
  if (!record?.claimedBy) return 'vacant';
  return record.claimedBy === runtimeId ? 'local' : 'remote';
}

export type SeatMutation =
  | { ok: true; board: SeatBoardState; occupancy: SeatOccupancy }
  | { ok: false; code: 'SEAT_TAKEN' | 'SEAT_NOT_HELD'; error: string; board: SeatBoardState };

export function applyClaim(
  board: SeatBoardState,
  agentId: string,
  runtimeId: string,
  opts: { hostLabel?: string; provider?: string; force?: boolean; now?: number } = {}
): SeatMutation {
  const current = board.seats[agentId];
  const holder = current?.claimedBy;
  if (holder && holder !== runtimeId && !opts.force) {
    return {
      ok: false,
      code: 'SEAT_TAKEN',
      error: `seat ${agentId} is held by ${current?.hostLabel || holder}`,
      board
    };
  }
  const next: SeatBoardState = {
    version: 1,
    seats: {
      ...board.seats,
      [agentId]: {
        claimedBy: runtimeId,
        claimedAt: opts.now ?? Date.now(),
        hostLabel: opts.hostLabel,
        provider: opts.provider ?? current?.provider
      }
    }
  };
  return { ok: true, board: next, occupancy: 'local' };
}

export function applyVacate(
  board: SeatBoardState,
  agentId: string,
  runtimeId: string,
  opts: { force?: boolean } = {}
): SeatMutation {
  const current = board.seats[agentId];
  const holder = current?.claimedBy;
  if (!holder) {
    return { ok: true, board, occupancy: 'vacant' };
  }
  if (holder !== runtimeId && !opts.force) {
    return {
      ok: false,
      code: 'SEAT_NOT_HELD',
      error: `seat ${agentId} is not held by this runtime`,
      board
    };
  }
  const seats = { ...board.seats };
  seats[agentId] = {
    provider: current?.provider
  };
  return { ok: true, board: { version: 1, seats }, occupancy: 'vacant' };
}

export interface SeatHandoff {
  version: 1;
  exportedAt: number;
  runtimeId: string;
  projectId: string;
  projectName?: string;
  agentId: string;
  agentName?: string;
  role?: string;
  provider?: string;
  identity?: string;
  memory?: string;
  hiveRootPath?: string;
  hostLabel?: string;
}
