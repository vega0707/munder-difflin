# HANDOFF — munder-fleet-b

## 背景

同 A/C：整合 Munder 表现层 + Aion 交互/远程能力 + Multica 多机接活；**单一 Fleet 协议**，本地是单节点。

本仓选 **B**：不换 Rust 主后端，在 **Munder TS** 上把关键能力做成可测模块。

## 为何可能是「主路径」

- 与现有 `vega0707/munder-difflin` 工程师技能栈一致
- 办公楼/Pixi/hive 资产不搬家
- 仍能「直接抄」Aion/Multica 的**行为与模块边界**，用契约测试锁住

## 立刻该做

1. `./scripts/bootstrap.sh` — 获取 munder-difflin 基线与上游对照
2. 设计 `packages/fleet-daemon`：从 `src/main/*` 抽 hive/pty/hooks/control
3. 设计 `packages/fleet-gateway`：HTTP/WS + auth（SQLite sessions）
4. 移植对象：`Runtime` / `PendingDecision` / claim API（对齐 `refs/multica` 文档与 `refs/AionCore` team 语义）
5. Electron 连 daemon；Web 鉴权连同一 gateway

## 不要做

- 不要引入第二模式开关
- 不要整仓合并 Multica Go 服务
- 不要为了对齐 Aion 而丢掉 assignee 看板

## 模块建议（monorepo）

```
apps/shell-electron/     # 现 Munder Electron
apps/shell-web/          # 鉴权 Web
packages/fleet-daemon/   # pty + hive + decision gate
packages/fleet-gateway/  # auth + REST/WS
packages/fleet-protocol/ # 共享类型与契约测试
refs/                    # 上游对照（gitignore）
```
