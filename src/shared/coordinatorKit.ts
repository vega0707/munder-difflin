/**
 * Coordinator role kit — the shared skills + MCP bundle every orchestrator /
 * coordination-class hire should ride with.
 *
 * Why a kit: a coordinator's job is situational awareness + routing. That needs
 * the same small set of tools every time (hive sync, fetch/summarize, structured
 * thinking, time, scoped filesystem/git, and — when the human consents — web
 * search). Encoding it once keeps GOD's identity prompt, hire manifests, and
 * the gallery in sync instead of hand-copying lists that drift.
 *
 * Security: secret-tier MCP (search-with-key) is listed for consent UI only —
 * never auto-enabled. Safe-readonly entries match MCP_CATALOG defaults.
 */

import { isSafeReadonlyMcp } from './mcpCatalog';

/** Bundled skills every coordinator should lean on. */
export const COORDINATOR_SKILLS = ['md-hive-sync', 'md-fetch-summarize'] as const;

/** Safe-readonly MCP servers for coordinators (pre-enabled by catalog defaults). */
export const COORDINATOR_MCP_SAFE = [
  'sequential-thinking',
  'time',
  'fetch',
  'filesystem',
  'git'
] as const;

/**
 * Consent-gated MCP servers coordinators typically need. Surfaced at hire
 * import / settings — never auto-enabled.
 */
export const COORDINATOR_MCP_CONSENT = ['search-with-key'] as const;

/** Full MCP id list (safe + consent) for hire manifests. */
export const COORDINATOR_MCP_SERVERS = [
  ...COORDINATOR_MCP_SAFE,
  ...COORDINATOR_MCP_CONSENT
] as const;

export type CoordinatorKit = {
  skills: string[];
  mcpServers: string[];
};

/** Capability tags that mark a hire as coordination-class. */
const COORDINATOR_CAP_TAGS = new Set([
  'triage',
  'ticket-triage',
  'escalation',
  'operations',
  'monitoring',
  'workflows',
  'orchestration',
  'coordination',
  'routing'
]);

const COORDINATOR_TEXT_RE =
  /\b(orchestrat|coordina|triage|dispatch|rout(e|ing)|escalat|manager)\b|协调|编排|分派/i;

/** The portable kit object (fresh arrays so callers can mutate safely). */
export function coordinatorKit(): CoordinatorKit {
  return {
    skills: [...COORDINATOR_SKILLS],
    mcpServers: [...COORDINATOR_MCP_SERVERS]
  };
}

/** True when this agent is the GOD orchestrator. */
export function isCoordinatorAgent(agent: {
  isGod?: boolean;
  description?: string | null;
  role?: string | null;
  capabilities?: string[] | null;
}): boolean {
  if (agent.isGod) return true;
  return isCoordinatorHire({
    description: agent.description ?? agent.role,
    capabilities: agent.capabilities ?? undefined
  });
}

/**
 * True when a hire (or role description) is coordination-class — triage,
 * escalation, fleet ops, orchestration wording, etc.
 */
export function isCoordinatorHire(hire: {
  description?: string | null;
  goal?: string | null;
  capabilities?: string[] | null;
}): boolean {
  const caps = (hire.capabilities ?? []).map((c) => c.trim().toLowerCase());
  if (caps.some((c) => COORDINATOR_CAP_TAGS.has(c))) return true;
  const text = `${hire.description ?? ''} ${hire.goal ?? ''}`;
  return COORDINATOR_TEXT_RE.test(text);
}

/**
 * Merge the coordinator kit into a hire-shaped object. Existing skills /
 * mcpServers win (kit fills gaps only). Idempotent.
 */
export function withCoordinatorKit<T extends { skills?: string[]; mcpServers?: string[] }>(
  hire: T
): T & CoordinatorKit {
  const kit = coordinatorKit();
  const skills = mergeUnique(hire.skills, kit.skills);
  const mcpServers = mergeUnique(hire.mcpServers, kit.mcpServers);
  return { ...hire, skills, mcpServers };
}

/** Split a kit's MCP list into safe (auto) vs consent-required. */
export function partitionCoordinatorMcp(ids: readonly string[] = COORDINATOR_MCP_SERVERS): {
  safe: string[];
  consent: string[];
} {
  const safe: string[] = [];
  const consent: string[] = [];
  for (const id of ids) {
    if (isSafeReadonlyMcp(id)) safe.push(id);
    else consent.push(id);
  }
  return { safe, consent };
}

/**
 * One-line toolkit reminder for GOD identity / system prompt. Volatile-free
 * (no dates/ids) so it stays prompt-cache stable.
 */
export function coordinatorToolkitPromptLine(): string {
  const { safe, consent } = partitionCoordinatorMcp();
  return (
    `COORDINATOR TOOLKIT: at the start of a task run the \`/${COORDINATOR_SKILLS[0]}\` skill ` +
    `(and \`/${COORDINATOR_SKILLS[1]}\` when you need a URL summarized). Prefer the safe MCP servers ` +
    `${safe.map((id) => `\`${id}\``).join(', ')} when they are enabled. ` +
    `Web search (${consent.map((id) => `\`${id}\``).join(', ')}) is available only when the human ` +
    `has opted in under Settings → MCP — use it to ground routing and research instead of guessing.`
  );
}

function mergeUnique(
  existing: string[] | undefined,
  extras: readonly string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(existing ?? []), ...extras]) {
    const key = id.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
