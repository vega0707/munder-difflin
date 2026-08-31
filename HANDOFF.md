# 交接文档：多项目多 Hive 架构重构

**交接时间：** 2026-01-31  
**当前阶段：** dcsspec-design（设计阶段，未完成）  
**变更标识：** `multi-project-office`

---

## 一、已完成的工作

### 1. 需求分析（dcsspec-open）✅ 完成

**需求文档：** `docs/dcsspec/multi-project-office/proposal.md`（132 行）

**核心需求（Phase 1 MVP）：**
- 多项目数据模型 + 标签页切换
- 1 项目 = 1 楼层（独立地图），标签页切换
- 项目 = 独立 hive 数据目录 + 灵活 agent cwd（可操作多个仓库）
- 并发活跃 agent 限制 = 5，非活跃项目暂停 PTY（SIGSTOP/SIGCONT）
- 不做 agent 模板系统（Phase 2）
- 不做跨项目通信（Phase 4）
- 不做 boss 晋升（Phase 3）

**关键决策：**
- 项目 = 楼层（独立地图），标签页切换
- 项目边界 = 独立 hive 数据目录 + 灵活 agent cwd
- boss 职责 = 参考 iClaw lead 角色（独占编排工具），但可以换人（员工晋升替代 boss）；默认纯编排，也支持 player-coach 模式
- agent 配置 = agent 级独立配置 MCP/skill
- agent 模板 = 全局共享，参考 iClaw Skill 系统
- 跨项目通信 = 开放通信，消息标注"跨项目"
- 全局 boss = 无，扁平结构（你 → 项目 boss → 员工）

**长期规划（保留在 proposal.md）：**
- Phase 1：多项目数据模型 + 标签页切换
- Phase 2：agent 模板系统
- Phase 3：boss 模型演进
- Phase 4：跨项目通信

### 2. 架构设计（architect-agent）✅ 完成

**设计文档：** `openspec/changes/multi-project-office/design.md`（337 行）

**核心架构决策：**
1. **ProjectRegistry 作为多项目协调核心**
   - 新增 `ProjectRegistry` 模块，持有 `Map<projectId, HiveManager>` 实例映射
   - 充当 IPC handler 与底层 HiveManager 之间的唯一路由层
   - PtyManager、ControlRegistry、CircuitBreaker、PersistStore 等保持全局单例，通过 projectId 分区

2. **IPC 路由策略：projectId 首参 + 渐进式迁移**
   - 所有 hive/pty/control 相关 IPC handler（~20+ 个）统一增加 projectId 作为第一个参数
   - 通过 ProjectRegistry 分发到对应实例
   - 过渡期保留"缺省取活跃项目"的回退机制
   - 全局性 IPC（config/fs/git/integrations）不携带 projectId

3. **PTY 暂停/恢复采用 OS 信号而非 hook-level 控制**
   - 非活跃项目的所有 PTY 通过 SIGSTOP/SIGCONT 在操作系统层面暂停/恢复
   - 区别于现有 ControlRegistry.pause 的 hook 返回机制（两者语义完全不同）
   - Windows 平台降级处理（标记 suspended 但不发信号）
   - 并发活跃 agent 上限 = 5，由 ProjectRegistry 统一计数和准入控制

**涉及模块（11 个）：**
- 4.1 ProjectRegistry（新增）
- 4.2 HiveManager（修改：构造函数接收 projectRoot）
- 4.3 PtyManager（修改：按项目暂停/恢复、全局活跃计数）
- 4.4 IPC 路由层（index.ts 重构）
- 4.5 HookServer（修改：通过 ProjectRegistry 路由）
- 4.6 共享服务（ControlRegistry/CircuitBreaker/TelemetryCollector/MemoryManager/RosterStore）
- 4.7 ProjectTabBar（新增）
- 4.8 Store 多项目改造
- 4.9 OfficeFloor（修改：按 activeProjectId 读取）
- 4.10 useHive Hook（修改：IPC 增加 projectId）
- 4.11 Project 类型定义（新增）

**交付阶段（5 个）：**
- Phase 1A：数据层 & 路由基础设施（PersistStore migration、ProjectRegistry、HiveManager 重构、旧版迁移）
- Phase 1B：IPC 路由改造（hive/pty/control IPC 增加 projectId）
- Phase 1C：PTY 暂停/恢复 & 并发控制
- Phase 1D：Renderer 多项目 UI（Store 改造、ProjectTabBar、useHive、OfficeFloor）
- Phase 1E：收尾 & 迁移（端到端测试、回归测试）

### 3. 实施提案（proposal-agent）✅ 完成

**提案文档：** `openspec/changes/multi-project-office/proposal.md`（260 行）

包含：概述、动机、范围、关键决策、架构概览、影响分析、交付计划、验收标准、成功指标、风险与缓解、替代方案、开放问题、附录

### 4. 任务清单 ✅ 完成

**任务文档：** `openspec/changes/multi-project-office/tasks.md`（586 行）

**预估总工时：** 12-15 天

**任务组织：** 按 5 个交付阶段（Phase 1A-1E）组织，每个阶段独立可测

**Phase 1A 示例任务：**
- 1.1 PersistStore 新增 projects 表 migration（0.5 天）
- 1.2 新增 Shared 类型定义（0.5 天）
- 1.3 HiveManager 构造函数重构（1 天）
- 1.4 ProjectRegistry 模块骨架（1 天）
- 1.5 旧版单 hive 自动迁移（0.5 天）
- 1.6 项目生命周期 IPC handler（0.5 天）

---

## 二、待完成的工作

### 1. 验收表（硬门控）❌ 未完成

**要求：**
- 表至少含：场景、动作（新增/修改/复用）、用例名称
- 场景覆盖：项目创建/删除/切换、IPC 路由、PTY 暂停/恢复、并发控制、旧版迁移
- 写入 plan 的「自动化用例」专节
- 对话列出 → `acceptanceCasesPlanned`

**参考文档：** `~/.chengxiaobang/skills/dcsspec/references/acceptance-cases.md`

### 2. 实现计划（writing-plans）❌ 未完成

**要求：**
- 写完整的实现计划到 `docs/superpowers/plans/2026-01-31-multi-project-office.md`
- 包含自动化验收表（完整表）
- 每个 Task 对应 design.md 的交付阶段中的一个步骤
- 包含验收检查点（每个 Task 完成后的验证方式）

**plan 结构：**
```markdown
# 实现计划：多项目多 Hive 架构（Phase 1）

## 关联设计
- 设计文档：`openspec/changes/multi-project-office/design.md`
- 需求文档：`docs/dcsspec/multi-project-office/proposal.md`

## 实现步骤

### Task 1: [Task 名称]
**范围：** [具体改动]
**涉及文件：** [文件列表]
**实现要点：** [关键实现细节]
**验收检查点：** [如何验证]

### Task 2: ...

## 自动化用例

| 场景 | 动作 | 用例名称 | 描述 |
|---|---|---|---|
| ... | ... | ... | ... |

## 风险与缓解
[从 design.md 附录提取的关键注意事项]
```

### 3. humanizer-zh ❌ 未完成

**要求：**
- 改设计正文
- 让文档更自然、更符合中文表达习惯

### 4. plan-review ❌ 未完成

**要求：**
- 审查 plan
- 置 `planReviewPassed`

### 5. designApproved ❌ 未完成

**要求：**
- 用户批准
- 置 `designApproved`
- 同会话 Read `dcsspec-build/SKILL.md` 并执行

---

## 三、dcsspec 状态

**状态文件：** `.dcsspec/changes/multi-project-office/state.json`

```json
{
  "version": 1,
  "ticketKey": null,
  "idev": null,
  "title": "多项目办公室架构",
  "changeName": "multi-project-office",
  "changeId": "multi-project-office",
  "branch": "main",
  "repos": ["munder-difflin"],
  "primaryRepo": "munder-difflin",
  "openspecChange": "multi-project-office",
  "specPath": [],
  "planPath": [],
  "dcsspecDir": "docs/dcsspec/multi-project-office",
  "currentStage": "design",
  "stages": {
    "open": { "status": "done" },
    "design": { "status": "in_progress" }
  },
  "gates": {
    "brainstormingDone": true
  },
  "notes": "已决议：1 项目 = 1 楼层（独立地图），标签页切换；项目 = 独立 hive 数据目录 + 灵活 cwd；boss = iClaw lead 角色（可换人）；agent 级独立 MCP/skill；全局模板参考 iClaw Skill；并发活跃 agent 限制 = 5，非活跃项目暂停 PTY；Phase 1 只做多项目数据模型 + 标签页切换。"
}
```

**待设置的 gates：**
- `acceptanceCasesPlanned`
- `planReviewPassed`
- `designApproved`

---

## 四、关键风险点

### 1. `index.ts` 的 5300+ 行是最大风险面

当前 main 进程入口文件中存在 80+ 处对单例 `hive` 的直接引用，IPC handler 与 HiveManager 深度耦合。Phase 1B 的 IPC 路由改造涉及面广，**必须分批进行**（按 hive → pty → control 顺序），每批完成后跑全量回归，避免一次性重构引入难以定位的回归 bug。

### 2. SIGSTOP/SIGCONT 的平台限制

这两个 POSIX 信号仅在 macOS/Linux 有效，Windows 没有等价机制。当前用户群以 macOS 为主可暂时降级处理，但架构文档中必须明确标注此约束，Phase 2 若需 Windows 支持需探索替代方案（如挂起 node-pty 的 I/O 流但不杀进程）。

### 3. agent ID 的全局唯一性约定需提前确立

现有 ControlRegistry、CircuitBreaker、TelemetryCollector 均按 agentId 分区，多项目后不同项目可能出现同名 agentId。两种方案：

- **(a) agentId 自然全局唯一**（projectId 前缀或 UUID）
- **(b) 复合 key**（projectId + agentId）

**建议在 Phase 1A 启动前明确选定方案**，否则后续所有分区逻辑都需要返工。推荐方案 (a) 对现有代码改动最小。

---

## 五、下一步该做什么

### 立即执行（按顺序）：

1. **写验收表**
   - 覆盖场景：项目创建/删除/切换、IPC 路由、PTY 暂停/恢复、并发控制、旧版迁移
   - 写入 plan 的「自动化用例」专节
   - 置 `acceptanceCasesPlanned`

2. **写实现计划**
   - 路径：`docs/superpowers/plans/2026-01-31-multi-project-office.md`
   - 参考 writing-plans skill
   - 每个 Task 对应 design.md 的交付阶段中的一个步骤

3. **humanizer-zh**
   - 改设计正文，让文档更自然

4. **plan-review**
   - 审查 plan
   - 置 `planReviewPassed`

5. **designApproved**
   - 用户批准
   - 置 `designApproved`

6. **进入 build 阶段**
   - 同会话 Read `dcsspec-build/SKILL.md` 并执行

---

## 六、相关文件索引

### 需求文档
- `docs/dcsspec/multi-project-office/proposal.md`（132 行）

### 设计文档
- `openspec/changes/multi-project-office/design.md`（337 行）
- `openspec/changes/multi-project-office/proposal.md`（260 行）
- `openspec/changes/multi-project-office/tasks.md`（586 行）

### 状态文件
- `.dcsspec/changes/multi-project-office/state.json`

### 参考文档
- `~/.chengxiaobang/skills/dcsspec-design/SKILL.md`（设计阶段技能）
- `~/.chengxiaobang/skills/dcsspec/references/acceptance-cases.md`（验收表规范）
- `~/.chengxiaobang/skills/writing-plans/SKILL.md`（实现计划技能）
- `~/.cursor/agents/architect-agent.md`（架构师 agent）

---

## 七、给 Cursor 的提示

### 你接手时的状态：
- ✅ 需求分析完成（proposal.md）
- ✅ 架构设计完成（design.md）
- ✅ 实施提案完成（proposal.md in openspec）
- ✅ 任务清单完成（tasks.md）
- ❌ 验收表未完成
- ❌ 实现计划未完成
- ❌ humanizer-zh 未完成
- ❌ plan-review 未完成
- ❌ designApproved 未完成

### 你的任务：
1. 完成待完成的工作（验收表、实现计划、humanizer-zh、plan-review）
2. 获得 designApproved
3. 进入 build 阶段（实现代码）

### 注意事项：
- dcsspec 流程有硬门控，必须按顺序完成
- 验收表是硬门控，必须在进 build 前完成
- Phase 1 只做 MVP，不要扩展到 Phase 2/3/4
- 风险点（index.ts 重构、SIGSTOP 平台限制、agentId 唯一性）需要特别关注

### 推荐执行顺序：
1. 先写验收表（参考 acceptance-cases.md）
2. 再写实现计划（参考 writing-plans skill）
3. 做 humanizer-zh（让文档更自然）
4. 做 plan-review（审查计划）
5. 获得 designApproved
6. 进入 build 阶段（按 tasks.md 的 5 个 Phase 逐步实现）

---

**交接完成。祝顺利！**
