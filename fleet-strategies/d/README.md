# munder-fleet-d — Strategy D（Multica 主核）

**一句话：** 以 **Multica fork/自托管** 做控制面与多机接活主核；**参考 Aion**（Team/CLI/关口/远程体验）与 **Munder**（办公楼壳、Michael、assignee 体验）；本地 = 单 daemon 节点。

| | |
|--|--|
| 策略代号 | **D** |
| 姊妹仓 | [`munder-fleet-a`](../munder-fleet-a) · [`b`](../munder-fleet-b) · [`c`](../munder-fleet-c) |
| 主核 | [multica-ai/multica](https://github.com/multica-ai/multica)（Go server + daemon + 工作区） |
| 参考 | AionCore/AionUi · Munder Difflin |
| 状态 | Scaffold / 交接就绪 |

## 和 A/B/C 的差别

| | A | B | C | **D（本仓）** |
|--|--|--|--|--|
| 主核 | AionCore | Munder TS | 规格自研 | **Multica** |
| 分布式 | 自研对齐 Multica | 自研对齐 | 规格 | **开箱用 Multica** |
| 最大风险 | Rust 栈 | 自研 claim | 慢 | **许可附加条件** |

## 许可红线（必读）

Multica License = Apache-2.0 + **Part I 附加条件**：未经商业许可，不得把源码做成对外托管服务，或作为商业产品的嵌入组件对外分发。  

本仓默认场景：

- ✅ 自用 / 组织内自托管接活平台  
- ⚠️ 对外 SaaS 或嵌入售卖 → **先法务 / 谈商业许可**，否则不要选 D 当对外产品内核  

对外品牌仍建议叫 **Munder**；文档可写 powered by / based on Multica（遵守 NOTICE）。

## 你要做什么

1. [`docs/HANDOFF.md`](./docs/HANDOFF.md)
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · [`docs/COPY_MAP.md`](./docs/COPY_MAP.md) · [`docs/LICENSE_NOTES.md`](./docs/LICENSE_NOTES.md)
3. `./scripts/bootstrap.sh` — clone Multica + Aion + Munder 到 `refs/`
4. 按 [`docs/ROADMAP.md`](./docs/ROADMAP.md)：自托管 Multica → 单机 daemon = 本地版 → 挂 Munder 壳 / Aion 能力对照清单

## 成功标准（P0）

- [ ] 本机 `multica setup self-host`（或 compose）跑通
- [ ] 一台机器 daemon 在线 =「本地版」故事可演示
- [ ] 文档写清：Munder 壳如何读 Multica 任务/assignee（API 或 iframe 过渡）
- [ ] Aion 能力差距表（Team MCP / 待确认）有 P1 计划
- [ ] `LICENSE_NOTES.md` 经负责人确认适用场景
