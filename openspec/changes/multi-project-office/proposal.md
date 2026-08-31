# 提案：多项目多 Hive 办公楼层重构

## 概述

将 Munder Difflin 从单 HiveManager 单例架构重构为多项目多 HiveManager 实例架构。每个项目拥有独立的 hive 数据目录和楼层可视化，通过标签页切换实现项目间隔离，并以 OS 级信号（SIGSTOP/SIGCONT）暂停/恢复非活跃项目的 PTY 进程以控制并发资源消耗。

## 动机

当前架构限制：
- **单项目瓶颈**：所有 agent 共用一个 hive，无法按项目隔离数据和上下文
- **资源失控**：大量 agent 同时运行时，PTY 进程并发消耗 CPU/内存，无暂停机制
- **上下文混乱**：不同项目的 agent 混在同一楼层，用户难以管理

用户需求：
- 同时管理多个独立项目（不同仓库、不同团队）
- 项目间数据完全隔离（registry、board、tasks、messages）
- 智能资源控制：非活跃项目自动暂停，切回时恢复
- 灵活的 agent cwd：每个项目的 agent 可操作不同仓库

## 范围

### 纳入范围（Phase 1 MVP）

1. **多项目数据模型**：Project 实体持久化（SQLite migration）、项目生命周期管理（创建/切换/删除）
2. **多 HiveManager 实例**：每个项目对应独立的 HiveManager，拥有独立 hive 数据目录（`<harnessHome>/projects/<projectId>/hive/`）
3. **标签页切换 UI**：Renderer 顶部标签栏，支持项目新建、切换、关闭；每个项目渲染独立楼层
4. **PTY 并发控制**：并发活跃 agent 上限 = 5；非活跃项目的全部 PTY 发送 SIGSTOP，切回时 SIGCONT 恢复
5. **IPC 路由层**：所有 hive/pty/control 相关 IPC handler 增加 projectId 参数，main 进程按 projectId 分发到对应 HiveManager 实例
6. **灵活 agent cwd**：每个项目的 agent 可独立设置 cwd，支持操作不同仓库

### 非目标（后续 Phase）

- **Phase 2**：agent 模板系统
- **Phase 3**：boss 晋升 / 跨项目编排
- **Phase 4**：跨项目 agent 通信
- **Phase 1 不做**：程序化地图生成（每个项目复用现有 office 主题楼层）、多窗口支持（仍为单窗口 + 标签页切换）、PersistStore/RosterStore 多实例化（保持全局单例，按 projectId 分区）

## 关键决策

1. **数据隔离策略**：每个项目独立的 hive 目录（`<harnessHome>/projects/<projectId>/hive/`），HiveManager 内部无需感知多项目
2. **路由层设计**：新增 ProjectRegistry 模块，持有 `Map<projectId, HiveManager>` 实例映射，作为 IPC handler 与 HiveManager 之间的唯一路由层
3. **PTY 暂停机制**：使用 OS 信号（SIGSTOP/SIGCONT），与现有 ControlRegistry 的 hook-level pause 是不同机制，避免语义混淆
4. **共享服务策略**：ControlRegistry / CircuitBreaker / TelemetryCollector / MemoryManager / MemoryReflector 保持全局单例，按 projectId/agentId 分区
5. **向后兼容策略**：Phase 1 期间 IPC handler 在缺少 projectId 时回退到 activeProjectId，最终在 Phase 1E 去掉回退
6. **旧版迁移策略**：首次启动时，若检测到旧版单 hive 数据，自动创建一个 "Default" 项目并导入

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer (标签页 UI)                       │
│  ProjectTabBar  │  OfficeFloor  │  useHive (按项目路由)       │
└─────────────────────────────────────────────────────────────┘
                              │ IPC (projectId 首参)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Main 进程：ProjectRegistry                      │
│  Map<projectId, HiveManager>  │  活跃项目切换  │  并发准入    │
└─────────────────────────────────────────────────────────────┘
                              │ 路由
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ HiveManager  │    │ HiveManager  │    │ HiveManager  │
│ (Project A)  │    │ (Project B)  │    │ (Project C)  │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌──────────────────┐
                    │   PtyManager     │
                    │  (全局单例)       │
                    │  SIGSTOP/SIGCONT │
                    └──────────────────┘
```

## 影响分析

### 高风险改动

1. **index.ts 的 ~129 处 hive 引用改造**：所有 IPC handler 需增加 projectId 首参并通过 ProjectRegistry 路由，任何一个遗漏或错误路由都会导致功能异常
   - 缓解：引入 `routeHive()` 工具函数统一路由，逐 handler 改造 + 回归测试

2. **HiveManager 构造函数去闭包依赖**：从读取全局 `readConfig().harnessHome` 改为显式 `projectRoot` 参数
   - 缓解：grep 所有内部文件操作路径，确保全部基于 projectRoot

3. **SIGSTOP/SIGCONT 平台兼容性**：仅在 macOS/Linux 有效，Windows 需降级处理
   - 缓解：Phase 1C 设计 Windows 降级方案（标记 suspended 但不发信号）

### 中等风险改动

4. **Renderer IPC 调用点数量多**：所有 `window.cth.hiveXxx()` 调用点需增加 projectId 参数
   - 缓解：Phase 1D 期间保留默认 projectId 回退，1E 阶段逐步消除

5. **旧版迁移失败时的数据安全性**：迁移过程中若发生错误可能导致数据丢失
   - 缓解：采用"先复制后删除"策略，迁移失败时保留旧目录

### 低风险改动

6. **PTY 并发计数准确性**：PTY 进程异常退出可能导致计数不准
   - 缓解：在 PtyManager 的 exit 事件回调中始终递减计数器

## 交付计划

### Phase 1A：数据层 & 路由基础设施（2-3 天）
- PersistStore 新增 `projects` 表 migration
- 新增 ProjectRegistry 模块
- HiveManager 构造函数重构
- 旧版单 hive → Default 项目自动迁移逻辑
- 新增项目生命周期 IPC handler

### Phase 1B：IPC 路由改造（3-4 天）
- hive 相关 IPC handler 全部增加 projectId 首参 + 路由
- pty 相关 IPC handler 增加 projectId + 并发准入检查
- HiveManager 事件推送增加 projectId
- HookServer 改为通过 ProjectRegistry 路由
- TelemetryCollector / MemoryManager / RosterStore 按项目隔离

### Phase 1C：PTY 暂停/恢复 & 并发控制（2 天）
- PtyManager 新增按项目 SIGSTOP/SIGCONT 能力
- ProjectRegistry 在 active 切换时编排暂停/恢复
- 全局活跃 agent 计数器 + 准入拒绝逻辑
- Windows 平台降级处理

### Phase 1D：Renderer 多项目 UI（3-4 天）
- Store 增加 projects 列表 + activeProjectId + 按项目分区数据
- ProjectTabBar 组件（标签栏）
- useHive hook 改造
- OfficeFloor 改造
- 项目创建/删除对话框
- 现有 IPC 调用点全量迁移

### Phase 1E：收尾 & 迁移（2 天）
- 旧版数据迁移的端到端测试
- 去掉默认 projectId 回退
- 回归测试（单项目场景退化为 Default 项目的多项目场景）

**总计：12-15 天**

## 验收标准

1. **旧版迁移**：现有单 hive 用户升级后，首次启动自动创建 "Default" 项目，所有历史数据完整保留，功能等价于升级前
2. **多项目创建**：用户可通过 UI 创建新项目，指定名称和 cwd，创建成功后自动切换到新标签页
3. **标签页切换**：点击标签页可切换活跃项目，切换后楼层渲染新项目数据，非活跃项目 PTY 被 SIGSTOP 暂停
4. **PTY 恢复**：切回非活跃项目时，其 PTY 进程被 SIGCONT 恢复，输出正常续接
5. **并发控制**：全局活跃 agent 数达 5 时，新项目 spawn 请求被拒绝并返回 `SPAWN_LIMIT_REACHED` 错误
6. **项目删除**：删除项目时所有 PTY 被终止，目录被清理，若删除的是当前活跃项目则自动切换到最近的其他项目
7. **IPC 路由正确性**：所有 hive/pty/control IPC 调用在携带 projectId 时路由到正确的 HiveManager 实例
8. **HookServer 路由**：多项目场景下 agent hook 请求通过 token 正确路由到对应项目的 HiveManager
9. **降级兼容**：Windows 平台不发送 SIGSTOP/SIGCONT，但项目切换功能正常工作
10. **回归测试**：单项目场景（退化为 Default 项目）所有现有功能正常
11. **单元测试覆盖**：ProjectRegistry、HiveManager（改造后）、PtyManager（改造后）单元测试覆盖
12. **端到端测试**：旧版迁移、多项目切换、并发控制、项目删除全流程端到端验证

## 成功指标

- **功能完整性**：所有验收标准通过
- **数据安全性**：旧版迁移零数据丢失
- **性能**：项目切换响应时间 < 200ms；PTY 暂停/恢复延迟 < 100ms
- **稳定性**：多项目场景下无回归 bug
- **用户体验**：标签页切换流畅，无卡顿感

## 风险与缓解

### 技术风险

1. **index.ts 改造复杂度高**：~129 处 hive 引用需要系统性改造，容易遗漏
   - 缓解：引入 `routeHive()` 工具函数统一路由；逐 handler 改造 + 回归测试；Phase 1 期间保留默认 projectId 回退

2. **SIGSTOP/SIGCONT 平台兼容性**：Windows 不支持
   - 缓解：Windows 降级处理（标记 suspended 但不发信号）；Phase 1 仅在 macOS/Linux 上启用完整暂停功能

3. **旧版迁移失败**：可能导致数据丢失
   - 缓解：采用"先复制后删除"策略；迁移失败时保留旧目录；弹出对话框让用户手动处理

4. **并发控制准确性**：PTY 异常退出可能导致计数不准
   - 缓解：在 PtyManager 的 exit 事件回调中始终递减计数器

### 业务风险

5. **用户体验中断**：标签页切换机制可能改变用户习惯
   - 缓解：保持 UI 一致性；提供清晰的视觉反馈；单项目用户无感知（退化为 Default 项目）

## 替代方案

### 方案 A：多窗口支持（ rejected ）
- 每个项目独立窗口
- 优点：项目隔离更彻底
- 缺点：实现复杂度高；窗口管理成本增加；不符合用户"单窗口多标签"的心智模型

### 方案 B：单 HiveManager + 逻辑分区（ rejected ）
- HiveManager 内部按 projectId 分区，不创建多实例
- 优点：改动最小；无需重构 HiveManager
- 缺点：hive 数据目录仍需物理隔离（git 仓库独立）；无法满足"每个项目独立 git repo"的需求

### 方案 C：Hook-level PTY 暂停（ rejected ）
- 通过 node-pty 的 API 暂停 PTY 输出，而非 OS 信号
- 优点：跨平台兼容
- 缺点：无法真正暂停进程执行；CPU/内存仍被占用；不符合"资源控制"的目标

**选择当前方案**：多 HiveManager 实例 + OS 信号暂停 + 标签页切换，在功能完整性、用户体验、实现复杂度之间取得最佳平衡。

## 开放问题

1. **项目删除的确认机制**：是否需要二次确认对话框？建议：删除前弹出确认，显示将终止的 PTY 数量和清理的目录
2. **degraded 项目的恢复**：项目 HiveManager 初始化失败后，是否支持手动重试？建议：支持"重试"按钮
3. **跨项目 agent 迁移**：是否支持将 agent 从一个项目迁移到另一个项目？建议：Phase 2 再考虑

## 附录

### 数据模型变更

**新增 `projects` 表**：
```sql
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'degraded', 'pending-deletion')),
  default_cwd TEXT,
  hive_root_path TEXT NOT NULL
);
```

**`command_history` 表扩展**：
```sql
ALTER TABLE command_history ADD COLUMN project_id TEXT;
```

### IPC 通道变更

**新增通道**：
- `project:list` → 返回所有项目元数据
- `project:create` → 创建新项目
- `project:delete` → 删除项目
- `project:activate` → 切换活跃项目
- `project:getActive` → 获取当前活跃项目
- `project:changed` → 项目列表变更推送
- `project:active-changed` → 活跃项目切换推送

**改造通道（增加 projectId 首参）**：
- `hive:registry`、`hive:board`、`hive:tasks`、`hive:send`、`hive:inbox`、`hive:messages`、`hive:memory`、`hive:log`
- `pty:spawn`、`pty:kill`、`pty:write`、`pty:resize`
- `control:pause`、`control:steer`、`control:halt` 等

### 文件布局变更

```
<harnessHome>/
├── settings.json              (全局配置，不变)
├── difflin.sqlite             (PersistStore，新增 projects 表)
├── projects/
│   ├── default/
│   │   ├── hive/              (原 <harnessHome>/hive/ 的内容)
│   │   └── roster.json        (原 <harnessHome>/roster.json)
│   └── <new-project-id>/
│       ├── hive/
│       └── roster.json
└── ...
```