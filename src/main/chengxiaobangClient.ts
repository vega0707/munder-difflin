/**
 * 程小帮 run client.
 *
 * This is the one way to actually "call 程小帮": its local API runs agents itself.
 * A run is a session plus an SSE stream —
 *
 *   POST /api/sessions        → { session }        (optional title/projectId/providerId/model)
 *   POST /api/runs/stream     → text/event-stream  ({ sessionId, prompt, model? })
 *   POST /api/runs/:id/abort  → cancel a live run
 *   DELETE /api/sessions/:id  → { deleted: true }
 *
 * Verified against the running app (2026-09-13). One tiny prompt produced:
 *
 *   event: run_started  {"type":"run_started","runId":…,"providerId":"ctrip-chat","model":"auto(free)"}
 *   event: message      {"type":"message","message":{"role":"user","content":…}}
 *   event: delta        {"type":"delta","channel":"text","delta":"好了"}
 *   event: message      {"type":"message","message":{"role":"assistant","content":"好了"}}
 *   event: run_end      {"type":"run_end","status":"completed","usage":{"promptTokens":38504,…}}
 *
 * Notes that matter for how this is used:
 *   - The caller passes `model: 'auto'` and the app resolves it to `auto(free)` and
 *     picks the provider itself. So the model vocabulary belongs to 程小帮, not to
 *     whatever channel this machine's CLIs are configured against.
 *   - Its run is already an agent: it has its own tools, plan mode and approvals.
 *     Wrapping it in another tool loop would double the agent, so the seat this
 *     serves hands the task over wholesale and delivers the answer it gets back.
 *   - The token is the LOCAL app's token. It is therefore only ever sent to a
 *     loopback address — see assertLoopback.
 */
import type { ChengxiaobangRunResult, ChengxiaobangSession } from '../shared/chengxiaobang';

export interface ChengxiaobangClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = 'http://127.0.0.1:42527';

/** The token belongs to the local app, so it must never leave this machine. */
function assertLoopback(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '');
  let host: string;
  try {
    host = new URL(normalized).hostname;
  } catch {
    throw new Error(`程小帮 api base is not a URL: ${baseUrl}`);
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(`refusing to send the 程小帮 token to ${host} — it is a local-app token`);
  }
  return normalized;
}

export class ChengxiaobangClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ChengxiaobangClientOptions = {}) {
    this.base = assertLoopback(opts.baseUrl ?? process.env.CHENGXIAOBANG_API_BASE ?? DEFAULT_BASE);
    this.token = (opts.token ?? process.env.CHENGXIAOBANG_API_TOKEN ?? '').trim();
    if (!this.token) throw new Error('程小帮 needs CHENGXIAOBANG_API_TOKEN (the local app token)');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Is the app actually running and accepting this token? */
  async probe(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/health`, { headers: this.headers() });
      return res.ok;
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    return { 'x-chengxiaobang-token': this.token, accept: 'application/json' };
  }

  async createSession(input: {
    title?: string;
    projectId?: string;
    providerId?: string;
    model?: string;
    accessMode?: string;
  } = {}): Promise<ChengxiaobangSession> {
    const res = await this.fetchImpl(`${this.base}/api/sessions`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!res.ok) throw new Error(`程小帮 createSession HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { session?: ChengxiaobangSession };
    if (!body.session?.id) throw new Error('程小帮 createSession returned no session id');
    return body.session;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: this.headers()
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async abortRun(runId: string): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/runs/${encodeURIComponent(runId)}/abort`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: '{}'
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Run one prompt in a session and read the answer off the event stream.
   *
   * The stream is the authority: `delta` frames carry the text as it is produced
   * and `run_end` says how it finished. A dropped connection is reported as a
   * failure rather than silently returning a half answer, because 程小帮 aborts
   * the run when the consumer goes away.
   */
  async run(
    sessionId: string,
    prompt: string,
    opts: {
      model?: string;
      onEvent?: (type: string) => void;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {}
  ): Promise<ChengxiaobangRunResult> {
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const res = await this.fetchImpl(`${this.base}/api/runs/stream`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ sessionId, prompt, ...(opts.model ? { model: opts.model } : {}) }),
        signal: controller.signal
      });
      if (!res.ok) {
        return {
          ok: false,
          text: '',
          error: `程小帮 run HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
          events: []
        };
      }
      if (!res.body) return { ok: false, text: '', error: '程小帮 run returned no stream', events: [] };
      return await readRunStream(res.body, opts.onEvent);
    } catch (err) {
      const aborted = controller.signal.aborted;
      return {
        ok: false,
        text: '',
        error: aborted ? 'the run timed out or was cancelled' : err instanceof Error ? err.message : String(err),
        events: []
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}

/**
 * Read the SSE stream to its end. Also exported for tests, so the frame handling
 * is exercised against the frames a real run produced rather than a guess.
 */
export async function readRunStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: (type: string) => void
): Promise<ChengxiaobangRunResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let text = '';
  let assistantText: string | undefined;
  let runId: string | undefined;
  let status: string | undefined;
  let usage: ChengxiaobangRunResult['usage'];
  let error: string | undefined;
  const seen: string[] = [];

  const handleFrame = (frame: string): boolean => {
    // `event: x` then one or more `data: …` lines; only the data is JSON.
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (!dataLines.length) return false;
    let payload: {
      type?: string;
      runId?: string;
      status?: string;
      delta?: string;
      channel?: string;
      message?: { role?: string; content?: string };
      usage?: ChengxiaobangRunResult['usage'];
      error?: unknown;
    };
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return false; // a frame we cannot read is skipped, not fatal
    }
    if (payload.runId && !runId) runId = payload.runId;
    if (payload.type && !seen.includes(payload.type)) {
      seen.push(payload.type);
      onEvent?.(payload.type);
    }
    switch (payload.type) {
      case 'delta':
        // Only the text channel; other channels carry tool/reasoning output.
        if (payload.channel === 'text' && payload.delta) text += payload.delta;
        return false;
      case 'message':
        // The final assistant message repeats what the deltas built, and is the
        // only thing present if the deltas were dropped. Prefer it verbatim.
        if (payload.message?.role === 'assistant' && typeof payload.message.content === 'string') {
          assistantText = payload.message.content;
        }
        return false;
      case 'run_end':
        status = payload.status;
        usage = payload.usage;
        if (payload.status && payload.status !== 'completed' && payload.status !== 'done') {
          error = `run ended with status "${payload.status}"`;
        }
        return true;
      case 'error':
        error = typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error ?? 'unknown error');
        return true;
      default:
        return false;
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffered.indexOf('\n\n')) >= 0) {
        const frame = buffered.slice(0, idx);
        buffered = buffered.slice(idx + 2);
        if (frame.trim() && handleFrame(frame)) {
          await reader.cancel().catch(() => {});
          return finish();
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  // SSE dispatches a pending event when the stream ends, so a last frame that
  // arrived without its blank-line terminator still counts. Dropping it turned a
  // finished run into "the stream ended before the run reported a result".
  if (buffered.trim()) handleFrame(buffered);

  // The stream closed without a run_end: say so instead of reporting a success
  // that the app never confirmed.
  if (!error && status === undefined) error = 'the stream ended before the run reported a result';
  return finish();

  function finish(): ChengxiaobangRunResult {
    const answer = assistantText ?? text;
    return {
      ok: !error,
      text: answer,
      ...(runId ? { runId } : {}),
      ...(status ? { status } : {}),
      ...(usage ? { usage } : {}),
      ...(error ? { error } : {}),
      events: seen
    };
  }
}
