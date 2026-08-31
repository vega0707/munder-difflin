import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HiveMessage, HiveTask } from './hive';
import {
  type RunRecord,
  type RunsFile,
  type TaskLike,
  type FlowDefaultView,
  createRunFromRequest,
  syncRunStepsFromTasks,
  computeDefaultView,
  prepareRetry,
  clearRetryLatch,
  taskToStepStatus
} from '../shared/runFlow';

const EMPTY_FILE = (): RunsFile => ({ version: 1, runs: [] });

/** Durable Run projection under `<hive>/runs.json`. Tasks remain authoritative. */
export class RunProjectionStore {
  constructor(private rootFn: () => string | null) {}

  private filePath(): string | null {
    const root = this.rootFn();
    return root ? join(root, 'runs.json') : null;
  }

  load(): RunsFile {
    const p = this.filePath();
    if (!p || !existsSync(p)) return EMPTY_FILE();
    try {
      const data = JSON.parse(readFileSync(p, 'utf8')) as RunsFile;
      if (data.version !== 1 || !Array.isArray(data.runs)) return EMPTY_FILE();
      return data;
    } catch {
      return EMPTY_FILE();
    }
  }

  save(data: RunsFile): void {
    const p = this.filePath();
    const root = this.rootFn();
    if (!p || !root) return;
    mkdirSync(root, { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  }

  list(): RunRecord[] {
    return this.load().runs;
  }

  get(id: string): RunRecord | null {
    return this.load().runs.find((r) => r.id === id) ?? null;
  }

  defaultView(): FlowDefaultView {
    return computeDefaultView(this.list());
  }

  upsertRun(run: RunRecord): void {
    const data = this.load();
    const i = data.runs.findIndex((r) => r.id === run.id);
    if (i >= 0) data.runs[i] = run;
    else data.runs.push(run);
    data.lastActiveRunId = run.id;
    this.save(data);
  }

  /** New human request opens a Run when conversation is new. */
  onHumanRequest(msg: HiveMessage): RunRecord | null {
    if (msg.act !== 'request') return null;
    const data = this.load();
    const open = data.runs.find(
      (r) => r.conversation === msg.conversation && r.status === 'in_progress'
    );
    if (open) {
      data.lastActiveRunId = open.id;
      this.save(data);
      return open;
    }
    const run = createRunFromRequest(
      msg.conversation,
      (msg.subject || msg.body || 'Run').slice(0, 120),
      msg.id
    );
    data.runs.push(run);
    data.lastActiveRunId = run.id;
    this.save(data);
    return run;
  }

  /** Attach new tasks to the active in-progress Run and sync step states.
   *  TODO[CONCURRENCY]: only one active Run claims unassigned tasks; parallel Runs
   *  must set task.runId explicitly (addTask stamps lastActiveRunId). */
  syncFromTasks(tasks: HiveTask[]): void {
    const data = this.load();
    if (!data.runs.length) return;
    const taskList = tasks as TaskLike[];

    const active = data.lastActiveRunId
      ? data.runs.find((r) => r.id === data.lastActiveRunId && r.status === 'in_progress')
      : data.runs.find((r) => r.status === 'in_progress');

    if (active) {
      const claimed = new Set(active.steps.map((s) => s.taskId));
      for (const t of tasks) {
        if (claimed.has(t.id)) continue;
        if (t.runId && t.runId !== active.id) continue;
        claimed.add(t.id);
        active.steps.push({
          taskId: t.id,
          status: taskToStepStatus(t.status),
          source: 'auto',
          title: t.title,
          output: t.result ?? t.description
        });
      }
    }

    data.runs = data.runs.map((run) => syncRunStepsFromTasks(run, taskList));
    this.save(data);
  }

  beginRetry(runId: string): ReturnType<typeof prepareRetry> {
    const data = this.load();
    const idx = data.runs.findIndex((r) => r.id === runId);
    if (idx < 0) return { ok: false, error: 'not-found' };
    const prep = prepareRetry(data.runs[idx]);
    if (!prep.ok) return prep;
    data.runs[idx] = prep.run;
    this.save(data);
    return prep;
  }

  finishRetry(runId: string): void {
    const data = this.load();
    const idx = data.runs.findIndex((r) => r.id === runId);
    if (idx < 0) return;
    data.runs[idx] = clearRetryLatch(data.runs[idx]);
    this.save(data);
  }

  abortRetry(runId: string): void {
    this.finishRetry(runId);
  }
}
