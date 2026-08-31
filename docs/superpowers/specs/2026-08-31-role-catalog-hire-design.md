# Shared role catalog + one-click hire — Design

**Date:** 2026-08-31  
**Status:** Approved (ship P1+P2 together)  
**Related:** `2026-08-31-dev-floor-templates-design.md`, AddAgentModal, hire manifests, realtime spawn

## Goal

「添加智能体」可从与楼层模板**同一套**角色库点选（产品经理、架构师等）并一键生成；可自定义；也可通过 UI 对话或 god/语音让 AI 创建新角色——创建后写入角色库并立刻 spawn。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| After pick existing role | One-click spawn (cwd + default engine); no form |
| Role list source | Dedicated catalog, shared with floor templates |
| Seed data | Current floor template titles/descriptions |
| Manual add | Keep via「自定义…」→ existing AddAgentModal |
| AI create channels | UI「让 AI 创建…」**and** god/voice |
| After AI create | Save to catalog **and** immediately spawn |
| Builtin floor JSON | Do **not** auto-mutate; new roles live in catalog for hire + user templates |
| External hire import | Still never auto-spawn (unchanged security model) |

## Non-goals

- Visual CRUD editor for the full catalog in Settings
- Changing hire-manifest auto-spawn ban
- Reworking AddAgentModal beyond「自定义」entry
- Add-agent creating a second god (`asGod` never from this entry)

## Data model

```ts
interface RoleDefinition {
  id: string;                 // builtin: "pm" | user/ai: "user-<uuid>"
  title: string;
  description: string;
  character: OfficeCharacterName;
  skills?: string[];
  mcp?: string[];
  builtin: boolean;
  source?: 'builtin' | 'user' | 'ai-ui' | 'ai-god';
}
```

Floor templates reference roles:

```ts
interface ProjectTemplateRoleRef {
  roleId: string;
  asGod?: boolean;
}
```

Resolve: `roleId` → `CreateProjectRole` (+ `asGod`).

**Storage**
- Builtin: `BUILTIN_ROLES` in code (seeded from product-rd / fullstack / fe-be / office templates).
- User/AI: `harnessHome/role-catalog/<id>.json`.
- `listRoles()` = builtin ∪ user.

**Compat:** Legacy user floor templates with inline `CreateProjectRole[]` still load; new templates prefer `roleId` refs.

Existing AddAgent briefing chips (repo janitor, etc.) merge into the catalog so there is one picker vocabulary.

## UI

1. 「添加智能体」→ **Role picker** panel:
   - All catalog roles (title + one-line description)
   - 「让 AI 创建…」
   - 「自定义…」→ AddAgentModal
2. Click role → spawn immediately (table below).
3. AI create: short prompt → propose → preview → confirm → save + spawn.
4. If default CLI unavailable for propose: fall back to manual title/description/character form (+ optional copy-prompt helper).

### One-click spawn fields

| Field | Source |
|-------|--------|
| title, description, character, skills, mcp | RoleDefinition |
| Display name | Cast display name; title as secondary label |
| cwd | Active project `defaultCwd`, else `registeredRepos[0]` |
| provider / model / command | Global defaults via `buildSpawnCommand` |
| projectId | `activeProjectId` |
| asGod | Never |

Live cap / 划水: same as floor create/seed (`SPAWN_LIMIT_REACHED` → seat without PTY; `ensureLiveSlots` may fill later).

## AI create

**Shared outcome:** validate → write catalog → one-click spawn.  
Save failure → no spawn. Spawn failure → role remains in catalog.

**UI:** `role:proposeFromBrief` (headless default CLI structured JSON when possible) → preview → `role:save` + spawn. In-app trusted path (not hire-import rules).

**God / Michael realtime:** extend hire/spawn to accept new-role fields; still requires verbal confirm; on confirm upsert catalog (`source: ai-god`) + spawn. Matching existing roleId/title → spawn only. God CLI tool: same `define_role_and_hire` semantics.

## Errors

- No active project / no cwd → surface error; no save/spawn.
- Propose timeout/fail → error + manual form fallback.
- Invalid role → reject save.
- Live cap → role saved; explain seat may go live later.
- God cancel before confirm → neither save nor spawn.

## Testing

- Every builtin floor `roleId` resolves.
- `saveRole` / `listRoles` round-trip; builtins not deletable.
- `spawnFromRole` uses default command + active cwd.
- UI/god create: save-then-spawn order; hire import still no auto-spawn.

## Architecture sketch

```
roleCatalog.ts (shared)     roleCatalogStore.ts (main)
        │                            │
        ├─ projectTemplates resolve ─┤
        ├─ RolePickerPanel (renderer)
        ├─ role:propose / save IPC
        └─ god / realtime spawn path
```
