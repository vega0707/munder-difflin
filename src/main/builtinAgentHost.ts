import { draftBuiltinReply } from '../shared/builtinAgent';
import { isInProcessChatEngine } from '../shared/agentProvider';
import { AgentRuntime, type AgentRunEvent, type AgentRunResult, type AgentToolTraceEntry, type LlmClient } from './agentRuntime';
import { createAgentTools } from './agentTools';
import { createAgentLlm } from './agentLlm';
import type { AgentLlmConfig } from './agentLlmCreds';
import type { ChengxiaobangClient } from './chengxiaobangClient';
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
    const cfg = this.opts.llmConfig?.() ?? null;
    if (!cfg) {
      return { ok: false, error: 'this machine has no model channel configured for built-in seats' };
    }
    const hive = this.opts.listHives().find((h) => h.projectId === projectId);
    if (!hive) return { ok: false, error: `no floor ${projectId}` };

    let meta: { name?: string; cwd?: unknown; isGod?: boolean; role?: string; archived?: boolean } | undefined;
    try {
      meta = hive.registry().agents[agentId];
    } catch {
      return { ok: false, error: 'the hive registry is not readable' };
    }
    if (!meta) return { ok: false, error: `no seat ${agentId} on this floor` };

    const agentName = meta.name ?? agentId;
    const runtime = this.runtimeFor(hive, agentId, agentName, meta, cfg, { onEvent });
    if (!runtime) return { ok: false, error: 'this seat has no workspace to work in' };

    const key = `${projectId}|${agentId}`;
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

    const res = await client.run(sessionId, this.chengxiaobangTaskFor(agentName, mail, hive, agentId, primed), {
      model: this.opts.chengxiaobangModel?.(agentId),
      onEvent: (type) =>
        this.opts.onEvent?.(hive.projectId, agentId, { kind: 'tool', name: type, ok: true })
    });
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
