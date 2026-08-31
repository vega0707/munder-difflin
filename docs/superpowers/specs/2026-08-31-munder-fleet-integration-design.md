# Munder Fleet 整合设计（跨 A/B/C/D 策略）

**日期：** 2026-08-31  
**状态：** 已拍板方向；实现分四仓并行  
**品牌：** Munder（对外）

## 1. 产品命题

做一个「很大」的 agent 办公产品：

- **表现层**：Munder Difflin（办公楼、Command Center、assignee 看板）
- **控制/远程**：AionCore / AionUi 能力（主核或参考，视策略）
- **多机接活**：Multica runtime / claim / blocker / review（主核或语义，视策略）

**本地版不是第二种模式**，而是 **Fleet 协议在节点数=1 时的默认拓扑**。

## 2. 四仓策略

| 仓 | 策略 | 主动作 |
|----|------|--------|
| `munder-fleet-a` | 激进 | Fork AionCore 为主后端；Multica 语义自研；Munder 壳 |
| `munder-fleet-b` | 中等 | Munder TS 抽 daemon/gateway；契约对齐 Aion/Multica |
| `munder-fleet-c` | 规格 | 自研规格权威 + spike；零上游源码合入 |
| `munder-fleet-d` | Multica 主核 | Fork/自托管 Multica；参考 Aion；Munder 壳（**先读许可**） |

脚手架与交接：[`fleet-strategies/`](../../fleet-strategies/README.md)。

## 3. 统一对象

`Project` · `Task(assignee)` · `Runtime` · `Role` · `PendingDecision(owner)` · `Michael/Orchestrator`

## 4. 许可

- Aion*：Apache-2.0 — fork 需保留归属  
- Multica：Apache-2.0 + **附加条件**（限制对外托管/嵌入式商业分发）  
  - 作**语义来源（A/B）**：默认协议重写  
  - 作**主核（D）**：组织内自托管默认；对外 SaaS/嵌入需法务/商业许可  
- Munder：按该仓 LICENSE

## 5. 非目标（一期）

内置穿透、公有云代跑、双模式开关、用 AionUi 永久换掉 Munder 品牌皮。

## 6. 下一步

1. 有写权限账号执行 `fleet-strategies/scripts/publish-to-github.sh`  
2. 四人/四 Agent 各认领一仓按 `docs/HANDOFF.md` 开工  
3. 用 C 的 PROTOCOL/MATRIX 给 A/B/D 做对齐评审  
