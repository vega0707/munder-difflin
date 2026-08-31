'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { transcribeWithGroq } = loadTs('src/main/freeflow.ts');

function fakeAudio() {
  return new Uint8Array([1, 2, 3, 4]);
}

test('posts to Groq by default', async (t) => {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, text: async () => JSON.stringify({ text: 'hello' }) };
  };
  t.after(() => { globalThis.fetch = prev; });

  const out = await transcribeWithGroq({ apiKey: 'gsk_test', audio: fakeAudio() });
  assert.equal(out.ok, true);
  assert.equal(out.text, 'hello');
  assert.equal(calls[0], 'https://api.groq.com/openai/v1/audio/transcriptions');
});

test('posts to SiliconFlow when that endpoint is set', async (t) => {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization });
    return { ok: true, status: 200, text: async () => JSON.stringify({ text: '你好' }) };
  };
  t.after(() => { globalThis.fetch = prev; });

  const out = await transcribeWithGroq({
    apiKey: 'sk-test',
    audio: fakeAudio(),
    endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
    model: 'FunAudioLLM/SenseVoiceSmall'
  });
  assert.equal(out.ok, true);
  assert.equal(out.text, '你好');
  assert.equal(calls[0].url, 'https://api.siliconflow.cn/v1/audio/transcriptions');
  assert.equal(calls[0].auth, 'Bearer sk-test');
});

test('surfaces a 403 Forbidden body without leaking the key', async (t) => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    text: async () => JSON.stringify({ error: { message: 'Forbidden' } })
  });
  t.after(() => { globalThis.fetch = prev; });

  const out = await transcribeWithGroq({ apiKey: 'gsk_secret_value', audio: fakeAudio() });
  assert.equal(out.ok, false);
  assert.match(out.error, /403/);
  assert.match(out.error, /Forbidden/);
  assert.doesNotMatch(out.error, /gsk_secret_value/);
});
