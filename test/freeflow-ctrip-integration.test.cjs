'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { readCxbAsrToken, transcribeWithCtrip } = loadTs('src/main/freeflow.ts');
const { CTRIP_WAV_RATE, encodeWavPcm16Mono } = loadTs('src/shared/wavEncode.ts');

/** ~0.5 s of silence at 16 kHz — valid WAV, minimal payload for a live broker ping. */
function tinySilentWav() {
  const samples = new Float32Array(CTRIP_WAV_RATE / 2);
  return encodeWavPcm16Mono(samples, CTRIP_WAV_RATE);
}

const NETWORK_FAIL = /timed out|ECONNREFUSED|ENOTFOUND|fetch failed|network|getaddrinfo/i;

test(
  'live Ctrip ASR (optional)',
  { skip: !process.env.CXB_ASR_TOKEN?.trim() },
  async (t) => {
    const token = readCxbAsrToken();
    assert.ok(token, 'CXB_ASR_TOKEN must be non-empty when test is not skipped');

    const out = await transcribeWithCtrip({ apiKey: token, audio: tinySilentWav() });

    if (!out.ok && NETWORK_FAIL.test(out.error || '')) {
      t.skip(`corp network unreachable: ${out.error}`);
    }

    assert.equal(typeof out.ok, 'boolean');
    if (out.ok) {
      assert.equal(typeof out.text, 'string');
    } else {
      // Silent fixture often yields "no speech detected" — still proves the broker responded.
      assert.ok(out.error);
      assert.doesNotMatch(out.error, new RegExp(token));
    }
  }
);
