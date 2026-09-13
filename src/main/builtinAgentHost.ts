import { draftBuiltinReply } from '../shared/builtinAgent';
import { isInProcessChatEngine, type AgentProvider } from '../shared/agentProvider';
import { AgentRuntime, type AgentRunEvent, type AgentRunResult, type AgentToolTraceEntry, type LlmClient } from './agentRuntime';
import { createAgentTools } from './agentTools';
import { createAgentLlm } from './agentLlm';
import type { AgentLlmConfig } from './agentLlmCreds';
import type { ChengxiaobangClient } from './chengxiaobangClient';
import type { ChengxiaobangRunResult } from '../shared/chengxiaobang';
import type {
  ChengxiaobangFileChange,
  ChengxiaobangRevertDirection,
  ChengxiaobangToolCall
} from '../shared/chengxiaobang';
import type { HiveManager, HiveMessage } from './hive';
import type { SeatOccupancy } from '../shared/seats';

/** One turn of a seat's visible conversation, for its chat panel. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** What the seat actually ran to produce this answer. */
  toolTrace?: AgentToolTraceEntry[];
}

/** Recent tail kept per seat. Older turns fall off; the record is the board. */
const MAX_KEPT_TURNS = 60;

/** How long a relayed gate waits for the god before it is denied. */
const DEFAULT_APPROVAL_RELAY_MS = 120_000;

/** A 程小帮 run that is currently in flight for one seat. */
interface ChengxiaobangActiveRun {
  sessionId: string;
  /** Known only once `run_started` arrives; steering needs it. */
  runId?: string;
  abort: () => void;
  /** Every tool call seen, latest status each. A call sitting on
   *  `pending_approval` is what the run is blocked on. */
  toolCalls: Map<string, ChengxiaobangToolCall>;
  /** True when nobody is at the keyboard: the gate goes to the god instead. */
  unattended: boolean;
}

/** A permission gate relayed to the god, waiting on its answer. */
interface ChengxiaobangApprovalRelay {
  toolCallId: string;
  name: string;
  requestedAt: number;
  /** id of the mail we sent, so the reply can be matched to it. */
  requestId: string;
}

/**
 * Polls builtin-provider agents and answers hive mail on disk. No PTY.
 *
 * Two modes, and which one runs is decided by whether this machine has a model
 * channel at all (see agentLlmCreds):
 *   - WITH a channel the seat is a real agent: it gets the workspace tools and
 *     works the mail like any other seat on the floor.
 *   - WITHOUT one it stays the product's spare worker — a template reply, so a
 *     floor still opens on a machine where nothing is configured.
 */
export class BuiltinAgentHost {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  /** Built once per channel; rebuilding a client per tick would re-read config. */
  private llm: { key: string; client: LlmClient } | null = null;

  constructor(private opts: {
    listHives: () => HiveManager[];
    occupancy: (projectId: string, agentId: string) => SeatOccupancy | Promise<SeatOccupancy>;
    intervalMs?: number;
    /** Model channel for builtin seats. Absent/null → template replies. */
    llmConfig?: () => AgentLlmConfig | null;
    /** 程小帮 client for seats on that engine; null (no local app / no token)
     *  leaves those seats on the template reply. */
    chengxiaobang?: () => ChengxiaobangClient | null;
    /** Model for a 程小帮 seat. Omitted leaves the choice to the app. */
    chengxiaobangModel?: (agentId: string) => string | undefined;
    /** Builds the client for a channel. Overridden in tests with a scripted one. */
    createClient?: (cfg: AgentLlmConfig) => LlmClient;
    /** Absolute workspace for one seat, or null when it has no usable cwd. */
    seatWorkspace?: (hive: HiveManager, agentId: string, meta: { cwd?: unknown }) => string | null;
    /** Seat-assembled system prompt (floor manual, role card). */
    systemPrompt?: (hive: HiveManager, agentId: string, agentName: string) => string | undefined;
    maxSteps?: number;
    /** How long an unattended permission gate waits for the god (default 120s). */
    approvalRelayMs?: number;
    /** Progress sink for the seat's chat surface. */
    onEvent?: (projectId: string, agentId: string, event: AgentRunEvent) => void;
    /** Called after a model run so callers can record the trace. */
    onRun?: (info: {
      projectId: string;
      agentId: string;
      ok: boolean;
      text?: string;
      error?: string;
      toolTrace?: AgentToolTraceEntry[];
    }) => void;
  }) {}

  start(): void {
    if (this.timer) return;
    const ms = this.opts.intervalMs ?? 2000;
    this.timer = setInterval(() => { void this.tick(); }, ms);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // The sessions we opened are ours to close: leaving them behind would fill
    // 程小帮's own conversation list with one entry per seat.
    const client = this.opts.chengxiaobang?.() ?? null;
    if (client) {
      for (const sessionId of this.cbSessions.values()) void client.deleteSession(sessionId);
    }
    this.cbSessions.clear();
    this.cbPrimed.clear();
  }

  /** The client for the current channel, rebuilt only when the channel changes. */
  private clientFor(cfg: AgentLlmConfig): LlmClient {
    const key = `${cfg.wire}|${cfg.baseUrl}|${cfg.model ?? ''}|${cfg.source}`;
    if (this.llm?.key !== key) {
      this.llm = { key, client: this.opts.createClient?.(cfg) ?? createAgentLlm(cfg) };
    }
    return this.llm.client;
  }

  /** Turns kept per seat for its chat surface. In memory on purpose: this is the
   *  visible conversation, not the record of what happened — hive mail and the
   *  task board are. A restart is allowed to lose it. */
  private turns = new Map<string, ChatTurn[]>();
  /** One 程小帮 session per seat, opened lazily and closed on stop(). */
  private cbSessions = new Map<string, string>();
  /** Seats whose 程小帮 session has already been given the floor manual. */
  private cbPrimed = new Set<string>();
  /** Seats with a 程小帮 run in flight right now, so the UI can stop or steer it. */
  private cbActive = new Map<string, ChengxiaobangActiveRun>();
  /** The last finished run per seat, for undo: its id and what it changed. Kept
   *  after the run ends because undoing is something you do afterwards. */
  private cbLastRun = new Map<string, { runId: string; fileChanges: ChengxiaobangFileChange[] }>();
  /** Permission gates we handed to the god because nobody was at the keyboard. */
  private cbRelays = new Map<string, ChengxiaobangApprovalRelay>();

  chatHistory(projectId: string, agentId: string): ChatTurn[] {
    return this.turns.get(`${projectId}|${agentId}`) ?? [];
  }

  /** Send one chat turn to an in-process seat and return its answer. This is the
   *  path behind the seat's chat panel: same runtime, tools and prompt as the
   *  mail path, with the previous turns carried so the seat keeps the thread. */
  async sendTurn(
    projectId: string,
    agentId: string,
    text: string,
    onEvent?: (event: AgentRunEvent) => void
  ): Promise<{ ok: boolean; text?: string; error?: string; toolTrace?: AgentToolTraceEntry[] }> {
    if (!text.trim()) return { ok: false, error: 'empty message' };
    const hive = this.opts.listHives().find((h) => h.projectId === projectId);
    if (!hive) return { ok: false, error: `no floor ${projectId}` };

    let meta:
      | { name?: string; provider?: AgentProvider; cwd?: unknown; isGod?: boolean; role?: string; archived?: boolean }
      | undefined;
    try {
      meta = hive.registry().agents[agentId];
    } catch {
      return { ok: false, error: 'the hive registry is not readable' };
    }
    if (!meta) return { ok: false, error: `no seat ${agentId} on this floor` };

    const agentName = meta.name ?? agentId;
    const key = `${projectId}|${agentId}`;

    // A 程小帮 seat answers through 程小帮 whether the work arrived as mail or as a
    // typed turn. Routing typed turns through our own runtime instead would make
    // one seat behave differently depending on how it was asked, and the
    // stop/steer controls would only reach half of it.
    if (meta.provider === 'chengxiaobang') {
      const cb = this.opts.chengxiaobang?.() ?? null;
      if (!cb) return { ok: false, error: '程小帮 is not reachable from this app' };
      const primed = this.cbPrimed.has(key);
      let sessionId = this.cbSessions.get(key);
      try {
        if (!sessionId) {
          const session = await cb.createSession({ title: `${agentName} · ${projectId}` });
          sessionId = session.id;
          this.cbSessions.set(key, sessionId);
        }
        const manual = primed ? '' : (this.opts.systemPrompt?.(hive, agentId, agentName) ?? '');
        const task = manual ? `${manual}\n\n${text}` : text;
        const res = await this.runTracked(
          cb,
          hive,
          key,
          sessionId,
          task,
          projectId,
          agentId,
          this.opts.chengxiaobangModel?.(agentId),
          // Someone is here and typing, so let a tool call stop and ask. A run
          // woken by MAIL keeps the app's own default: blocking a seat on an
          // answer nobody is present to give would just stall the floor.
          'approval'
        );
        this.cbPrimed.add(key);
        this.opts.onRun?.({ projectId, agentId, ok: res.ok, text: res.text, error: res.error });
        this.remember(key, [
          { role: 'user', content: text, at: Date.now() },
          ...(res.ok && res.text ? [{ role: 'assistant' as const, content: res.text, at: Date.now() }] : [])
        ]);
        return res.ok ? { ok: true, text: res.text } : { ok: false, error: res.error ?? 'the run did not complete' };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.remember(key, [{ role: 'user', content: text, at: Date.now() }]);
        this.opts.onRun?.({ projectId, agentId, ok: false, error });
        return { ok: false, error };
      }
    }

    const cfg = this.opts.llmConfig?.() ?? null;
    if (!cfg) {
      return { ok: false, error: 'this machine has no model channel configured for built-in seats' };
    }
    const runtime = this.runtimeFor(hive, agentId, agentName, meta, cfg, { onEvent });
    if (!runtime) return { ok: false, error: 'this seat has no workspace to work in' };
    const history = this.turns.get(key) ?? [];
    let res: AgentRunResult;
    try {
      res = await runtime.run(
        text,
        history.map((turn) => ({ role: turn.role, content: turn.content }))
      );
    } catch (err) {
      // A dead channel is an answer the caller can render, not an exception that
      // blows up through IPC. Only the user's turn is kept: an empty assistant
      // bubble would read as a silent reply.
      const error = err instanceof Error ? err.message : String(err);
      this.remember(key, [{ role: 'user', content: text, at: Date.now() }]);
      this.opts.onRun?.({ projectId, agentId, ok: false, error });
      return { ok: false, error };
    }
    this.opts.onRun?.({
      projectId,
      agentId,
      ok: res.ok,
      text: res.text,
      error: res.error,
      toolTrace: res.toolTrace
    });
    this.remember(key, [
      { role: 'user', content: text, at: Date.now() },
      ...(res.text
        ? [{ role: 'assistant' as const, content: res.text, at: Date.now(), toolTrace: res.toolTrace }]
        : [])
    ]);
    return { ok: res.ok, text: res.text, error: res.error, toolTrace: res.toolTrace };
  }

  /** Append turns, keeping only the recent tail: an unbounded transcript would
   *  grow without limit in a process that may run for weeks. */
  private remember(key: string, add: ChatTurn[]): void {
    const next = [...(this.turns.get(key) ?? []), ...add];
    this.turns.set(key, next.length > MAX_KEPT_TURNS ? next.slice(-MAX_KEPT_TURNS) : next);
  }

  /** The mail, written out as the task the seat is being asked to do. */
  private taskFor(agentName: string, mail: HiveMessage[]): string {
    const body = mail
      .map(
        (m) =>
          `From ${m.from}, act=${m.act ?? 'inform'}, subject: ${m.subject ?? '(none)'}\n${m.body ?? ''}\n(reply with mail_send to "${m.from}"; message id ${m.id})`
      )
      .join('\n---\n');
    return [
      `You are ${agentName}, answering the mail below in your own workspace.`,
      'Do the work the sender is asking for, then reply to them with mail_send.',
      'Keep the reply short and report what you actually did.',
      '',
      body
    ].join('\n');
  }

  /** One runtime for one seat: its own workspace, tools, board access and prompt. */
  private runtimeFor(
    hive: HiveManager,
    agentId: string,
    agentName: string,
    meta: { cwd?: unknown; isGod?: boolean; role?: string },
    cfg: AgentLlmConfig,
    opts: { conversation?: string; onEvent?: (event: AgentRunEvent) => void } = {}
  ): AgentRuntime | null {
    const root = this.opts.seatWorkspace?.(hive, agentId, meta) ?? null;
    if (!root) return null;
    return new AgentRuntime({
      llm: this.clientFor(cfg),
      tools: createAgentTools({
        workspaceRoot: root,
        shellCwd: typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : root,
        hive,
        agentId,
        agentName,
        // The god is the only seat that may add cards; the ACL lives in the
        // tool factory, so a worker never even sees task_create.
        tasks: {
          host: hive,
          isLead: Boolean(meta.isGod),
          seatId: agentId,
          conversation: opts.conversation
        }
      }),
      maxSteps: this.opts.maxSteps ?? 24,
      systemPrompt: this.opts.systemPrompt?.(hive, agentId, agentName),
      onEvent: (event) => {
        this.opts.onEvent?.(hive.projectId, agentId, event);
        opts.onEvent?.(event);
      }
    });
  }

  private async handleWithModel(
    hive: HiveManager,
    agentId: string,
    agentName: string,
    meta: { cwd?: unknown; isGod?: boolean; role?: string },
    mail: HiveMessage[],
    cfg: AgentLlmConfig
  ): Promise<boolean> {
    const runtime = this.runtimeFor(hive, agentId, agentName, meta, cfg, {
      conversation: mail[0]?.conversation
    });
    if (!runtime) return false;

    const res = await runtime.run(this.taskFor(agentName, mail));
    this.opts.onRun?.({
      projectId: hive.projectId,
      agentId,
      ok: res.ok,
      text: res.text,
      error: res.error,
      toolTrace: res.toolTrace
    });

    // A model that forgot to send mail still owes the sender an answer — hand
    // its final text over rather than dropping the conversation on the floor.
    const replied = (res.toolTrace ?? []).some(
      (t) => t.name === 'mail_send' && t.ok && mail.some((m) => (t.output ?? '').includes(m.from))
    );
    const first = mail[0];
    if (!replied && res.text && first) {
      hive.send(
        {
          to: first.from,
          from: agentId,
          act: first.act === 'query' ? 'inform' : 'done',
          subject: `Re: ${first.subject ?? ''}`,
          body: res.text,
          in_reply_to: first.id,
          conversation: first.conversation,
          requires_reply: false
        },
        agentId
      );
    }
    return res.ok;
  }

  /** Hand a gate to the god, who is the human's proxy on this floor. */
  private relayGateToGod(
    hive: HiveManager,
    key: string,
    agentId: string,
    call: ChengxiaobangToolCall
  ): void {
    if (this.cbRelays.has(key)) return;
    const timeout = this.opts.approvalRelayMs ?? DEFAULT_APPROVAL_RELAY_MS;
    try {
      const msg = hive.send(
        {
          to: 'god',
          from: agentId,
          act: 'request',
          subject: `permission needed: ${call.name}`,
          body: [
            `${agentId} is blocked on a permission gate and nobody is at the keyboard.`,
            `Tool: ${call.name}`,
            call.args ? `Arguments: ${JSON.stringify(call.args).slice(0, 800)}` : '',
            '',
            `Reply "agree" to allow it once, or "refuse" to deny. No answer within ${Math.round(timeout / 1000)}s denies it.`,
            'If you cannot decide either, the ASK ME board is yours to put it on.'
          ]
            .filter(Boolean)
            .join('\n'),
          requires_reply: true
        },
        agentId
      );
      this.cbRelays.set(key, {
        toolCallId: call.id,
        name: call.name,
        requestedAt: Date.now(),
        requestId: msg.id
      });
    } catch {
      /* a gate we cannot raise must not take the run down with it */
    }
  }

  /**
   * Answer the gates we relayed: the god's reply if it came, a deny if it did
   * not. Denying on timeout is deliberate — an unattended agent must never be
   * allowed to do something nobody approved.
   */
  private async resolveApprovalRelays(hive: HiveManager): Promise<void> {
    if (this.cbRelays.size === 0) return;
    const client = this.opts.chengxiaobang?.() ?? null;
    if (!client) return;
    const timeout = this.opts.approvalRelayMs ?? DEFAULT_APPROVAL_RELAY_MS;
    for (const [key, relay] of [...this.cbRelays]) {
      if (!key.startsWith(`${hive.projectId}|`)) continue;
      const agentId = key.slice(hive.projectId.length + 1);
      let reply: HiveMessage | undefined;
      try {
        reply = hive
          .inbox(agentId)
          .find((m) => m.in_reply_to === relay.requestId);
      } catch {
        continue;
      }
      let approved: boolean | undefined;
      if (reply) {
        approved = reply.act === 'agree' || reply.act === 'done';
        hive.archiveInbox(agentId, reply.id);
      } else if (Date.now() - relay.requestedAt >= timeout) {
        approved = false;
      }
      if (approved === undefined) continue;
      this.cbRelays.delete(key);
      await client.approve(relay.toolCallId, { approved });
      if (!reply) {
        try {
          hive.send(
            {
              to: 'god',
              from: agentId,
              act: 'inform',
              subject: `permission denied, no answer: ${relay.name}`,
              body: `${relay.name} was denied after ${Math.round(timeout / 1000)}s with no reply. Raise it yourself if it should go to the human.`,
              requires_reply: false
            },
            agentId
          );
        } catch {
          /* best effort */
        }
      }
    }
  }

  // ── Mid-run control (the seat's own stop / steer) ───────────────────────────

  /** Is this seat mid-run? Drives the stop and steer controls in its panel. */
  isSeatRunning(projectId: string, agentId: string): boolean {
    return this.cbActive.has(`${projectId}|${agentId}`);
  }

  /** The live run's id, when it has reported one. */
  activeRunId(projectId: string, agentId: string): string | undefined {
    return this.cbActive.get(`${projectId}|${agentId}`)?.runId;
  }

  /** Stop the run this seat is on. False when it is on no run at all. */
  async abortSeat(projectId: string, agentId: string): Promise<boolean> {
    const active = this.cbActive.get(`${projectId}|${agentId}`);
    if (!active) return false;
    // 程小帮 aborts a run when its consumer disconnects, so dropping the stream
    // suffices on its own. The endpoint is called too, because it also reaches a
    // run whose stream we are only half-reading.
    const client = this.opts.chengxiaobang?.() ?? null;
    if (client && active.runId) void client.abortRun(active.runId);
    active.abort();
    return true;
  }

  /** Put a line of guidance into the run this seat is on. */
  async steerSeat(
    projectId: string,
    agentId: string,
    prompt: string
  ): Promise<{ ok: boolean; accepted?: boolean; disposition?: string; error?: string }> {
    const active = this.cbActive.get(`${projectId}|${agentId}`);
    if (!active) return { ok: false, error: 'this seat is not on a run' };
    if (!active.runId) return { ok: false, error: 'the run has not reported its id yet' };
    const client = this.opts.chengxiaobang?.() ?? null;
    if (!client) return { ok: false, error: '程小帮 is not reachable' };
    return client.steer(active.runId, prompt);
  }

  /** Tool calls this seat's run is waiting on an answer for. */
  pendingApprovals(projectId: string, agentId: string): ChengxiaobangToolCall[] {
    const active = this.cbActive.get(`${projectId}|${agentId}`);
    if (!active) return [];
    return [...active.toolCalls.values()].filter((call) => call.status === 'pending_approval');
  }

  /** Answer one of them. `approvalScope: 'project'` trusts the same tool
   *  signature for the project from then on; omitted approves just this once. */
  async approveSeat(
    projectId: string,
    agentId: string,
    toolCallId: string,
    opts: { approved: boolean; approvalScope?: 'project' }
  ): Promise<{ ok: boolean; accepted?: boolean; error?: string }> {
    const client = this.opts.chengxiaobang?.() ?? null;
    if (!client) return { ok: false, error: '程小帮 is not reachable' };
    return client.approve(toolCallId, opts);
  }

  /** What the seat's last finished run changed — empty when it changed nothing. */
  lastFileChanges(projectId: string, agentId: string): ChengxiaobangFileChange[] {
    return this.cbLastRun.get(`${projectId}|${agentId}`)?.fileChanges ?? [];
  }

  /** Undo or redo the last finished run's changes. */
  async revertSeat(
    projectId: string,
    agentId: string,
    opts: { direction: ChengxiaobangRevertDirection; paths?: string[] }
  ): Promise<{ ok: boolean; error?: string }> {
    const last = this.cbLastRun.get(`${projectId}|${agentId}`);
    if (!last) return { ok: false, error: 'this seat has no finished run with file changes' };
    const client = this.opts.chengxiaobang?.() ?? null;
    if (!client) return { ok: false, error: '程小帮 is not reachable' };
    return client.revertFileChanges(last.runId, opts);
  }

  /**
   * Run one 程小帮 task while keeping it addressable.
   *
   * The registry entry is what lets the seat's own UI stop the run or put a line
   * into it. Without it the seat is fire-and-forget: you can hand over work but
   * not call it back.
   */
  private async runTracked(
    client: ChengxiaobangClient,
    hive: HiveManager,
    key: string,
    sessionId: string,
    task: string,
    projectId: string,
    agentId: string,
    model?: string,
    accessMode?: 'approval' | 'smart_approval' | 'full_access',
    unattended = false
  ): Promise<ChengxiaobangRunResult> {
    const controller = new AbortController();
    const active: ChengxiaobangActiveRun = {
      sessionId,
      abort: () => controller.abort(),
      toolCalls: new Map(),
      unattended
    };
    this.cbActive.set(key, active);
    let result: ChengxiaobangRunResult;
    try {
      result = await client.run(sessionId, task, {
        ...(model ? { model } : {}),
        ...(accessMode ? { accessMode } : {}),
        signal: controller.signal,
        onEvent: (event) => {
          if (event.runId && !active.runId) active.runId = event.runId;
          this.opts.onEvent?.(projectId, agentId, { kind: 'tool', name: event.type, ok: true });
        },
        onToolCall: (call) => {
          active.toolCalls.set(call.id, call);
          this.opts.onEvent?.(projectId, agentId, {
            kind: 'tool',
            name: call.name,
            ok: call.status !== 'pending_approval'
          });
          // Nobody is at the keyboard, so the gate goes up the ladder instead of
          // waiting for a click nobody will make. Never ALLOW by default.
          if (call.status === 'pending_approval' && unattended) {
            this.relayGateToGod(hive, key, agentId, call);
          }
        }
      });
    } finally {
      // Only clear our own entry: a later tick may already have replaced it.
      if (this.cbActive.get(key) === active) this.cbActive.delete(key);
    }
    // Remember what it changed; undo happens after the run is over.
    if (result.runId && result.fileChanges?.length) {
      this.cbLastRun.set(key, { runId: result.runId, fileChanges: result.fileChanges });
    }
    return result;
  }

  /**
   * Hand a seat's mail to 程小帮 and deliver its answer.
   *
   * One session per seat, kept for the life of this process so the seat has a
   * continuous conversation, and deleted on stop() so the app's own session list
   * is not littered with one entry per run. The floor manual rides along on the
   * FIRST turn only: the session remembers it, and repeating it on every message
   * would pay for it every time.
   */
  private async handleWithChengxiaobang(
    hive: HiveManager,
    agentId: string,
    agentName: string,
    meta: { cwd?: unknown; isGod?: boolean; role?: string },
    mail: HiveMessage[]
  ): Promise<boolean> {
    const client = this.opts.chengxiaobang?.() ?? null;
    if (!client) return false;

    const key = `${hive.projectId}|${agentId}`;
    const primed = this.cbPrimed.has(key);
    let sessionId = this.cbSessions.get(key);
    if (!sessionId) {
      const session = await client.createSession({ title: `${agentName} · ${hive.projectId}` });
      sessionId = session.id;
      this.cbSessions.set(key, sessionId);
    }

    const res = await this.runTracked(
      client,
      hive,
      key,
      sessionId,
      this.chengxiaobangTaskFor(agentName, mail, hive, agentId, primed),
      hive.projectId,
      agentId,
      this.opts.chengxiaobangModel?.(agentId),
      // A run woken by mail has nobody at the keyboard, so it runs with gates ON
      // and hands any gate to the god — see relayGateToGod. The alternative,
      // leaving it on the app default, gates nothing at all.
      'approval',
      true
    );
    this.cbPrimed.add(key);
    this.opts.onRun?.({
      projectId: hive.projectId,
      agentId,
      ok: res.ok,
      text: res.text,
      error: res.error
    });
    if (!res.ok) return false;

    const first = mail[0];
    if (first && res.text.trim()) {
      hive.send(
        {
          to: first.from,
          from: agentId,
          act: first.act === 'query' ? 'inform' : 'done',
          subject: `Re: ${first.subject ?? ''}`,
          body: res.text,
          in_reply_to: first.id,
          conversation: first.conversation,
          requires_reply: false
        },
        agentId
      );
    }
    return true;
  }

  /** The mail as a task for 程小帮. No tool instructions: it brings its own. */
  private chengxiaobangTaskFor(
    agentName: string,
    mail: HiveMessage[],
    hive: HiveManager,
    agentId: string,
    primed: boolean
  ): string {
    const body = mail
      .map((m) => `From ${m.from}, act=${m.act ?? 'inform'}, subject: ${m.subject ?? '(none)'}\n${m.body ?? ''}`)
      .join('\n---\n');
    const lines: string[] = [];
    if (!primed) {
      const manual = this.opts.systemPrompt?.(hive, agentId, agentName);
      if (manual) lines.push(manual, '');
    }
    lines.push(
      `You are ${agentName}, a seat on this office floor. Answer the mail below.`,
      'Reply in plain text; the harness delivers your answer back to the sender.',
      '',
      body
    );
    return lines.join('\n');
  }

  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let handled = 0;
    try {
      const cfg = this.opts.llmConfig?.() ?? null;
      for (const hive of this.opts.listHives()) {
        // Gates we handed to the god are answered before new mail is taken, so a
        // blocked run is never waiting behind its own permission request.
        await this.resolveApprovalRelays(hive);
        let reg: ReturnType<HiveManager['registry']>;
        try { reg = hive.registry(); } catch { continue; }
        for (const [id, agent] of Object.entries(reg.agents)) {
          // Every in-process seat, not just `builtin`: 程小帮 runs on the same
          // runtime and would otherwise be skipped here and never answer at all.
          if (!isInProcessChatEngine(agent.provider) || agent.archived) continue;
          const occ = await this.opts.occupancy(hive.projectId, id);
          if (occ === 'remote') continue;
          const mail = hive.inbox(id);
          if (mail.length === 0) continue;

          let modelHandled = false;
          if (agent.provider === 'chengxiaobang') {
            // 程小帮's run is already an agent with its own tools, so the seat
            // hands the task over whole instead of wrapping it in ours.
            try {
              modelHandled = await this.handleWithChengxiaobang(hive, id, agent.name, agent, mail);
            } catch (err) {
              this.opts.onRun?.({
                projectId: hive.projectId,
                agentId: id,
                ok: false,
                error: err instanceof Error ? err.message : String(err)
              });
              modelHandled = false;
            }
          } else if (cfg) {
            try {
              modelHandled = await this.handleWithModel(hive, id, agent.name, agent, mail, cfg);
            } catch (err) {
              // A dead channel must not take the floor down with it: fall through
              // to the template reply below and keep the seat answering.
              this.opts.onRun?.({
                projectId: hive.projectId,
                agentId: id,
                ok: false,
                error: err instanceof Error ? err.message : String(err)
              });
              modelHandled = false;
            }
          }

          if (!modelHandled) {
            for (const msg of mail) {
              const reply = draftBuiltinReply(msg, { id, name: agent.name });
              if (reply) {
                hive.send(
                  {
                    to: reply.to,
                    act: reply.act,
                    subject: reply.subject,
                    body: reply.body,
                    in_reply_to: reply.in_reply_to,
                    conversation: reply.conversation,
                    requires_reply: false
                  },
                  id
                );
              }
            }
          }

          for (const msg of mail) hive.archiveInbox(id, msg.id);
          handled += mail.length;
        }
      }
    } finally {
      this.ticking = false;
    }
    return handled;
  }
}
