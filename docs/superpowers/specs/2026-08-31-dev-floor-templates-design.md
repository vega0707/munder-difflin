# Dev floor templates + global live slots — Design

**Date:** 2026-08-31  
**Status:** Approved for phase 1 implementation  
**Related:** iClaw product-rd team roles; multi-project office

## Goal

Floor templates carry real job titles and descriptions (iClaw-style) while keeping Office cast names. A floor may have many seats; only a **global** configurable number of agents run a live PTY at once. Everyone else stays on the floor and **划水** (idle wander) — no “clock out / restore” framing.

## Non-goals (this change)

- Reworking the existing **Restore team** UI (app-restart respawn). Tracked separately — click currently looks dead; investigate after phase 1.
- Full iClaw Team package install format.
- Message-composer queues (unrelated).

## Phasing

### Phase 1 (ship now)

1. Extend template / create-role with `title` + `description` (cast `character` kept).
2. Builtin dev templates (fullstack, product-rd aligned with iClaw, fe/be split) plus existing Office templates.
3. `config.maxActiveAgents` (default 5), Settings → General control; **sum across all projects**.
4. Create/seed may create **N seats** with sprites; spawn live PTYs only up to the global cap; god always may spawn.
5. When a live PTY exits and a global slot frees, **auto-start** the next seat that has no PTY (roster order), until the cap is full again. No “下班”.

### Phase 2 (required follow-up)

6. Per-seat **skill + MCP isolation**: template/roster fields `skills[]` / `mcp[]`; spawn injects only that seat’s set (god may keep orchestrator-only tools). Floor-wide `mcpDefaults` becomes the fallback when a seat omits an override.

## Semantics: 划水 vs live

| | Live | 划水 |
|---|------|------|
| On floor sprite | yes | yes |
| PTY / engine | yes | no |
| Counts toward `maxActiveAgents` | yes | no |
| Typical animation | work / desk | wander idle |

There is no separate “suspended employee” product state for this feature.

## Data model

```ts
interface CreateProjectRole {
  character: OfficeCharacterName;
  asGod?: boolean;
  title?: string;        // e.g. "产品经理"
  description?: string;  // short duty blurb
  // Phase 2 (accepted in JSON, ignored until wired):
  skills?: string[];
  mcp?: string[];
}
```

Roster / hive `role` + `description` prefer `title` / `description` when present; display name remains cast display name (Jim, …) unless UI chooses to show title as primary label later.

`MAX_ACTIVE_AGENTS` remains the **default** constant (5). Runtime limit = `config.maxActiveAgents ?? MAX_ACTIVE_AGENTS`, clamped to a sane range (1–32).

## Builtin templates (phase 1)

| id | name | god | workers |
|----|------|-----|---------|
| `fullstack-squad` | Full-stack squad | Tech Lead (michael) | FE (jim), BE (dwight), QA (creed) |
| `product-rd` | Product R&D | PM (michael) | Architect (oscar), Eng (jim), Full-stack QA (creed), Ops (stanley) |
| `fe-be-split` | Front / back split | Tech Lead (michael) | Frontend (pam), Backend (dwight), QA (creed), DevOps (ryan) |

Existing Custom / Solo / Accounting / Sales / Corporate / Party Planning stay.

## Spawn / fill algorithm

1. God spawn is exempt from the live cap (existing fix).
2. Non-god spawn fails with `SPAWN_LIMIT_REACHED` when `activePtyCount >= limit` (limit from config).
3. `ensureLiveSlots()` (renderer): while `active < limit`, pick next agent on the active floor with no `ptyId`, not archived, with a resolvable spawn command; spawn; stop on limit or no candidates.
4. Triggers: after god ready, after project create roster load, on PTY exit, when `maxActiveAgents` increases.

## Settings

General: “Max live agents (all floors)” — number input, save to config, apply on next spawn/fill (no mass-kill when lowering; new spawns respect the lower cap; optional later: soft nudge).

## Testing

- Builtin templates: each non-custom has one god; `title`/`description` round-trip through `assertCreateProjectRoles` / `rolesFromTemplate`.
- `product-rd` may have **>5** roles (ok).
- Config clamp + spawn uses configured limit (unit test helper).
- Manual: create Product R&D with limit 3 → god + 2 live, rest 划水; kill one → next starts.

## Restore team (out of scope note)

Existing strip control respawns `restorableAgents` after restart. User reports click no-op — debug after phase 1 (likely empty restorable, silent failure, or godStatus/slot race).
