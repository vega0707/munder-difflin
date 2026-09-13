/**
 * Task-ledger tools for the built-in seats — the delegation discipline.
 *
 * On a floor where several seats work the same board, the dangerous operations
 * are all write-side: a worker that can create cards can flood the board, and a
 * god that re-issues the same fan-out on every mail turn can duplicate the whole
 * thing. So the rules live here rather than in a prompt:
 *
 *   - Only a LEAD seat may create a card. A worker can update the cards assigned
 *     to it and nothing else.
 *   - Creating is idempotent per (conversation, title, assignee): a repeat inside
 *     the cooldown window returns the card already on the board.
 *   - One run may create at most CREATE_CAP_PER_RUN cards. That is a ceiling on
 *     one fan-out, not a board limit.
 *
 * What is deliberately NOT here: dependency unlocking, phase approval, or any
 * automatic progression. `dependsOn` is stored and read back; making it an
 * implicit state machine is how a delegation tool turns into an orchestrator.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AgentToolDef, AgentToolResult } from './agentRuntime';
import type { HiveTask, HumanQA } from './hive';

/** Ceiling on cards one lead run may add. Sized for a full fan-out plus slack. */
export const CREATE_CAP_PER_RUN = 16;

/** A repeat of the same fingerprint inside this window is treated as the same
 *  request, not a second one. */
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export interface AgentTaskHost {
  tasks(): unknown;
  addTask(task: HiveTask): boolean;
  patchTask(id: string, patch: Partial<Omit<HiveTask, 'id'>>): boolean;
}

export interface AgentTaskContext {
  host: AgentTaskHost;
  /** Lead seats (the god) may create cards; every other seat may not. */
  isLead: boolean;
  /** This seat's own id — a non-lead may only touch its own cards. */
  seatId: string;
  /** Thread id, part of the create fingerprint. */
  conversation?: string;
  capPerRun?: number;
}

/** Fingerprint → the card it produced, kept across runs so a duplicate fan-out
 *  in a later turn is still recognised. */
const recentCreates = new Map<string, { taskId: string; at: number }>();

/** Test seam: the registry is process-wide by design, so tests must reset it. */
export function resetTaskDedupe(): void {
  recentCreates.clear();
}

function fingerprint(conversation: string, title: string, assignee: string): string {
  return createHash('sha1').update(`${conversation}|${title}|${assignee}`).digest('hex').slice(0, 16);
}

function cardsOf(host: AgentTaskHost): HiveTask[] {
  const ledger = host.tasks() as { tasks?: HiveTask[] } | null;
  return Array.isArray(ledger?.tasks) ? ledger.tasks : [];
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function describe(task: HiveTask, seatId: string): string {
  const mine = task.assignee === seatId ? ' [mine]' : '';
  return `${task.id}  ${task.status.padEnd(7)}  ${(task.assignee ?? '(unassigned)').padEnd(12)}  ${task.title}${mine}`;
}

export function createAgentTaskTools(ctx: AgentTaskContext): AgentToolDef[] {
  const cap = ctx.capPerRun ?? CREATE_CAP_PER_RUN;
  const conversation = ctx.conversation ?? '';
  // Per-run counters. The tools are built once per run, so these reset with it;
  // only the dedupe registry outlives the run, which is the point of it.
  let created = 0;

  const tools: AgentToolDef[] = [
    {
      name: 'task_list',
      description: 'List the cards on this floor’s task board.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const cards = cardsOf(ctx.host);
        if (!cards.length) return { ok: true, output: '(board empty)' };
        return {
          ok: true,
          output: cards.map((t) => describe(t, ctx.seatId)).join('\n')
        };
      }
    },
    {
      name: 'task_update',
      description:
        'Update a card on the board: its status, its result summary, or who it is assigned to. A seat that is not the lead may only update cards assigned to it.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', description: 'todo | doing | blocked | done' },
          result: { type: 'string', description: 'What actually came of the work.' },
          assignee: { type: 'string' }
        },
        required: ['id']
      },
      run: async (input) => {
        const id = str(input, 'id');
        if (!id) return { ok: false, error: 'id is required' };
        const cards = cardsOf(ctx.host);
        const card = cards.find((c) => c.id === id);
        if (!card) return { ok: false, error: `no card ${id} on this board` };
        if (!ctx.isLead && card.assignee !== ctx.seatId) {
          return { ok: false, error: `card ${id} is not assigned to this seat, and only the lead may update other seats' cards` };
        }
        const patch: Partial<Omit<HiveTask, 'id'>> = {};
        const status = str(input, 'status');
        if (status) {
          if (!['todo', 'doing', 'blocked', 'done'].includes(status)) {
            return { ok: false, error: `unknown status "${status}"` };
          }
          patch.status = status as HiveTask['status'];
        }
        const result = str(input, 'result');
        if (result) patch.result = result;
        // Reassignment is a lead-only move: it changes who is responsible.
        const assignee = str(input, 'assignee');
        if (assignee) {
          if (!ctx.isLead) return { ok: false, error: 'only the lead may reassign a card' };
          patch.assignee = assignee;
        }
        if (!Object.keys(patch).length) return { ok: false, error: 'nothing to update' };
        return ctx.host.patchTask(id, patch)
          ? { ok: true, output: `updated ${id} (${Object.keys(patch).join(', ')})` }
          : { ok: false, error: `no card ${id} on this board` };
      }
    },
    {
      name: 'ask_human',
      description:
        'Raise a question only the human can answer. Ask a PEER or the god by mail FIRST. This is the last rung, for when no agent can decide. The card goes blocked and the question appears on the floor’s ASK ME board; never sit waiting on an answer.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Card id to park the question on.' },
          question: { type: 'string', description: 'The decision you need, in one short paragraph.' }
        },
        required: ['id', 'question']
      },
      run: async (input) => {
        const id = str(input, 'id');
        if (!id) return { ok: false, error: 'id is required' };
        const question = str(input, 'question');
        if (!question) return { ok: false, error: 'question is required' };
        const card = cardsOf(ctx.host).find((c) => c.id === id);
        if (!card) return { ok: false, error: `no card ${id} on this board` };
        if (!ctx.isLead && card.assignee !== ctx.seatId) {
          return { ok: false, error: `card ${id} is not assigned to this seat` };
        }
        // Same shape the orchestrator writes: status blocked + an appended entry,
        // never a replacement, because past questions document the card's
        // decisions and the ASK ME board shows the open one.
        const entry: HumanQA = { q: question, askedAt: new Date().toISOString() };
        const ok = ctx.host.patchTask(id, {
          status: 'blocked',
          humanQA: [...(card.humanQA ?? []), entry]
        });
        return ok
          ? { ok: true, output: `asked on ${id} — it is blocked and on the ASK ME board` }
          : { ok: false, error: `no card ${id} on this board` };
      }
    }
  ];

  // Only a lead gets the create tool at all: a worker asking for it should get a
  // clear answer, not a tool that fails late.
  if (ctx.isLead) {
    tools.push({
      name: 'task_create',
      description:
        'Add a card to the board and assign it to a seat. Repeating the same title and assignee within a few minutes returns the card already created instead of adding another.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          assignee: { type: 'string', description: 'Seat id that should do the work.' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Card ids this one waits on. Stored only.' },
          priority: { type: 'number' }
        },
        required: ['title']
      },
      run: async (input): Promise<AgentToolResult> => {
        const title = str(input, 'title');
        if (!title) return { ok: false, error: 'title is required' };
        const assignee = str(input, 'assignee') ?? '';
        const fp = fingerprint(conversation, title, assignee);
        const seen = recentCreates.get(fp);
        if (seen && Date.now() - seen.at < DEDUPE_WINDOW_MS) {
          return { ok: true, output: `already on the board as ${seen.taskId} (same title and assignee; not added again)` };
        }
        if (created >= cap) {
          return {
            ok: false,
            error: `this run has already created ${created} cards (cap ${cap}); do not keep fanning out`
          };
        }
        // Random suffix, not a per-run counter: two different runs can create a
        // card in the same millisecond, and an id built from ms + counter would
        // collide — the second create would then be swallowed as a duplicate.
        const id = `t-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
        const task: HiveTask = {
          id,
          title,
          status: 'todo',
          dependsOn: Array.isArray(input.dependsOn) ? (input.dependsOn as string[]) : [],
          priority: typeof input.priority === 'number' ? input.priority : 0,
          createdAt: new Date().toISOString(),
          ...(str(input, 'description') ? { description: str(input, 'description')! } : {}),
          ...(assignee ? { assignee } : {})
        };
        if (!ctx.host.addTask(task)) return { ok: false, error: `card ${id} already existed` };
        created += 1;
        recentCreates.set(fp, { taskId: id, at: Date.now() });
        return { ok: true, output: `created ${id}${assignee ? ` for ${assignee}` : ''}: ${title}` };
      }
    });
  }

  return tools;
}
