# ROADMAP — Strategy A

## P0 — Core 立住 + 单节点 Fleet

- Fork AionCore，钉版本，跑通健康检查与 JWT
- 扩展最小 Fleet 表/类型：Runtime、PendingDecision
- 本机自动 register runtime
- Munder 或最小壳：登录（Web）/免登（loopback）、任务列表、待定列表
- DoD：单机 claim→干活→完成回传可演示

## P1 — Team 协作（Aion）

- 打通 Team MCP wake；Michael/Lead 收 idle/完成
- DecisionGate：pending 时拒绝/挂起新工具
- Electron 本机免鉴权通道冻结

## P2 — 多机（Multica 语义）

- 第二台机器 runtime 注册 + heartbeat
- 手动 claim + 自动 claim（并发上限）
- Blocker 只推给 role owner
- 项目内看板只读可见他人进行中任务（assignee 模型不变）

## P3 — 产品化

- 穿透文档（自备，不内置）
- 执行日志/用量（可对齐 Multica 能力清单）
- 从 Munder 迁移 hive 任务导入

## 非目标（本仓一期）

- 公有云代跑 agent 算力
- 内置 frp/ngrok 一键隧道
- 完整 Pixi 楼移植进 AionUi
