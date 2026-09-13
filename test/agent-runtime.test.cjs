'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { AgentRuntime } = loadTs('src/main/agentRuntime.ts');

/** A scripted model: replies with the given responses in order and records what
 *  it was asked, so the loop is driven with no network and no real model. */
function scripted(responses) {
  const calls = [];
  return {
    calls,
    respond: async (system, turns, tools) => {
      calls.push({ system, turns: turns.map((t) => `${t.role}:${t.content}`), tools: tools.map((t) => t.name) });
      const i = Math.min(calls.length - 1, responses.length - 1);
      return responses[i];
    }
  };
}

function echoTool() {
  return {
    name: 'echo',
    description: 'echo back a value',
    inputSchema: { type: 'object', properties: { v: { type: 'string' } } },
    run: async (input) => ({ ok: true, output: String(input.v) })
  };
}

test('a plain text answer needs one step and no tool trace', async () => {
  const llm = scripted([{ kind: 'text', text: 'all done' }]);
  const res = await new AgentRuntime({ llm }).run('say hi');

  assert.equal(res.ok, true);
  assert.equal(res.text, 'all done');
  assert.equal(res.steps, 1);
  assert.equal(res.toolTrace, undefined);
});

test('a tool call runs, its result is fed back, and the trace records it', async () => {
  const llm = scripted([
    { kind: 'tool', name: 'echo', input: { v: 'abc' } },
    { kind: 'text', text: 'finished' }
  ]);
  const res = await new AgentRuntime({ llm, tools: [echoTool()] }).run('do the thing');

  assert.equal(res.ok, true);
  assert.equal(res.text, 'finished');
  assert.equal(res.steps, 2);
  assert.deepEqual(res.toolTrace, [{ name: 'echo', ok: true, output: 'abc' }]);
  // The second turn must carry the tool result, or the model is answering blind.
  assert.deepEqual(llm.calls[1].turns, ['user:do the thing', 'assistant:tool:echo', 'user:ok: abc']);
});

test('a failing tool records ok:false and still feeds the error back', async () => {
  const llm = scripted([
    { kind: 'tool', name: 'boom', input: {} },
    { kind: 'text', text: 'recovered' }
  ]);
  const tools = [
    {
      name: 'boom',
      description: 'always fails',
      inputSchema: { type: 'object' },
      run: async () => ({ ok: false, error: 'nope' })
    }
  ];
  const res = await new AgentRuntime({ llm, tools }).run('try it');

  assert.equal(res.ok, true);
  assert.deepEqual(res.toolTrace, [{ name: 'boom', ok: false, error: 'nope' }]);
  assert.equal(llm.calls[1].turns.at(-1), 'user:error: nope');
});

test('an invented tool name stops the run instead of looping', async () => {
  const llm = scripted([{ kind: 'tool', name: 'no-such-tool', input: {} }]);
  const res = await new AgentRuntime({ llm, tools: [echoTool()] }).run('go');

  assert.equal(res.ok, false);
  assert.match(res.error, /unknown tool "no-such-tool"/);
});

test('running past the step budget is reported as unfinished', async () => {
  const llm = scripted([{ kind: 'tool', name: 'echo', input: { v: 'x' } }]);
  const res = await new AgentRuntime({ llm, tools: [echoTool()], maxSteps: 3 }).run('go');

  assert.equal(res.ok, false);
  assert.match(res.error, /exceeded 3 steps/);
  assert.equal(res.steps, 3);
  assert.equal(res.toolTrace.length, 3);
});

test('progress events carry the tool name and outcome for the seat chat surface', async () => {
  const events = [];
  const llm = scripted([
    { kind: 'tool', name: 'echo', input: { v: 'z' } },
    { kind: 'text', text: 'ok' }
  ]);
  await new AgentRuntime({ llm, tools: [echoTool()], onEvent: (e) => events.push(e) }).run('go');

  assert.deepEqual(events, [
    { kind: 'tool', name: 'echo', ok: true, detail: 'z' },
    { kind: 'text', detail: 'ok' }
  ]);
});

test('a seat-assembled system prompt replaces the default one', async () => {
  const llm = scripted([{ kind: 'text', text: 'ok' }]);
  await new AgentRuntime({ llm, systemPrompt: 'FLOOR MANUAL' }).run('go');

  assert.equal(llm.calls[0].system, 'FLOOR MANUAL');
});

test('a blank system prompt falls back to the engine default', async () => {
  const llm = scripted([{ kind: 'text', text: 'ok' }]);
  await new AgentRuntime({ llm, systemPrompt: '   ' }).run('go');

  assert.match(llm.calls[0].system, /built-in agent/);
});
