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

export interface ChengxiaobangRunResult {
  ok: boolean;
  /** The assistant's answer: the joined text deltas, or the final message. */
  text: string;
  runId?: string;
  status?: string;
  usage?: ChengxiaobangUsage;
  error?: string;
  /** Event types seen, in order — diagnostics when a run misbehaves. */
  events: string[];
}
