/**
 * Cross-floor hive addresses. One project is one floor; mail to another floor
 * uses `floor:<projectId>/<agentId>`. `god` / `human` still mean that floor's
 * current orchestrator, resolved on the target hive.
 */

export const FLOOR_ADDRESS_PREFIX = 'floor:';

export interface FloorAddress {
  projectId: string;
  agentId: string;
}

const FLOOR_RE = /^floor:([^/]+)\/([^/]+)$/;

export function isFloorAddress(value: string): boolean {
  return FLOOR_RE.test(value);
}

export function parseFloorAddress(value: string): FloorAddress | null {
  const m = FLOOR_RE.exec(value.trim());
  if (!m) return null;
  const projectId = m[1].trim();
  const agentId = m[2].trim();
  if (!projectId || !agentId) return null;
  return { projectId, agentId };
}

export function formatFloorAddress(projectId: string, agentId: string): string {
  return `${FLOOR_ADDRESS_PREFIX}${projectId}/${agentId}`;
}

/** Rewrite a local sender id into a floor address unless it already is one. */
export function stampFloorFrom(sourceProjectId: string, from: string): string {
  if (isFloorAddress(from)) return from;
  return formatFloorAddress(sourceProjectId, from);
}
