# munder-fleet-c — Strategy C（设计对齐 · 自研实现）

**一句话：** **不合并、不 vendor** Aion/Multica 代码；产品与协议在文档层对齐它们的能力清单，实现全部自研（可从 Munder 长出来）。

适合：法务最保守、要完全自主 IP、或先用文档把「牛逼产品」规格锁死再写。

| | |
|--|--|
| 策略代号 | **C** |
| 姊妹仓 | [`munder-fleet-a`](../munder-fleet-a) · [`munder-fleet-b`](../munder-fleet-b) |
| 状态 | Scaffold / 规格仓优先 |

## 你要做什么

1. [`docs/HANDOFF.md`](./docs/HANDOFF.md)
2. 完善 [`docs/PRODUCT_SPEC.md`](./docs/PRODUCT_SPEC.md) 与 [`docs/PROTOCOL.md`](./docs/PROTOCOL.md)
3. 用 [`docs/CAPABILITY_MATRIX.md`](./docs/CAPABILITY_MATRIX.md) 对拍 Aion/Multica/Munder（只读上游）
4. `spikes/` 里做最小自研原型（可依赖 Munder 作 submodule）
5. **禁止**把上游源码拷进本仓 `src/`

## 成功标准（规格阶段）

- [ ] PRODUCT_SPEC 无 TBD 关键需求
- [ ] PROTOCOL 定义 Runtime/Claim/PendingDecision/Task 消息
- [ ] CAPABILITY_MATRIX 每行有「自研验收方式」
- [ ] 至少一个 spike：单节点 register + claim 假驱动

## 许可

只读上游；实现自有。产品名 Munder。Multica/Aion 仅出现在「对齐说明」。
