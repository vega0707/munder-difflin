# 给其他 Agent 的初始化提示词

脚手架在本仓（`munder-difflin`）分支 `cursor/fleet-strategies-abc-d985`：

- `fleet-strategies/a|b|c|d/`
- 设计：`docs/superpowers/specs/2026-08-31-munder-fleet-integration-design.md`

目标空仓（需 Agent **有 push 权限**）：

- https://github.com/vega0707/munder-fleet-a
- https://github.com/vega0707/munder-fleet-b
- https://github.com/vega0707/munder-fleet-c
- https://github.com/vega0707/munder-fleet-d

---

## 通用前置（每个 Agent 先做）

1. 从 `vega0707/munder-difflin` 拉取分支 `cursor/fleet-strategies-abc-d985`（或 main，若已合并）。
2. 将对应 `fleet-strategies/<x>/` **整目录**作为目标仓初始内容 push 到 `munder-fleet-<x>` 的 `main`。
3. 再读该仓 `docs/HANDOFF.md`，按 ROADMAP 的 P0 继续。

跨策略共识（勿违反）：

- 本地 = Fleet **单节点**，禁止 `solo|distributed` 双模式
- 看板保持 **assignee**
- 对外品牌 **Munder**
- Electron 本机免鉴权；Web 必鉴权
- Multica 附加许可：A/B 默认协议重写；D 作主核须读 `LICENSE_NOTES.md`

---

## Agent A — `munder-fleet-a`

```
你负责仓库 https://github.com/vega0707/munder-fleet-a（Strategy A：AionCore 主核）。

初始化：
1. Clone https://github.com/vega0707/munder-difflin ，checkout 分支 cursor/fleet-strategies-abc-d985（若已合 main 则用含 fleet-strategies/ 的最新 main）。
2. 用目录 fleet-strategies/a/ 的全部文件初始化/覆盖 munder-fleet-a 的 main 并 push（保留 README、docs/、AGENTS.md、scripts/）。
3. 阅读 docs/HANDOFF.md、ARCHITECTURE.md、COPY_MAP.md、ROADMAP.md。
4. 运行 scripts/bootstrap-forks.sh，把上游 clone 到 refs/（勿提交大树）。
5. 按 ROADMAP P0：钉住 AionCore fork 点、跑通健康检查；扩展 Runtime + PendingDecision；单机自动 register；最小壳或文档说明如何连 Munder。
6. Multica 只做语义对齐/协议重写，不要整仓 vendor Multica 源码。
7. 不要引入 solo|distributed 模式开关。工作结束时更新 docs/DECISIONS.md 并保证 typecheck/文档可交接。
```

---

## Agent B — `munder-fleet-b`

```
你负责仓库 https://github.com/vega0707/munder-fleet-b（Strategy B：Munder/TS 主栈 + 契约对齐）。

初始化：
1. Clone https://github.com/vega0707/munder-difflin ，checkout 分支 cursor/fleet-strategies-abc-d985（或已合并的 main）。
2. 用 fleet-strategies/b/ 初始化并 push 到 munder-fleet-b 的 main。
3. 阅读 docs/HANDOFF.md、ARCHITECTURE.md、COPY_MAP.md、ROADMAP.md。
4. 运行 scripts/bootstrap.sh，拉取 refs（munder-difflin / AionCore / multica）。
5. 按 ROADMAP P0：从 munder-difflin 设计 packages/fleet-daemon、fleet-gateway、fleet-protocol；实现无头 daemon、Web 鉴权、loopback 免鉴权、PendingDecision 硬闸、Runtime.ensureLocal()。
6. 用契约测试对齐 Aion wake / Multica claim 行为；禁止 vendor Multica 整仓源码。
7. 无双模式。保持 Task.assignee。提交清晰、可给下一任继续。
```

---

## Agent C — `munder-fleet-c`

```
你负责仓库 https://github.com/vega0707/munder-fleet-c（Strategy C：规格权威 + 自研 spike）。

初始化：
1. Clone https://github.com/vega0707/munder-difflin ，checkout 分支 cursor/fleet-strategies-abc-d985（或已合并的 main）。
2. 用 fleet-strategies/c/ 初始化并 push 到 munder-fleet-c 的 main。
3. 阅读 docs/HANDOFF.md、PRODUCT_SPEC.md、PROTOCOL.md、CAPABILITY_MATRIX.md。
4. 禁止把 Aion/Multica 源码拷进实现目录；refs 仅只读对照。
5. P0：消除 PRODUCT_SPEC/PROTOCOL 中的含糊处；补全 CAPABILITY_MATRIX 每行验收；实现 spikes/single-node-fleet 内存版 register→claim→complete。
6. 本仓规格是 A/B/D 的验收 oracle；与实现仓冲突时先改 DECISIONS 再改规格。
7. 无双模式。提交后在 README 写明「规格已冻结到哪一节」。
```

---

## Agent D — `munder-fleet-d`

```
你负责仓库 https://github.com/vega0707/munder-fleet-d（Strategy D：Multica 主核，参考 Aion + Munder 壳）。

初始化：
1. Clone https://github.com/vega0707/munder-difflin ，checkout 分支 cursor/fleet-strategies-abc-d985（或已合并的 main）。
2. 用 fleet-strategies/d/ 初始化并 push 到 munder-fleet-d 的 main。
3. 先读 docs/LICENSE_NOTES.md 并确认适用场景（默认组织内自托管；对外 SaaS/嵌入需法务）。
4. 阅读 docs/HANDOFF.md、ARCHITECTURE.md、COPY_MAP.md、ROADMAP.md。
5. 运行 scripts/bootstrap.sh；按 Multica SELF_HOSTING 跑通 server + 单机 daemon（=本地版故事）。
6. 填写 shell/README.md（Munder 壳如何读任务/runtime）；更新 adapters/aion-gap.md。
7. 不要并行再造一套 claim 总线；主核就是 Multica。无双模式。
```

---

## 一键「只推脚手架」短提示（若空仓仍空）

```
从 vega0707/munder-difflin 的 cursor/fleet-strategies-abc-d985 取出 fleet-strategies/<LETTER>/，
作为唯一内容 push 到 vega0707/munder-fleet-<LETTER> 的 main。
不要改策略含义。完成后回复仓库 URL 与最新 commit。
```

把 `<LETTER>` 换成 `a` / `b` / `c` / `d`。
