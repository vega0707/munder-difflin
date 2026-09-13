'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  AGENT_PROVIDER_PRESETS,
  providerPreset,
  providerNeedsPty,
  isInProcessChatEngine,
  isAgentProvider,
  inferAgentProvider,
  DEFAULT_AGENT_PROVIDER,
  IN_PROCESS_CHAT_PROVIDERS
} = loadTs('src/shared/agentProvider.ts');
const { classifyEngineAvailability } = loadTs('src/shared/engineAvailability.ts');
const { contextCommandsForProvider } = loadTs('src/shared/providerAutomation.ts');
const { modelsForProvider } = loadTs('src/renderer/src/store/config.ts');

/**
 * 程小帮 is a selectable engine, not a CLI — it has no binary, no PATH probe and
 * no slash parser. These pin the two things that make it real: it resolves as a
 * provider, and every "is this an engine with a child process?" call site lands
 * on the in-process answer.
 */

test('the preset is registered with the fields a pickable engine needs', () => {
  const preset = providerPreset('chengxiaobang');

  assert.equal(preset.label, '程小帮');
  assert.equal(preset.supportsModel, true, 'it has a model list, so the picker must show one');
  assert.equal(preset.canReceiveInbox, true, 'it can drain hive mail, so it may run the floor');
  assert.equal(preset.hiveAware, false);
  assert.equal(preset.recommendedOrchestratorModel, 'auto');
  assert.deepEqual(preset.commandGroups, [], 'no CLI means no slash-command groups');
});

test('it sits beside Built-in as the no-install options', () => {
  const ids = AGENT_PROVIDER_PRESETS.map((p) => p.id);
  assert.equal(ids[0], 'builtin');
  assert.equal(ids[1], 'chengxiaobang');
  assert.deepEqual([...IN_PROCESS_CHAT_PROVIDERS], ['builtin', 'chengxiaobang']);
});

test('it is recognised as a provider value and inferred from its own command', () => {
  assert.equal(isAgentProvider('chengxiaobang'), true);
  assert.equal(inferAgentProvider('chengxiaobang'), 'chengxiaobang');
  // The second argument is an explicit override, which outranks the command.
  assert.equal(inferAgentProvider('chengxiaobang', 'claude'), 'claude');
});

test('it needs no PTY, which is what routes it to the in-process host and the chat panel', () => {
  assert.equal(providerNeedsPty('chengxiaobang'), false);
  assert.equal(providerNeedsPty('builtin'), false);
  assert.equal(providerNeedsPty('claude'), true);
  assert.equal(providerNeedsPty(undefined), true, 'an unset provider is still a CLI');
});

test('isInProcessChatEngine answers for both no-install engines and nothing else', () => {
  assert.equal(isInProcessChatEngine('builtin'), true);
  assert.equal(isInProcessChatEngine('chengxiaobang'), true);
  assert.equal(isInProcessChatEngine('claude'), false);
  assert.equal(isInProcessChatEngine('custom'), false);
  assert.equal(isInProcessChatEngine(undefined), false);
});

test('the default engine is unchanged by this addition', () => {
  // 程小帮 is selectable, but flipping what a fresh floor starts on is a separate
  // product decision — pin the current answer so a silent change is caught.
  assert.equal(DEFAULT_AGENT_PROVIDER, 'builtin');
});

test('engine availability says installed, because there is nothing to install', () => {
  assert.deepEqual(classifyEngineAvailability(undefined, 'chengxiaobang'), {
    state: 'installed',
    path: null,
    installCommand: ''
  });
});

test('it declares no compaction command, because there is no REPL to type one into', () => {
  assert.deepEqual(contextCommandsForProvider('chengxiaobang'), {
    compact: null,
    clear: null,
    compactTakesFocus: false
  });
});

test('the catalog offers its model, so the picker is never empty', () => {
  const models = modelsForProvider('chengxiaobang');
  assert.deepEqual(models.map((m) => m.id), ['auto']);
  assert.equal(models[0].label, 'Auto');
});
