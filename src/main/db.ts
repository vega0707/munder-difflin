/**
 * PersistStore — durable harness state in SQLite (better-sqlite3, synchronous).
 *
 * Phase A scope (the rest of the renderer state stays in localStorage for now):
 *   - kv:               scalar app state. Today: the main window's bounds.
 *   - command_history:  NET-NEW — every prompt the user submits to an agent.
 *
 * Lives in the Electron MAIN process (better-sqlite3 is native + synchronous);
 * the renderer reaches it over IPC. The DB file sits next to config.json under
 * app.getPath('userData'). WAL mode so reads never block the single writer.
 *
 * Schema evolves via PRAGMA user_version migrations: an ordered array where
 * migration N runs when user_version < N+1, then bumps it. NEVER edit a shipped
 * migration — only append. Phases B/C (agents + message_queue mirror) and the
 * cross-lane cost_ledger are reserved as future additive migrations (see below);
 * they are deliberately NOT built in v1.
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import type { ProjectRow, ProjectStatus } from '../shared/projectTypes';

/** A captured user prompt, as returned to the renderer (camelCase columns). */
export interface CommandHistoryRow {
  id: number;
  agentId: string;
  cwd: string | null;
  text: string;
  ts: number;
}

/**
 * Ordered, append-only migrations. Index N takes the DB from user_version N to
 * N+1. To evolve the schema, APPEND a new function — never edit an existing one
 * (shipped DBs have already run it).
 *
 * FUTURE (do NOT build in v1 — reserved so the array isn't painted into a corner):
 *   - Phase B: `agents` + `message_queue` mirror of the renderer roster/queues
 *     (dual-write), enabling the eventual authority flip off localStorage.
 *   - Cross-lane (Lane A #6): migrate Jim's cost ledger onto this DB so his
 *     circuit-breaker can move off transcript-polling. Column names match his
 *     <harnessHome>/hive/cost-ledger.jsonl keys 1:1 for a straight INSERT…SELECT
 *     (coordinated w/ jim-mq290qkn 2026-06-06):
 *       cost_ledger(id, agent_id, session_id TEXT, ts, input, output,
 *                   cache_read, cache_creation, model TEXT, usd REAL)
 *     Rows are CUMULATIVE snapshots (one per agent per heartbeat beat) — diff
 *     consecutive rows for velocity; index (agent_id, session_id, ts). Additive;
 *     lands as a later migration.
 */
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // → user_version 1 (Phase A): scalar kv + net-new command history.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,     -- JSON-encoded
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command_history (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        cwd      TEXT,
        text     TEXT NOT NULL,
        ts       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ch_agent_ts ON command_history(agent_id, ts DESC);
    `);
  },
  // → user_version 2: multi-project metadata + optional project_id on history.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'degraded', 'pending-deletion')),
        default_cwd TEXT,
        hive_root_path TEXT NOT NULL,
        god_character TEXT NOT NULL DEFAULT 'michael'
      );
    `);
    db.exec(`ALTER TABLE command_history ADD COLUMN project_id TEXT`);
  }
];

export class PersistStore {
  private db: Database.Database | null = null;

  /** @param dbPath  Override the DB location (tests). Defaults to userData/harness.db. */
  constructor(private dbPath?: string) {}

  /** Open (creating if needed) and migrate the DB. Idempotent — a second call is
   *  a no-op. Throws if the native module fails to load or the file is unusable;
   *  callers should guard so a DB failure can't crash app startup. */
  open(): void {
    if (this.db) return;
    const path = this.dbPath ?? join(app.getPath('userData'), 'harness.db');
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    this.migrate(db);
    this.db = db;
  }

  private migrate(db: Database.Database): void {
    const version = db.pragma('user_version', { simple: true }) as number;
    for (let i = version; i < MIGRATIONS.length; i++) {
      // Each migration + its version bump run in one transaction so a crash
      // mid-migration never leaves a half-applied schema at the wrong version.
      const run = db.transaction(() => {
        MIGRATIONS[i](db);
        db.pragma(`user_version = ${i + 1}`);
      });
      run();
    }
  }

  /** Close the handle (checkpoints WAL). Safe to call when already closed. */
  close(): void {
    try { this.db?.close(); } catch { /* best-effort on shutdown */ }
    this.db = null;
  }

  get isOpen(): boolean { return this.db !== null; }

  // ─── kv (scalar app state) ─────────────────────────────────────────────────

  /** Read a JSON-decoded scalar, or undefined if absent/unparseable. */
  getKv<T = unknown>(key: string): T | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.value) as T; } catch { return undefined; }
  }

  /** Upsert a JSON-encoded scalar. */
  setKv(key: string, value: unknown): void {
    if (!this.db) return;
    this.db.prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, JSON.stringify(value), Date.now());
  }

  // ─── command history (net-new) ─────────────────────────────────────────────

  /** Record one submitted prompt. Empty text or missing agent id are ignored. */
  addHistory(entry: { agentId: string; cwd?: string | null; text: string }): void {
    if (!this.db) return;
    const text = (entry.text ?? '').trim();
    if (!text || !entry.agentId) return;
    this.db.prepare('INSERT INTO command_history (agent_id, cwd, text, ts) VALUES (?, ?, ?, ?)')
      .run(entry.agentId, entry.cwd ?? null, text, Date.now());
  }

  /** Most-recent-first history, optionally scoped to one agent. */
  listHistory(agentId?: string, limit = 100): CommandHistoryRow[] {
    if (!this.db) return [];
    const lim = clampLimit(limit, 100);
    const rows = agentId
      ? this.db.prepare(
          'SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history WHERE agent_id = ? ORDER BY ts DESC, id DESC LIMIT ?'
        ).all(agentId, lim)
      : this.db.prepare(
          'SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history ORDER BY ts DESC, id DESC LIMIT ?'
        ).all(lim);
    return rows as CommandHistoryRow[];
  }

  /** Substring search over prompt text, most-recent-first. */
  searchHistory(query: string, limit = 50): CommandHistoryRow[] {
    if (!this.db) return [];
    const q = (query ?? '').trim();
    if (!q) return [];
    const lim = clampLimit(limit, 50);
    // Escape LIKE wildcards so a literal % or _ in the query isn't a metachar.
    const needle = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.prepare(
      "SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history WHERE text LIKE ? ESCAPE '\\' ORDER BY ts DESC, id DESC LIMIT ?"
    ).all(needle, lim) as CommandHistoryRow[];
  }

  // ─── projects (multi-hive) ─────────────────────────────────────────────────

  /** TODO[REENTRANCY] 幂等: 同 projectId 再 insert 走 PRIMARY KEY 冲突，由调用方决定是否先 get。 */
  insertProject(row: ProjectRow): void {
    if (!this.db) return;
    this.db.prepare(
      `INSERT INTO projects (project_id, name, created_at, status, default_cwd, hive_root_path, god_character)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.projectId, row.name, row.createdAt, row.status, row.defaultCwd, row.hiveRootPath, row.godCharacter);
  }

  getProject(projectId: string): ProjectRow | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare(
      `SELECT project_id AS projectId, name, created_at AS createdAt, status,
              default_cwd AS defaultCwd, hive_root_path AS hiveRootPath,
              god_character AS godCharacter
       FROM projects WHERE project_id = ?`
    ).get(projectId) as ProjectRow | undefined;
    return row;
  }

  listProjects(): ProjectRow[] {
    if (!this.db) return [];
    return this.db.prepare(
      `SELECT project_id AS projectId, name, created_at AS createdAt, status,
              default_cwd AS defaultCwd, hive_root_path AS hiveRootPath,
              god_character AS godCharacter
       FROM projects ORDER BY created_at ASC, project_id ASC`
    ).all() as ProjectRow[];
  }

  updateProject(projectId: string, patch: Partial<Omit<ProjectRow, 'projectId'>>): void {
    if (!this.db) return;
    const current = this.getProject(projectId);
    if (!current) return;
    const next: ProjectRow = {
      ...current,
      ...patch,
      projectId,
      status: (patch.status ?? current.status) as ProjectStatus
    };
    this.db.prepare(
      `UPDATE projects SET name = ?, created_at = ?, status = ?, default_cwd = ?, hive_root_path = ?, god_character = ?
       WHERE project_id = ?`
    ).run(next.name, next.createdAt, next.status, next.defaultCwd, next.hiveRootPath, next.godCharacter, projectId);
  }

  deleteProjectRow(projectId: string): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
  }
}

/** Coerce an untrusted limit into [1, 1000] with a sane fallback. */
function clampLimit(n: number, fallback: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(1000, v);
}
