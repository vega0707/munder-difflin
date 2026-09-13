/**
 * Model access for the built-in (in-process) agent seats.
 *
 * A `builtin` seat runs no CLI, so it has no CLI of its own to borrow a channel
 * from. Instead it reuses one this machine ALREADY has configured, the same way
 * 程小帮 does: whatever the operator set up for Claude Code or Codex is, in
 * practice, the corp coding-plan gateway. That is what lets a floor open on a
 * machine where nobody has installed an agent CLI.
 *
 * Resolution order (first hit wins):
 *   1. MUNDER_AGENT_LLM_KEY / _BASE / _MODEL — explicit OpenAI-compatible override
 *   2. config.json `agentLlm` — what the operator typed into Settings, so it
 *      outranks credentials merely discovered in other tools' config files
 *   3. ~/.codex/config.toml — the active model_provider's base_url/wire_api/env_key
 *   4. ~/.claude/settings.json env — ANTHROPIC_BASE_URL + key/auth token
 *   5. process env — ANTHROPIC_* / OPENAI_* fallbacks
 *
 * SECURITY: every secret here is read at runtime, used only in an Authorization
 * header, and never logged, returned to the renderer, or written anywhere except
 * the app's own config file when the operator types one in. `source` exists so a
 * log line can say WHERE a credential came from without saying what it is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentLlmSection } from './config';

export type AgentLlmWire = 'anthropic' | 'openai' | 'openai-responses';

export interface AgentLlmConfig {
  wire: AgentLlmWire;
  baseUrl: string;
  apiKey?: string;
  authToken?: string;
  model?: string;
  /** Where the credential came from — for logs. Never the secret itself. */
  source: string;
}

export interface CodexProviderInfo {
  providerId: string;
  name?: string;
  baseUrl?: string;
  wireApi?: string;
  envKey?: string;
}

/** Minimal TOML reader for the three things we need from ~/.codex/config.toml: the
 *  top-level `model`, the active `model_provider`, and that provider's
 *  base_url/wire_api/env_key. A real TOML parser would be a new dependency for
 *  four keys we can read line-wise. */
export function readCodexConfig(
  home = homedir()
): { model?: string; modelProvider?: string; providers: Record<string, CodexProviderInfo> } {
  const path = join(home, '.codex', 'config.toml');
  const out: { model?: string; modelProvider?: string; providers: Record<string, CodexProviderInfo> } = {
    providers: {}
  };
  if (!existsSync(path)) return out;
  let section = '';
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1]!;
      const pm = section.match(/^model_providers\.(.+)$/);
      if (pm) out.providers[pm[1]!] = { providerId: pm[1]! };
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*"?([^"]*)"?$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (!section && key === 'model') out.model = value;
    if (!section && key === 'model_provider') out.modelProvider = value;
    const pm = section.match(/^model_providers\.(.+)$/);
    if (pm) {
      const entry = (out.providers[pm[1]!] ??= { providerId: pm[1]! });
      if (key === 'name') entry.name = value;
      if (key === 'base_url') entry.baseUrl = value;
      if (key === 'wire_api') entry.wireApi = value;
      if (key === 'env_key') entry.envKey = value;
    }
  }
  return out;
}

export interface ClaudeSettingsEnv {
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
  model?: string;
}

/** The env block of ~/.claude/settings.json — the same file Claude Code itself
 *  reads, so this is the corp gateway 程小帮 is configured against. */
export function readClaudeSettingsEnv(home = homedir()): ClaudeSettingsEnv {
  const path = join(home, '.claude', 'settings.json');
  let parsed: { env?: Record<string, unknown> };
  try {
    parsed = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as { env?: Record<string, unknown> })
      : {};
  } catch {
    return {};
  }
  const env = parsed.env ?? {};
  const str = (k: string): string | undefined =>
    typeof env[k] === 'string' && (env[k] as string).length > 0 ? (env[k] as string) : undefined;
  const model = str('ANTHROPIC_MODEL');
  return {
    baseUrl: str('ANTHROPIC_BASE_URL'),
    apiKey: str('ANTHROPIC_API_KEY'),
    authToken: str('ANTHROPIC_AUTH_TOKEN'),
    // 'auto' means "let the gateway pick" — pass no --model / no model field
    // rather than asking for a model literally named auto.
    model: model && model !== 'auto' ? model : undefined
  };
}

/** Key for a codex provider: its own env_key first, then ~/.codex/auth.json. */
function codexProviderKey(
  provider: CodexProviderInfo,
  home: string,
  env: NodeJS.ProcessEnv
): string | undefined {
  if (provider.envKey && env[provider.envKey]) return env[provider.envKey];
  // A GUI-launched app (Finder/Dock, or a LaunchAgent) never inherited the shell
  // that exported ADA_API_KEY, so the ctrip provider looks keyless even though the
  // machine is set up. Claude's settings often hold the SAME ada_* token — reuse
  // it so we stay on the openai-responses wire instead of falling through to an
  // Anthropic channel this provider's base_url does not serve.
  if (provider.envKey === 'ADA_API_KEY' || provider.providerId === 'ctrip') {
    const claude = readClaudeSettingsEnv(home);
    if (claude.authToken) return claude.authToken;
    if (claude.apiKey) return claude.apiKey;
  }
  const authPath = join(home, '.codex', 'auth.json');
  if (!existsSync(authPath)) return undefined;
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>;
    const entry = auth[provider.providerId];
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      for (const k of ['api_key', 'apiKey', 'key', 'token']) {
        if (typeof e[k] === 'string' && (e[k] as string).length > 0) return e[k] as string;
      }
    }
    if (typeof auth.OPENAI_API_KEY === 'string') return auth.OPENAI_API_KEY;
  } catch {
    /* unreadable auth.json → no key discovered from it */
  }
  return undefined;
}

function wireFromCodex(wireApi: string | undefined): AgentLlmWire {
  if (wireApi === 'anthropic' || wireApi === 'anthropic_messages') return 'anthropic';
  if (wireApi === 'responses') return 'openai-responses';
  return 'openai';
}

const stripSlash = (u: string): string => u.replace(/\/$/, '');

export function resolveAgentLlmConfig(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  fileConfig?: AgentLlmSection
): AgentLlmConfig | undefined {
  // 1. Explicit OpenAI-compatible override — the escape hatch for a machine whose
  //    agent CLIs are configured some way we do not know how to read.
  const overrideKey = env.MUNDER_AGENT_LLM_KEY;
  if (overrideKey) {
    return {
      wire: 'openai',
      baseUrl: stripSlash(env.MUNDER_AGENT_LLM_BASE ?? 'https://api.openai.com/v1'),
      apiKey: overrideKey,
      model: env.MUNDER_AGENT_LLM_MODEL,
      source: 'env:MUNDER_AGENT_LLM_*'
    };
  }

  // 2. What the operator configured in Settings — their explicit choice for THIS
  //    app, so it outranks anything merely discovered elsewhere.
  if (fileConfig && (fileConfig.baseUrl || fileConfig.apiKey)) {
    return {
      wire: fileConfig.wire ?? 'openai',
      baseUrl: stripSlash(fileConfig.baseUrl ?? 'https://api.openai.com/v1'),
      apiKey: fileConfig.apiKey,
      authToken: fileConfig.authToken,
      model: fileConfig.model,
      source: 'config:agentLlm'
    };
  }

  // 3. Codex's active provider.
  const codex = readCodexConfig(home);
  const activeId = codex.modelProvider ?? Object.keys(codex.providers)[0];
  const active = activeId ? codex.providers[activeId] : undefined;
  if (active?.baseUrl) {
    const key = codexProviderKey(active, home, env);
    if (key) {
      return {
        wire: wireFromCodex(active.wireApi),
        baseUrl: stripSlash(active.baseUrl),
        apiKey: key,
        // Forwarded verbatim, `"auto"` included: on the corp gateway that IS the
        // model name (the operator's own config.toml says so), and guessing a
        // slug instead gets the request rejected with "model is not supported".
        model: codex.model,
        source: `~/.codex/config.toml (${active.providerId})`
      };
    }
  }

  // 4. Claude Code's configured gateway — the corp coding-plan channel.
  const claude = readClaudeSettingsEnv(home);
  if (claude.baseUrl && (claude.apiKey || claude.authToken)) {
    return {
      wire: 'anthropic',
      baseUrl: stripSlash(claude.baseUrl),
      apiKey: claude.apiKey,
      authToken: claude.authToken,
      model: claude.model,
      source: '~/.claude/settings.json env'
    };
  }

  // 5. Plain process-env fallbacks.
  if (env.ANTHROPIC_API_KEY) {
    return {
      wire: 'anthropic',
      baseUrl: stripSlash(env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'),
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL && env.ANTHROPIC_MODEL !== 'auto' ? env.ANTHROPIC_MODEL : undefined,
      source: 'env:ANTHROPIC_*'
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      wire: 'openai',
      baseUrl: stripSlash(env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'),
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      source: 'env:OPENAI_*'
    };
  }

  return undefined;
}
