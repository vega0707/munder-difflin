'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  readCodexConfig,
  readClaudeSettingsEnv,
  resolveAgentLlmConfig
} = loadTs('src/main/agentLlmCreds.ts');

/** A throwaway HOME so the resolution chain never depends on this machine. */
function homeWith(files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'munder-creds-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(home, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return home;
}

const CODEX_TOML = [
  'model_provider = "ctrip"',
  'model = "auto"',
  '',
  '[model_providers.ctrip]',
  'name = "Ctrip"',
  'base_url = "http://ada-cli-golang.ctripcorp.com/coding-plan/codex/v1"',
  'wire_api = "responses"',
  'env_key = "ADA_API_KEY"',
  ''
].join('\n');

const CLAUDE_SETTINGS = JSON.stringify({
  env: {
    ANTHROPIC_BASE_URL: 'http://ada-cli-golang.ctripcorp.com/coding-plan',
    ANTHROPIC_AUTH_TOKEN: 'tok-123456',
    ANTHROPIC_MODEL: 'auto'
  }
});

// ─────────────────────────────── readers ──────────────────────────────────────

test('readCodexConfig picks the active provider and its four keys', () => {
  const home = homeWith({ '.codex/config.toml': CODEX_TOML });
  const parsed = readCodexConfig(home);

  assert.equal(parsed.model, 'auto');
  assert.equal(parsed.modelProvider, 'ctrip');
  assert.deepEqual(parsed.providers.ctrip, {
    providerId: 'ctrip',
    name: 'Ctrip',
    baseUrl: 'http://ada-cli-golang.ctripcorp.com/coding-plan/codex/v1',
    wireApi: 'responses',
    envKey: 'ADA_API_KEY'
  });
});

test('readCodexConfig returns an empty result when the file is absent', () => {
  const home = homeWith({});
  assert.deepEqual(readCodexConfig(home), { providers: {} });
});

test('readClaudeSettingsEnv maps the env block and treats model "auto" as unset', () => {
  const home = homeWith({ '.claude/settings.json': CLAUDE_SETTINGS });
  const env = readClaudeSettingsEnv(home);

  assert.equal(env.baseUrl, 'http://ada-cli-golang.ctripcorp.com/coding-plan');
  assert.equal(env.authToken, 'tok-123456');
  // 'auto' means "let the gateway choose" — it must not be sent as a model name.
  assert.equal(env.model, undefined);
});

test('readClaudeSettingsEnv survives a malformed file', () => {
  const home = homeWith({ '.claude/settings.json': '{ not json' });
  assert.deepEqual(readClaudeSettingsEnv(home), {});
});

// ───────────────────────────── resolution order ───────────────────────────────

test('an explicit env override outranks everything else', () => {
  const home = homeWith({
    '.codex/config.toml': CODEX_TOML,
    '.claude/settings.json': CLAUDE_SETTINGS
  });
  const cfg = resolveAgentLlmConfig(home, { MUNDER_AGENT_LLM_KEY: 'envkey', MUNDER_AGENT_LLM_BASE: 'http://x/' });

  assert.equal(cfg.wire, 'openai');
  assert.equal(cfg.apiKey, 'envkey');
  assert.equal(cfg.baseUrl, 'http://x');
  assert.equal(cfg.source, 'env:MUNDER_AGENT_LLM_*');
});

test('the settings section outranks credentials discovered from other tools', () => {
  const home = homeWith({ '.codex/config.toml': CODEX_TOML });
  const cfg = resolveAgentLlmConfig(home, {}, {
    wire: 'anthropic',
    baseUrl: 'http://mine/',
    apiKey: 'mykey',
    model: 'my-model'
  });

  assert.equal(cfg.source, 'config:agentLlm');
  assert.equal(cfg.wire, 'anthropic');
  assert.equal(cfg.baseUrl, 'http://mine');
  assert.equal(cfg.model, 'my-model');
});

test('the codex provider is used and its wire_api decides the wire', () => {
  const home = homeWith({
    '.codex/config.toml': CODEX_TOML,
    '.codex/auth.json': JSON.stringify({ ctrip: { api_key: 'codexkey' } })
  });
  const cfg = resolveAgentLlmConfig(home, {});

  assert.equal(cfg.wire, 'openai-responses', 'wire_api = "responses"');
  assert.equal(cfg.baseUrl, 'http://ada-cli-golang.ctripcorp.com/coding-plan/codex/v1');
  assert.equal(cfg.apiKey, 'codexkey');
  assert.equal(cfg.source, '~/.codex/config.toml (ctrip)');
  // Forwarded verbatim, not dropped: on this gateway "auto" IS the model name,
  // and substituting a slug gets the request rejected.
  assert.equal(cfg.model, 'auto');
});

test('an explicit codex model is forwarded verbatim', () => {
  const home = homeWith({
    '.codex/config.toml': CODEX_TOML.replace('model = "auto"', 'model = "gpt-5.1-codex"'),
    '.codex/auth.json': JSON.stringify({ ctrip: { api_key: 'codexkey' } })
  });

  assert.equal(resolveAgentLlmConfig(home, {}).model, 'gpt-5.1-codex');
});

test('a GUI-launched app still reaches the ctrip provider by reusing the claude token', () => {
  // The real case: Finder/Dock never inherited the shell that exported
  // ADA_API_KEY, so the codex provider looks keyless — but the same ada_* token
  // sits in Claude's settings, and reusing it keeps us on the responses wire.
  const home = homeWith({
    '.codex/config.toml': CODEX_TOML,
    '.claude/settings.json': CLAUDE_SETTINGS
  });
  const cfg = resolveAgentLlmConfig(home, {});

  assert.equal(cfg.wire, 'openai-responses');
  assert.equal(cfg.apiKey, 'tok-123456');
  assert.equal(cfg.source, '~/.codex/config.toml (ctrip)');
});

test('codex env_key wins over the claude fallback when the shell did export it', () => {
  const home = homeWith({
    '.codex/config.toml': CODEX_TOML,
    '.claude/settings.json': CLAUDE_SETTINGS
  });
  const cfg = resolveAgentLlmConfig(home, { ADA_API_KEY: 'from-shell' });

  assert.equal(cfg.apiKey, 'from-shell');
});

test('with no codex config the claude gateway is used on the anthropic wire', () => {
  const home = homeWith({ '.claude/settings.json': CLAUDE_SETTINGS });
  const cfg = resolveAgentLlmConfig(home, {});

  assert.equal(cfg.wire, 'anthropic');
  assert.equal(cfg.baseUrl, 'http://ada-cli-golang.ctripcorp.com/coding-plan');
  assert.equal(cfg.authToken, 'tok-123456');
  assert.equal(cfg.apiKey, undefined);
  assert.equal(cfg.model, undefined);
  assert.equal(cfg.source, '~/.claude/settings.json env');
});

test('process env is the last resort', () => {
  const home = homeWith({});
  assert.equal(resolveAgentLlmConfig(home, { OPENAI_API_KEY: 'o' }).wire, 'openai');
  assert.equal(resolveAgentLlmConfig(home, { ANTHROPIC_API_KEY: 'a' }).wire, 'anthropic');
  // ANTHROPIC wins the ordering when both are present.
  assert.equal(resolveAgentLlmConfig(home, { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }).wire, 'anthropic');
});

test('an anthropic env fallback drops the literal model name "auto"', () => {
  const home = homeWith({});
  const cfg = resolveAgentLlmConfig(home, { ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'auto' });
  assert.equal(cfg.model, undefined);
});

test('a machine with no configured channel resolves to nothing', () => {
  const home = homeWith({});
  assert.equal(resolveAgentLlmConfig(home, {}), undefined);
});

test('a channel that carries a key but no base URL is not used', () => {
  // base_url is what makes a provider usable; a bare env_key is not a channel.
  const home = homeWith({
    '.codex/config.toml': '[model_providers.ctrip]\nenv_key = "ADA_API_KEY"\n',
    '.claude/settings.json': JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' } })
  });
  assert.equal(resolveAgentLlmConfig(home, { ADA_API_KEY: 'x' }), undefined);
});

test('the reported source names the origin without ever carrying the secret', () => {
  const home = homeWith({
    '.codex/config.toml': CODEX_TOML,
    '.claude/settings.json': CLAUDE_SETTINGS
  });
  for (const cfg of [
    resolveAgentLlmConfig(home, {}),
    resolveAgentLlmConfig(home, { MUNDER_AGENT_LLM_KEY: 'envkey' }),
    resolveAgentLlmConfig(home, {}, { baseUrl: 'http://mine', apiKey: 'mykey' })
  ]) {
    assert.ok(!cfg.source.includes('tok-123456'), 'source must not leak the token');
    assert.ok(!cfg.source.includes('envkey'));
    assert.ok(!cfg.source.includes('mykey'));
  }
});
