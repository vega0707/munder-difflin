'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  CTRIP_ASR_URL,
  CTRIP_MAX_AUDIO_BASE64_LENGTH,
  readCxbAsrToken,
  transcribeWithCtrip
} = loadTs('src/main/freeflow.ts');

function fakeAudio() {
  return new Uint8Array([1, 2, 3, 4]);
}

test('readCxbAsrToken trims CXB_ASR_TOKEN', () => {
  assert.equal(readCxbAsrToken({ CXB_ASR_TOKEN: '  tok  ' }), 'tok');
  assert.equal(readCxbAsrToken({ CXB_ASR_TOKEN: '' }), undefined);
  assert.equal(readCxbAsrToken({}), undefined);
});

test('empty key returns error mentioning CXB_ASR_TOKEN', async () => {
  const out = await transcribeWithCtrip({ apiKey: '', audio: fakeAudio() });
  assert.equal(out.ok, false);
  assert.match(out.error, /CXB_ASR_TOKEN/);
});

test('success posts JSON to Ctrip ASR with Bearer auth', async (t) => {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, text: '你好' })
    };
  };
  t.after(() => { globalThis.fetch = prev; });

  const secret = 'cxb_secret_token_value';
  const out = await transcribeWithCtrip({ apiKey: secret, audio: fakeAudio() });
  assert.equal(out.ok, true);
  assert.equal(out.text, '你好');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CTRIP_ASR_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');

  const body = JSON.parse(calls[0].init.body);
  assert.ok(typeof body.audio === 'string' && body.audio.length > 0);
  assert.equal(body.mimeType, 'audio/wav');
  assert.equal(body.language, 'zh');
  assert.doesNotMatch(out.error || '', new RegExp(secret));
});

test('HTTP 401 returns error mentioning CXB_ASR_TOKEN', async (t) => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => JSON.stringify({ success: false, message: 'invalid token' })
  });
  t.after(() => { globalThis.fetch = prev; });

  const secret = 'cxb_bad_token';
  const out = await transcribeWithCtrip({ apiKey: secret, audio: fakeAudio() });
  assert.equal(out.ok, false);
  assert.match(out.error, /CXB_ASR_TOKEN/);
  assert.doesNotMatch(out.error, new RegExp(secret));
});

test('success false with message surfaces broker message', async (t) => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: false, message: 'audio decode failed' })
  });
  t.after(() => { globalThis.fetch = prev; });

  const out = await transcribeWithCtrip({ apiKey: 'tok', audio: fakeAudio() });
  assert.equal(out.ok, false);
  assert.match(out.error, /audio decode failed/);
});

test('oversized base64 rejects before fetch', async (t) => {
  let fetchCalled = false;
  const prev = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200, text: async () => '{}' };
  };
  t.after(() => { globalThis.fetch = prev; });

  const rawBytes = Math.ceil((CTRIP_MAX_AUDIO_BASE64_LENGTH / 4) * 3) + 1;
  const huge = new Uint8Array(rawBytes);
  const out = await transcribeWithCtrip({ apiKey: 'tok', audio: huge });
  assert.equal(out.ok, false);
  assert.equal(fetchCalled, false);
  assert.match(out.error, /too large/i);
});
