'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  CTRIP_WAV_RATE,
  resampleLinear,
  encodeWavPcm16Mono,
  uint8ToBase64
} = loadTs('src/shared/wavEncode.ts');

/** Short sine tone for PCM/WAV checks (not audibility — structure only). */
function tone(length, freq = 440, sampleRate = 16000) {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5;
  }
  return samples;
}

test('WAV has RIFF/WAVE and data chunk size matches samples', () => {
  const samples = tone(1600, 440, CTRIP_WAV_RATE);
  const wav = encodeWavPcm16Mono(samples, CTRIP_WAV_RATE);

  const riff = String.fromCharCode(...wav.subarray(0, 4));
  const wave = String.fromCharCode(...wav.subarray(8, 12));
  assert.equal(riff, 'RIFF');
  assert.equal(wave, 'WAVE');

  const dataMarker = String.fromCharCode(...wav.subarray(36, 40));
  assert.equal(dataMarker, 'data');

  const dataSize =
    wav[40] | (wav[41] << 8) | (wav[42] << 16) | (wav[43] << 24);
  assert.equal(dataSize, samples.length * 2);
  assert.equal(wav.length, 44 + dataSize);
});

test('resample 48000 to 16000 yields length approximately one third', () => {
  const input = tone(4800, 440, 48000);
  const output = resampleLinear(input, 48000, 16000);
  const expected = Math.round(input.length / 3);
  assert.ok(
    Math.abs(output.length - expected) <= 1,
    `expected ~${expected}, got ${output.length}`
  );
});

test('base64 round-trip preserves byte length', () => {
  const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
  const b64 = uint8ToBase64(bytes);
  const decoded = Buffer.from(b64, 'base64');
  assert.equal(decoded.length, bytes.length);
  assert.deepEqual([...decoded], [...bytes]);
});

test('CTRIP_WAV_RATE is 16000', () => {
  assert.equal(CTRIP_WAV_RATE, 16000);
});
