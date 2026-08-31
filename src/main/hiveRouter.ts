import type { HiveManager } from './hive';
import type { ProjectRegistry } from './projectRegistry';

/**
 * Route a hive IPC call to the right HiveManager.
 *
 * An explicit projectId wins; otherwise the active project; otherwise the
 * process-wide fallback (legacy single hive during bootstrap).
 */
export function resolveHive(
  registry: ProjectRegistry,
  fallback: HiveManager,
  projectId?: unknown
): HiveManager {
  if (typeof projectId === 'string' && projectId) {
    const hit = registry.getProject(projectId);
    if (hit) return hit;
  }
  const active = registry.getActiveProjectId();
  if (active) {
    const hit = registry.getProject(active);
    if (hit) return hit;
  }
  return fallback;
}

export function projectIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const id = (payload as { projectId?: unknown }).projectId;
  return typeof id === 'string' && id ? id : undefined;
}
