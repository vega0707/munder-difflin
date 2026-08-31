'use strict';

/**
 * The app is often launched from inside a Claude Code session, and the parent
 * session's identity markers used to flow into every agent PTY. One of them
 * (CLAUDE_CODE_CHILD_SESSION) silently disables transcript saving, which broke
 * --resume for every agent of a run — invisible until someone needed a resume.
 * These tests pin the layering rule: inherited env is stripped of the parent's
 * Claude identity by PREFIX, config-not-identity names survive, and per-agent
 * values always win.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { buildPtyEnv } = loadTs('src/main/ptyEnv.ts');
const { parseExportLines } = loadTs('src/main/shellEnv.ts');

/** The twelve markers dumped from a live Claude Code session in review of the
 *  fix — the original hardcoded list caught only the first five. */
const LIVE_SESSION_MARKERS = {
  CLAUDE_CODE_CHILD_SESSION: 'true',
  CLAUDE_CODE_SESSION_ID: 'abc-123',
  CLAUDE_PID: '4242',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/claude.sock',
  CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
  CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
  CLAUDE_EFFORT: 'high',
  CLAUDE_CODE_EXECPATH: '/usr/local/bin/claude',
  CLAUDECODE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX: 'rc'
};

test('every live-session identity marker is stripped from the inherited env', () => {
  const env = buildPtyEnv({ HOME: '/Users/x', ...LIVE_SESSION_MARKERS }, '/bin', undefined, 'darwin');
  for (const k of Object.keys(LIVE_SESSION_MARKERS)) {
    assert.ok(!(k in env), `${k} must not leak into an agent PTY`);
  }
  assert.equal(env.HOME, '/Users/x');
});

test('markers the CLI has not invented yet are stripped by the prefix rule', () => {
  const env = buildPtyEnv(
    { CLAUDE_CODE_SOME_FUTURE_THING: 'x', CLAUDE_NEXT_YEAR: 'y' },
    '/bin', undefined, 'darwin'
  );
  assert.ok(!('CLAUDE_CODE_SOME_FUTURE_THING' in env));
  assert.ok(!('CLAUDE_NEXT_YEAR' in env));
});

test('operator configuration sharing the prefix survives: config dir, auth, backend', () => {
  const env = buildPtyEnv(
    {
      CLAUDE_CONFIG_DIR: '/Users/x/.claude-alt',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      ...LIVE_SESSION_MARKERS
    },
    '/bin', undefined, 'darwin'
  );
  assert.equal(env.CLAUDE_CONFIG_DIR, '/Users/x/.claude-alt');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'oauth');
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, '1');
  assert.equal(env.CLAUDE_CODE_USE_VERTEX, '1');
  assert.ok(!('CLAUDE_CODE_SESSION_ID' in env), 'keep-list must not weaken the strip');
});

test('names that merely start with CLAUDE are not the prefix and survive', () => {
  const env = buildPtyEnv({ CLAUDES_HOUSE: 'blue', ANTHROPIC_API_KEY: 'k' }, '/bin', undefined, 'darwin');
  assert.equal(env.CLAUDES_HOUSE, 'blue');
  assert.equal(env.ANTHROPIC_API_KEY, 'k');
});

test('per-agent env wins over the strip AND over the defaults', () => {
  const env = buildPtyEnv(
    LIVE_SESSION_MARKERS,
    '/bin',
    { CLAUDE_CODE_SESSION_ID: 'deliberate', TERM: 'vt100', AGENT_ID: 'a1' },
    'darwin'
  );
  // A marker set on purpose by the app (or a future per-agent env feature) is
  // NOT wiped — only the inherited layer is stripped.
  assert.equal(env.CLAUDE_CODE_SESSION_ID, 'deliberate');
  assert.equal(env.TERM, 'vt100');
  assert.equal(env.AGENT_ID, 'a1');
});

test('app defaults land: PATH, terminal identity, color', () => {
  const env = buildPtyEnv({ PATH: '/stale' }, '/resolved/bin', undefined, 'darwin');
  assert.equal(env.PATH, '/resolved/bin');
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.FORCE_COLOR, '1');
});

test('locale: UTF-8 defaults on darwin, the user\'s exported locale wins, win32 untouched', () => {
  const bare = buildPtyEnv({}, '/bin', undefined, 'darwin');
  assert.equal(bare.LANG, 'en_US.UTF-8');
  assert.equal(bare.LC_CTYPE, 'en_US.UTF-8');

  const exported = buildPtyEnv({ LANG: 'es_ES.UTF-8', LC_ALL: 'fr_FR.UTF-8' }, '/bin', undefined, 'linux');
  assert.equal(exported.LANG, 'es_ES.UTF-8');
  assert.equal(exported.LC_CTYPE, 'fr_FR.UTF-8');

  const win = buildPtyEnv({}, 'C:\\bin', undefined, 'win32');
  assert.ok(!('LANG' in win));
  assert.ok(!('LC_CTYPE' in win));
});

test('parseExportLines reads export -p output: bare, quoted, and rc chatter', () => {
  assert.deepEqual(
    parseExportLines([
      'export ADA_API_KEY=ada_secret',
      'export LANG=\'en_US.UTF-8\'',
      'export BREW_PREFIX="/opt/homebrew"',
      'export EMPTY=\'\'',
      'Restored session: <date>',       // rc-file chatter — no assignment, skipped
      'PATH=/stale/should/not/appear'   // no `export` keyword is still a bare form
    ].join('\n')),
    {
      ADA_API_KEY: 'ada_secret',
      LANG: 'en_US.UTF-8',
      BREW_PREFIX: '/opt/homebrew',
      PATH: '/stale/should/not/appear'
    }
  );
});

test('shell exports fill ONLY gaps the inherited env left, and stay stripped', () => {
  // ADA_API_KEY lives in the user's rc file but not in the launching env — the
  // exact case that broke codex's env_key provider when the app was launched
  // from Finder (or a terminal that lacks it).
  const filled = buildPtyEnv(
    { HOME: '/Users/x' },
    '/bin',
    undefined,
    'darwin',
    { ADA_API_KEY: 'ada_secret', BREW_PREFIX: '/opt/homebrew', CLAUDE_CODE_SESSION_ID: 'stale' }
  );
  assert.equal(filled.ADA_API_KEY, 'ada_secret');
  assert.equal(filled.BREW_PREFIX, '/opt/homebrew');
  assert.ok(!('CLAUDE_CODE_SESSION_ID' in filled), 'rc-file identity markers are stripped too');

  // An explicit value in the inherited layer wins over the rc file.
  const explicitWins = buildPtyEnv(
    { HOME: '/Users/x', ADA_API_KEY: 'launching-env-key' },
    '/bin',
    undefined,
    'darwin',
    { ADA_API_KEY: 'rc-file-key' }
  );
  assert.equal(explicitWins.ADA_API_KEY, 'launching-env-key');

  // Agent env still outranks everything, including a filled gap.
  const agentWins = buildPtyEnv(
    {},
    '/bin',
    { ADA_API_KEY: 'per-agent-key' },
    'darwin',
    { ADA_API_KEY: 'rc-file-key' }
  );
  assert.equal(agentWins.ADA_API_KEY, 'per-agent-key');
});
