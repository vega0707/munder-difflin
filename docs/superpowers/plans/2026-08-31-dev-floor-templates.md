# Dev floor templates + live slots — Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkbox syntax for tracking.

**Goal:** iClaw-style role titles on floor templates, N seats with sprites, global configurable live-PTY cap, auto-fill when a slot frees (划水 semantics).

**Architecture:** Extend `CreateProjectRole` + builtins; `config.maxActiveAgents`; seed titles into hive/roster; renderer `ensureLiveSlots` fills PTYs up to the global cap.

**Tech Stack:** TypeScript, Electron, existing project template / hive / spawn paths, node:test.

## Global Constraints

- Live cap is **global** (all projects), default 5, Settings-editable.
- No “下班”; seats without PTY stay on floor and idle-wander.
- God spawn remains exempt from the live cap.
- Phase 2 skill/MCP fields may be stored but not injected yet.
- Do not change Restore team behavior in this plan (debug later).

---

### Task 1: Role title/description on create types + seed

**Files:** `src/shared/projectTypes.ts`, `src/main/seedProjectCast.ts`, `src/main/projectRegistry.ts`, `test/project-create-god.test.cjs`

- [ ] Extend `CreateProjectRole` with optional `title`, `description`, `skills?`, `mcp?`
- [ ] `assertCreateProjectRoles` preserves metadata; return `roles: CreateProjectRole[]` (or parallel arrays) so seed can use titles
- [ ] `seedProjectCast` writes title→hive role / roster description
- [ ] Tests green

### Task 2: Builtin dev templates + tests

**Files:** `src/shared/projectTemplates.ts`, `test/project-templates.test.cjs`

- [ ] Add `fullstack-squad`, `product-rd`, `fe-be-split`
- [ ] Drop/relax “corporate stays at 5” as a hard product rule; allow templates with >5 roles
- [ ] Tests for titles present and one god each

### Task 3: Configurable global live cap

**Files:** `src/main/config.ts`, `src/shared/projectTypes.ts`, `src/main/index.ts`, `src/main/projectRegistry.ts`, Settings UI + i18n, tests

- [ ] `maxActiveAgents` on config; helper `resolveMaxActiveAgents(config)`
- [ ] Replace hardcoded limit checks with helper
- [ ] Settings General control
- [ ] i18n en / zh-CN / ar

### Task 4: Auto-fill live slots (划水 → live)

**Files:** new or `src/renderer/src/hooks/useLiveSlots.ts`, wire in `App.tsx` / hive boot

- [ ] `ensureLiveSlots`: spawn agents lacking `ptyId` until global cap
- [ ] Trigger on god ready, roster load, pty exit, config change
- [ ] SPAWN_LIMIT stops fill without treating as floor failure

### Task 5: Create dialog shows titles

**Files:** `ProjectCreateDialog.tsx`, i18n if needed

- [ ] When role has `title`, show it on the cast chip / list
