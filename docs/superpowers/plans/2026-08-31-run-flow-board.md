# Run Flow Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Command Center「流程」tab backed by a durable hive Run projection (step = 1 task), with floor overview for multiple in-flight Runs and retry-from-failed-step via god.

**Architecture:** Main owns Run projection files + hooks on tasks/log/send; preload exposes Run IPC; renderer Flow tab reads projection only; retry resets failed+later tasks then `hiveSend` to god. 任务/动态 tabs unchanged.

**Tech Stack:** Electron main/preload/renderer, existing hive file store, node:test (`.cjs` source contracts).

**OpenSpec:** `openspec/changes/run-flow-board/design.md`  
**PRD:** `docs/dcsspec/local-run-flow-board/prd.md`  
**ChangeId:** `local-run-flow-board`

---

## File map

| File | Responsibility |
| --- | --- |
| `src/shared/runFlow.ts` (new) | Run / Step types, status enums, source tags |
| `src/main/runProjection.ts` (new) | Load/save projection, rebuild from tasks/board/log, retry orchestration helpers |
| `src/main/hive.ts` | Hook writeTasks / appendLog / send → projection update |
| `src/main/index.ts` | IPC handlers for list / get / retry |
| `src/preload/index.ts` | `cth.run*` (or `hiveRun*`) API surface |
| `src/renderer/.../FlowTab.tsx` (new) | Overview / board / step detail / retry CTA |
| `src/renderer/.../CommandCenterPanel.tsx` | Register `flow` tab |
| `test/run-projection.test.cjs` (new) | Projection + retry contracts |
| `test/flow-tab-structure.test.cjs` (new) | Tab registration + no-auto-focus source checks |

---

### Task 1: Shared Run/Step types + failing projection tests

**Files:**
- Create: `src/shared/runFlow.ts`
- Create: `test/run-projection.test.cjs`
- Modify: none yet

- [ ] **Step 1:** Write failing tests for: empty hive → no runs; given tasks with dependsOn → ordered steps 1:1; plan+event hybrid marks `source`; retry helper would reset failed+later only.
- [ ] **Step 2:** Run `node --test test/run-projection.test.cjs` — expect FAIL.
- [ ] **Step 3:** Add minimal types in `src/shared/runFlow.ts` (RunStatus, StepStatus, StepSource, Run, Step).
- [ ] **Step 4:** Commit types-only if tests still fail on missing projection module (or stub exports).

**工程关注点：** 与 `taskLedger` 一样，投影合并不得抹掉未知字段；Step.taskId 必填。

---

### Task 2: Run projection module (Phase A)

**Files:**
- Create: `src/main/runProjection.ts`
- Modify: `src/main/hive.ts` (hooks)
- Test: `test/run-projection.test.cjs`

- [ ] **Step 1:** Implement projection store under hive root (e.g. `runs.json` index + per-run detail, or one file — pick one and document in module header).
- [ ] **Step 2:** `rebuild` / `onTasksChanged` / `onLog` / `onHumanRequest` — coarse auto steps when no plan; plan skeleton when board/tasks imply order.
- [ ] **Step 3:** Wire hooks in hive write paths without changing send/tasks public semantics.
- [ ] **Step 4:** GREEN `node --test test/run-projection.test.cjs`.
- [ ] **Step 5:** Commit.

**工程关注点：** 幂等；冷启动空投影可从 tasks 重建；禁止把 log 当唯一真相。

---

### Task 3: IPC + preload

**Files:**
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Test: extend `test/run-projection.test.cjs` or add IPC contract source test

- [ ] **Step 1:** Failing test that preload source exports list/get/retry.
- [ ] **Step 2:** Implement `ipcMain.handle` + preload methods.
- [ ] **Step 3:** GREEN; commit.

**工程关注点：** Flow 不复用「整文件交给 renderer 自己 merge」；合并在 main。

---

### Task 4: Flow tab UI — single Run (Phase B)

**Files:**
- Create: `src/renderer/src/components/FlowTab.tsx` (and small children if needed)
- Modify: `CommandCenterPanel.tsx`, i18n `en.json` / `zh-CN.json` / `ar.json`
- Create: `test/flow-tab-structure.test.cjs`

- [ ] **Step 1:** Structure test: tab key `flow` in TABS; Activity/Tasks keys still present.
- [ ] **Step 2:** Structure test: Flow click-step styles/handlers must not call select-agent store APIs unconditionally (grep guard).
- [ ] **Step 3:** Implement FlowTab: default in-flight Run → board; expand step → dynamics + output;「去看 Ta」explicit.
- [ ] **Step 4:** GREEN structure tests; manual smoke checklist in commit message.
- [ ] **Step 5:** Commit.

**工程关注点：** 默认不切 `selectedId`；空态说明文案，不嵌派发框。

---

### Task 5: Floor overview + history (Phase C)

**Files:**
- Modify: `FlowTab.tsx`, projection list API if needed
- Test: projection list default-view rules in `test/run-projection.test.cjs`

- [ ] **Step 1:** Tests: 0 in-flight → latest ended; 1 → that Run; ≥2 → overview mode flag.
- [ ] **Step 2:** UI overview strips; history switcher reads durable projection.
- [ ] **Step 3:** GREEN; commit.

---

### Task 6: Retry from failed step (Phase D)

**Files:**
- Modify: `src/main/runProjection.ts`, hive task patch paths, IPC retry
- Modify: `FlowTab.tsx` retry button on failed Run
- Test: `test/run-projection.test.cjs`

- [ ] **Step 1:** Failing test: failed step index N → tasks N..end reset; 0..N-1 untouched; Run in_progress; records intent to hiveSend god (mock/spy pattern used elsewhere).
- [ ] **Step 2:** Implement orchestration; UI never writes worker inbox.
- [ ] **Step 3:** GREEN; commit.

**工程关注点：** 完成步只读；经 god 续跑；失败原因可展示。

---

### Task 7: Regression pass

- [ ] Run `node --test test/run-projection.test.cjs test/flow-tab-structure.test.cjs test/activity-log-scroll.test.cjs`
- [ ] Spot-check 任务 / 动态 tabs still mount.
- [ ] Commit if fixes needed.

---

## 自动化用例

本仓无 AREX/Baiji。权威验收 = 下表；submit-test / verify 按 **node:test** 落地与全量跑。

| 场景 | 动作 | 用例名称 | caseId | 入口标识 | 断言要点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 空 hive 无 Run | 新增 | run projection empty | — | munder-difflin · runProjection | 列表空；默认视图空态语义 | Task 2 |
| 无 plan 粗粒度步骤 | 新增 | run projection auto coarse | — | munder-difflin · runProjection | 有序步骤；一步一 taskId | Q1A |
| 有 plan/dependsOn 骨架 | 新增 | run projection plan skeleton | — | munder-difflin · runProjection | 步骤序对齐 task 链 | |
| 混合补洞标来源 | 新增 | run projection hybrid source | — | munder-difflin · runProjection | source=plan\|auto | Q9A |
| 默认视图 0/1/≥2 进行中 | 新增 | run default view mode | — | munder-difflin · runProjection | ended / single / overview | Q2A Q3B |
| 跨会话读投影 | 新增 | run projection durable reload | — | munder-difflin · runProjection | 写盘再加载仍见 Run | Q8B |
| 失败高亮可回看 | 新增 | run failure preserves steps | — | munder-difflin · runProjection | Run=failed；完成步仍在 | Q7 |
| 从失败步起重试 | 新增 | run retry from failed onward | — | munder-difflin · runProjection+hiveSend | N..end 重置；0..N-1 不变；经 god | 重试=B |
| 流程 Tab 注册 | 新增 | flow tab registered | — | munder-difflin · CommandCenterPanel | TABS 含 flow；tasks/activity 仍在 | |
| 点步骤不自动选 agent | 新增 | flow no autofocus on step | — | munder-difflin · FlowTab | 步骤 onClick 路径无 setSelectedId | Q6A |
| 步骤详情动态+输出 | 新增 | flow step detail summary output | — | munder-difflin · FlowTab | 展开区渲染 summary + output 区块 | Q5A |
| ≥2 进行中总览 UI | 新增 | flow overview renders multi in flight | — | munder-difflin · FlowTab | ≥2 时 overview 结构存在 | Q3B |
| 空态说明 | 新增 | flow empty state copy | — | munder-difflin · FlowTab | 无 Run 时说明文案 i18n key | Q11A |
| 重试幂等 latch | 新增 | run retry idempotent latch | — | munder-difflin · runProjection | 连点第二次 rejected；单次 hiveSend | 挑刺 |
| 投影 rebuild | 新增 | run projection rebuild from tasks | — | munder-difflin · runProjection | 漂移后 step 与 task 对齐 | 挑刺 |
| 活动日志横向滚动 | 复用 | activity log rows scroll horizontally | — | munder-difflin · ActivityTab | 既有 test 仍绿 | 回归 |

**手工冒烟（不进自动化表）：** 任务 / 动态 Tab 打开与基本读写与改前一致。

---

## Self-review

- Spec coverage: PRD Q1–Q12 + retry=B mapped to tasks/tests.  
- No placeholders TBD in critical paths.  
- Types first, hooks, IPC, UI, overview, retry — ordered for TDD.
