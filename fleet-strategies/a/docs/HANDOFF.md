# HANDOFF — munder-fleet-a

> 给下一个人类或 Cloud Agent：读完本文即可开工，无需回放原对话。

## 背景（从哪来）

产品方要把 **Munder Difflin（表现层）**、**Aion 系（Core/远程/Team）**、**Multica（多机接活）** 整合成一个大产品。

拍板要点：

1. **不要双模式**；本地 = Fleet 协议的单节点部署。
2. **三条路线并行探索**：A 激进 / B 中等 / C 自研对齐——本仓是 **A**。
3. 看板保持 Munder 的 **assignee** 模型；最多以后加「按角色筛选」。
4. Electron **本机免鉴权**；Web/远程 **必鉴权**。
5. HITL：**待定列表硬闸**（不清则卡住后续工具），本地全部 owner=你。

原讨论仓：`vega0707/munder-difflin`（分支规划：`cursor/fleet-strategies-abc-d985`）。

## 本仓目标

把 **AionCore 变成主后端**，在其上实现 Multica 风格的 runtime/claim，Munder 只做 UI 壳。

## 立刻该做的事（按序）

1. `./scripts/bootstrap-forks.sh` —— 拉取上游到 `refs/`（不提交）
2. 在 `refs/AionCore` 按上游文档跑通 `cargo`/`just` 健康检查
3. 画清适配层：`src/` 里只放「Munder IPC/Web → AionCore HTTP/WS」与「Multica 语义类型」
4. 实现最小对象：`Runtime{id,host,clis[],ownerId}` + `Task.assignee` + `PendingDecision`
5. Spike：单机自动 register runtime；创建一个 task；claim；完成回传

## 明确不要做的事

- 不要用 AionUi 替换 Munder 办公楼作为默认壳（AionUi 仅对照远程/待确认交互）
- 不要整仓拷贝 Multica 进产品做对外 SaaS（许可附加条件）；协议重写
- 不要再引入 `solo|distributed` 配置枚举
- 不要在未读 `COPY_MAP.md` 前大面积合并上游

## 交接检查清单

- [ ] 上游 clone 成功，版本钉在 `refs/VERSIONS.md`（bootstrap 脚本生成）
- [ ] P0 勾选见 README
- [ ] 有问题记入 `docs/DECISIONS.md` 新条目，不要只留在聊天里

## 联系语境

- 表现层品牌：**Munder**
- 编排者角色名可继续叫 **Michael**（映射 Aion Lead / Multica squad leader）
- 分布式接活：角色（如 vega/开发）绑定本机 CLI（Claude/Codex/Cursor），手动或自动 claim，问题问 **该角色主人**，完成后回传 Michael
