# COPY_MAP — 直接抄什么 / 不抄什么（Strategy A）

## 直接抄（fork / 合入）

| 来源 | 抄什么 | 目标位置 |
|------|--------|----------|
| **AionCore** | 整仓 fork 作主后端：Axum、JWT/CSRF、WS、session、ai-agent、team MCP、SQLite | `refs/AionCore` → 本组织 fork，本仓跟踪 |
| **AionCore team** | Lead/Teammate、mailbox、wake/dispatch、task MCP tools | 保留并扩展 Fleet |
| **AionUi（选择性）** | 远程 Web、待确认/权限 UI 模式、Team 状态展示 | 对照实现；移植到 Munder Web，不换皮 |
| **Munder Difflin** | 办公楼、Command Center、assignee 看板、设计 tokens、provider 列表体验 | `shell/` 或独立 munder 客户端仓连本 Core |

## 协议级重写（对齐测试向量，不整仓拷源码）

| 来源 | 重写什么 | 原因 |
|------|----------|------|
| **Multica** | Runtime 注册、heartbeat、task claim、blocker、review gate、execution log 生命周期 | 许可附加条件 + Go/Postgres 栈不合；语义最有价值 |

## 明确不抄

- Multica 完整 Next 工作区 UI（表现层用 Munder）
- AionUi 整站替换 Munder 楼层
- 第二套 `solo` 协议

## 许可操作清单

1. Aion fork：保留 `LICENSE`/`NOTICE`，衍生作品声明变更
2. Multica：只读公开文档与行为；实现自写；若考虑 vendor 源码 → **停下来做法务**
3. 对外产品名用 **Munder**，文档可写 “protocol aligned with Multica / powered by AionCore fork”
