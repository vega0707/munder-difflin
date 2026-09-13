'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  OpenAiCompatLlm,
  OpenAiResponsesLlm,
  AnthropicMessagesLlm,
  createAgentLlm
} = loadTs('src/main/agentLlm.ts');

/** Records the request and replies with a canned response body. */
function fakeFetch(body, init = {}) {
  const seen = {};
  const impl = async (url, options) => {
    seen.url = url;
    seen.headers = options.headers;
    seen.body = JSON.parse(options.body);
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
      text: async () => init.errorText ?? JSON.stringify(body)
    };
  };
  impl.seen = seen;
  return impl;
}

// ───────────────────────────── OpenAI-compatible wire ─────────────────────────

test('openai-compat wire posts the tools and maps a tool call', async () => {
  const fetchImpl = fakeFetch({
    choices: [{ message: { tool_calls: [{ function: { name: 'read', arguments: '{"p":"a.txt"}' } }] } }]
  });
  const llm = new OpenAiCompatLlm({ apiKey: 'k', baseUrl: 'http://gw/v1', model: 'm', fetchImpl });
  const res = await llm.respond('sys', [{ role: 'user', content: 'go' }], [
    { name: 'read', description: 'read a file', inputSchema: { type: 'object' } }
  ]);

  assert.equal(fetchImpl.seen.url, 'http://gw/v1/chat/completions');
  assert.equal(fetchImpl.seen.headers.authorization, 'Bearer k');
  assert.equal(fetchImpl.seen.body.model, 'm');
  assert.equal(fetchImpl.seen.body.messages[0].role, 'system');
  assert.equal(fetchImpl.seen.body.tools[0].function.name, 'read');
  assert.deepEqual(res, { kind: 'tool', name: 'read', input: { p: 'a.txt' } });
});

test('openai-compat wire maps a plain answer', async () => {
  const fetchImpl = fakeFetch({ choices: [{ message: { content: ' hello ' } }] });
  const llm = new OpenAiCompatLlm({ apiKey: 'k', fetchImpl });
  const res = await llm.respond('sys', [], []);

  assert.deepEqual(res, { kind: 'text', text: 'hello' });
});

test('openai-compat wire reports an HTTP failure with the body', async () => {
  const fetchImpl = fakeFetch({}, { ok: false, status: 401, errorText: 'bad key' });
  const llm = new OpenAiCompatLlm({ apiKey: 'k', fetchImpl });
  await assert.rejects(() => llm.respond('sys', [], []), /LLM HTTP 401: bad key/);
});

test('openai-compat wire refuses to build without a key', () => {
  const env = process.env.MUNDER_AGENT_LLM_KEY;
  delete process.env.MUNDER_AGENT_LLM_KEY;
  const openai = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => new OpenAiCompatLlm({}), /is required/);
  } finally {
    if (env !== undefined) process.env.MUNDER_AGENT_LLM_KEY = env;
    if (openai !== undefined) process.env.OPENAI_API_KEY = openai;
  }
});

// ───────────────────────────── OpenAI Responses wire ──────────────────────────

test('responses wire forwards tools as flat function defs and reads output_text', async () => {
  const fetchImpl = fakeFetch({ output_text: 'the answer' });
  const llm = new OpenAiResponsesLlm({
    apiKey: 'k',
    baseUrl: 'http://gw/coding-plan/codex/v1',
    model: 'codex',
    fetchImpl
  });
  const res = await llm.respond('sys', [{ role: 'user', content: 'go' }], [
    { name: 'read', description: 'read', inputSchema: { type: 'object' } }
  ]);

  assert.equal(fetchImpl.seen.url, 'http://gw/coding-plan/codex/v1/responses');
  assert.equal(fetchImpl.seen.body.instructions, 'sys');
  // Flat {type,name,description,parameters} — not the nested chat-completions shape.
  assert.equal(fetchImpl.seen.body.tools[0].name, 'read');
  assert.equal(fetchImpl.seen.body.tools[0].function, undefined);
  assert.equal(fetchImpl.seen.body.tool_choice, 'auto');
  assert.deepEqual(res, { kind: 'text', text: 'the answer' });
});

test('responses wire maps a function_call output item', async () => {
  const fetchImpl = fakeFetch({
    output: [{ type: 'function_call', name: 'shell', arguments: '{"cmd":"ls"}' }]
  });
  const llm = new OpenAiResponsesLlm({ apiKey: 'k', fetchImpl });
  const res = await llm.respond('sys', [], []);

  assert.deepEqual(res, { kind: 'tool', name: 'shell', input: { cmd: 'ls' } });
});

test('responses wire omits tools entirely when there are none', async () => {
  const fetchImpl = fakeFetch({ output_text: 'x' });
  const llm = new OpenAiResponsesLlm({ apiKey: 'k', fetchImpl });
  await llm.respond('sys', [], []);

  assert.equal(fetchImpl.seen.body.tools, undefined);
  assert.equal(fetchImpl.seen.body.tool_choice, undefined);
});

test('responses wire defaults to the model name the gateway actually serves', async () => {
  // A guessed slug (gpt-5-codex) is rejected by the corp gateway with HTTP 400;
  // 'auto' is what the operator's own codex config sends.
  const fetchImpl = fakeFetch({ output_text: 'x' });
  await new OpenAiResponsesLlm({ apiKey: 'k', fetchImpl }).respond('sys', [], []);

  assert.equal(fetchImpl.seen.body.model, 'auto');
});

// ──────────────────────────── Anthropic messages wire ─────────────────────────

test('anthropic wire sends the bearer token and maps a text block', async () => {
  const fetchImpl = fakeFetch({ content: [{ type: 'text', text: 'hi there' }] });
  const llm = new AnthropicMessagesLlm({
    authToken: 'tok',
    baseUrl: 'http://ada-cli-golang.ctripcorp.com/coding-plan',
    model: 'auto',
    fetchImpl
  });
  const res = await llm.respond('sys', [{ role: 'user', content: 'go' }], []);

  assert.equal(fetchImpl.seen.url, 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1/messages');
  assert.equal(fetchImpl.seen.headers.authorization, 'Bearer tok');
  assert.equal(fetchImpl.seen.headers['x-api-key'], undefined);
  assert.equal(fetchImpl.seen.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(res, { kind: 'text', text: 'hi there' });
});

test('anthropic wire prefers x-api-key when a key was given', async () => {
  const fetchImpl = fakeFetch({ content: [{ type: 'text', text: 'ok' }] });
  const llm = new AnthropicMessagesLlm({ apiKey: 'k', fetchImpl });
  await llm.respond('sys', [], []);

  assert.equal(fetchImpl.seen.headers['x-api-key'], 'k');
  assert.equal(fetchImpl.seen.headers.authorization, undefined);
});

test('anthropic wire maps a tool_use block', async () => {
  const fetchImpl = fakeFetch({
    content: [{ type: 'tool_use', name: 'read', input: { path: 'x' } }]
  });
  const llm = new AnthropicMessagesLlm({ authToken: 't', fetchImpl });
  const res = await llm.respond('sys', [], [{ name: 'read', description: 'r', inputSchema: {} }]);

  assert.deepEqual(res, { kind: 'tool', name: 'read', input: { path: 'x' } });
});

test('anthropic wire retries once when the gateway burns the budget on thinking', async () => {
  let call = 0;
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(JSON.parse(options.body));
    call += 1;
    // First call: thinking only, stop_reason max_tokens. Retry: a real answer.
    const body =
      call === 1
        ? { content: [{ type: 'thinking' }], stop_reason: 'max_tokens' }
        : { content: [{ type: 'text', text: 'finally' }], stop_reason: 'end_turn' };
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  const llm = new AnthropicMessagesLlm({ authToken: 't', maxTokens: 8192, fetchImpl });
  const res = await llm.respond('sys', [{ role: 'user', content: 'go' }], []);

  assert.deepEqual(res, { kind: 'text', text: 'finally' });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].max_tokens, 16000);
  assert.equal(seen[1].tools.length, 0);
});

test('anthropic wire explains an unusable response shape', async () => {
  const fetchImpl = fakeFetch({ content: [], stop_reason: 'end_turn' });
  const llm = new AnthropicMessagesLlm({ authToken: 't', fetchImpl });
  await assert.rejects(() => llm.respond('sys', [], []), /neither text nor a tool_use/);
});

test('anthropic wire refuses to build without a key or token', () => {
  assert.throws(() => new AnthropicMessagesLlm({}), /apiKey or an authToken/);
});

// ────────────────────────────────── factory ───────────────────────────────────

test('the factory picks the client matching the resolved wire', () => {
  const cases = [
    ['anthropic', 'AnthropicMessagesLlm'],
    ['openai', 'OpenAiCompatLlm'],
    ['openai-responses', 'OpenAiResponsesLlm']
  ];
  for (const [wire, expected] of cases) {
    const client = createAgentLlm({ wire, baseUrl: 'http://gw', apiKey: 'k', source: 'test' });
    assert.equal(client.constructor.name, expected, `${wire} → ${expected}`);
  }
});
