/** Run / Step projection types and pure logic for the Flow tab. */

export type RunStatus = 'in_progress' | 'success' | 'failed';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type StepSource = 'plan' | 'auto';

export interface RunStep {
  taskId: string;
  status: StepStatus;
  source: StepSource;
  title?: string;
  summary?: string;
  output?: string;
}

export interface RunRecord {
  id: string;
  conversation: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  steps: RunStep[];
  failedStepIndex?: number;
  retryInFlight?: boolean;
  seedMessageId?: string;
}

export interface RunsFile {
  version: 1;
  lastActiveRunId?: string;
  runs: RunRecord[];
}

export type FlowViewMode = 'empty' | 'single' | 'overview' | 'ended';

export interface FlowDefaultView {
  mode: FlowViewMode;
  runId?: string;
  runIds?: string[];
}

/** Minimal task fields used to derive steps (matches hive task ledger). */
export interface TaskLike {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'blocked' | 'done';
  dependsOn?: string[];
  runId?: string;
  result?: string;
  description?: string;
}

export function taskToStepStatus(status: TaskLike['status']): StepStatus {
  switch (status) {
    case 'done': return 'done';
    case 'doing': return 'running';
    case 'blocked': return 'failed';
    case 'todo': return 'pending';
    default: return 'pending';
  }
}

export function topoSortTasks(tasks: TaskLike[]): TaskLike[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const out: TaskLike[] = [];

  const visit = (id: string, stack: Set<string>) => {
    if (visited.has(id)) return;
    if (stack.has(id)) return;
    stack.add(id);
    const t = byId.get(id);
    if (!t) return;
    for (const dep of t.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep, stack);
    }
    stack.delete(id);
    visited.add(id);
    out.push(t);
  };

  for (const t of tasks) visit(t.id, new Set());
  return out;
}

export function buildStepsFromTasks(
  tasks: TaskLike[],
  taskIds: string[],
  defaultSource: StepSource = 'plan'
): RunStep[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const subset = taskIds.map((id) => byId.get(id)).filter((t): t is TaskLike => !!t);
  const ordered = topoSortTasks(subset);
  return ordered.map((t) => ({
    taskId: t.id,
    status: taskToStepStatus(t.status),
    source: defaultSource,
    title: t.title,
    output: t.result ?? t.description
  }));
}

export function syncRunStepsFromTasks(run: RunRecord, tasks: TaskLike[]): RunRecord {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const knownIds = run.steps.map((s) => s.taskId).filter((id) => byId.has(id));
  const linked = tasks.filter((t) => t.runId === run.id).map((t) => t.id);
  const allIds = [...new Set([...knownIds, ...linked])];
  const sourceByTask = new Map(run.steps.map((s) => [s.taskId, s.source]));
  const steps = buildStepsFromTasks(tasks, allIds).map((s) => ({
    ...s,
    source: sourceByTask.get(s.taskId) ?? s.source
  }));
  return deriveRunStatus({ ...run, steps });
}

export function deriveRunStatus(run: RunRecord): RunRecord {
  const failedIdx = run.steps.findIndex((s) => s.status === 'failed');
  const allDone = run.steps.length > 0
    && run.steps.every((s) => s.status === 'done' || s.status === 'skipped');
  if (failedIdx >= 0) {
    return {
      ...run,
      status: 'failed',
      failedStepIndex: failedIdx,
      endedAt: run.endedAt ?? new Date().toISOString()
    };
  }
  if (allDone) {
    return {
      ...run,
      status: 'success',
      failedStepIndex: undefined,
      endedAt: run.endedAt ?? new Date().toISOString()
    };
  }
  return { ...run, status: 'in_progress', failedStepIndex: undefined, endedAt: undefined };
}

export function computeDefaultView(runs: RunRecord[]): FlowDefaultView {
  const inProgress = runs.filter((r) => r.status === 'in_progress');
  if (inProgress.length >= 2) {
    return { mode: 'overview', runIds: inProgress.map((r) => r.id) };
  }
  if (inProgress.length === 1) {
    return { mode: 'single', runId: inProgress[0].id };
  }
  const ended = runs.filter((r) => r.status === 'success' || r.status === 'failed');
  if (!ended.length) return { mode: 'empty' };
  const latest = [...ended].sort(
    (a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt)
  )[0];
  return { mode: 'ended', runId: latest.id };
}

export function createRunFromRequest(
  conversation: string,
  title: string,
  seedMessageId?: string,
  now = () => Date.now(),
  rand = () => Math.random().toString(36).slice(2, 8)
): RunRecord {
  const ts = new Date(now()).toISOString();
  return {
    id: `run-${now()}-${rand()}`,
    conversation,
    title: title || 'Run',
    status: 'in_progress',
    startedAt: ts,
    steps: [],
    seedMessageId,
    retryInFlight: false
  };
}

export type RetryPrep =
  | { ok: true; run: RunRecord; taskIdsToReset: string[] }
  | { ok: false; error: string };

export function prepareRetry(run: RunRecord): RetryPrep {
  if (run.retryInFlight) return { ok: false, error: 'retry-in-flight' };
  if (run.status !== 'failed') return { ok: false, error: 'not-failed' };
  const failIdx = run.failedStepIndex ?? run.steps.findIndex((s) => s.status === 'failed');
  if (failIdx < 0) return { ok: false, error: 'no-failed-step' };
  const taskIdsToReset = run.steps.slice(failIdx).map((s) => s.taskId);
  const steps = run.steps.map((s, i) => (
    i >= failIdx ? { ...s, status: 'pending' as StepStatus } : s
  ));
  return {
    ok: true,
    run: {
      ...run,
      status: 'in_progress',
      retryInFlight: true,
      failedStepIndex: undefined,
      endedAt: undefined,
      steps
    },
    taskIdsToReset
  };
}

export function clearRetryLatch(run: RunRecord): RunRecord {
  return { ...run, retryInFlight: false };
}

export function markStepFailed(run: RunRecord, taskId: string): RunRecord {
  const steps = run.steps.map((s) => (
    s.taskId === taskId ? { ...s, status: 'failed' as StepStatus } : s
  ));
  return deriveRunStatus({ ...run, steps });
}
