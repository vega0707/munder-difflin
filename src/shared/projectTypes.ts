/** Shared project types and IPC constants for multi-project hive. */

export type ProjectStatus = 'active' | 'degraded' | 'pending-deletion';

export interface ProjectMeta {
  projectId: string;
  name: string;
  createdAt: number;
  status: ProjectStatus;
  defaultCwd?: string;
  hiveRootPath: string;
  /** Floor character that is this project's god. Required on create. */
  godCharacter: OfficeCharacterName;
}

export const MAX_ACTIVE_AGENTS = 5;

/** Stable id of the hive migrated out of `<harnessHome>/hive`. */
export const DEFAULT_PROJECT_ID = 'default';

export const ACTIVE_PROJECT_KV = 'activeProjectId';

export const LEGACY_HIVE_BACKUP = 'hive.pre-migrate';
export const LEGACY_ROSTER_BACKUP = 'roster.pre-migrate.json';

/** Global PTY id. Colon-separated so a UUID projectId cannot collide with agentId. */
export function agentPtyId(projectId: string, agentId: string): string {
  return `pty:${projectId}:${agentId}`;
}

export function parseAgentPtyId(ptyId: string): { projectId: string; agentId: string } | null {
  if (!ptyId.startsWith('pty:')) return null;
  const rest = ptyId.slice(4);
  const cut = rest.indexOf(':');
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { projectId: rest.slice(0, cut), agentId: rest.slice(cut + 1) };
}

export const PROJECT_CHANNELS = {
  LIST: 'project:list',
  CREATE: 'project:create',
  DELETE: 'project:delete',
  ACTIVATE: 'project:activate',
  GET_ACTIVE: 'project:getActive',
  PROMOTE: 'project:promote',
  SPIN_OUT: 'project:spinOut',
  LIST_TEMPLATES: 'project:listTemplates',
  SAVE_TEMPLATE: 'project:saveTemplate',
  DELETE_TEMPLATE: 'project:deleteTemplate',
  CHANGED: 'project:changed',
  ACTIVE_CHANGED: 'project:active-changed'
} as const;

export const SEAT_CHANNELS = {
  LIST: 'seat:list',
  CLAIM: 'seat:claim',
  VACATE: 'seat:vacate',
  EXPORT: 'seat:exportHandoff'
} as const;

export type ProjectErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_DEGRADED'
  | 'SPAWN_LIMIT_REACHED'
  | 'RESUME_LIMIT_REACHED'
  | 'LAST_PROJECT'
  | 'CREATE_FAILED'
  | 'GOD_REQUIRED'
  | 'TOO_MANY_GODS'
  | 'NOT_GOD_ELIGIBLE'
  | 'ALREADY_GOD'
  | 'SEAT_TAKEN'
  | 'SEAT_NOT_HELD';

/** Floor-cast ids. Kept here so main-process create validation does not import Pixi. */
export const OFFICE_CHARACTER_NAMES = [
  'michael', 'jim', 'pam', 'dwight', 'kevin', 'angela',
  'oscar', 'stanley', 'phyllis', 'andy', 'kelly', 'ryan',
  'toby', 'creed', 'meredith'
] as const;

export type OfficeCharacterName = typeof OFFICE_CHARACTER_NAMES[number];

export const OFFICE_CHARACTER_DISPLAY: Record<OfficeCharacterName, string> = {
  michael: 'Michael',
  jim: 'Jim',
  pam: 'Pam',
  dwight: 'Dwight',
  kevin: 'Kevin',
  angela: 'Angela',
  oscar: 'Oscar',
  stanley: 'Stanley',
  phyllis: 'Phyllis',
  andy: 'Andy',
  kelly: 'Kelly',
  ryan: 'Ryan',
  toby: 'Toby',
  creed: 'Creed',
  meredith: 'Meredith'
};

export interface CreateProjectRole {
  character: OfficeCharacterName;
  asGod?: boolean;
}

export interface ParsedCreateProjectRoles {
  godCharacter: OfficeCharacterName;
  godName: string;
  extraCharacters: OfficeCharacterName[];
}

export class ProjectCreateError extends Error {
  constructor(readonly code: ProjectErrorCode, message: string) {
    super(message);
    this.name = 'ProjectCreateError';
  }
}

export function isOfficeCharacter(value: unknown): value is OfficeCharacterName {
  return typeof value === 'string' && (OFFICE_CHARACTER_NAMES as readonly string[]).includes(value);
}

/** New projects must pick at least one floor role and mark exactly one as god. */
export function assertCreateProjectRoles(roles: unknown): ParsedCreateProjectRoles {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new ProjectCreateError('GOD_REQUIRED', 'pick at least one role as god');
  }
  const parsed: CreateProjectRole[] = [];
  const seen = new Set<string>();
  for (const raw of roles) {
    const character = raw && typeof raw === 'object' ? (raw as { character?: unknown }).character : undefined;
    const asGod = raw && typeof raw === 'object' ? Boolean((raw as { asGod?: unknown }).asGod) : false;
    if (!isOfficeCharacter(character)) {
      throw new ProjectCreateError('GOD_REQUIRED', 'pick at least one role as god');
    }
    if (seen.has(character)) continue;
    seen.add(character);
    parsed.push({ character, asGod });
  }
  if (parsed.length === 0) {
    throw new ProjectCreateError('GOD_REQUIRED', 'pick at least one role as god');
  }
  const gods = parsed.filter((r) => r.asGod);
  if (gods.length === 0) {
    throw new ProjectCreateError('GOD_REQUIRED', 'pick at least one role as god');
  }
  if (gods.length > 1) {
    throw new ProjectCreateError('TOO_MANY_GODS', 'a project has one god');
  }
  const godCharacter = gods[0].character;
  return {
    godCharacter,
    godName: OFFICE_CHARACTER_DISPLAY[godCharacter],
    extraCharacters: parsed.filter((r) => r.character !== godCharacter).map((r) => r.character)
  };
}

export function canSubmitCreateProject(roles: ReadonlyArray<{ character: string; asGod?: boolean }>): boolean {
  try {
    assertCreateProjectRoles(roles);
    return true;
  } catch {
    return false;
  }
}

/** Click a cast tile: select (first pick becomes god) or deselect (remaining god is promoted). */
export function toggleCreateRole(
  roles: ReadonlyArray<CreateProjectRole>,
  character: OfficeCharacterName
): CreateProjectRole[] {
  const existing = roles.filter((r) => r.character === character);
  if (existing.length > 0) {
    const remaining = roles.filter((r) => r.character !== character);
    if (remaining.length === 0) return [];
    if (remaining.some((r) => r.asGod)) return remaining.map((r) => ({ ...r }));
    return remaining.map((r, i) => ({ character: r.character, asGod: i === 0 }));
  }
  const hasGod = roles.some((r) => r.asGod);
  return [...roles.map((r) => ({ ...r })), { character, asGod: !hasGod }];
}

export function assignCreateProjectGod(
  roles: ReadonlyArray<CreateProjectRole>,
  character: OfficeCharacterName
): CreateProjectRole[] {
  if (!roles.some((r) => r.character === character)) return roles.map((r) => ({ ...r }));
  return roles.map((r) => ({ character: r.character, asGod: r.character === character }));
}

export interface ProjectRow {
  projectId: string;
  name: string;
  createdAt: number;
  status: ProjectStatus;
  defaultCwd: string | null;
  hiveRootPath: string;
  godCharacter: OfficeCharacterName;
}

export function canDeleteProject(list: ReadonlyArray<{ projectId: string }>): boolean {
  return list.length > 1;
}

export function projectTabLabel(meta: Pick<ProjectMeta, 'name' | 'status'>): string {
  return meta.status === 'degraded' ? `${meta.name} (degraded)` : meta.name;
}

/** Session ids that would be SIGSTOP'd (or flagged on Windows) for this project. */
export function planProjectSuspend(
  sessions: ReadonlyArray<{ id: string; projectId: string; suspended: boolean }>,
  projectId: string
): string[] {
  return sessions.filter((s) => s.projectId === projectId && !s.suspended).map((s) => s.id);
}

export function ptyStopSignal(platform: string): NodeJS.Signals | null {
  return platform === 'win32' ? null : 'SIGSTOP';
}

export function ptyContinueSignal(platform: string): NodeJS.Signals | null {
  return platform === 'win32' ? null : 'SIGCONT';
}

export function wouldExceedActiveLimit(opts: {
  platform: string;
  currentActive: number;
  oldProjectRunning: number;
  targetProjectSessions: number;
  limit?: number;
}): boolean {
  const limit = opts.limit ?? MAX_ACTIVE_AGENTS;
  if (opts.platform === 'win32') return opts.currentActive > limit;
  const next = opts.currentActive - opts.oldProjectRunning + opts.targetProjectSessions;
  return next > limit;
}

export function countActivePtys(
  sessions: Iterable<{ suspended: boolean }>,
  platform: string
): number {
  let n = 0;
  for (const s of sessions) {
    if (platform === 'win32' || !s.suspended) n++;
  }
  return n;
}

export function swapProjectSlice<T>(
  slices: Record<string, T>,
  fromId: string | null,
  toId: string,
  current: T,
  empty: T
): { slices: Record<string, T>; next: T } {
  const nextSlices = { ...slices };
  if (fromId) nextSlices[fromId] = current;
  const next = nextSlices[toId] ?? empty;
  return { slices: nextSlices, next };
}

export function assertProjectName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('project name required');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('project name required');
  if (trimmed.length > 80) throw new Error('project name too long');
  return trimmed;
}
