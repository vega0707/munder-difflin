/**
 * Shapes shared between the 程小帮 run client (main) and whatever reports on it.
 * Only what has actually been observed in a response is modelled; the run client
 * skips anything it does not recognise rather than failing the whole run.
 */

export interface ChengxiaobangSession {
  id: string;
  projectId?: string | null;
  title?: string;
  /** Which 程小帮 provider the app picked (observed: `ctrip-chat`). */
  providerId?: string;
  /** What the app resolved the requested model to (observed: `auto` → `auto(free)`). */
  model?: string;
  accessMode?: string;
}

export interface ChengxiaobangUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
}

/** One file a run touched, as `run_end` reports it. This is what the revert
 *  endpoint operates on, so the changes a run made are knowable from the stream
 *  itself rather than by diffing afterwards. */
export interface ChengxiaobangFileChange {
  path: string;
  /** Observed: `write`. */
  operation?: string;
  /** Unified diff. */
  patch?: string;
  additions?: number;
  deletions?: number;
  beforeExisted?: boolean;
  toolCallIds?: string[];
}

/** `undo` rolls back to before this run; `redo` applies it again. */
export type ChengxiaobangRevertDirection = 'undo' | 'redo';

/** One tool call the run made. `pending_approval` is the one that needs an
 *  answer before the run can continue; the rest are progress. */
export interface ChengxiaobangToolCall {
  id: string;
  name: string;
  status: string;
  args?: Record<string, unknown>;
}

export interface ChengxiaobangRunResult {
  ok: boolean;
  /** The assistant's answer: the joined text deltas, or the final message. */
  text: string;
  runId?: string;
  status?: string;
  usage?: ChengxiaobangUsage;
  /** Files this run changed, so they can be shown and undone. */
  fileChanges?: ChengxiaobangFileChange[];
  /** Tool calls seen, latest status each. Carries `pending_approval`. */
  toolCalls?: ChengxiaobangToolCall[];
  error?: string;
  /** Event types seen, in order — diagnostics when a run misbehaves. */
  events: string[];
}
