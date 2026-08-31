/**
 * Per-agent seat occupancy. Source of truth is `claimedBy` (a runtime id),
 * not the word "local"/"remote" — those are derived for the machine reading
 * the board. A paused PTY still holds the seat; only a real exit, an explicit
 * vacate, or a lapsed lease vacates it.
 *
 * Lease: a holder must heartbeat. If the machine dies (power off, kill -9),
 * heartbeats stop and another runtime can take the seat without `force`.
 * This is the MultiCA-style coordination layer: the hub remembers who sits
 * where; the coding CLI still runs on a local machine.
 */

/** Heartbeat cadence (MultiCA daemons use 15s). */
export const SEAT_HEARTBEAT_MS = 15_000;
/** Hold the seat this long after the last heartbeat. ~6 beats; crash → vacant. */
export const SEAT_LEASE_TTL_MS = 90_000;
/** Default loopback port for a machine that serves SeatHub. */
export const DEFAULT_SEAT_HUB_PORT = 3851;

export type SeatOccupancy = 'local' | 'vacant' | 'remote';

export interface SeatRecord {
  claimedBy?: string;
  claimedAt?: number;
  heartbeatAt?: number;
  leaseUntil?: number;
  hostLabel?: string;
  provider?: string;
  sessionId?: string;
}

export interface SeatBoardState {
  version: 1;
  seats: Record<string, SeatRecord>;
}

export function emptySeatBoard(): SeatBoardState {
  return { version: 1, seats: {} };
}

export function isLeaseExpired(record: SeatRecord | undefined, now: number): boolean {
  if (!record?.claimedBy) return true;
  if (typeof record.leaseUntil === 'number') return record.leaseUntil <= now;
  // Pre-lease boards: treat last known activity + TTL as the deadline.
  const start = record.heartbeatAt ?? record.claimedAt ?? 0;
  if (!start) return true;
  return start + SEAT_LEASE_TTL_MS <= now;
}

export function leaseRemainingMs(record: SeatRecord | undefined, now: number): number {
  if (!record?.claimedBy || isLeaseExpired(record, now)) return 0;
  if (typeof record.leaseUntil === 'number') return Math.max(0, record.leaseUntil - now);
  const start = record.heartbeatAt ?? record.claimedAt ?? 0;
  return Math.max(0, start + SEAT_LEASE_TTL_MS - now);
}

export function occupancyFor(
  record: SeatRecord | undefined,
  runtimeId: string,
  now: number = Date.now()
): SeatOccupancy {
  if (!record?.claimedBy || isLeaseExpired(record, now)) return 'vacant';
  return record.claimedBy === runtimeId ? 'local' : 'remote';
}

export type SeatMutation =
  | { ok: true; board: SeatBoardState; occupancy: SeatOccupancy }
  | { ok: false; code: 'SEAT_TAKEN' | 'SEAT_NOT_HELD'; error: string; board: SeatBoardState };

function withSeat(board: SeatBoardState, agentId: string, rec: SeatRecord): SeatBoardState {
  return { version: 1, seats: { ...board.seats, [agentId]: rec } };
}

export function applyClaim(
  board: SeatBoardState,
  agentId: string,
  runtimeId: string,
  opts: {
    hostLabel?: string;
    provider?: string;
    force?: boolean;
    now?: number;
    ttlMs?: number;
    sessionId?: string;
  } = {}
): SeatMutation {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? SEAT_LEASE_TTL_MS;
  const current = board.seats[agentId];
  const holder = current?.claimedBy;
  const held = Boolean(holder) && !isLeaseExpired(current, now);
  if (held && holder !== runtimeId && !opts.force) {
    return {
      ok: false,
      code: 'SEAT_TAKEN',
      error: `seat ${agentId} is held by ${current?.hostLabel || holder}`,
      board
    };
  }
  const next: SeatRecord = {
    claimedBy: runtimeId,
    claimedAt: now,
    heartbeatAt: now,
    leaseUntil: now + ttl,
    hostLabel: opts.hostLabel,
    provider: opts.provider ?? current?.provider,
    sessionId: opts.sessionId ?? current?.sessionId
  };
  return { ok: true, board: withSeat(board, agentId, next), occupancy: 'local' };
}

export function applyHeartbeat(
  board: SeatBoardState,
  agentId: string,
  runtimeId: string,
  opts: { now?: number; ttlMs?: number; hostLabel?: string; provider?: string } = {}
): SeatMutation {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? SEAT_LEASE_TTL_MS;
  const current = board.seats[agentId];
  if (!current?.claimedBy || isLeaseExpired(current, now)) {
    return {
      ok: false,
      code: 'SEAT_NOT_HELD',
      error: `seat ${agentId} is vacant`,
      board
    };
  }
  if (current.claimedBy !== runtimeId) {
    return {
      ok: false,
      code: 'SEAT_NOT_HELD',
      error: `seat ${agentId} is not held by this runtime`,
      board
    };
  }
  const next: SeatRecord = {
    ...current,
    heartbeatAt: now,
    leaseUntil: now + ttl,
    hostLabel: opts.hostLabel ?? current.hostLabel,
    provider: opts.provider ?? current.provider
  };
  return { ok: true, board: withSeat(board, agentId, next), occupancy: 'local' };
}

export function applyVacate(
  board: SeatBoardState,
  agentId: string,
  runtimeId: string,
  opts: { force?: boolean; now?: number } = {}
): SeatMutation {
  const now = opts.now ?? Date.now();
  const current = board.seats[agentId];
  const holder = current?.claimedBy;
  if (!holder || isLeaseExpired(current, now)) {
    const seats = { ...board.seats };
    seats[agentId] = { provider: current?.provider };
    return { ok: true, board: { version: 1, seats }, occupancy: 'vacant' };
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
  seats[agentId] = { provider: current?.provider };
  return { ok: true, board: { version: 1, seats }, occupancy: 'vacant' };
}

export interface SeatHandoffInbox {
  id: string;
  conversation?: string;
  in_reply_to?: string | null;
  from: string;
  to: string;
  act: string;
  subject?: string;
  body?: string;
  hops?: number;
  requires_reply?: boolean;
  needs_human?: boolean;
  created_at?: string;
}

/**
 * Pack a taking-over machine needs to sit in the chair. Secrets, API keys,
 * and the git working tree are NOT in this pack — they stay on the executing
 * machine. The new runtime clones/pulls the same repo at `cwd` (or picks a
 * local folder) and uses its own CLI login.
 */
export interface SeatHandoff {
  version: 1 | 2;
  exportedAt: number;
  runtimeId: string;
  projectId: string;
  projectName?: string;
  agentId: string;
  agentName?: string;
  role?: string;
  character?: string;
  provider?: string;
  command?: string;
  model?: string;
  cwd?: string;
  sessionId?: string;
  identity?: string;
  memory?: string;
  inbox?: SeatHandoffInbox[];
  git?: { branch?: string; head?: string; dirty?: boolean };
  hiveRootPath?: string;
  hostLabel?: string;
  /** Honest note: hub does not mirror the repo. */
  syncNote?: string;
}

export const SEAT_HANDOFF_SYNC_NOTE =
  'Code stays on the machine that held the seat. Push from there (or its git remote) and pull here. The hub only carries identity, memory, pending inbox, and a cwd/git snapshot — not the working tree and not API keys.';

export interface FloorAgentCatalog {
  agentId: string;
  name: string;
  role?: string;
  character?: string;
  provider?: string;
}

export interface FloorCatalog {
  projectId: string;
  name: string;
  godCharacter: string;
  defaultCwd?: string;
  agents: FloorAgentCatalog[];
  updatedAt: number;
}

export interface SeatListRow extends SeatRecord {
  agentId: string;
  occupancy: SeatOccupancy;
  expired: boolean;
  leaseRemainingMs: number;
}

export function seatListRows(
  board: SeatBoardState,
  runtimeId: string,
  now: number = Date.now()
): SeatListRow[] {
  return Object.entries(board.seats).map(([agentId, rec]) => ({
    agentId,
    ...rec,
    occupancy: occupancyFor(rec, runtimeId, now),
    expired: Boolean(rec.claimedBy) && isLeaseExpired(rec, now),
    leaseRemainingMs: leaseRemainingMs(rec, now)
  }));
}

/** Path segments for hub URLs: project ids (uuid) and agent ids (god/jim/…). */
export function isSeatPathId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,80}$/.test(value);
}
