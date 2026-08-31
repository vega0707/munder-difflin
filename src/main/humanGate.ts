/**
 * Human-gate sync — when a kanban card waits on the human (blocked + open
 * humanQA), the assignee agent must not keep running tools or getting inbox
 * nudges. Pure helpers so unit tests need no Electron.
 */

export interface HumanGateTask {
  status?: string;
  assignee?: string;
  humanQA?: Array<{ q?: string; a?: string; dismissedAt?: string }>;
}

export function taskHasOpenHumanAsk(t: HumanGateTask): boolean {
  if (!Array.isArray(t.humanQA)) return false;
  for (let i = t.humanQA.length - 1; i >= 0; i--) {
    const e = t.humanQA[i];
    if (e && typeof e.q === 'string' && !e.a && !e.dismissedAt) return true;
  }
  return false;
}

/** Waiting on the human = blocked with an unanswered / undismissed ask. */
export function taskWaitsOnHuman(t: HumanGateTask): boolean {
  return t.status === 'blocked' && taskHasOpenHumanAsk(t);
}

/** Agent ids that are assignees of at least one waits-on-human card. */
export function agentsAwaitingHuman(tasks: readonly HumanGateTask[]): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) {
    if (!taskWaitsOnHuman(t)) continue;
    const id = typeof t.assignee === 'string' ? t.assignee.trim() : '';
    if (id) out.add(id);
  }
  return out;
}

export interface AwaitingHumanControl {
  setAwaitingHuman(id: string, on: boolean): void;
  isAwaitingHuman(id: string): boolean;
}

/**
 * Align ControlRegistry awaitingHuman flags with the task ledger.
 * `knownAgentIds` are cleared to false when no longer waiting so a resolved
 * ask resumes tool use without a manual operator resume.
 */
export function syncAwaitingHuman(
  control: AwaitingHumanControl,
  waiting: ReadonlySet<string>,
  knownAgentIds: readonly string[]
): void {
  const seen = new Set<string>();
  for (const id of knownAgentIds) {
    seen.add(id);
    control.setAwaitingHuman(id, waiting.has(id));
  }
  for (const id of waiting) {
    if (seen.has(id)) continue;
    control.setAwaitingHuman(id, true);
  }
}
