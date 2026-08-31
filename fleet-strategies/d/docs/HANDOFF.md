# HANDOFF — munder-fleet-d

> 下一个 Agent/人类：以 Multica 为主核开工。

## 背景

A/B/C 之外补 **D**：用户追问「为什么不以 Multica 为主」。结论是——**可以，而且分布式最强**；代价是许可与栈，以及 Munder/Aion 体验要外挂。

跨策略仍成立：

- 无 `solo|distributed` 开关；本地 = 单 runtime/daemon  
- 看板语义尽量保持 **assignee**  
- Electron 本机免鉴权（若壳是 Munder）；连 Multica Web 则走 Multica 鉴权  
- 品牌对外：Munder  

## 立刻该做

1. 读 `LICENSE_NOTES.md`，确认使用场景（组织内自托管 vs 对外产品）
2. `./scripts/bootstrap.sh`
3. 按 Multica `SELF_HOSTING.md` 起 server + `multica daemon start`
4. 映射概念：

| Munder / 讨论用语 | Multica |
|-------------------|---------|
| Michael | Squad leader / 编排 agent |
| Runtime | daemon × CLI |
| Claim | assign / agent pickup |
| PendingDecision | Inbox / review gate / 需人拍板 |
| 角色 vega | Agent + member 权限 |

5. 在 `shell/` 写清 Munder 壳接入方式（P0 可先 deep-link / API 只读看板）
6. 在 `adapters/aion-gap.md` 列出要参考 Aion 补的能力（Team 会话质感、关口 UX）

## 不要做

- 未看法务就把 Multica 当对外 SaaS 内核卖
- 用 Multica UI 永久替换 Munder 品牌却不改名（产品叙事混乱）
- 同时大改 Multica 服务端 + 重写 daemon（先上游默认路径跑通）

## 姊妹仓

- A：AionCore 主核（若 D 许可不通可回退）  
- B：TS 自研对齐（许可最干净的工程路径之一）  
- C：规格 oracle  
