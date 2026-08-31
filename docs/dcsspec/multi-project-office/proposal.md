# 拆分建议：Munder Difflin 多项目办公室架构

## 需求概述

将 Munder Difflin 从"单项目单 hive"架构重构为"多项目多 hive"架构，支持同时运行多个独立项目，每个项目有自己的 boss（可纯编排可干活）和 agent 团队，通过标签页切换。

## 已确认的设计决策

| 决策项 | 结论 |
|---|---|
| 项目 = 楼层 | 1 项目 = 1 楼层（独立地图），标签页切换 |
| 项目边界 | 独立 hive 数据目录 + 灵活 agent cwd（可操作多个仓库） |
| boss 职责 | 参考 iClaw 平台级 lead 角色（独占编排工具），但可以换人（员工晋升替代 boss）；默认纯编排，也支持 player-coach 模式 |
| agent 配置 | agent 级独立配置 MCP/skill |
| agent 模板 | 全局共享，参考 iClaw Skill 系统 |
| 项目创建 | 应用内新建 + 导入已有目录 |
| 跨项目通信 | 开放通信，消息标注"跨项目" |
| 全局 boss | 无，扁平结构（你 → 项目 boss → 员工） |

---

## 子需求 1：多项目数据模型 + 标签页切换（MVP · 一期）

**范围：**

- **Project 实体**：定义 Project 数据结构（id, name, harnessHome, cwd[], agents[], bossId, createdAt, status）
- **多 hive 共存**：HiveManager 从单例改为 `Map<projectId, HiveManager>`，每个项目独立 hive 目录、独立 registry、独立 router
- **项目 CRUD**：
  - 应用内新建：填项目名、选地图模板、选 boss 模板、配初始 agent → 创建项目目录 + hive
  - 导入已有目录：选择已有的 harnessHome 目录 → 识别为新项目
  - 删除/归档项目
- **标签页 UI**：顶部 tab 栏，每个 tab 对应一个项目，点击切换楼层视图
- **运行时切换**：切标签页 = 切活跃项目视图，所有项目的 agent 进程保持运行（PTY 不挂起）
- **IPC 路由**：IPC 调用携带 projectId，main 进程根据 projectId 路由到对应的 HiveManager

**不做的事：**
- 不做 agent 模板系统（子需求 2）
- 不做跨项目通信（子需求 4）
- 不做 boss 晋升（子需求 3）
- 不做程序化地图生成

**依赖：** 无

**建议迭代顺序：** 第 1 个

---

## 子需求 2：Agent 模板系统

**范围：**

- **模板数据结构**：参考 iClaw Skill 系统，每个模板是一个目录（SKILL.md + references/ + scripts/），定义 agent 的角色、MCP 列表、skill 列表、初始 prompt
- **模板存储**：全局模板库（app 级），支持内置模板 + 用户自定义模板 + 外部 Git 仓库引入
- **从模板创建 agent**：选模板 → 填充项目专属参数（name, cwd, 自定义 MCP/skill 覆盖）→ 创建 agent
- **模板管理 UI**：模板库浏览、安装、卸载、自定义编辑
- **模板克隆语义**：模板只定义初始配置，克隆出来的 agent 可以独立修改自己的 MCP/skill

**依赖：** 子需求 1（需要 Project 实体和 agent 创建流程）

**建议迭代顺序：** 第 2 个

---

## 子需求 3：Boss 模型演进（参考 iClaw lead 角色）

**范围：**

- **Boss 默认行为（参考 iClaw 平台级 lead 角色）**：
  - 独占编排工具（类比 iClaw 的 `team_spawn_agent`、`team_task_create`、`team_shutdown_agent` 等）
  - 读取任务板，分发给员工
  - 监控员工状态，处理阻塞
  - 门控：任务完成需要确认
  - **员工只有汇报和自管理能力**（类比 iClaw 的 `team_send_message`、`team_task_list/update`）
  - **硬约束**：不能绕过门控，不能替阻塞阶段做决策
- **与 iClaw 的关键差异：iClaw 的 lead 不能换，你可以换**
  - 右键员工 → "晋升为 boss" → 替代当前 boss，继承编排工具，保留原有 MCP/skill/cwd
  - 反向操作：把 player-coach boss 降级回普通员工，再拉一个新的纯编排 boss
- **Boss 模板分类**：模板层面区分"纯编排 boss"和"干活 boss"（如"项目经理"模板 = 纯编排，"研发组长"模板 = 编排 + 写代码）
- **创建项目时选 boss 模板**：选哪种 boss 模板都行，一步到位
- **Boss 状态可视化**：boss avatar 同时显示"编排状态"和"执行状态"（player-coach 模式下）

**依赖：** 子需求 2（需要模板系统支持 boss 模板分类）

**建议迭代顺序：** 第 3 个

---

## 子需求 4：跨项目通信

**范围：**

- **跨项目消息路由**：消息格式增加 `source_project` / `target_project` 字段，router 支持跨 hive 投递
- **联邦注册表**：app 级 `federation.json` 记录所有项目及其 agent，跨项目寻址基于此
- **跨项目标签**：UI 上跨项目消息标注"跨项目"来源，颜色/图标区分
- **上下文隔离**：跨项目消息不自动注入接收方的记忆/任务板，需要显式确认
- **信封动画**：跨项目信封飞出当前楼层 → 飞入目标楼层（标签页闪烁提醒）

**依赖：** 子需求 1（需要多项目运行时）

**建议迭代顺序：** 第 4 个

---

## 迭代顺序总览

```
子需求 1（多项目 + 标签页）
    ↓
子需求 2（Agent 模板系统）
    ↓
子需求 3（Boss 模型演进）
    ↓
子需求 4（跨项目通信）
```

每个子需求独立上线都有价值：
- 子需求 1 上线 = 能同时跑多个项目了
- 子需求 2 上线 = 能快速拉 agent 了
- 子需求 3 上线 = boss 能干活 + 能换人了
- 子需求 4 上线 = 项目之间能协作了

---

## 关键风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 多 hive 共存不是内存问题 | hive 层开销 ~几十字节/hive，可忽略 | 真正的瓶颈是 agent CLI 进程（每个 Claude Code ~100-300MB）。5 个项目 × 3 个 agent = 15 个 CLI 进程 ≈ 2.3GB，与 hive 数量无关 |
| Agent 进程数量限制 | 15 个 agent ≈ 2.3GB，50 个 agent ≈ 7GB | 非活跃项目的 agent 暂停 PTY（SIGSTOP/SIGCONT），只保留活跃 agent 进程 |
| 多 HiveManager 实例改造量 | 当前所有服务（router, memory, hookServer）都是单例 | 子需求 1 的核心工作，需要参数化改造 |
| 模板系统与 iClaw 的差异 | iClaw 是单进程 skill 注入，Munder Difflin 是 PTY 进程 spawn | 模板只定义配置，不注入运行时；spawn 时读取模板配置 |
| 跨项目通信的上下文污染 | 项目 A 的消息混入项目 B 的记忆 | 跨项目消息不自动注入记忆，需显式确认 |
