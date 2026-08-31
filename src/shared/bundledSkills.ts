/**
 * Bundled skill folder names under `resources/skills/`. Single source of truth
 * for hire allowlists, role catalog validation, and UI hints.
 */

export const BUNDLED_SKILL_IDS = [
  'capabilities',
  'temporal',
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'lastQuarter',
  'thisYear',
  'lastYear',
  'last7Days',
  'last30Days',
  'md-audit',
  'md-hive-sync',
  'md-fetch-summarize',
  'browser-automation',
  'desktop-automation'
] as const;

export type BundledSkillId = (typeof BUNDLED_SKILL_IDS)[number];

export const BUNDLED_SKILL_ID_SET: ReadonlySet<string> = new Set(BUNDLED_SKILL_IDS);

export function isBundledSkillId(id: string): boolean {
  return BUNDLED_SKILL_ID_SET.has(id);
}

/** Return ids that are not in the bundled catalog. */
export function unknownBundledSkillIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !BUNDLED_SKILL_ID_SET.has(id));
}
