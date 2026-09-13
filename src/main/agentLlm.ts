/**
 * Wire implementations for the built-in agent's model client.
 *
 * Three shapes cover every channel this machine realistically has:
 *   1. OpenAiCompatLlm      — any POST {base}/chat/completions
 *   2. OpenAiResponsesLlm   — POST {base}/responses, i.e. codex's
 *                             `wire_api = "responses"` (the corp coding-plan gateway)
 *   3. AnthropicMessagesLlm — POST {base}/v1/messages, key OR bearer token,
 *                             i.e. ~/.claude/settings.json's ANTHROPIC_BASE_URL
 *
 * `fetchImpl` is injectable so contract tests exercise request shaping and
 * response mapping with no network and no real model call.
 */
import type { LlmClient, LlmResponse, LlmToolSpec } from './agentRuntime';
import type { AgentLlmConfig } from './agentLlmCreds';

// ────────────────────────────── OpenAI-compatible ─────────────────────────────

export interface OpenAiCompatOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAiToolCall {
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
}

export class OpenAiCompatLlm implements LlmClient {
  private readonly apiKey: string;
  private readonly url: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAiCompatOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.MUNDER_AGENT_LLM_KEY ?? process.env.OPENAI_API_KEY ?? '';
    if (!this.apiKey) {
      throw new Error('a model channel is required (opts.apiKey / MUNDER_AGENT_LLM_KEY / OPENAI_API_KEY)');
    }
    const base = (opts.baseUrl ?? process.env.MUNDER_AGENT_LLM_BASE ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.url = `${base}/chat/completions`;
    this.model = opts.model ?? process.env.MUNDER_AGENT_LLM_MODEL ?? 'gpt-4o-mini';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private toOpenAiTools(tools: LlmToolSpec[]): unknown[] {
    return tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema }
    }));
  }

  async respond(
    system: string,
    turns: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools: LlmToolSpec[]
  ): Promise<LlmResponse> {
    const messages = [
      { role: 'system', content: system },
      ...turns.map((t) => ({ role: t.role, content: t.content }))
    ];
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: this.toOpenAiTools(tools),
        tool_choice: 'auto'
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: OpenAiMessage }> };
    const message = data.choices?.[0]?.message;
    const call = message?.tool_calls?.[0];
    if (call?.function?.name) {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(call.function.arguments ?? '{}') as Record<string, unknown>;
      } catch {
        throw new Error(`LLM returned malformed tool arguments for ${call.function.name}`);
      }
      return { kind: 'tool', name: call.function.name, input };
    }
    const text = message?.content?.trim();
    if (text) return { kind: 'text', text };
    throw new Error('LLM returned neither text nor a tool call');
  }
}

// ─────────────────────────── OpenAI Responses wire ────────────────────────────

export interface OpenAiResponsesOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Defaults to `auto`, which is what the corp coding-plan gateway expects when
   *  the caller has no model of its own — a guessed slug like `gpt-5-codex` is
   *  rejected outright ("This model is not currently supported"). */
  model?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAiResponsesLlm implements LlmClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAiResponsesOptions = {}) {
    if (!opts.apiKey) throw new Error('the responses wire needs a key');
    this.apiKey = opts.apiKey;
    this.url = `${(opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/responses`;
    this.model = opts.model ?? 'auto';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async respond(
    system: string,
    turns: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools: LlmToolSpec[]
  ): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: system,
      input: turns.map((t) => ({
        role: t.role,
        content: [{ type: t.role === 'user' ? 'input_text' : 'output_text', text: t.content }]
      }))
    };
    // Passing tools is what keeps the model on the tool-call path; without it a
    // tools-capable prompt comes back as prose describing the call it wanted.
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
      }));
      body.tool_choice = 'auto';
    }
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Responses HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      output_text?: string;
      output?: Array<{
        type?: string;
        name?: string;
        arguments?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    const output = data.output ?? [];
    const fn = output.find((o) => o.type === 'function_call' && typeof o.name === 'string');
    if (fn?.name) {
      let input: Record<string, unknown> = {};
      if (typeof fn.arguments === 'string' && fn.arguments.trim()) {
        try {
          input = JSON.parse(fn.arguments) as Record<string, unknown>;
        } catch {
          input = { raw: fn.arguments };
        }
      }
      return { kind: 'tool', name: fn.name, input };
    }
    const text =
      (typeof data.output_text === 'string' && data.output_text.trim()) ||
      output
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('')
        .trim();
    if (text) return { kind: 'text', text };
    throw new Error('Responses returned no output_text');
  }
}

// ─────────────────────────── Anthropic messages wire ─────────────────────────

export interface AnthropicMessagesOptions {
  /** /v1/messages base, e.g. http://ada-cli-golang.ctripcorp.com/coding-plan */
  baseUrl?: string;
  apiKey?: string;
  /** Bearer token alternative (ANTHROPIC_AUTH_TOKEN). */
  authToken?: string;
  model?: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

interface AnthropicToolUseBlock {
  type?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  tool_use?: AnthropicToolUseBlock;
}

export class AnthropicMessagesLlm implements LlmClient {
  private readonly base: string;
  private readonly url: string;
  private readonly key?: string;
  private readonly token?: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicMessagesOptions = {}) {
    if (!opts.apiKey && !opts.authToken) {
      throw new Error('the anthropic wire needs an apiKey or an authToken');
    }
    this.base = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.url = `${this.base}/v1/messages`;
    this.key = opts.apiKey;
    this.token = opts.authToken;
    this.model = opts.model ?? 'claude-sonnet-4-6';
    this.maxTokens = opts.maxTokens ?? 8192;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private toAnthropicTools(tools: LlmToolSpec[]): unknown[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));
  }

  async respond(
    system: string,
    turns: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools: LlmToolSpec[]
  ): Promise<LlmResponse> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01'
    };
    if (this.key) headers['x-api-key'] = this.key;
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
        tools: this.toAnthropicTools(tools),
        tool_choice: { type: 'auto' }
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as { content?: AnthropicContentBlock[]; stop_reason?: string };
    const blocks = data.content ?? [];
    const toolBlock = blocks.find(
      (b) => b.type === 'tool_use' || typeof (b as { name?: string }).name === 'string'
    );
    const toolName =
      toolBlock?.tool_use?.name ??
      (toolBlock && typeof (toolBlock as { name?: string }).name === 'string'
        ? (toolBlock as { name: string }).name
        : undefined);
    if (toolName) {
      const input =
        (toolBlock?.tool_use?.input as Record<string, unknown> | undefined) ??
        ((toolBlock as { input?: Record<string, unknown> }).input ?? {});
      return { kind: 'tool', name: toolName, input };
    }
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .trim();
    if (text) return { kind: 'text', text };
    // The gateway spent the whole budget on a thinking block and returned no
    // answer. Retry once with a bigger ceiling and no tools, asking for prose.
    if (
      data.stop_reason === 'max_tokens' &&
      blocks.some((b) => b.type === 'thinking') &&
      this.maxTokens < 16_000
    ) {
      const retry = new AnthropicMessagesLlm({
        baseUrl: this.base,
        apiKey: this.key,
        authToken: this.token,
        model: this.model,
        maxTokens: Math.min(16_000, this.maxTokens * 2),
        fetchImpl: this.fetchImpl
      });
      return retry.respond(
        `${system}\n\n请直接输出最终纯文本结论，不要只返回思考块。`,
        turns,
        []
      );
    }
    const shape = blocks.map((b) => b.type ?? '?').join(',') || '(no content)';
    throw new Error(
      `Anthropic returned neither text nor a tool_use block (stop=${data.stop_reason ?? '?'}; blocks=${shape})`
    );
  }
}

/** Build the client for a resolved channel. */
export function createAgentLlm(cfg: AgentLlmConfig): LlmClient {
  if (cfg.wire === 'openai-responses') {
    return new OpenAiResponsesLlm({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model });
  }
  if (cfg.wire === 'openai') {
    return new OpenAiCompatLlm({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model ?? 'gpt-4o-mini'
    });
  }
  return new AnthropicMessagesLlm({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    authToken: cfg.authToken,
    model: cfg.model ?? 'claude-sonnet-4-6'
  });
}
