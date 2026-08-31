# 多项目多 Hive 架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单例 HiveManager 改成「一项目一 Hive」，主窗口用标签页切换楼层，非活跃项目的 PTY 用 SIGSTOP/SIGCONT 停住，全局同时跑着的 agent 不超过 5 个。

**Architecture:** 新增 `ProjectRegistry` 作为唯一路由层，持有 `Map<projectId, HiveManager>`。PtyManager / ControlRegistry / CircuitBreaker / PersistStore 仍是进程级单例，按 `projectId` 或全局唯一 `agentId` 分区。HiveManager 构造函数继续吃 getter，语义从「harnessHome」改成「projectRoot」（下面仍是 `hive/`）。旧目录先复制再改名备份，不立刻删。

**Tech Stack:** Electron main/renderer、better-sqlite3、node-pty、Zustand、`node --test` + `test/load-ts.cjs`。

**关联设计：** `openspec/changes/multi-project-office/design.md`  
**关联需求：** `docs/dcsspec/multi-project-office/proposal.md`  
**薄任务清单：** `openspec/changes/multi-project-office/tasks.md`（T1 ↔ Task 1）  
**自动化用例：** 见本文 §自动化用例（权威；design / tasks 只引用）

## Global Constraints

- Phase 1 只做多项目数据模型 + 标签页切换。不做 agent 模板、boss 晋升、跨项目通信、程序化地图、多窗口改造。
- 1 项目 = 1 楼层；标签页切换 = 换活跃项目，不叠楼层。
- 项目边界 = `<harnessHome>/projects/<projectId>/hive/` + 每项目自己的 defaultCwd；agent cwd 仍可指向任意仓库。
- `MAX_ACTIVE_AGENTS = 5`。只统计未暂停的 PTY。Windows 不发信号，该平台上所有 PTY 都算活跃。
- agentId **全局唯一**（方案 a）。Hook 用 payload `agent_id` 反查项目，不另造 token 表，不用 `projectId+agentId` 复合键。
- HiveManager 对外方法签名不变。构造函数保持 `getProjectRoot: () => string | null`，现有 `new HiveManager(() => tmpHome)` 测试继续能跑。
- 旧 hive 迁移：先复制到 `projects/default/`，再把旧目录改名为 `hive.pre-migrate` / `roster.pre-migrate.json`。失败则不动旧目录。
- 切换项目：允许从已有 5 个活跃 agent 的项目切走（旧项目会 SIGSTOP）。仅当**目标项目恢复后**活跃数会超过 5 时拒绝，错误码 `RESUME_LIMIT_REACHED`。
- 最后一个项目不能删。
- `config.multiProjectEnabled` 缺省 true。false 时只加载 Default（或列表第一项），不画标签栏。
- 现有 `HivePicker` 仍只选 `harnessHome`（projects 的父目录），不要和项目标签混成一个控件。
- 现有多窗口 floor 本阶段不改交互；额外窗口打开时快照当时的 `activeProjectId`，IPC 带这个 id。
- IPC 改造分两段：Task 6 起允许缺省回退 `activeProjectId`；Task 11 去掉回退。hive / pty / control 按批改，每批跑 `npm run test:focused`。
- 测试命令：`node --test test/<file>.test.cjs`；全量：`npm run test:focused`。新测试一律放 `test/*.test.cjs`，用 `load-ts.cjs` 加载 TS。
- 工程类场景（重复 create、并发 activate、SIGCONT 时进程已死）走 `TODO[REENTRANCY]` / `TODO[CONCURRENCY]` / `TODO[FAILURE_HANDLING]`，不进验收表。
- 不引入 AREX。本仓是本地 Electron，验收入口是 `node:test` 单测 / 集成测试。

---

## 文件结构

| 路径 | 职责 |
|---|---|
| Create: `src/shared/projectTypes.ts` | `ProjectMeta`、状态、IPC 名、错误码、`MAX_ACTIVE_AGENTS` |
| Modify: `src/main/db.ts` | `projects` 表 + `command_history.project_id` + CRUD |
| Modify: `src/main/hive.ts` | getter 语义改为 projectRoot；`emit` payload 带 `projectId` |
| Modify: `src/main/pty.ts` | `PtySession.projectId` / `suspended`；`suspendProject` / `resumeProject` / `getActivePtyCount` |
| Create: `src/main/projectRegistry.ts` | 项目生命周期 + HiveManager map + 切换编排 |
| Create: `src/main/legacyHiveMigrate.ts` | 旧单 hive → Default |
| Create: `src/main/hiveRouter.ts` | `routeHive(projectId, fn)` |
| Modify: `src/main/hooks.ts` | 按 `agent_id` 找 HiveManager |
| Modify: `src/main/roster.ts` | 路径改为 projectRoot |
| Modify: `src/main/memory.ts` / `src/main/reflect.ts` / `src/main/telemetry.ts` | 按项目解析 cwd / session / palace |
| Modify: `src/main/index.ts` | 启动时 registry；project IPC；hive/pty/control 走路由 |
| Modify: `src/main/config.ts` | `multiProjectEnabled?: boolean` |
| Modify: `src/preload/index.ts` + `src/preload/index.d.ts` | `project*` API；hive/pty 增加 `projectId` |
| Modify: `src/renderer/src/store/store.ts` | `projects` / `activeProjectId`；切换时替换当前 `agents` |
| Create: `src/renderer/src/components/ProjectTabBar.tsx` | 标签栏 |
| Create: `src/renderer/src/components/ProjectCreateDialog.tsx` | 新建 |
| Create: `src/renderer/src/components/ProjectDeleteDialog.tsx` | 删除确认 |
| Modify: `src/renderer/src/hooks/useHive.ts` | IPC 带 `activeProjectId` |
| Modify: `src/renderer/src/scene/office/OfficeFloor.tsx` | `activeProjectId` 变化时重建场景 |
| Modify: `src/renderer/src/App.tsx` | 挂标签栏 |
| Test: `test/project-types.test.cjs` 等（见各 Task） | |

---

### Task 1: Shared 类型 + PersistStore projects 表

**范围：** 共享类型与 SQLite schema，不启动 HiveManager。  
**关注点：** 写操作 → `TODO[REENTRANCY]`（migration 已按 user_version 事务包裹，保持幂等）；失败分支 → `TODO[FAILURE_HANDLING]`（DB 打不开不崩启动，沿用现有 PersistStore 约定）。

**Files:**
- Create: `src/shared/projectTypes.ts`
- Modify: `src/main/db.ts`（在 `MIGRATIONS` 数组末尾追加，禁止改已有 migration）
- Test: `test/project-persist.test.cjs`

**Interfaces:**
- Consumes: 现有 `PersistStore.open()` / `MIGRATIONS` 追加模式
- Produces:

```ts
export type ProjectStatus = 'active' | 'degraded' | 'pending-deletion';

export interface ProjectMeta {
  projectId: string;
  name: string;
  createdAt: number;
  status: ProjectStatus;
  defaultCwd?: string;
  hiveRootPath: string;
}

export const MAX_ACTIVE_AGENTS = 5;

export const PROJECT_CHANNELS = {
  LIST: 'project:list',
  CREATE: 'project:create',
  DELETE: 'project:delete',
  ACTIVATE: 'project:activate',
  GET_ACTIVE: 'project:getActive',
  CHANGED: 'project:changed',
  ACTIVE_CHANGED: 'project:active-changed'
} as const;

export type ProjectErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_DEGRADED'
  | 'SPAWN_LIMIT_REACHED'
  | 'RESUME_LIMIT_REACHED'
  | 'LAST_PROJECT'
  | 'CREATE_FAILED';

export interface ProjectRow {
  projectId: string;
  name: string;
  createdAt: number;
  status: ProjectStatus;
  defaultCwd: string | null;
  hiveRootPath: string;
}

// PersistStore 新增：
insertProject(row: ProjectRow): void
getProject(projectId: string): ProjectRow | undefined
listProjects(): ProjectRow[]
updateProject(projectId: string, patch: Partial<Omit<ProjectRow, 'projectId'>>): void
```

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { MAX_ACTIVE_AGENTS, PROJECT_CHANNELS } = loadTs('src/shared/projectTypes.ts');
const { PersistStore } = loadTs('src/main/db.ts');

test('MAX_ACTIVE_AGENTS is 5', () => {
  assert.equal(MAX_ACTIVE_AGENTS, 5);
});

test('project channel names stay project:*', () => {
  assert.equal(PROJECT_CHANNELS.LIST, 'project:list');
  assert.equal(PROJECT_CHANNELS.CREATE, 'project:create');
});

test('projects table round-trips and migration is idempotent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-persist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'harness.db');

  const store = new PersistStore(dbPath);
  store.open();
  store.insertProject({
    projectId: 'default',
    name: 'Default',
    createdAt: 1,
    status: 'active',
    defaultCwd: null,
    hiveRootPath: '/tmp/projects/default/hive'
  });
  const row = store.getProject('default');
  assert.equal(row.name, 'Default');
  assert.equal(row.status, 'active');

  store.close();
  const again = new PersistStore(dbPath);
  again.open();
  assert.equal(again.listProjects().length, 1);
  again.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/project-persist.test.cjs`  
Expected: FAIL — `Cannot find module` / `insertProject is not a function`

- [ ] **Step 3: Write minimal implementation**

`src/shared/projectTypes.ts`：按上面 Interfaces 原样导出。

`src/main/db.ts` 追加 migration（不要改 index 0）：

```ts
(db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'degraded', 'pending-deletion')),
      default_cwd TEXT,
      hive_root_path TEXT NOT NULL
    );
    ALTER TABLE command_history ADD COLUMN project_id TEXT;
  `);
}
```

`insertProject` / `getProject` / `listProjects` / `updateProject` 用 prepared statement，列名 snake_case ↔ camelCase 与现有 `CommandHistoryRow` 一样。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/project-persist.test.cjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/projectTypes.ts src/main/db.ts test/project-persist.test.cjs
git commit -m "feat: persist projects table and shared project types"
```

---

### Task 2: HiveManager 以 projectRoot 为根

**范围：** 不改对外方法；getter 语义改为「含 `hive/` 的项目根」。`emit` 在已有 payload 对象上补 `projectId`（若调用方传入）。  
**关注点：** 失败分支 → 某项目目录坏了由 Registry 标 degraded，本 Task 只保证 `root()` 仍是 `join(projectRoot, 'hive')`。

**Files:**
- Modify: `src/main/hive.ts`（`constructor` 注释、可选第三参 `projectId`、emit 包装）
- Test: `test/hive-cwd.test.cjs`（应继续绿）；新增 `test/hive-project-root.test.cjs`

**Interfaces:**
- Consumes: Task 1 的类型（可选）
- Produces:

```ts
constructor(
  private getProjectRoot: () => string | null,
  private emit?: (channel: string, payload: unknown) => boolean | void,
  readonly projectId: string = 'default'
)
root(): string | null  // join(getProjectRoot(), 'hive') — 行为与今天相同
```

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { HiveManager } = loadTs('src/main/hive.ts');

test('two HiveManagers keep separate registry files', async (t) => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pa-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pb-'));
  t.after(() => { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); });
  const hiveA = new HiveManager(() => a, undefined, 'proj-a');
  const hiveB = new HiveManager(() => b, undefined, 'proj-b');
  await hiveA.ensureAgent({ id: 'aa', name: 'A', provider: 'claude', cwd: a });
  await hiveB.ensureAgent({ id: 'bb', name: 'B', provider: 'claude', cwd: b });
  assert.ok(fs.existsSync(path.join(a, 'hive', 'registry.json')));
  assert.ok(fs.existsSync(path.join(b, 'hive', 'registry.json')));
  assert.equal(hiveA.registry().agents.bb, undefined);
  assert.equal(hiveB.registry().agents.aa, undefined);
  assert.equal(hiveA.projectId, 'proj-a');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hive-project-root.test.cjs`  
Expected: FAIL — `projectId` undefined（若第三参尚未接上）

- [ ] **Step 3: Write minimal implementation**

在 `HiveManager` 上增加只读 `projectId`，默认 `'default'`。`root()` 一行都不用改。包装 `emit`：若 payload 是普通对象且没有 `projectId`，补上 `this.projectId`。

- [ ] **Step 4: Run tests**

Run: `node --test test/hive-project-root.test.cjs test/hive-cwd.test.cjs test/hive-runtime-path.test.cjs test/hive-task-mutation.test.cjs`  
Expected: PASS（现有测试仍 `new HiveManager(() => home)`）

- [ ] **Step 5: Commit**

```bash
git add src/main/hive.ts test/hive-project-root.test.cjs
git commit -m "feat: bind HiveManager to a projectRoot and projectId"
```

---

### Task 3: PtyManager 按项目暂停 / 恢复 / 计数

**范围：** session 记 `projectId` + `suspended`；POSIX 发信号；Windows 只打标。  
**关注点：** 状态变更 → `TODO[CONCURRENCY]`（suspend 中途 exit）；失败分支 → `TODO[FAILURE_HANDLING]`（进程已死则当已退出，走现有 `exitHandler`）；外部调用 → `TODO[TIMEOUT]`（信号本身无超时，kill 树仍走 `ensureKilled`）。

**Files:**
- Modify: `src/main/pty.ts`（`PtySession`、`SpawnOptions`、`spawn` / 三个新方法）
- Test: `test/pty-project-suspend.test.cjs`

**Interfaces:**
- Consumes: `MAX_ACTIVE_AGENTS`（本 Task 只计数，不拒 spawn）
- Produces:

```ts
interface PtySession {
  // 现有字段保留
  projectId: string;
  suspended: boolean;
}
interface SpawnOptions {
  // 现有字段保留
  projectId?: string;
}
class PtyManager {
  spawn(opts: SpawnOptions, owner?: WebContents | null): { ok: boolean; error?: string }
  suspendProject(projectId: string): { ok: true; pids: number[] }
  resumeProject(projectId: string): { ok: true; pids: number[]; deadIds: string[] }
  getActivePtyCount(): number  // sessions where !suspended
  listByProject(projectId: string): Array<{ id: string; suspended: boolean; pid: number }>
}
```

`spawn` 缺 `projectId` 时记 `'default'`（Task 11 再收紧）。  
`suspendProject`：`os.platform() === 'win32'` 则只 `suspended = true`，不 `process.kill`。否则对每个 session `process.kill(pid, 'SIGSTOP')`。  
`resumeProject`：Windows 只清标；POSIX `SIGCONT`。`ESRCH` 收入 `deadIds`，并从 map 删掉，触发现有 `exitHandler`。  
`getActivePtyCount`：Windows 上 `suspended` 仍算活跃（降级：标记不代表真停）。实现：`platform==='win32' ? sessions.size : count(!suspended)`。

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { PtyManager } = loadTs('src/main/pty.ts');

test('getActivePtyCount ignores POSIX-suspended sessions', () => {
  const mgr = new PtyManager();
  // 不真 spawn：测纯计数辅助。若实现只在 spawn 后入 map，
  // 本测试改为对内部 sessions 的等价公开 API listByProject。
  assert.equal(typeof mgr.suspendProject, 'function');
  assert.equal(typeof mgr.resumeProject, 'function');
  assert.equal(mgr.getActivePtyCount(), 0);
});
```

补一条用假 session 的测试：在 `pty.ts` 导出 `__testInsertSession` 仅当 `process.env.MD_TEST_PTY === '1'`，或把计数函数抽成：

```ts
export function countActivePtys(
  sessions: Iterable<{ suspended: boolean }>,
  platform: string
): number {
  let n = 0;
  for (const s of sessions) {
    if (platform === 'win32' || !s.suspended) n++;
  }
  return n;
}
```

测这个纯函数，不碰真 PTY。

```js
const { countActivePtys } = loadTs('src/main/pty.ts');
test('posix suspended sessions drop out of the active count', () => {
  assert.equal(countActivePtys([{ suspended: true }, { suspended: false }], 'darwin'), 1);
  assert.equal(countActivePtys([{ suspended: true }, { suspended: false }], 'win32'), 2);
});
```

再测 `suspendProject` 在 win32 不调用 kill：给 `PtyManager` 注入 `killFn` 可选依赖，生产默认 `process.kill`。测试传入记录数组的 fake。

```ts
constructor(private killProcess: (pid: number, sig?: string) => void = (pid, sig) => process.kill(pid, sig)) {}
```

现有 `new PtyManager()` 零改动。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pty-project-suspend.test.cjs`  
Expected: FAIL — `suspendProject` / `countActivePtys` 不存在

- [ ] **Step 3: Write minimal implementation**

按 Interfaces 实现。`spawn` 写入 `projectId: opts.projectId ?? 'default'`、`suspended: false`。`onExit` 里删 session（活跃数自然下降）。

```ts
// TODO[FAILURE_HANDLING] 信号: ESRCH/已退出视为正常，走 exitHandler，不抛到 IPC
// TODO[CONCURRENCY] 暂停: suspend 循环中 session 退出则跳过该 pid
```

- [ ] **Step 4: Run tests**

Run: `node --test test/pty-project-suspend.test.cjs test/pty-env.test.cjs test/proc-kill.test.cjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/pty.ts test/pty-project-suspend.test.cjs
git commit -m "feat: suspend and resume PTYs by project"
```

---

### Task 4: ProjectRegistry + 旧版迁移

**范围：** 项目 CRUD、目录、Hive 实例、迁移。本 Task **不**挂 IPC。activate 调用 Task 3 的 suspend/resume。  
**关注点：** 写操作 → `TODO[REENTRANCY]`（同名 create / 重复 migrate）；状态机 → `TODO[CONCURRENCY]`（active / degraded / pending-deletion）；失败分支 → 建目录失败回滚、迁移失败保留旧树。

**Files:**
- Create: `src/main/projectRegistry.ts`
- Create: `src/main/legacyHiveMigrate.ts`
- Test: `test/project-registry.test.cjs`, `test/legacy-hive-migrate.test.cjs`

**Interfaces:**
- Consumes: Task 1 PersistStore、Task 2 HiveManager、Task 3 PtyManager
- Produces:

```ts
export function projectRootOf(harnessHome: string, projectId: string): string {
  return join(harnessHome, 'projects', projectId);
}

export interface MigrateResult {
  migrated: boolean;
  projectId?: 'default';
  error?: string;
}

export function migrateLegacyHive(opts: {
  harnessHome: string;
  persist: PersistStore;
}): MigrateResult

export class ProjectRegistry {
  constructor(opts: {
    persist: PersistStore;
    pty: PtyManager;
    getHarnessHome: () => string | null;
    emit?: (channel: string, payload: unknown) => boolean | void;
  })
  bootstrap(): { ok: boolean; error?: string }  // migrate + load rows + new HiveManager each
  createProject(name: string, defaultCwd?: string): { ok: true; project: ProjectMeta } | { ok: false; code: 'CREATE_FAILED'; error: string }
  deleteProject(projectId: string): { ok: true } | { ok: false; code: 'PROJECT_NOT_FOUND' | 'LAST_PROJECT'; error: string }
  activateProject(projectId: string): { ok: true; previousId: string | null } | { ok: false; code: 'PROJECT_NOT_FOUND' | 'PROJECT_DEGRADED' | 'RESUME_LIMIT_REACHED'; error: string }
  getProject(projectId: string): HiveManager | undefined
  getMeta(projectId: string): ProjectMeta | undefined
  listProjects(): ProjectMeta[]
  getActiveProjectId(): string | null
  hiveForAgent(agentId: string): HiveManager | undefined  // 扫各 registry；O(项目数)
}
```

`createProject`：`projectId = randomUUID()`；`mkdirSync(projectRoot)`；`new HiveManager(() => projectRoot, emit, projectId)`；`persist.insertProject`。任一步失败：删已建目录、不写库。  
`TODO[REENTRANCY] 幂等: migrateLegacyHive 见 projects 已有 default 或 projects/default/hive/registry.json 则 migrated:false 且不复制。`  
`TODO[FAILURE_HANDLING] 迁移: 复制失败不改名旧 hive；SQLite 失败把已复制目录标 orphan（不删旧树）。`

迁移步骤：

1. 若 `listProjects()` 非空 → `{ migrated: false }`
2. 若 `harnessHome/hive/registry.json` 不存在 → 不迁，让 `bootstrap` 建空 Default
3. `cpSync(hive → projects/default/hive)`、`cpSync(roster.json → projects/default/roster.json)`（文件存在才拷）
4. `insertProject({ projectId: 'default', name: 'Default', ... })`
5. `renameSync(hive, hive.pre-migrate)`、`renameSync(roster.json, roster.pre-migrate.json)`

`bootstrap`：无 home 则 no-op。先 migrate，再对每条 `status!=='pending-deletion'` 的行 `new HiveManager`。某行目录没有 `hive/` 则该行 `status='degraded'`，其余项目照常。若表空且无旧 hive，创建 Default。`activeProjectId` 取第一个 `status==='active'`。

`deleteProject`：只剩一个则 `LAST_PROJECT`。先 `pty` 里该项目各 session `kill`（现有 API），再从 map 删 HiveManager，`status='pending-deletion'`，异步 `rm` 目录，成功后再删 SQLite 行。

`activateProject`：目标 degraded → 拒绝。先算 `resume` 后活跃数：`getActivePtyCount() - oldActive + newWouldBe`。Windows 上 `newWouldBe` = 目标项目 session 数且旧的不会真正停，用 `sessions.size` 规则（见 Task 3）。超 5 → `RESUME_LIMIT_REACHED`。否则 `pty.resumeProject(new)` → `pty.suspendProject(old)` → 改 `activeProjectId`。suspend/resume 只发信号或打标，不阻塞等子进程。


- [ ] **Step 1: Write the failing tests**（`test/legacy-hive-migrate.test.cjs` 搭临时 harnessHome，写假 `hive/registry.json`，断言复制后旧目录变成 `hive.pre-migrate`，第二次调用 `migrated===false`。）

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test test/project-registry.test.cjs test/legacy-hive-migrate.test.cjs`

- [ ] **Step 3: Implement the two modules as specified**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/main/projectRegistry.ts src/main/legacyHiveMigrate.ts test/project-registry.test.cjs test/legacy-hive-migrate.test.cjs
git commit -m "feat: add ProjectRegistry and legacy hive migration"
```

---

### Task 5: 项目生命周期 IPC + preload

**范围：** `project:*` handler 与 preload。启动时 `registry.bootstrap()` 替换 `const hive = new HiveManager(...)`。临时保留 `function hive()` = 活跃实例，供尚未改的 handler 用。  
**关注点：** 新业务路径 → `TODO[FEATURE_FLAG]`（`multiProjectEnabled===false` 时 `create` 仍可用但 UI 后置；main 不拒）；`TODO[METRIC]`（create/delete/activate/migrate 打现有 analytics 或 `console` + 若已有 telemetry event 则加 `project_created` 等，无则先 log）。

**Files:**
- Modify: `src/main/index.ts`（构造 registry；注册 5 个 handle；`whenReady` 里 `bootstrap`）
- Modify: `src/main/config.ts`（`multiProjectEnabled?: boolean`）
- Modify: `src/preload/index.ts`、`src/preload/index.d.ts`
- Test: `test/project-ipc-contract.test.cjs`（测纯函数 `assertProjectName` / 错误码映射，不拉 electron）

**Interfaces:**
- Consumes: Task 4 `ProjectRegistry`
- Produces:

```ts
// preload
projectList(): Promise<ProjectMeta[]>
projectCreate(name: string, defaultCwd?: string): Promise<{ ok: true; project: ProjectMeta } | { ok: false; code: string; error: string }>
projectDelete(projectId: string): Promise<{ ok: true } | { ok: false; code: string; error: string }>
projectActivate(projectId: string): Promise<{ ok: true } | { ok: false; code: string; error: string }>
projectGetActive(): Promise<string | null>
```

index.ts 骨架（插在 PersistStore 创建之后）：

```ts
const registry = new ProjectRegistry({
  persist,
  pty: ptyManager,
  getHarnessHome: () => readConfig().harnessHome,
  emit: (channel, payload) => { try { liveWebContents()?.send(channel, payload); } catch { return false; } }
});

function hive(): HiveManager {
  const id = registry.getActiveProjectId();
  const inst = id ? registry.getProject(id) : undefined;
  if (!inst) throw new Error('PROJECT_NOT_FOUND');
  return inst;
}
```

把现有 `const hive = new HiveManager(...)` 换成上面。所有 `hive.xxx` 暂时经 `hive()` 走活跃项目——这是过渡，Task 6 再改成显式 projectId。

`app.whenReady` 里 `persist.open()` 之后立刻 `registry.bootstrap()`。

- [ ] **Step 1–4:** 先写 `assertProjectName`（空名拒绝、trim、最长 80）的测试再实现；preload 方法按上表加。跑 `npm run typecheck:node`。
- [ ] **Step 5: Commit** `feat: expose project lifecycle IPC`

---

### Task 6: hive / pty IPC 经 ProjectRegistry 路由

**范围：** 抽 `routeHive`；hive 与 pty handler 首参 `projectId`；缺省回退活跃项目。事件 payload 带 `projectId`（Task 2 已补 emit）。  
**关注点：** 失败分支 → `PROJECT_NOT_FOUND` / `PROJECT_DEGRADED`；新路径 → spawn 前查 `getActivePtyCount() >= MAX_ACTIVE_AGENTS` → `SPAWN_LIMIT_REACHED`。  
**风险：** `index.ts` 里大量 `hive.` 引用。本 Task **只改 hive:\* 与 pty:\***，每改一批跑全量测试。control:\* 一并带 projectId，但 ControlRegistry 仍按全局 agentId。

**Files:**
- Create: `src/main/hiveRouter.ts`
- Modify: `src/main/index.ts`（`hive:registry` 等、`pty:spawn` / write / resize / kill）
- Modify: `src/preload/index.ts`（hive/pty 方法增加 `projectId?: string`，先可选）
- Test: `test/hive-router.test.cjs`

**Interfaces:**

```ts
export function routeHive<T>(opts: {
  projectId: string | undefined;
  registry: { getActiveProjectId(): string | null; getProject(id: string): HiveManager | undefined; getMeta(id: string): ProjectMeta | undefined };
}): { ok: true; hive: HiveManager; projectId: string } | { ok: false; code: 'PROJECT_NOT_FOUND' | 'PROJECT_DEGRADED'; error: string }

// handler 用法：
ipcMain.handle('hive:registry', (_e, projectId?: string) => {
  const r = routeHive({ projectId, registry });
  if (!r.ok) return { error: r.error, code: r.code };
  return r.hive.registry();
});
```

`pty:spawn`：先 `routeHive`，再 `if (ptyManager.getActivePtyCount() >= MAX_ACTIVE_AGENTS) return { ok:false, code:'SPAWN_LIMIT_REACHED' }`，再把 `opts.projectId = r.projectId` 交给现有 spawn 核心。

- [ ] **Step 1: Write router tests**（缺 projectId 回退 active；未知 id → NOT_FOUND；degraded → DEGRADED）
- [ ] **Step 2: Expect FAIL**
- [ ] **Step 3: Implement `hiveRouter.ts`；grep `ipcMain.handle('hive:` 与 `pty:`，改为走 `routeHive`。不要一次改 fs/git/config。**
- [ ] **Step 4:** `node --test test/hive-router.test.cjs` 以及 `npm run test:focused`
- [ ] **Step 5: Commit** `feat: route hive and pty IPC by projectId`

---

### Task 7: HookServer 与共享服务按项目找实例

**范围：** HookServer 不再持有单个 HiveManager；`MemoryManager` / `MemoryReflector` / `RosterStore` 的 home getter 改为按 agent 所属 projectRoot；Telemetry 的 `resolveCwd` / `resolveSessionId` 先 `registry.hiveForAgent(agentId)`。  
**关注点：** 失败分支 → 未知 agent_id 时 hook 当禁用（与今天 hive disabled 类似），不 500；ControlRegistry / CircuitBreaker **不改**。

**Files:**
- Modify: `src/main/hooks.ts`（构造改为 `getHive: (agentId: string) => HiveManager | undefined`）
- Modify: `src/main/index.ts`（HookServer / telemetry / memory / roster / reflector 接线）
- Modify: `src/main/roster.ts`（`RosterStore` 继续吃 getter，调用方传入 `() => registry 活跃或指定 projectRoot`；读写 IPC 带 projectId）
- Modify: `src/main/memory.ts`、`src/main/reflect.ts`、`src/main/telemetry.ts`（回调多一个能拿到 projectRoot 的函数）
- Test: `test/hooks-project-route.test.cjs`（沿用 `test/hooks-notification.test.cjs` 的构造方式，注入 fake getHive）

**Interfaces:**

```ts
new HookServer(
  (agentId) => registry.hiveForAgent(agentId),
  getWebContents,
  getConfig,
  control,
  breaker,
  standingGoalFromRoster,
  onEvent
)
```

`hiveForAgent`：遍历已加载 HiveManager 的 `registry().agents`。agentId 全局唯一，命中至多一个。

Roster IPC `roster:read` / `roster:write` 增加可选 `projectId`，缺省活跃项目。路径：`join(projectRoot, 'roster.json')` —— 与今天 `join(harnessHome, 'roster.json')` 同形，只是 root 变了。

- [ ] **Step 1–4:** 单测「agent A 在项目 1 时 hook 写到项目 1 的 hive」；改完跑 `test/hooks-notification.test.cjs test/hooks-project-route.test.cjs test/roster.test.cjs`
- [ ] **Step 5: Commit** `feat: route hooks and shared services by project`

---

### Task 8: 切换编排与并发上限收口

**范围：** 把 Task 3/4/6 的暂停、计数、错误码在真实 activate / spawn 路径上接严；Renderer 暂不画 UI，但 spawn 错误码要能回到 preload。  
**关注点：** 状态变更 + 失败分支已在 T3/T4 标注；本 Task 补 `TODO[METRIC]`：`SPAWN_LIMIT_REACHED` / `RESUME_LIMIT_REACHED` 记一条。

**Files:**
- Modify: `src/main/projectRegistry.ts`（activate 计数公式与 Task 3 Windows 规则对齐，补测）
- Modify: `src/main/index.ts`（spawn 错误原样返回 `{ ok:false, code, error }`）
- Test: `test/project-activate-limit.test.cjs`

**Interfaces:** 不新增类型。锁定公式：

```ts
export function wouldExceedActiveLimit(opts: {
  platform: string;
  currentActive: number;
  oldProjectRunning: number;
  targetProjectSessions: number;
  limit?: number;
}): boolean {
  const limit = opts.limit ?? 5;
  if (opts.platform === 'win32') return opts.currentActive > limit;
  const next = opts.currentActive - opts.oldProjectRunning + opts.targetProjectSessions;
  return next > limit;
}
```

Windows：切换不改变真实运行数，故不因切换拒绝；spawn 仍看 `getActivePtyCount() >= 5`。

- [ ] **Step 1–4:** 单测该纯函数 + registry.activate 用 fake PtyManager
- [ ] **Step 5: Commit** `fix: enforce spawn and resume agent limits`

---

### Task 9: Store + useHive + preload 显式 projectId

**范围：** Zustand 增加项目列表与活跃 id；切换时替换当前 `agents` / queues / selection。`useHive` 所有 `window.cth.hive*()` 传入 `activeProjectId`。OfficeFloor 先不动读取，靠 `agents` 已被换成当前项目。  
**关注点：** 失败分支 → activate 失败不改 store；新路径 → `TODO[FEATURE_FLAG]`：`multiProjectEnabled===false` 不请求 list 以外的项目。

**Files:**
- Modify: `src/renderer/src/store/store.ts`
- Modify: `src/renderer/src/hooks/useHive.ts`
- Modify: `src/preload/index.ts` / `index.d.ts`（hive* 的 `projectId` 从可选变调用方必传，main 仍回退到 Task 11）
- Test: `test/store-project-slice.test.cjs`（把「切换时用哪份 agents」抽成纯函数，避免把 zustand 拖进 node:test）

**Interfaces:**

```ts
export interface ProjectSlice {
  agents: Agent[];
  archivedAgents: Agent[];
  restorableAgents: Agent[];
  selectedId: string | null;
  queues: Record<string, unknown[]>;
}

export function swapProjectSlice(
  slices: Record<string, ProjectSlice>,
  fromId: string | null,
  toId: string,
  current: ProjectSlice
): { slices: Record<string, ProjectSlice>; next: ProjectSlice } {
  const slices2 = { ...slices };
  if (fromId) slices2[fromId] = current;
  const next = slices2[toId] ?? { agents: [], archivedAgents: [], restorableAgents: [], selectedId: null, queues: {} };
  return { slices: slices2, next };
}
```

store 新增字段：`projects: ProjectMeta[]`、`activeProjectId: string | null`、`projectSlices`（内存）。`activateProject` action：先 IPC，成功再 `swapProjectSlice`。localStorage key 从 `cth.agents` 改为 `cth.agents.<projectId>`（写入时）。读取：先新 key，没有再回退旧 `cth.agents` 一次（仅 Default）。

`useHive`：`const projectId = useStore(s => s.activeProjectId)`；`useEffect` 依赖 `projectId`，变化时停旧轮询、拉新 snapshot。

- [ ] **Step 1–4:** 单测 `swapProjectSlice`；改 store / useHive；`npm run typecheck:web`
- [ ] **Step 5: Commit** `feat: partition renderer hive state by project`

---

### Task 10: 标签栏、对话框、OfficeFloor

**范围：** UI。标签点击 → `projectActivate`；新建 / 删除对话框；`App.tsx` 顶部挂 `ProjectTabBar`（`multiProjectEnabled===false` 或只有一个项目时仍画栏，但可只显示 Default——产品选择：**始终画栏**，单项目时一个 tab + 「+」）。OfficeFloor 在 `activeProjectId` 变化时走现有重建路径（agents 已换）。  
**关注点：** 新业务路径 → `TODO[FEATURE_FLAG]`；失败分支 → 删除二次确认，展示将杀掉的 PTY 数（IPC `pty:list` 按项目过滤）。

**Files:**
- Create: `src/renderer/src/components/ProjectTabBar.tsx`
- Create: `src/renderer/src/components/ProjectCreateDialog.tsx`
- Create: `src/renderer/src/components/ProjectDeleteDialog.tsx`
- Modify: `src/renderer/src/App.tsx`（HivePicker 过关后、OfficeFloor 上方）
- Modify: `src/renderer/src/scene/office/OfficeFloor.tsx`（依赖数组加 `activeProjectId`）
- Test: 无现成 renderer harness。抽 `projectTabLabel(meta)` / `canDeleteProject(list)` 到 `src/shared/projectTypes.ts` 或相邻纯文件，`test/project-tab-logic.test.cjs` 测：最后一个项目 `canDelete=false`；degraded 显示警告点。

**Interfaces:**
- Tab 点击：`window.cth.projectActivate(id)`
- 新建：名称必填，cwd 用现有 `dialog:chooseFolder`
- 删除：`list.length<=1` 时按钮禁用

样式跟现有 `PixelButton` / `PixelPanel`，不要新设计系统。

- [ ] **Step 1–4:** 纯函数测试 + 组件接入 + `npm run typecheck:web`
- [ ] **Step 5: Commit** `feat: add project tab bar and create/delete dialogs`

---

### Task 11: 去掉缺省回退 + 回归

**范围：** `routeHive` 不再接受 `undefined` projectId；preload 全部必传；补迁移与多项目切换的端到端单测（文件系统 + Registry + Pty 假对象，不启 Electron 窗口）。跑全量 `npm run test:focused` 与 `npm run typecheck`。  
**关注点：** 无新写路径。本 Task 是收口。

**Files:**
- Modify: `src/main/hiveRouter.ts`（`!projectId` → `PROJECT_NOT_FOUND`）
- Modify: `src/preload/index.ts`（hive/pty 签名去掉 optional）
- Modify: renderer 里残留的 `window.cth.hiveXxx()` 无 id 调用（grep `hiveRegistry(` `hiveBoard(` `hiveSend(` `spawnPty(`）
- Test: `test/legacy-hive-migrate.test.cjs` 保持；新增 `test/project-e2e-main.test.cjs`：bootstrap 旧目录 → list 含 Default → create 第二项 → activate → spawn 限额

- [ ] **Step 1:** `rg "hiveRegistry\\(|hiveBoard\\(|hiveTasks\\(|hiveSend\\(|hiveInbox\\(|hiveMemory\\(|hiveLog\\(" src/renderer src/preload` 列出未传 projectId 的点，逐个改。
- [ ] **Step 2:** 改 router，跑 `test/hive-router.test.cjs`（缺 id 现在应 NOT_FOUND）。
- [ ] **Step 3:** 写 e2e-main 测试。
- [ ] **Step 4:** `npm run test:focused && npm run typecheck`
- [ ] **Step 5: Commit** `feat: require explicit projectId on hive and pty IPC`

---

## 自动化用例

本仓无 AREX / SOA。入口类型按「本地 node:test」。submit-test 阶段按本表新建或修改 `test/*.test.cjs` 并全量 `npm run test:focused`。

| 场景 | 动作 | 用例名称 | caseId | 入口标识 | 断言要点 | 备注 |
|---|---|---|---|---|---|---|
| projects 表写入并可重复 open | 新增 | persist-projects-roundtrip | | munder-difflin · PersistStore.insertProject | 再 open 后 list 仍 1 条；status/hive_root_path 一致 | Task 1 |
| 旧库升级加上 project_id 列 | 新增 | persist-command-history-project-id | | munder-difflin · PersistStore.migrate | 旧 user_version=1 的库 open 后 command_history 有 project_id，旧行仍在 | Task 1 |
| 两项目 hive 目录互不影响 | 新增 | hive-managers-isolated | | munder-difflin · HiveManager.ensureAgent | A 的 registry 无 B 的 agent；路径各在自己 projectRoot/hive | Task 2 |
| 现有 cwd 展开行为不回退 | 修改 | a "~/…" cwd is expanded before it reaches the registry | | munder-difflin · HiveManager.ensureAgent | 仍写入绝对路径；`hive-cwd.test.cjs` 继续绿 | 复用文件，构造函数兼容 |
| POSIX 暂停后活跃数下降 | 新增 | pty-posix-suspend-drops-active-count | | munder-difflin · countActivePtys | darwin 上 suspended 不计入；resume 加回 | Task 3 |
| Windows 标记暂停仍计入活跃 | 新增 | pty-win32-suspend-keeps-active-count | | munder-difflin · countActivePtys | win32 上 suspended 仍计入 | Task 3 |
| 旧单 hive 迁到 Default | 新增 | legacy-migrate-copies-then-renames | | munder-difflin · migrateLegacyHive | projects/default/hive/registry.json 存在；旧目录改名为 hive.pre-migrate；SQLite 有 default | Task 4 |
| 迁移失败保留旧树 | 新增 | legacy-migrate-keeps-old-on-copy-fail | | munder-difflin · migrateLegacyHive | 注入复制失败后 harnessHome/hive 仍在；表无 default | Task 4 |
| 迁移幂等 | 新增 | legacy-migrate-second-call-noop | | munder-difflin · migrateLegacyHive | 第二次 migrated=false；没有第二个 default 行 | Task 4 |
| 无旧数据时自动建 Default | 新增 | bootstrap-creates-empty-default | | munder-difflin · ProjectRegistry.bootstrap | list 含 Default；hive 目录被创建 | Task 4 |
| 创建项目写盘且可切换 | 新增 | registry-create-then-activate | | munder-difflin · ProjectRegistry.createProject | 新目录存在；activeProjectId 为新 id；旧项目 PTY 走 suspend | Task 4 |
| 目录成功库失败不留半套 | 新增 | registry-create-rolls-back-dir | | munder-difflin · ProjectRegistry.createProject | persist.insert 抛错后 projects/<id> 不存在 | Task 4 |
| 不能删除最后一个项目 | 新增 | registry-refuses-last-delete | | munder-difflin · ProjectRegistry.deleteProject | code=LAST_PROJECT；目录还在 | Task 4 |
| 删除后切到仍在的项目 | 新增 | registry-delete-switches-active | | munder-difflin · ProjectRegistry.deleteProject | 删的是当前活跃时 active 变成另一个 | Task 4 |
| 未知 projectId | 新增 | route-hive-unknown-id | | munder-difflin · routeHive | code=PROJECT_NOT_FOUND | Task 6 |
| 缺省回退活跃项目 | 新增 | route-hive-fallback-active | | munder-difflin · routeHive | Task 6 阶段 undefined → 活跃实例；Task 11 后此行改为「缺 id 即 NOT_FOUND」并**修改**本用例 | Task 6→11 |
| degraded 项目拒绝 spawn | 新增 | spawn-rejects-degraded-project | | munder-difflin · pty:spawn | code=PROJECT_DEGRADED | Task 6 |
| 活跃满 5 拒绝再 spawn | 新增 | spawn-limit-reached | | munder-difflin · pty:spawn | 第 6 次 code=SPAWN_LIMIT_REACHED | Task 6/8 |
| hook 按 agent 落到对应 hive | 新增 | hook-routes-by-agent-id | | munder-difflin · HookServer | 项目 B 的 agent hook 不写进项目 A 的 log | Task 7 |
| 切到将超限的项目被拒绝 | 新增 | activate-resume-limit | | munder-difflin · ProjectRegistry.activateProject | POSIX 下目标 5 个 session 且当前已有其他活跃时 code=RESUME_LIMIT_REACHED；从满 5 的项目切走成功 | Task 8 |
| 切换保存并换回各自 agents | 新增 | store-swap-project-slice | | munder-difflin · swapProjectSlice | 切走再切回，A 的 selectedId/agents 还在 | Task 9 |
| 单项目禁止删 | 新增 | tab-logic-last-project | | munder-difflin · canDeleteProject | list.length===1 为 false | Task 10 |
| 单项目 Default 退化为升级前行为 | 新增 | single-project-default-equivalent | | munder-difflin · ProjectRegistry.bootstrap | 仅 Default 时 registry/board/tasks 与迁之前文件内容一致 | Task 11 |
| hive IPC 必须带 projectId | 修改 | route-hive-fallback-active | | munder-difflin · routeHive | Task 11：undefined → PROJECT_NOT_FOUND | 改 Task 6 那条 |

Pre：各用例在 `os.tmpdir()` 建 harness，测完 `rmSync`。不要睡等、不要真起 Electron 窗口、不要真 node-pty spawn（限额/暂停用 fake session 或纯函数）。

---

## 风险与缓解

1. **`index.ts` 体量。** 只抽 `hiveRouter` / `ProjectRegistry`，handler 保持薄。按 hive → pty → control 分批，每批 `npm run test:focused`。
2. **SIGSTOP 仅 POSIX。** Windows 计数把全部 session 当活跃，切换不拒，spawn 仍封顶 5。
3. **agentId 撞车。** 全局唯一；`ensureAgent` 前 `registry.hiveForAgent(id)` 已有则拒绝。旧数据迁入 Default，id 不变。
4. **迁移安全性。** 改名备份而不是删除；`hive.pre-migrate` 作回滚原料。
5. **HivePicker vs 标签页。** 前者换 harnessHome，后者换项目。文案和入口分开。
6. **现有 `s.agents` 读取面大。** 切换时替换当前数组，少改 OfficeFloor。

---

## Self-review

**Spec coverage**
- 多项目模型 / CRUD / Default 迁移 → Task 1, 4, 5, 11
- 多 HiveManager / 独立目录 → Task 2, 4
- 标签页 + 独立楼层 → Task 9, 10
- PTY 暂停/恢复 + 上限 5 → Task 3, 6, 8
- IPC projectId → Task 5, 6, 11
- 灵活 cwd → 沿用 HiveManager.ensureAgent，Task 2 回归 hive-cwd
- Hook / roster / memory 隔离 → Task 7
- 非目标（模板 / 跨项目消息 / boss 晋升 / 多窗口改造）无 Task

**发布保护（写入 design.md）**
- 开关：`multiProjectEnabled`
- 灰度：桌面应用按版本发布，无按用户比例
- 监控：create/activate/delete/migrate/limit 事件
- 回滚：`hive.pre-migrate`；关开关只留 Default

**Placeholder scan：** 无 TBD；测试命令与类型名已写死。
