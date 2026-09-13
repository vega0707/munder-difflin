'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { ChengxiaobangClient, readRunStream } = loadTs('src/main/chengxiaobangClient.ts');

/** The frames a real run produced on 2026-09-13 (prompt: "只回答两个字：好了"). */
const REAL_FRAMES = [
  'event: run_started',
  'data: {"type":"run_started","runId":"run_e6890089-b35f-4696-a84f-5f8b07badfe2","sessionId":"s_90atvzylrx4j","providerId":"ctrip-chat","model":"auto(free)"}',
  '',
  'event: message',
  'data: {"type":"message","message":{"id":"msg_a989","sessionId":"s_90atvzylrx4j","role":"user","content":"只回答两个字：好了"}}',
  '',
  'event: model_debug',
  'data: {"type":"model_debug","record":{"id":"model_debug_e5db","runId":"run_e6890089-b35f-4696-a84f-5f8b07badfe2"}}',
  '',
  'event: delta',
  'data: {"type":"delta","runId":"run_e6890089-b35f-4696-a84f-5f8b07badfe2","channel":"text","delta":"好了"}',
  '',
  'event: message',
  'data: {"type":"message","message":{"id":"msg_3336","sessionId":"s_90atvzylrx4j","role":"assistant","content":"好了"}}',
  '',
  'event: run_end',
  'data: {"type":"run_end","runId":"run_e6890089-b35f-4696-a84f-5f8b07badfe2","status":"completed","usage":{"promptTokens":38504,"completionTokens":2,"totalTokens":38506,"cachedPromptTokens":2176}}',
  ''
].join('\n');

function streamOf(text, chunkSize = 64) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    }
  });
}

function fakeFetch({ status = 200, body = '', streamText, json, headers = {} } = {}) {
  const seen = {};
  const impl = async (url, options) => {
    seen.url = url;
    seen.method = options?.method ?? 'GET';
    seen.headers = options?.headers;
    seen.body = options?.body ? JSON.parse(options.body) : undefined;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k] ?? null },
      json: async () => json ?? JSON.parse(body || '{}'),
      text: async () => body,
      body: streamText === undefined ? null : streamOf(streamText)
    };
  };
  impl.seen = seen;
  return impl;
}

// ─────────────────────────── reading a real stream ────────────────────────────

test('a real run stream yields the answer, the run id and its usage', async () => {
  const res = await readRunStream(streamOf(REAL_FRAMES));

  assert.equal(res.ok, true);
  assert.equal(res.text, '好了');
  assert.equal(res.runId, 'run_e6890089-b35f-4696-a84f-5f8b07badfe2');
  assert.equal(res.status, 'completed');
  assert.deepEqual(res.usage, {
    promptTokens: 38504,
    completionTokens: 2,
    totalTokens: 38506,
    cachedPromptTokens: 2176
  });
  // The two model_debug frames collapse to one entry; order is preserved.
  assert.deepEqual(res.events, ['run_started', 'message', 'model_debug', 'delta', 'run_end']);
});

test('frames split across chunk boundaries still parse', async () => {
  // The stream is cut at 7 bytes, which lands mid-JSON on purpose.
  const res = await readRunStream(streamOf(REAL_FRAMES, 7));
  assert.equal(res.text, '好了');
  assert.equal(res.status, 'completed');
});

test('text deltas are used when no assistant message arrives', async () => {
  const frames = [
    'data: {"type":"delta","channel":"text","delta":"he"}',
    '',
    'data: {"type":"delta","channel":"text","delta":"llo"}',
    '',
    'data: {"type":"run_end","status":"completed"}',
    ''
  ].join('\n');
  const res = await readRunStream(streamOf(frames));

  assert.equal(res.ok, true);
  assert.equal(res.text, 'hello');
});

test('the final assistant message wins over the deltas it repeats', async () => {
  const frames = [
    'data: {"type":"delta","channel":"text","delta":"partial"}',
    '',
    'data: {"type":"message","message":{"role":"assistant","content":"the complete answer"}}',
    '',
    'data: {"type":"run_end","status":"completed"}',
    ''
  ].join('\n');
  const res = await readRunStream(streamOf(frames));

  assert.equal(res.text, 'the complete answer');
});

test('non-text channels are not mistaken for the answer', async () => {
  const frames = [
    'data: {"type":"delta","channel":"reasoning","delta":"thinking out loud"}',
    '',
    'data: {"type":"delta","channel":"text","delta":"done"}',
    '',
    'data: {"type":"run_end","status":"completed"}',
    ''
  ].join('\n');
  const res = await readRunStream(streamOf(frames));

  assert.equal(res.text, 'done');
});

test('a user message is not mistaken for the answer', async () => {
  const frames = [
    'data: {"type":"message","message":{"role":"user","content":"the prompt"}}',
    '',
    'data: {"type":"run_end","status":"completed"}',
    ''
  ].join('\n');
  const res = await readRunStream(streamOf(frames));

  assert.equal(res.text, '');
});

test('a run that ends cancelled is reported as a failure, with its status', async () => {
  const frames = 'data: {"type":"run_end","status":"aborted"}\n\n';
  const res = await readRunStream(streamOf(frames));

  assert.equal(res.ok, false);
  assert.equal(res.status, 'aborted');
  assert.match(res.error, /aborted/);
});

test('an error frame is surfaced verbatim', async () => {
  const frames = 'data: {"type":"error","error":"模型不可用"}\n\n';
  const res = await readRunStream(streamOf(frames));

  assert.equal(res.ok, false);
  assert.equal(res.error, '模型不可用');
});

test('a stream that ends with no run_end is a failure, not an empty success', async () => {
  const frames = 'data: {"type":"delta","channel":"text","delta":"half"}\n\n';
  const res = await readRunStream(streamOf(frames));

  assert.equal(res.ok, false);
  assert.match(res.error, /ended before the run reported a result/);
});

test('unreadable frames are skipped instead of killing the run', async () => {
  const frames = [
    'event: comment',
    'data: not json at all',
    '',
    'data: {"type":"delta","channel":"text","delta":"fine"}',
    '',
    'data: {"type":"run_end","status":"completed"}',
    ''
  ].join('\n');
  const res = await readRunStream(streamOf(frames));

  assert.equal(res.ok, true);
  assert.equal(res.text, 'fine');
});

test('event types are reported to the caller as they arrive, with the run id', async () => {
  const seen = [];
  await readRunStream(streamOf(REAL_FRAMES), (event) => seen.push(event));

  assert.deepEqual(seen.map((e) => e.type), ['run_started', 'message', 'model_debug', 'delta', 'run_end']);
  // The runId is what makes a run steerable while it is going, so every frame
  // after run_started has to carry it too.
  assert.deepEqual(
    seen.map((e) => e.runId),
    Array(5).fill('run_e6890089-b35f-4696-a84f-5f8b07badfe2')
  );
});

// ────────────────────────────── client behaviour ──────────────────────────────

test('the client refuses to send the local token anywhere but loopback', () => {
  for (const base of ['http://example.com', 'https://10.0.0.5:42527', 'http://192.168.1.9']) {
    assert.throws(
      () => new ChengxiaobangClient({ baseUrl: base, token: 't' }),
      /refusing to send the 程小帮 token/,
      base
    );
  }
  for (const base of ['http://127.0.0.1:42527', 'http://localhost:42527']) {
    assert.ok(new ChengxiaobangClient({ baseUrl: base, token: 't' }));
  }
});

test('the client needs a token', () => {
  const saved = process.env.CHENGXIAOBANG_API_TOKEN;
  delete process.env.CHENGXIAOBANG_API_TOKEN;
  try {
    assert.throws(() => new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527' }), /needs CHENGXIAOBANG_API_TOKEN/);
  } finally {
    if (saved !== undefined) process.env.CHENGXIAOBANG_API_TOKEN = saved;
  }
});

test('createSession posts what it was given and returns the session', async () => {
  const fetchImpl = fakeFetch({ status: 201, json: { session: { id: 's_1', title: 'x' } } });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  const session = await client.createSession({ title: '[probe] x' });

  assert.equal(session.id, 's_1');
  assert.equal(fetchImpl.seen.url, 'http://127.0.0.1:42527/api/sessions');
  assert.equal(fetchImpl.seen.method, 'POST');
  assert.equal(fetchImpl.seen.headers['x-chengxiaobang-token'], 't');
  assert.deepEqual(fetchImpl.seen.body, { title: '[probe] x' });
});

test('createSession explains a failure instead of returning a half session', async () => {
  const fetchImpl = fakeFetch({ status: 400, body: '{"error":"项目不存在"}' });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  await assert.rejects(() => client.createSession(), /createSession HTTP 400.*项目不存在/);
});

test('run sends the session, the prompt and the model, and reads the stream', async () => {
  const fetchImpl = fakeFetch({ streamText: REAL_FRAMES, headers: { 'content-type': 'text/event-stream' } });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  const res = await client.run('s_1', '只回答两个字：好了', { model: 'auto' });

  assert.equal(res.ok, true);
  assert.equal(res.text, '好了');
  assert.equal(fetchImpl.seen.url, 'http://127.0.0.1:42527/api/runs/stream');
  assert.deepEqual(fetchImpl.seen.body, { sessionId: 's_1', prompt: '只回答两个字：好了', model: 'auto' });
});

test('run omits the model when none was chosen, so the app decides', async () => {
  const fetchImpl = fakeFetch({ streamText: 'data: {"type":"run_end","status":"completed"}\n\n' });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  await client.run('s_1', 'hi');

  assert.deepEqual(fetchImpl.seen.body, { sessionId: 's_1', prompt: 'hi' });
});

test('run reports an HTTP failure rather than pretending the run happened', async () => {
  const fetchImpl = fakeFetch({ status: 404, body: '{"error":"接口不存在"}' });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  const res = await client.run('s_1', 'hi');

  assert.equal(res.ok, false);
  assert.match(res.error, /run HTTP 404/);
});

test('steering posts the line to the live run and reports how it landed', async () => {
  const fetchImpl = fakeFetch({ status: 200, json: { accepted: true, disposition: 'next_step' } });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  const res = await client.steer('run_1', '先别动那个文件');

  assert.equal(res.ok, true);
  assert.equal(res.accepted, true);
  assert.equal(res.disposition, 'next_step');
  assert.equal(fetchImpl.seen.url, 'http://127.0.0.1:42527/api/runs/run_1/steering');
  assert.equal(fetchImpl.seen.method, 'POST');
  assert.deepEqual(fetchImpl.seen.body, { prompt: '先别动那个文件' });
});

test('steering an empty line never leaves the machine', async () => {
  const fetchImpl = fakeFetch({ status: 200, json: { accepted: true } });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  assert.equal((await client.steer('run_1', '   ')).ok, false);
  assert.equal(fetchImpl.seen.url, undefined, 'no request was made');
});

test('steering reports a refusal instead of looking accepted', async () => {
  const fetchImpl = fakeFetch({ status: 404, body: '{"error":"运行不存在"}' });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  const res = await client.steer('gone', 'hello');

  assert.equal(res.ok, false);
  assert.match(res.error, /steering HTTP 404/);
});

// ──────────────────────────── tool calls / approvals ─────────────────────────

/** Real shapes: a tool_call is announced, moves to running, and either completes
 *  or, under accessMode 'approval', sits on `pending_approval`. */
function frames(...bodies) {
  return bodies.map((b) => `data: ${JSON.stringify(b)}\n\n`).join('');
}

test('a tool call that is waiting for permission is visible on the result', async () => {
  const res = await readRunStream(
    streamOf(
      frames(
        { type: 'run_started', runId: 'run_1' },
        { type: 'tool_call', runId: 'run_1', toolCall: { id: 'tc_1', name: 'Shell', status: 'pending_approval', args: { command: 'whoami' } } }
      )
    )
  );

  assert.equal(res.ok, false, 'the run never finished');
  assert.deepEqual(res.toolCalls, [
    { id: 'tc_1', name: 'Shell', status: 'pending_approval', args: { command: 'whoami' } }
  ]);
});

test('the latest status of a tool call wins, not the first', async () => {
  const res = await readRunStream(
    streamOf(
      frames(
        { type: 'run_started', runId: 'run_1' },
        { type: 'tool_call', runId: 'run_1', toolCall: { id: 'tc_1', name: 'Shell', status: 'pending_approval' } },
        { type: 'tool_call', runId: 'run_1', toolCall: { id: 'tc_1', name: 'Shell', status: 'completed' } },
        { type: 'run_end', status: 'completed' }
      )
    )
  );

  assert.equal(res.ok, true);
  assert.deepEqual(res.toolCalls, [{ id: 'tc_1', name: 'Shell', status: 'completed' }]);
});

test('every tool call update is reported, not once per event type', async () => {
  // onEvent dedupes by type, which is exactly wrong for a status sequence.
  const updates = [];
  await readRunStream(
    streamOf(
      frames(
        { type: 'tool_call', runId: 'run_1', toolCall: { id: 'tc_1', name: 'Shell', status: 'running' } },
        { type: 'tool_call', runId: 'run_1', toolCall: { id: 'tc_1', name: 'Shell', status: 'pending_approval' } }
      )
    ),
    undefined,
    (call) => updates.push(call.status)
  );

  assert.deepEqual(updates, ['running', 'pending_approval']);
});

test('file changes from run_end land on the result', async () => {
  const res = await readRunStream(
    streamOf(
      frames({
        type: 'run_end',
        status: 'completed',
        fileChanges: [
          {
            path: '/tmp/x/hello.txt',
            operation: 'write',
            patch: '@@ -0,0 +1,1 @@\n+hi\n',
            additions: 1,
            deletions: 0,
            beforeExisted: false,
            toolCallIds: ['tc_1']
          }
        ]
      })
    )
  );

  assert.equal(res.fileChanges.length, 1);
  assert.equal(res.fileChanges[0].path, '/tmp/x/hello.txt');
  assert.equal(res.fileChanges[0].additions, 1);
});

test('approving posts the decision, and scope project when asked', async () => {
  const fetchImpl = fakeFetch({ status: 200, json: { accepted: true } });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  assert.equal((await client.approve('tc_1', { approved: true })).ok, true);
  assert.equal(fetchImpl.seen.url, 'http://127.0.0.1:42527/api/approvals/tc_1');
  assert.deepEqual(fetchImpl.seen.body, { approved: true });

  await client.approve('tc_1', { approved: true, approvalScope: 'project' });
  assert.deepEqual(fetchImpl.seen.body, { approved: true, approvalScope: 'project' });
});

test('a denied approval is sent as a decision, not skipped', async () => {
  const fetchImpl = fakeFetch({ status: 200, json: { accepted: true } });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  await client.approve('tc_1', { approved: false });

  assert.deepEqual(fetchImpl.seen.body, { approved: false });
});

// ──────────────────────────────── revert ─────────────────────────────────────

test('revert posts the direction, and paths only when given', async () => {
  const fetchImpl = fakeFetch({ status: 200, body: '{}' });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  assert.equal((await client.revertFileChanges('run_1', { direction: 'undo' })).ok, true);
  assert.equal(fetchImpl.seen.url, 'http://127.0.0.1:42527/api/runs/run_1/file-changes/revert');
  assert.deepEqual(fetchImpl.seen.body, { direction: 'undo' }, 'omitted paths means every file');

  await client.revertFileChanges('run_1', { direction: 'redo', paths: ['/tmp/a.txt'] });
  assert.deepEqual(fetchImpl.seen.body, { direction: 'redo', paths: ['/tmp/a.txt'] });
});

test('reverting a run that changed nothing explains why, in the app\u2019s words', async () => {
  const fetchImpl = fakeFetch({ status: 400, body: '{"error":"该运行没有文件变更"}' });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  const res = await client.revertFileChanges('run_1', { direction: 'undo' });

  assert.equal(res.ok, false);
  assert.match(res.error, /revert HTTP 400/);
  assert.match(res.error, /该运行没有文件变更/);
});

test('the run carries the access mode when one was chosen', async () => {
  const fetchImpl = fakeFetch({ streamText: 'data: {"type":"run_end","status":"completed"}\n\n' });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  await client.run('s_1', 'hi', { accessMode: 'approval' });

  assert.deepEqual(fetchImpl.seen.body, { sessionId: 's_1', prompt: 'hi', accessMode: 'approval' });
});

test('abort posts to the run and survives the app being gone', async () => {
  const fetchImpl = fakeFetch({ status: 200, body: '{}' });
  const client = new ChengxiaobangClient({ baseUrl: 'http://127.0.0.1:42527', token: 't', fetchImpl });

  assert.equal(await client.abortRun('run_1'), true);
  assert.equal(fetchImpl.seen.url, 'http://127.0.0.1:42527/api/runs/run_1/abort');

  const dead = new ChengxiaobangClient({
    baseUrl: 'http://127.0.0.1:42527',
    token: 't',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); }
  });
  assert.equal(await dead.abortRun('run_1'), false);
});
