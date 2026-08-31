# munder-fleet-b — Strategy B（中等整合）

**一句话：** **主仓仍是 Munder/TypeScript 栈**；大段 **vendor/重写** Aion 的 auth·Team·wake 与 Multica 的 daemon/claim **状态机**；用测试向量对齐上游行为。

本地 = Fleet 单节点（无双模式）。

| | |
|--|--|
| 策略代号 | **B** |
| 姊妹仓（含 [`munder-fleet-d`](../munder-fleet-d)） | [`munder-fleet-a`](../munder-fleet-a) · [`munder-fleet-c`](../munder-fleet-c) |
| 主实现栈 | Electron · React · Node（延续 munder-difflin） |
| 状态 | Scaffold / 交接就绪 |

## 与 A/C 的差别

| | A | **B（本仓）** | C |
|--|--|--|--|
| 后端 | Fork AionCore（Rust）当主 | **Munder main/daemon（TS）** | 自研，仅设计对齐 |
| 抄法 | 合入 Aion 源码 | **行为对齐 + 模块级移植/重写** | 不抄代码 |
| 风险 | 双栈/Rust 人力 | 中等；最可能成为主产品路径 | 最慢 |

## 你要做什么

1. [`docs/HANDOFF.md`](./docs/HANDOFF.md)
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · [`docs/COPY_MAP.md`](./docs/COPY_MAP.md)
3. [`scripts/bootstrap.sh`](./scripts/bootstrap.sh) — 子模块或 clone munder-difflin 为工作树基线
4. 按 [`docs/ROADMAP.md`](./docs/ROADMAP.md) 把 Gateway / DecisionGate / Fleet claim 做进 TS daemon

## 许可

- Aion：移植思路与 API 形状 OK；若复制大段源码需 Apache-2.0 归属
- Multica：**协议重写**（许可限制托管/嵌入式商业分发）
- Munder：MIT 基线

## 成功标准（P0）

- [ ] 从 munder-difflin 抽出可无头运行的 daemon 进程
- [ ] Web 鉴权（密码/令牌 + 可选 OAuth 白名单）+ Electron 免鉴权
- [ ] PendingDecision 硬闸
- [ ] Runtime 自动注册（单节点）+ Task assignee 不变
- [ ] 文档中 Multica/Aion 对齐项有「行为验收」清单
