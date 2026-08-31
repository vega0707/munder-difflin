# 技术架构设计：多项目多 Hive

自动化验收表见 `docs/superpowers/plans/2026-08-31-multi-project-office.md` §自动化用例，本文不抄表。

## 1. 方案摘要

现在整个应用只有一个 HiveManager。Phase 1 改成一项目一个实例：各自一块 hive 目录，各自一张楼层，顶部标签切换。切走的项目用 SIGSTOP 停住里面的 PTY，切回来再 SIGCONT，避免一堆 CLI 同时占 CPU。

还要守住三件事：

1. HiveManager、HookServer、MemoryManager 这些今天都是单例。加协调层时，原来的单项目路径不能断。单项目用户升级后只看见一个叫 Default 的项目，行为应和现在一样。
2. `index.ts` 五千多行，hive 调用八十多处。IPC 要加 `projectId`，但必须分批改，不能一次翻完再测。
3. SIGSTOP/SIGCONT 是停进程，和 ControlRegistry 那套 hook 级 pause 不是一回事，两套词不要混用。

## 2. 范围界定

### 纳入范围

1. **多项目数据模型**：Project 实体持久化（SQLite migration）、项目生命周期管理（创建/切换/删除）
2. **多 HiveManager 实例**：每个项目对应独立的 HiveManager，拥有独立 hive 数据目录（`<harnessHome>/projects/<projectId>/hive/`）
3. **标签页切换 UI**：Renderer 顶部标签栏，支持项目新建、切换、关闭；每个项目渲染独立楼层
4. **PTY 并发控制**：并发活跃 agent 上限 = 5；非活跃项目的全部 PTY 发送 SIGSTOP，切回时 SIGCONT 恢复
5. **IPC 路由层**：所有 hive/pty/control 相关 IPC handler 增加 projectId 参数，main 进程按 projectId 分发到对应 HiveManager 实例
6. **灵活 agent cwd**：每个项目的 agent 可独立设置 cwd，支持操作不同仓库

### 非目标

* **不做 agent 模板系统**（Phase 2）
* **不做跨项目 agent 通信**（Phase 4）
* **不做 boss 晋升 / 跨项目编排**（Phase 3）
* **不做程序化地图生成**（每个项目复用现有 office 主题楼层）
* **不做多窗口**（Phase 1 仍为单窗口 + 标签页切换）
* **不迁移 PersistStore / RosterStore 为多实例**（保持全局单例，按 projectId 分区）

### 前置假设

* 用户已确认 brainstorming 所有设计决策
* 现有代码库结构如调研所述（单例 HiveManager、单例 PtyManager、单例 ControlRegistry 等）
* Phase 1 MVP 范围严格控制，后续 phase 在此基础上扩展
* 现有用户迁移：首次启动时，若检测到旧版单 hive 数据，自动创建一个 "Default" 项目并导入

## 3. 系统交互与核心业务流

### 核心链路 1：应用启动 → 多 Hive 初始化

* 正常流：
  `app.ready → PersistStore.open() → 读取 projects 表 → 若无记录则执行旧版迁移（将现有 harnessHome/hive/ 归入 Default 项目）→ 为每个 enabled 项目创建 HiveManager 实例 → 注册 IPC handlers（带路由层）→ 创建主窗口 → Renderer 加载标签页`
* 异常 / 边界：
  - 某项目的 hive 目录损坏 → 标记该项目为 degraded，跳过其 HiveManager 初始化，标签页显示错误态，不阻塞其他项目
  - 旧版迁移失败 → 保留旧目录不删除，弹出对话框让用户手动处理

### 核心链路 2：标签页切换（活跃项目变更）

* 正常流：
  `Renderer 标签页点击 → IPC project:activate(projectId) → Main 进程更新 activeProjectId → 对新活跃项目的所有 PTY 发送 SIGCONT → 对刚变为非活跃的项目的所有 PTY 发送 SIGSTOP → 通知 Renderer 切换楼层渲染数据源`
* 异常 / 边界：
  - SIGCONT 后某 PTY 进程已退出 → PtyManager 走现有 exit / 归档
  - 目标项目恢复后，全局未暂停 PTY 会超过 5 → 拒绝切换，错误码 `RESUME_LIMIT_REACHED`
  - 当前项目已经有 5 个活跃 agent 时，仍允许切走（旧项目会暂停，活跃数下降）


### 核心链路 3：Agent 启动（带并发控制）

* 正常流：
  `Renderer 发起 spawn → IPC pty:spawn(projectId, opts) → 路由到对应 HiveManager → 检查全局活跃 PTY 总数 < 5 → PtyManager.spawn() → HiveManager 注册 agent → 启动 hook proxy → HookServer 绑定到对应 HiveManager 实例`
* 异常 / 边界：
  - 活跃数 = 5 → 返回错误码 SPAWN_LIMIT_REACHED，Renderer 弹窗提示
  - 目标项目的 HiveManager 尚未初始化（degraded 项目） → 返回错误码 PROJECT_DEGRADED

### 核心链路 4：项目创建

* 正常流：
  `Renderer 发起创建 → IPC project:create(name, cwd) → Main 进程分配 projectId → 创建目录 <harnessHome>/projects/<projectId>/ → 初始化 HiveManager（写入 registry.json、board.md 等）→ SQLite INSERT 项目记录 → 返回 projectId → Renderer 自动切换到新标签页`
* 异常 / 边界：
  - 目录创建成功但 HiveManager 初始化失败 → 删除已创建的目录，不写入 SQLite（原子性保证）
  - SQLite 写入失败但目录已创建 → 标记目录为 orphan，下次启动时清理

### 核心链路 5：项目删除

* 正常流：
  `Renderer 发起删除 → IPC project:delete(projectId) → 停止该项目所有 PTY（SIGTERM → 等待退出）→ 销毁 HiveManager 实例 → SQLite 标记 deleted → 异步删除 hive 目录 → 如果删除的是当前活跃项目，自动切换到最近的其他项目`
* 异常 / 边界：
  - PTY 进程拒绝退出（SIGTERM 超时 5s） → SIGKILL 强制终止
  - 目录删除失败 → 标记为 pending-deletion，下次启动时重试

### 核心链路 6：IPC 消息路由

* 正常流：
  `Renderer 调用 hive:registry(projectId) → IPC handler 提取 projectId → ProjectRegistry 查找对应 HiveManager → 调用 hive.registry() → 返回结果`
* 异常 / 边界：
  - projectId 不存在 → 返回标准错误 PROJECT_NOT_FOUND
  - 全局性 IPC（如 config:get、fs:*、git:*） → 不携带 projectId，直接路由到对应全局服务

## 4. 涉及仓库 / 服务及变更范围

> 单仓库（Electron 应用），按 main 进程 / renderer 进程 / shared 三层划分模块。

### 📦 4.1 Main 进程：ProjectRegistry（新增模块）

* **角色定位：** 多项目生命周期管理器——持有 `Map<projectId, HiveManager>` 实例映射，承担项目创建/删除/切换/查询的全部职责，是上层 IPC handler 与底层 HiveManager 之间的**唯一路由层**
* **能力变更意图：** `[新增]`
* **业务边界：**
  - 项目实体的内存态管理（活跃/非活跃/degraded 状态机）
  - HiveManager 实例的创建与销毁
  - 活跃项目切换时的 PTY 暂停/恢复编排（通过调用 PtyManager 的新能力）
  - 并发活跃 agent 计数与准入控制
  - 旧版单 hive 数据迁移
* **上下游依赖：**
  - 上游：IPC handler（所有 hive/pty/control 相关调用经此路由）
  - 下游：HiveManager（N 个实例）、PtyManager（暂停/恢复）、PersistStore（项目记录读写）

### 📦 4.2 Main 进程：HiveManager（修改）

* **角色定位：** 单项目的 hive 数据层——管理一个项目的 registry、router、blackboard、task ledger、event log
* **能力变更意图：** `[修改]`
* **变更要点：**
  - 构造函数继续吃 getter：`getProjectRoot: () => string | null`。语义从「harnessHome」改成「项目根」（其下仍是 `hive/`）。现有测试 `new HiveManager(() => tmpHome)` 不用改调用方式
  - 增加只读 `projectId`，默认 `'default'`。`root()` 仍是 `join(getProjectRoot(), 'hive')`
  - 对外方法签名不动

* **上下游依赖：**
  - 上游：ProjectRegistry（创建/销毁/调用）
  - 下游：文件系统（hive 目录）、git（hive 目录内的 git 操作）
  - 非 breaking：HiveManager 对外暴露的方法签名不变，仅构造参数语义变化

### 📦 4.3 Main 进程：PtyManager（修改）

* **角色定位：** 全局 PTY 进程管理器——管理所有项目的所有 agent PTY 进程
* **能力变更意图：** `[修改]`
* **变更要点：**
  - **新增按项目批量暂停/恢复能力**：接收 projectId → 查找该项目所有 PTY → 逐个发送 SIGSTOP / SIGCONT
  - **新增全局活跃 PTY 计数能力**：返回当前未暂停的 PTY 数量，供并发准入控制使用
  - 每个 PTY session 记录所属 projectId（现有 PtySession 接口扩展）
  - 保持单例——所有项目共用一个 PtyManager（PTY 是 OS 资源，与 HiveManager 的数据管理职责正交）
* **上下游依赖：**
  - 上游：ProjectRegistry（暂停/恢复调度）、IPC handler（spawn/kill/write）
  - 下游：node-pty（OS 级 PTY 进程）
  - SIGSTOP/SIGCONT 仅在 macOS/Linux 有效；Windows 需降级处理（Phase 1 不支持 Windows 的项目暂停，仅标记为 suspended 但实际不发送信号）

### 📦 4.4 Main 进程：IPC 路由层（index.ts 重构）

* **角色定位：** Electron IPC handler 的注册与分发
* **能力变更意图：** `[修改]`
* **变更要点：**
  - **hive 相关 IPC**（`hive:registry`、`hive:board`、`hive:tasks`、`hive:send`、`hive:memory`、`hive:inbox`、`hive:messages`、`hive:log` 等 ~20 个 handler）：第一个参数统一为 projectId，通过 ProjectRegistry 路由到对应 HiveManager
  - **pty 相关 IPC**（`pty:spawn`、`pty:write`、`pty:resize`、`pty:kill` 等）：增加 projectId 参数；spawn 时关联 PTY 与项目；kill 时通过 PTY→project 映射正确归档
  - **control 相关 IPC**（pause、steer、halt 等）：增加 projectId 参数。agentId 已全局唯一，ControlRegistry 仍按 agentId 查找
  - **全局 IPC 不变**：`config:*`、`fs:*`、`git:*`、`integrations:*`、`dialog:*` 等不携带 projectId
  - **新增项目生命周期 IPC**：`project:create`、`project:delete`、`project:activate`、`project:list`、`project:getActive`。迁移只在启动 `bootstrap` 里跑，不另开 `project:migrate`
  - 现有 renderer 代码的所有 IPC 调用点需逐步迁移，Phase 1 期间通过**默认 projectId 回退**保持向后兼容

### 📦 4.5 Main 进程：HookServer（修改）

* **角色定位：** agent CLI hook 请求的 HTTP 服务器，根据 ControlRegistry 状态返回 hook 响应
* **能力变更意图：** `[修改]`
* **变更要点：**
  - 构造改为 `getHive: (agentId) => HiveManager | undefined`，用 hook payload 里的 `agent_id` 反查
  - 还是一个 HTTP/UDS 服务，所有项目的 agent 打同一个口

* **上下游依赖：**
  - 上游：agent CLI 进程（HTTP hook 请求）
  - 下游：ProjectRegistry（路由）、ControlRegistry（控制状态，保持全局单例）、CircuitBreaker（保持全局单例）

### 📦 4.6 Main 进程：共享服务（ControlRegistry / CircuitBreaker / TelemetryCollector / MemoryManager / MemoryReflector）

* **角色定位：** 保持全局单例，按 projectId/agentId 分区
* **能力变更意图：** `[修改]`
* **变更要点：**
  - **ControlRegistry**：不改。agentId 全局唯一（见 §8），按现有 agentId 分区即可

  - **CircuitBreaker**：无需改动——已按 agentId 分区
  - **TelemetryCollector**：`resolveCwd` / `resolveSessionId` 先 `registry.hiveForAgent(agentId)`，再读那个 hive

  - **MemoryManager / MemoryReflector**：从读取全局 `harnessHome` 改为接受 projectRoot 参数；每个项目独立的 memory palace wing
  - **RosterStore**：从全局 roster.json 改为按项目分区（`<projectRoot>/roster.json`）或增加 projectId 维度
  - **PersistStore**：保持单例 SQLite，新增 `projects` 表 + `command_history` 增加 `project_id` 列

### 📦 4.7 Renderer：ProjectTabBar（新增模块）

* **角色定位：** 顶部标签栏组件——展示所有项目标签、支持新建/切换/关闭/重命名
* **能力变更意图：** `[新增]`
* **业务边界：**
  - 渲染项目标签列表（名称、状态指示、活跃 agent 计数徽标）
  - 标签点击触发项目切换（IPC project:activate）
  - 新建按钮打开创建对话框
  - 右键菜单：重命名、删除、打开项目设置
* **上下游依赖：**
  - 上游：用户交互
  - 下游：store（activeProjectId）、IPC（project:* 系列）

### 📦 4.8 Renderer：Store 多项目改造（修改）

* **角色定位：** Renderer 全局状态管理（Zustand）
* **能力变更意图：** `[修改]`
* **变更要点：**
  - **新增顶层状态**：`projects: ProjectMeta[]`（项目列表）、`activeProjectId: string | null`（当前活跃项目）
  - **按项目分区的数据**：`agents`、`feed`、`queuedMessages`、`focusAgentId` 等——从扁平数组改为 `Map<projectId, T[]>` 结构，按 activeProjectId 派生当前视图
  - **保持全局的数据**：`config`、`settingsOpen`、`ideOpen`、`sidebarWidth` 等 UI 状态不按项目分区
  - **IPC 订阅改造**：useHive hook 在订阅 main→renderer 推送时，按 projectId 分发到对应分区（推送消息携带 projectId）
  - **localStorage 隔离**：现有按 floorSeq 隔离的 localStorage key 改为按 projectId 隔离

### 📦 4.9 Renderer：OfficeFloor（修改）

* **角色定位：** PixiJS 楼层渲染
* **能力变更意图：** `[修改]`
* **变更要点：**
  - OfficeFloor 从 store 读取 agents 时改为读取 `agentsByProject[activeProjectId]`
  - 项目切换时：清空当前楼层角色 → 加载新项目的 agent 列表 → 重新分配座位/角色
  - 楼层主题配置按项目独立（Phase 1 复用全局 officeTheme，Phase 2 支持项目级主题）
  - 非活跃项目的楼层不渲染（标签页切换 = 楼层切换，而非多楼层叠加）

### 📦 4.10 Renderer：useHive Hook（修改）

* **角色定位：** Renderer 与 main 进程的 hive 数据同步核心
* **能力变更意图：** `[修改]`
* **变更要点：**
  - 所有 IPC 调用（`window.cth.hiveRegistry()`、`window.cth.hiveBoard()` 等）增加 projectId 参数
  - 轮询/订阅逻辑按 activeProjectId 路由
  - 项目切换时：停止旧项目的轮询 → 启动新项目的轮询 → 一次性拉取新项目的完整状态快照

### 📦 4.11 Shared：Project 类型定义（新增）

* **角色定位：** main/renderer 共享的类型与常量
* **能力变更意图：** `[新增]`
* **业务边界：**
  - ProjectMeta 类型（projectId、name、createdAt、status、defaultCwd 等）
  - 项目状态枚举（active / degraded / pending-deletion）
  - IPC channel 常量（新增的 project:* 系列）
  - 并发限制常量（MAX_ACTIVE_AGENTS = 5）

## 5. 数据模型变更

### 新增存储对象

* **PersistStore `projects` 表**：存储项目元数据（projectId、name、createdAt、status、defaultCwd、hiveRootPath）。通过 SQLite migration 追加（追加到现有 MIGRATIONS 数组），遵循现有 schema evolution 模式。
* **PersistStore `agents` 表扩展**：现有 `command_history` 表新增 `project_id` 列（nullable，兼容旧数据）。

### 现有存储对象扩展

* **HiveManager 数据目录**：从 `<harnessHome>/hive/` 变为 `<harnessHome>/projects/<projectId>/hive/`。目录布局照旧（registry.json、board.md、tasks.json、log.jsonl、agents/）。HiveManager 仍然只认识自己的根目录。
* **RosterStore**：roster 放到 `<projectRoot>/roster.json`，和该项目的 hive 目录平级。


### 存储介质选型结论

* **项目元数据**：复用现有 SQLite（PersistStore），不引入新存储介质
* **项目内数据**：复用现有文件系统 hive 结构（HiveManager 的文件即数据库模式不变）
* **Renderer 状态**：复用 Zustand in-memory store + localStorage 持久化，按 projectId 分区 key

## 6. 对外契约定义

### 契约 1：Renderer → ProjectRegistry（新增 IPC）

| 通道 | 交互方式 | 业务语义 | 变更类型 |
|---|---|---|---|
| `project:list` | 同步 IPC | 返回所有项目元数据列表 | 新增 |
| `project:create` | 同步 IPC | 创建新项目，返回 projectId | 新增 |
| `project:delete` | 同步 IPC | 删除项目（停止 PTY → 销毁 HiveManager → 清理目录） | 新增 |
| `project:activate` | 同步 IPC | 切换活跃项目（SIGCONT 新项目 PTY / SIGSTOP 旧项目 PTY） | 新增 |
| `project:getActive` | 同步 IPC | 返回当前活跃 projectId | 新增 |

### 契约 2：Renderer → HiveManager（现有 IPC 改造）

| 通道 | 交互方式 | 业务语义 | 变更类型 |
|---|---|---|---|
| `hive:registry` | 同步 IPC | 查询项目 agent 注册表 | 修改（增加 projectId 首参，向后兼容——缺省取活跃项目） |
| `hive:board` | 同步 IPC | 查询项目 blackboard | 修改（同上） |
| `hive:tasks` | 同步 IPC | 查询项目任务看板 | 修改（同上） |
| `hive:send` | 同步 IPC | 向项目内 agent 发送消息 | 修改（同上） |
| `hive:inbox` / `hive:messages` | 同步 IPC | 查询项目内消息 | 修改（同上） |
| `hive:memory` | 同步 IPC | 查询项目内 agent 记忆 | 修改（同上） |
| `hive:log` | 同步 IPC | 查询项目事件日志 | 修改（同上） |

### 契约 3：Renderer → PtyManager（现有 IPC 改造）

| 通道 | 交互方式 | 业务语义 | 变更类型 |
|---|---|---|---|
| `pty:spawn` | 同步 IPC | 在项目内启动 agent PTY | 修改（增加 projectId 首参；含并发准入检查） |
| `pty:kill` | 同步 IPC | 终止项目内 agent PTY | 修改（增加 projectId 首参） |
| `pty:write` / `pty:resize` | 同步 IPC | 向项目内 PTY 写入/调整 | 修改（增加 projectId 首参） |

### 契约 4：Main 进程内部（IPC 推送）

| 通道 | 交互方式 | 业务语义 | 变更类型 |
|---|---|---|---|
| `hive:registry:changed` | 异步推送 | 项目注册表变更通知 | 修改（payload 增加 projectId） |
| `hive:board:changed` | 异步推送 | 项目 blackboard 变更通知 | 修改（payload 增加 projectId） |
| `pty:data` / `pty:exit` | 异步推送 | PTY 输出/退出事件 | 修改（payload 增加 projectId） |
| `project:changed` | 异步推送 | 项目列表变更通知（新建/删除/状态变化） | 新增 |
| `project:active-changed` | 异步推送 | 活跃项目切换通知 | 新增 |

### 契约 5：HookServer → ProjectRegistry（内部路由）

* Hook 请求带 `agent_id`。Registry 用 `hiveForAgent(agentId)` 找到对应 HiveManager。不另造 token 表
* HookServer 不再握单个 HiveManager 引用


## 7. 交付阶段

### Phase 1A：数据层 & 路由基础设施

1. PersistStore 新增 `projects` 表 migration
2. 新增 ProjectRegistry 模块（Map<projectId, HiveManager> 管理、项目 CRUD）
3. HiveManager getter 语义改为 projectRoot（调用形状不变）
4. 旧版单 hive → Default 项目自动迁移逻辑
5. 新增项目生命周期 IPC handler（project:create/delete/list/activate）

### Phase 1B：IPC 路由改造

6. hive 相关 IPC handler 全部增加 projectId 首参 + 路由到 ProjectRegistry
7. pty 相关 IPC handler 增加 projectId + 并发准入检查
8. HiveManager 事件推送增加 projectId
9. HookServer 改为通过 ProjectRegistry 路由
10. TelemetryCollector / MemoryManager / RosterStore 按项目隔离

### Phase 1C：PTY 暂停/恢复 & 并发控制

11. PtyManager 新增按项目 SIGSTOP/SIGCONT 能力
12. ProjectRegistry 在 active 切换时编排暂停/恢复
13. 全局活跃 agent 计数器 + 准入拒绝逻辑
14. Windows 平台降级处理（标记 suspended 但不发信号）

### Phase 1D：Renderer 多项目 UI

15. Store 增加 projects 列表 + activeProjectId + 按项目分区数据
16. ProjectTabBar 组件（标签栏）
17. useHive hook 改造（IPC 调用增加 projectId、轮询按项目切换）
18. OfficeFloor 改造（按 activeProjectId 读取 agents）
19. 项目创建/删除对话框
20. 现有 IPC 调用点全量迁移（默认 projectId 回退 → 显式传参）

### Phase 1E：收尾 & 迁移

21. 旧版数据迁移的端到端测试
22. 去掉默认 projectId 回退（所有 IPC 调用必须显式传 projectId）
23. 回归测试（单项目场景 = 退化为 Default 项目的多项目场景）

### 迭代顺序总览

Phase 1A（数据层）→ Phase 1B（IPC 路由）→ Phase 1C（PTY 控制）→ Phase 1D（Renderer UI）→ Phase 1E（收尾迁移）

每个 Phase 做完都能测：1A 测 Registry 和迁移；1B 测 IPC 路由；1C 测暂停/恢复和上限；1D 手点标签栏；1E 确认老用户只看见 Default，功能不丢。

实现步骤与 Task 编号见 `docs/superpowers/plans/2026-08-31-multi-project-office.md`（T1–T11）。

## 8. 已锁定的补充决策

1. **agentId 全局唯一。** 不用 `projectId + agentId` 复合键。新 agent 若 id 已在其他项目出现，创建失败。Hook、ControlRegistry、CircuitBreaker 继续只认 agentId。
2. **旧目录改名备份，不立刻删。** 复制成功后 `hive/` → `hive.pre-migrate`，`roster.json` → `roster.pre-migrate.json`。复制失败则两处都不动。
3. **HivePicker 仍只选 harnessHome**（projects 的父目录）。项目切换只走标签栏。
4. **现有多窗口 floor 本阶段不改交互。** 额外窗口打开时记下当时的 `activeProjectId`。
5. **最后一个项目不能删。**

## 9. 发布保护

1. **开关。** `config.multiProjectEnabled`，缺省 true。false 时只加载 Default（或列表第一项），不画标签栏，main 仍走 Registry（数据模型已经是多项目）。桌面应用没有远程配置中心，这个开关是本机逃生舱，不是灰度开关。
2. **灰度。** 按版本发布。没有按用户、按租户、按比例的通道。先内部 dogfood，再随正式版出去。
3. **监控。** 用现有主进程日志 + 已有 telemetry（若该事件通道还在）：`project_created` / `project_activated` / `project_deleted` / `legacy_migrate_ok|fail` / `SPAWN_LIMIT_REACHED` / `RESUME_LIMIT_REACHED` / `project_degraded`。没有对应事件则先打结构化 log，不新开一套平台。
4. **回滚。** 应用回退到旧版本时，若 `hive.pre-migrate` 还在，可把它改回 `hive/`。已经删掉的项目目录不能自动回来，所以删除必须二次确认。关 `multiProjectEnabled` 不能撤销迁移，只能把 UI 收成单项目。

## 10. 工程关注点怎么进代码

plan 各 Task 已按写操作 / 状态机 / 失败路径 / 开关 / 埋点标了关注点。build 时在对应位置留 `TODO[REENTRANCY]` / `TODO[CONCURRENCY]` / `TODO[FAILURE_HANDLING]` / `TODO[FEATURE_FLAG]` / `TODO[METRIC]`，verify 逐项核对。幂等、并发、信号失败这类工程场景不进验收表。

