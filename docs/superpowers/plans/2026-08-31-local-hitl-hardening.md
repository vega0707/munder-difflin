# Local HITL Hardening Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** Single-machine Munder: hard-gate agents waiting on Ask Me, unify the human surface, kanban filter, autonomy visibility, local loopback HTTP scaffold.

**Architecture:** Extend `ControlRegistry` with `awaitingHuman`; sync from hive tasks in main; UI filters and observability; optional `127.0.0.1` HTTP for tasks/health.

**Tech Stack:** Electron main/renderer, existing IPC, better-sqlite3 as needed, node:http.

## Global Constraints

- Local-only; no distributed claim
- Keep Task.assignee model
- Ask Me remains the human decision UI
- Tests: `npm run test:focused` / add `test/*.test.cjs`
- typecheck green

---

### Task 1: ControlRegistry awaitingHuman + unit tests

**Files:** `src/main/control.ts`, `test/control-awaiting-human.test.cjs`

- [x] Add `awaitingHuman` flag + `setAwaitingHuman` / include in `toolDecision` deny reason
- [x] `resume` does not clear awaitingHuman; only `setAwaitingHuman(false)` does
- [x] Tests for deny when awaitingHuman

### Task 2: Sync gates from hive tasks

**Files:** `src/main/hive.ts` or `src/main/humanGate.ts`, wire from task write/load in `index.ts`

- [x] `syncAwaitingHumanFromTasks(tasks, control, agentIds)` 
- [x] Call after tasks read/write and on interval with fleet
- [x] Pause auto-delivery while awaitingHuman

### Task 3: Ask Me + kanban UX

**Files:** `AskMeTab.tsx`, `TasksKanban.tsx`, i18n keys

- [x] Show gated-agent count on Ask Me
- [x] Kanban assignee filter
- [x] Waiting card → open Ask Me tab

### Task 4: Autonomy observability

**Files:** `CommandCenterPanel.tsx` or small `HivePulse.tsx`

- [x] Pulse: open Ask Me count, agents awaitingHuman, optional inbox sizes if cheap

### Task 5: Loopback HTTP scaffold

**Files:** `src/main/localGateway.ts`, config flag, index boot

- [x] `GET /health`, `GET /tasks` on 127.0.0.1 with optional token
- [x] Default off or on with random token logged once

### Task 6: Layout / history persistence (if hooks exist)

**Files:** `db.ts`, store

- [x] Persist layout + command history where store already has shapes
  (command history already in PersistStore; CC tab + sidebar layout via localStorage)

### Task 7: Verify + commit + PR

- [ ] typecheck + focused tests
- [ ] Push branch + PR with Before/After notes
