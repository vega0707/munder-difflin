import { mkdirSync, rmSync, existsSync, cpSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HiveManager } from './hive';
import type { PersistStore } from './db';
import {
  ACTIVE_PROJECT_KV,
  DEFAULT_PROJECT_ID,
  LEGACY_HIVE_BACKUP,
  LEGACY_ROSTER_BACKUP,
  assertCreateProjectRoles,
  assertProjectName,
  canDeleteProject,
  ProjectCreateError,
  wouldExceedActiveLimit,
  type ProjectMeta,
  type ProjectErrorCode,
  type CreateProjectRole,
  type OfficeCharacterName,
  type ProjectRow,
  isOfficeCharacter
} from '../shared/projectTypes';
import { seedProjectCast } from './seedProjectCast';
import { RosterStore } from './roster';
import { stampFloorFrom, type FloorAddress } from '../shared/floorAddress';
import type { HiveMessage } from './hive';

export function projectRootOf(harnessHome: string, projectId: string): string {
  return join(harnessHome, 'projects', projectId);
}

export interface ProjectPtyHost {
  getActivePtyCount(): number;
  countProjectSessions(projectId: string, opts?: { runningOnly?: boolean }): number;
  suspendProject(projectId: string): { stopped: number };
  resumeProject(projectId: string):
    | { ok: true; resumed: number }
    | { ok: false; code: 'RESUME_LIMIT_REACHED'; error: string };
  killProject(projectId: string): void;
}

export type ProjectMutationResult =
  | { ok: true; project: ProjectMeta }
  | { ok: false; code: ProjectErrorCode; error: string };

function rowToMeta(row: ProjectRow): ProjectMeta {
  return {
    projectId: row.projectId,
    name: row.name,
    createdAt: row.createdAt,
    status: row.status,
    defaultCwd: row.defaultCwd ?? undefined,
    hiveRootPath: row.hiveRootPath,
    godCharacter: row.godCharacter
  };
}

export class ProjectRegistry {
  private hives = new Map<string, HiveManager>();
  private metas = new Map<string, ProjectMeta>();
  private activeProjectId: string | null = null;

  constructor(private opts: {
    persist: PersistStore;
    getHarnessHome: () => string | null;
    pty?: ProjectPtyHost;
    emit?: (channel: string, payload: unknown) => boolean | void;
    onProjectReady?: (hive: HiveManager) => void;
    onProjectRemoved?: (projectId: string) => void;
    onActiveChanged?: (hive: HiveManager, previousId: string | null) => void;
  }) {}

  getProject(projectId: string): HiveManager | undefined {
    return this.hives.get(projectId);
  }

  getMeta(projectId: string): ProjectMeta | undefined {
    return this.metas.get(projectId);
  }

  listProjects(): ProjectMeta[] {
    return [...this.metas.values()].sort((a, b) => a.createdAt - b.createdAt || a.projectId.localeCompare(b.projectId));
  }

  listHives(): HiveManager[] {
    return [...this.hives.values()];
  }

  getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  activeHive(): HiveManager | undefined {
    return this.activeProjectId ? this.hives.get(this.activeProjectId) : undefined;
  }

  hiveForAgent(agentId: string): HiveManager | undefined {
    for (const hive of this.hives.values()) {
      if (hive.registry().agents[agentId]) return hive;
    }
    return undefined;
  }

  /**
   * Load SQLite rows, migrate a pre-projects hive, attach HiveManagers.
   * Does not spawn agents.
   */
  bootstrap(): { migrated: boolean; activeProjectId: string | null } {
    const home = this.opts.getHarnessHome();
    if (!home) return { migrated: false, activeProjectId: null };

    const migrated = this.migrateLegacy(home);
    for (const row of this.opts.persist.listProjects()) {
      this.attachRow(row, home);
    }

    const saved = this.opts.persist.getKv<string>(ACTIVE_PROJECT_KV);
    const pick = (saved && this.hives.has(saved))
      ? saved
      : (this.listProjects().find((p) => p.status !== 'pending-deletion')?.projectId ?? null);

    if (pick) {
      this.activeProjectId = pick;
      const hive = this.hives.get(pick);
      if (hive) this.opts.onActiveChanged?.(hive, null);
    }
    return { migrated, activeProjectId: pick };
  }

  /**
   * Create a project. `roles` must include exactly one god character — a hive
   * without an orchestrator is not a valid opening floor.
   */
  async createProject(input: {
    name: string;
    defaultCwd?: string;
    roles: CreateProjectRole[];
    /** Default true — spin-out stays on the source floor. */
    activate?: boolean;
    /** Join a hub floor using its existing id. Generated when omitted. */
    projectId?: string;
  }): Promise<ProjectMutationResult> {
    const home = this.opts.getHarnessHome();
    if (!home) return { ok: false, code: 'CREATE_FAILED', error: 'no harnessHome' };

    let name: string;
    let parsed: ReturnType<typeof assertCreateProjectRoles>;
    try {
      name = assertProjectName(input.name);
      parsed = assertCreateProjectRoles(input.roles);
    } catch (err) {
      if (err instanceof ProjectCreateError) {
        return { ok: false, code: err.code, error: err.message };
      }
      return { ok: false, code: 'CREATE_FAILED', error: err instanceof Error ? err.message : String(err) };
    }

    const requested = typeof input.projectId === 'string' ? input.projectId.trim() : '';
    const projectId = requested && /^[A-Za-z0-9._-]{1,80}$/.test(requested) ? requested : randomUUID();
    if (this.metas.has(projectId) || this.opts.persist.getProject(projectId)) {
      return { ok: false, code: 'CREATE_FAILED', error: 'project already exists' };
    }
    const projectRoot = projectRootOf(home, projectId);
    const hiveRootPath = join(projectRoot, 'hive');
    const cwd = input.defaultCwd?.trim() || projectRoot;

    try {
      mkdirSync(projectRoot, { recursive: true });
      const hive = new HiveManager(() => projectRoot, this.opts.emit, projectId);
      await seedProjectCast(hive, {
        godCharacter: parsed.godCharacter,
        godName: parsed.godName,
        extraCharacters: parsed.extraCharacters,
        cwd
      });
      const meta: ProjectMeta = {
        projectId,
        name,
        createdAt: Date.now(),
        status: 'active',
        defaultCwd: input.defaultCwd,
        hiveRootPath,
        godCharacter: parsed.godCharacter
      };
      this.opts.persist.insertProject({
        projectId,
        name,
        createdAt: meta.createdAt,
        status: 'active',
        defaultCwd: input.defaultCwd ?? null,
        hiveRootPath,
        godCharacter: parsed.godCharacter
      });
      this.hives.set(projectId, hive);
      this.metas.set(projectId, meta);
      this.bindHive(hive);
      this.opts.onProjectReady?.(hive);
      this.opts.emit?.('project:changed', { projectId, action: 'create' });
      if (input.activate === false) return { ok: true, project: meta };
      const switched = this.activate(projectId);
      if (!switched.ok) return switched;
      return { ok: true, project: meta };
    } catch (err) {
      // TODO[FAILURE_HANDLING] 创建: 目录或 hive 失败则拆掉半套，不写库。
      if (existsSync(projectRoot)) {
        try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
      return {
        ok: false,
        code: 'CREATE_FAILED',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  activate(projectId: string): ProjectMutationResult {
    const target = this.hives.get(projectId);
    const meta = this.metas.get(projectId);
    if (!target || !meta) {
      return { ok: false, code: 'PROJECT_NOT_FOUND', error: 'project not found' };
    }
    if (meta.status === 'degraded') {
      return { ok: false, code: 'PROJECT_DEGRADED', error: 'project hive is missing' };
    }
    if (this.activeProjectId === projectId) {
      return { ok: true, project: meta };
    }

    const fromId = this.activeProjectId;
    const pty = this.opts.pty;
    if (pty) {
      const currentActive = pty.getActivePtyCount();
      const oldProjectRunning = fromId
        ? pty.countProjectSessions(fromId, { runningOnly: true })
        : 0;
      const targetProjectSessions = pty.countProjectSessions(projectId);
      if (wouldExceedActiveLimit({
        platform: process.platform,
        currentActive,
        oldProjectRunning,
        targetProjectSessions
      })) {
        return {
          ok: false,
          code: 'RESUME_LIMIT_REACHED',
          error: 'resuming this floor would run more than 5 agents at once'
        };
      }
      if (fromId) pty.suspendProject(fromId);
      const resumed = pty.resumeProject(projectId);
      if (!resumed.ok) return resumed;
    }

    this.activeProjectId = projectId;
    this.opts.persist.setKv(ACTIVE_PROJECT_KV, projectId);
    this.opts.onActiveChanged?.(target, fromId);
    this.opts.emit?.('project:active-changed', { projectId, previousId: fromId });
    return { ok: true, project: meta };
  }

  deleteProject(projectId: string): ProjectMutationResult {
    const meta = this.metas.get(projectId);
    if (!meta) return { ok: false, code: 'PROJECT_NOT_FOUND', error: 'project not found' };
    if (!canDeleteProject(this.listProjects())) {
      return { ok: false, code: 'LAST_PROJECT', error: 'cannot delete the last project' };
    }

    const home = this.opts.getHarnessHome();
    const remaining = this.listProjects().find((p) => p.projectId !== projectId);
    if (this.activeProjectId === projectId && remaining) {
      const switched = this.activate(remaining.projectId);
      if (!switched.ok) return switched;
    }

    this.opts.pty?.killProject(projectId);
    const hive = this.hives.get(projectId);
    try { hive?.stopRouter(); } catch { /* best-effort */ }
    this.opts.onProjectRemoved?.(projectId);
    this.hives.delete(projectId);
    this.metas.delete(projectId);
    if (home) {
      const projectRoot = projectRootOf(home, projectId);
      try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    this.opts.persist.deleteProjectRow(projectId);
    this.opts.emit?.('project:changed', { projectId, action: 'delete' });
    return { ok: true, project: meta };
  }

  /**
   * Materialize a hub floor on this machine. Same projectId as the catalog so
   * seats line up. If the floor is already local, return it.
   */
  async importProject(input: {
    projectId: string;
    name: string;
    godCharacter: OfficeCharacterName;
    defaultCwd?: string;
    agents?: Array<{ agentId: string; name?: string; character?: string }>;
  }): Promise<ProjectMutationResult> {
    const existing = this.metas.get(input.projectId);
    if (existing) return { ok: true, project: existing };
    const extras = new Set<OfficeCharacterName>();
    for (const a of input.agents ?? []) {
      const ch = a.character || a.agentId;
      if (isOfficeCharacter(ch) && ch !== input.godCharacter) extras.add(ch);
    }
    const roles: CreateProjectRole[] = [
      { character: input.godCharacter, asGod: true },
      ...[...extras].map((character) => ({ character, asGod: false }))
    ];
    return this.createProject({
      name: input.name,
      defaultCwd: input.defaultCwd,
      roles,
      projectId: input.projectId,
      activate: true
    });
  }

  /** Copy `<harnessHome>/hive` into `projects/default` and rename the original. */
  migrateLegacy(home: string): boolean {
    if (this.opts.persist.listProjects().length > 0) return false;

    const projectId = DEFAULT_PROJECT_ID;
    const projectRoot = projectRootOf(home, projectId);
    const newHive = join(projectRoot, 'hive');
    const oldHive = join(home, 'hive');
    const oldRoster = join(home, 'roster.json');
    const hasLegacy = existsSync(oldHive) || existsSync(oldRoster);
    const hasNew = existsSync(newHive);
    if (!hasLegacy && !hasNew) return false;

    mkdirSync(projectRoot, { recursive: true });
    if (existsSync(oldHive) && !hasNew) {
      cpSync(oldHive, newHive, { recursive: true, force: true, dereference: false });
      const backup = join(home, LEGACY_HIVE_BACKUP);
      if (!existsSync(backup)) {
        try { renameSync(oldHive, backup); } catch { /* copy already succeeded */ }
      }
    } else if (!hasNew) {
      mkdirSync(newHive, { recursive: true });
    }

    if (existsSync(oldRoster)) {
      const destRoster = join(projectRoot, 'roster.json');
      if (!existsSync(destRoster)) {
        try { copyFileSync(oldRoster, destRoster); } catch { /* best-effort */ }
      }
      const backup = join(home, LEGACY_ROSTER_BACKUP);
      if (!existsSync(backup)) {
        try { renameSync(oldRoster, backup); } catch { /* copy already succeeded */ }
      }
    }

    const hiveReady = existsSync(newHive);
    this.opts.persist.insertProject({
      projectId,
      name: 'Default',
      createdAt: Date.now(),
      status: hiveReady ? 'active' : 'degraded',
      defaultCwd: null,
      hiveRootPath: newHive,
      godCharacter: 'michael'
    });
    return true;
  }

  private attachRow(row: ProjectRow, home: string): void {
    if (this.hives.has(row.projectId)) return;
    const projectRoot = projectRootOf(home, row.projectId);
    const hiveReady = existsSync(row.hiveRootPath) || existsSync(join(projectRoot, 'hive'));
    const meta = rowToMeta({
      ...row,
      status: hiveReady ? row.status : 'degraded'
    });
    if (meta.status !== row.status) {
      this.opts.persist.updateProject(row.projectId, { status: meta.status });
    }
    const hive = new HiveManager(() => projectRoot, this.opts.emit, row.projectId);
    this.hives.set(row.projectId, hive);
    this.metas.set(row.projectId, meta);
    this.bindHive(hive);
    this.opts.onProjectReady?.(hive);
  }

  private bindHive(hive: HiveManager): void {
    hive.setCrossFloorRouter((msg, addr) => this.deliverCrossFloor(hive.projectId, msg, addr));
  }

  /**
   * Drop mail into another project's inbox. Never resumes the target PTY —
   * a paused floor (or a remote seat) reads it from disk later.
   */
  deliverCrossFloor(fromProjectId: string, msg: HiveMessage, addr: FloorAddress): boolean {
    const targetHive = this.hives.get(addr.projectId);
    if (!targetHive) return false;
    const inbound: HiveMessage = {
      ...msg,
      from: stampFloorFrom(fromProjectId, msg.from),
      to: addr.agentId
    };
    return targetHive.acceptInbound(inbound);
  }

  promote(projectId: string, agentId: string): ProjectMutationResult & { godId?: string; previousGodId?: string | null } {
    const hive = this.hives.get(projectId);
    const meta = this.metas.get(projectId);
    if (!hive || !meta) return { ok: false, code: 'PROJECT_NOT_FOUND', error: 'project not found' };
    const promoted = hive.promoteGod(agentId);
    if (!promoted.ok) {
      const code = promoted.error.includes('assistant') ? 'NOT_GOD_ELIGIBLE' : 'NOT_GOD_ELIGIBLE';
      return { ok: false, code, error: promoted.error };
    }
    const home = this.opts.getHarnessHome();
    const projectRoot = home ? projectRootOf(home, projectId) : undefined;
    let godCharacter = meta.godCharacter;
    if (projectRoot) {
      const roster = new RosterStore(() => projectRoot);
      const snap = roster.read();
      if (snap && Array.isArray(snap.agents)) {
        const agents = snap.agents.map((raw) => {
          const a = raw as { id?: string; isGod?: boolean; character?: unknown };
          if (typeof a.id !== 'string') return raw;
          return { ...a, isGod: a.id === agentId };
        });
        const godRow = agents.find((raw) => (raw as { id?: string }).id === agentId) as { character?: unknown } | undefined;
        if (godRow && isOfficeCharacter(godRow.character)) godCharacter = godRow.character;
        roster.write({ ...snap, agents, selectedId: snap.selectedId });
      }
    }
    const nextMeta = { ...meta, godCharacter };
    this.metas.set(projectId, nextMeta);
    this.opts.persist.updateProject(projectId, { godCharacter });
    this.opts.emit?.('project:changed', { projectId, action: 'promote', godId: agentId });
    return { ok: true, project: nextMeta, godId: agentId, previousGodId: promoted.previousGodId };
  }

  async spinOut(input: {
    sourceProjectId: string;
    agentId: string;
    name?: string;
  }): Promise<ProjectMutationResult> {
    const source = this.hives.get(input.sourceProjectId);
    const sourceMeta = this.metas.get(input.sourceProjectId);
    if (!source || !sourceMeta) {
      return { ok: false, code: 'PROJECT_NOT_FOUND', error: 'source project not found' };
    }
    const home = this.opts.getHarnessHome();
    if (!home) return { ok: false, code: 'CREATE_FAILED', error: 'no harnessHome' };
    const projectRoot = projectRootOf(home, input.sourceProjectId);
    const roster = new RosterStore(() => projectRoot);
    const snap = roster.read();
    const row = Array.isArray(snap?.agents)
      ? snap.agents.find((raw) => (raw as { id?: string }).id === input.agentId) as {
          id?: string; name?: string; character?: unknown; isGod?: boolean; isAssistant?: boolean;
        } | undefined
      : undefined;
    if (!row || !isOfficeCharacter(row.character)) {
      return { ok: false, code: 'NOT_GOD_ELIGIBLE', error: 'that seat has no office character to spin out' };
    }
    if (row.isAssistant) {
      return { ok: false, code: 'NOT_GOD_ELIGIBLE', error: 'the send-only assistant cannot open a floor' };
    }
    const name = input.name?.trim() || `${row.name || row.character}'s floor`;
    return this.createProject({
      name,
      defaultCwd: sourceMeta.defaultCwd,
      roles: [{ character: row.character, asGod: true }],
      activate: false
    });
  }
}

export type { OfficeCharacterName };
