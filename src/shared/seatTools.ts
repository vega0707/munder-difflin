/**
 * Per-seat skill / MCP allowlists.
 *
 * - `undefined` / omit → inherit floor defaults (all bundled skills; floor mcpDefaults)
 * - `[]` → none
 * - `['fetch','time']` → only those catalog / skill-folder ids
 */

export type SeatAllowlist = string[] | undefined;

/** Normalize raw JSON into a clean allowlist, or undefined if absent. */
export function parseSeatAllowlist(raw: unknown): SeatAllowlist {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);
  // Dedup, stable order
  return Array.from(new Set(out));
}

/** Floor MCP consent map → effective enable map for one seat. */
export function seatMcpEnabledMap(
  floorDefaults: { [id: string]: { enabled: boolean } } | undefined,
  catalogIds: ReadonlyArray<string>,
  defaultEnabled: (id: string) => boolean,
  seatMcp: SeatAllowlist
): { [id: string]: { enabled: boolean } } {
  const out: { [id: string]: { enabled: boolean } } = {};
  for (const id of catalogIds) {
    const floorOn = floorDefaults?.[id]?.enabled ?? defaultEnabled(id);
    if (seatMcp === undefined) {
      out[id] = { enabled: !!floorOn };
      continue;
    }
    // Seat override: only allowlisted ids may be on, and only if the floor also
    // consents (or would default-enable for safe-readonly).
    out[id] = { enabled: seatMcp.includes(id) && !!floorOn };
  }
  return out;
}

/** Whether a bundled skill folder name should be copied for this seat. */
export function seatSkillAllowed(skillName: string, seatSkills: SeatAllowlist): boolean {
  if (seatSkills === undefined) return true;
  return seatSkills.includes(skillName);
}
