/**
 * The built-in agent's turn loop.
 *
 * A `builtin` seat runs no CLI, so "answering" it is this loop: the model picks
 * between a final text answer and one tool call; tool calls resolve against a
 * registered tool set; the result is fed back as the next turn. That is what
 * turns a builtin seat from a template responder into an agent that can actually
 * read the repo, run a command and report back.
 *
 * No network or model code lives here — `llm` is injected, so tests drive the
 * whole loop with a scripted provider and the real path stays exercisable
 * without a key.
 */

export interface AgentToolResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface AgentToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): Promise<AgentToolResult>;
}

export interface LlmToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type LlmResponse =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: Record<string, unknown> };

export interface LlmClient {
  respond(
    system: string,
    turns: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools: LlmToolSpec[]
  ): Promise<LlmResponse>;
}

/** Ordered tool calls from one run — the evidence a claim is checked against,
 *  instead of trusting the model's own prose about what it did. */
export interface AgentToolTraceEntry {
  name: string;
  ok: boolean;
  output?: string;
  error?: string;
}

export interface AgentRunEvent {
  kind: 'tool' | 'text';
  name?: string;
  ok?: boolean;
  detail?: string;
}

export interface AgentRuntimeOptions {
  llm: LlmClient;
  tools?: AgentToolDef[];
  maxSteps?: number;
  /** Seat-assembled system prompt: identity, skills, tools, floor manual. */
  systemPrompt?: string;
  /** Progress sink for the seat's chat surface. Never carries secrets. */
  onEvent?: (event: AgentRunEvent) => void;
}

export interface AgentRunResult {
  ok: boolean;
  text?: string;
  error?: string;
  steps: number;
  toolTrace?: AgentToolTraceEntry[];
}

const DEFAULT_SYSTEM = [
  'You are the built-in agent filling one seat on this office floor.',
  'Do the work with the tools you are given: read before you write, and run a command to verify rather than assuming.',
  'When the task is finished, reply with a plain final text answer and no tool call.',
  'Never invent a tool name; use only the tools described to you.',
  'Report what you actually did. If something failed, say what failed instead of describing what you meant to do.'
].join('\n');

export class AgentRuntime {
  private readonly llm: LlmClient;
  private readonly tools: AgentToolDef[];
  private readonly maxSteps: number;
  private readonly system: string;
  private readonly onEvent?: (event: AgentRunEvent) => void;

  constructor(opts: AgentRuntimeOptions) {
    this.llm = opts.llm;
    this.tools = opts.tools ?? [];
    this.maxSteps = opts.maxSteps ?? 20;
    this.system = opts.systemPrompt?.trim() ? opts.systemPrompt : DEFAULT_SYSTEM;
    this.onEvent = opts.onEvent;
  }

  private toolSpecs(): LlmToolSpec[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
  }

  private toolByName(name: string): AgentToolDef | undefined {
    return this.tools.find((t) => t.name === name);
  }

  async run(
    task: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Promise<AgentRunResult> {
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history,
      { role: 'user', content: task }
    ];
    let steps = 0;
    const toolTrace: AgentToolTraceEntry[] = [];
    const withTrace = () => (toolTrace.length ? { toolTrace } : {});

    while (steps < this.maxSteps) {
      const resp = await this.llm.respond(this.system, turns, this.toolSpecs());
      steps += 1;

      if (resp.kind === 'text') {
        this.onEvent?.({ kind: 'text', detail: resp.text });
        return { ok: true, text: resp.text, steps, ...withTrace() };
      }

      const tool = this.toolByName(resp.name);
      if (!tool) {
        // A hallucinated tool name is a model error, not a crash: stop and say so
        // rather than looping on a call that can never resolve.
        return { ok: false, error: `model called unknown tool "${resp.name}"`, steps, ...withTrace() };
      }

      const result = await tool.run(resp.input);
      toolTrace.push({
        name: resp.name,
        ok: result.ok,
        ...(result.output !== undefined ? { output: result.output } : {}),
        ...(result.error !== undefined ? { error: result.error } : {})
      });
      this.onEvent?.({
        kind: 'tool',
        name: resp.name,
        ok: result.ok,
        detail: result.ok ? result.output : result.error
      });
      turns.push({ role: 'assistant', content: `tool:${resp.name}` });
      turns.push({
        role: 'user',
        content: result.ok ? `ok: ${result.output ?? ''}` : `error: ${result.error ?? ''}`
      });
    }

    return {
      ok: false,
      error: `exceeded ${this.maxSteps} steps without a final answer`,
      steps,
      ...withTrace()
    };
  }
}
