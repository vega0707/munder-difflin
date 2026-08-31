# Role catalog + one-click hire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Shared role catalog used by floor templates and「添加智能体」; one-click spawn; AI create (UI + god) saves to catalog and spawns.

**Architecture:** `RoleDefinition` in shared module + disk store under harnessHome; templates reference `roleId`; new RolePickerPanel; IPC propose/save/spawn-from-role; extend realtime/god hire.

**Tech Stack:** TypeScript, Electron IPC, existing spawn/`buildSpawnCommand`/`ensureLiveSlots`, node:test (.cjs).

## Global Constraints

- Add-agent never sets `asGod`.
- External hire import never auto-spawns.
- One catalog for floor templates + hire picker.
- AI create: save then spawn; spawn fail keeps catalog entry.
- Live cap / 划水 unchanged.

---

### Task 1: Shared RoleDefinition + builtins + resolve

**Files:**
- Create: `src/shared/roleCatalog.ts`
- Modify: `src/shared/projectTemplates.ts` (roleId refs or dual-read)
- Test: `test/role-catalog.test.cjs`

- [ ] Define `RoleDefinition`, `BUILTIN_ROLES` (PM, architect, eng, QA, ops, FE/BE, briefing chips, office titles)
- [ ] `roleById`, `listBuiltinRoles`, `resolveRoleToCreateProjectRole(roleId, asGod?)`
- [ ] Refactor builtin floor templates to `roles: [{ roleId, asGod? }]` with resolve helper for create/seed
- [ ] Tests: every template roleId resolves; titles match expectations
- [ ] Commit

### Task 2: Disk store + IPC list/save/delete

**Files:**
- Create: `src/main/roleCatalogStore.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, channels in shared
- Test: `test/role-catalog-store.test.cjs`

- [ ] `harnessHome/role-catalog/*.json`; list = builtin ∪ user
- [ ] save (user-/ai- sources), delete (non-builtin only)
- [ ] IPC + preload
- [ ] Tests green
- [ ] Commit

### Task 3: spawnFromRole helper (renderer)

**Files:**
- Create or extend hook/util near AddAgentModal / `useLiveSlots`
- Modify: store if needed
- Test: unit where feasible, or thin integration

- [ ] Given RoleDefinition + config + activeProject → spawn + addAgent card (same fields as §3)
- [ ] Wire live-slot errors without wiping catalog
- [ ] Commit

### Task 4: RolePickerPanel UI

**Files:**
- Create: `src/renderer/src/components/RolePickerPanel.tsx`
- Modify: `AgentStrip.tsx`, `FullscreenTerminal.tsx` (open picker not modal), i18n
- Keep: AddAgentModal behind「自定义…」

- [ ] List roles; click → spawnFromRole
- [ ] 「让 AI 创建…」「自定义…」
- [ ] i18n en / zh-CN / ar
- [ ] Commit

### Task 5: UI AI propose + save + spawn

**Files:**
- `src/main/rolePropose.ts` (or in store), IPC `role:proposeFromBrief`
- RolePickerPanel AI subview
- Reuse headless CLI pattern (`claude -p` / reflect-style) when available

- [ ] Propose returns draft RoleDefinition
- [ ] Confirm → save (`ai-ui`) → spawn
- [ ] Fallback form if CLI missing
- [ ] Commit

### Task 6: God / realtime define_role_and_hire

**Files:**
- `src/main/realtimeActions.ts`, `src/renderer/src/realtime/actions.ts`
- God hive tools / prompts if present
- Tests for confirm → save + spawn

- [ ] Extend spawn path with title/description/character/persistCatalog
- [ ] Confirm required; cancel saves nothing
- [ ] Existing title match → spawn only
- [ ] Commit

### Task 7: Verification

- [ ] Run role-catalog + project-templates + related tests
- [ ] Manual smoke: picker hire PM; custom still opens; AI create saves; god path if testable
