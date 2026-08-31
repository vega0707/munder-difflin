'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  resolveSttProvider,
  STT_PROVIDERS
} = loadTs('src/shared/sttProviders.ts');

test('unknown or missing provider falls back to groq', () => {
  assert.equal(resolveSttProvider(undefined).id, 'groq');
  assert.equal(resolveSttProvider('nope').id, 'groq');
});

test('siliconflow resolves to the China-reachable transcription URL', () => {
  const p = resolveSttProvider('siliconflow');
  assert.equal(p.id, 'siliconflow');
  assert.equal(p.endpoint, 'https://api.siliconflow.cn/v1/audio/transcriptions');
  assert.equal(p.defaultModel, 'FunAudioLLM/SenseVoiceSmall');
});

test('siliconflow is a first-class Voice setting', () => {
  const modal = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src/renderer/src/components/SettingsModal.tsx'),
    'utf8'
  );
  assert.match(modal, /siliconflow/);
  assert.match(modal, /STT_PROVIDERS/);
});
