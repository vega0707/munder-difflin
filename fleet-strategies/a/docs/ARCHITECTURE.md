# ARCHITECTURE — Strategy A

## 分层

```
┌─────────────────────────────────────────────────────────┐
│ MUNDER SHELL                                             │
│ Electron（本机免鉴权）· Web（鉴权）· 办公楼 · assignee 看板 │
│ 待定列表 · Command Center                                 │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP/WS（本机可走 loopback 免登）
┌──────────────────────────▼──────────────────────────────┐
│ AIONCORE FORK（主后端）                                   │
│ auth · realtime · session/CLI lifecycle · Team MCP/wake  │
│ + Fleet 扩展：RuntimeRegistry · Claim · Blocker→Owner    │
└──────────────────────────┬──────────────────────────────┘
                           │ spawn / ACP / pty
┌──────────────────────────▼──────────────────────────────┐
│ LOCAL AGENT CLIs                                         │
│ Claude Code · Codex · Cursor · …                         │
└─────────────────────────────────────────────────────────┘
```

多机时：每台机器跑 **同一 Core 的 daemon 模式** 或 **轻量 runtime agent** 连中央 Core；语义对齐 Multica（heartbeat、claim、execution log），实现落在本 fork 内。

## 核心对象（统一，无第二套）

| 对象 | 含义 |
|------|------|
| `Project` | 边界（看板/角色/任务） |
| `Task` | 与 Munder `HiveTask` 对齐：`assignee`、`status`、`humanQA` |
| `Runtime` | `daemon × 已安装 CLI`（Multica 概念） |
| `Role` | 项目内身份（开发/测试…），绑定 ownerUser + 可选 runtime |
| `PendingDecision` | 硬闸项；`ownerId` 决定谁能解 |
| `Michael` | 编排者（god/lead）；收完成汇报 |

## 本地退化

启动时若发现无 runtime：自动注册 `runtime:local`，`ownerId=local-user`。  
所有 PendingDecision.ownerId 指向该用户 → UI 仍是一张待定列表。

## 与 Hive 文件协议的关系

Strategy A **不以** 文件 inbox 为跨机总线。单机可短期保留 hive 目录作兼容/迁移，目标态协作走 Core API + Team MCP（Aion）及 Fleet claim（Multica 语义）。
