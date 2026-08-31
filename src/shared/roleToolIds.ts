/**
 * Shared validation helpers for per-role tool allowlists (skills + MCP).
 * Kept separate from toolCatalog.ts (external setup catalog).
 */

import { unknownBundledSkillIds } from './bundledSkills';
import { MCP_CATALOG, mcpCatalogEntry } from './mcpCatalog';

const MCP_ID_SET = new Set(MCP_CATALOG.map((e) => e.id));

export function isMcpCatalogId(id: string): boolean {
  return MCP_ID_SET.has(id);
}

/** Return MCP catalog ids that are not known. */
export function unknownMcpCatalogIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !MCP_ID_SET.has(id));
}

/** Validate skill + MCP id arrays for role drafts; throws on unknown ids. */
export function assertRoleToolIds(skills?: string[], mcp?: string[]): void {
  if (skills?.length) {
    const bad = unknownBundledSkillIds(skills);
    if (bad.length) throw new Error(`unknown skill ids: ${bad.join(', ')}`);
  }
  if (mcp?.length) {
    const bad = unknownMcpCatalogIds(mcp);
    if (bad.length) throw new Error(`unknown mcp ids: ${bad.join(', ')}`);
  }
}

/** Safe-readonly MCP ids (for role-propose hints). */
export function safeReadonlyMcpIds(): string[] {
  return MCP_CATALOG.filter((e) => e.tier === 'safe-readonly').map((e) => e.id);
}

/** Consent-gated MCP ids (write/secret tier). */
export function consentGatedMcpIds(): string[] {
  return MCP_CATALOG.filter((e) => e.tier !== 'safe-readonly').map((e) => e.id);
}

export { mcpCatalogEntry };
