# ARCHITECTURE — Strategy B

```
Electron (no auth) ──┐
                     ├──► fleet-gateway ──► fleet-daemon ──► CLI pty
Web (auth) ──────────┘         │
                               ├── RuntimeRegistry
                               ├── ClaimService
                               ├── DecisionGate
                               └── TeamWake (Aion-aligned)
```

## 对齐方式

- **Aion**：Gateway 形态、Team wake、待确认；用 `packages/fleet-protocol` 契约测试描述「给定 mailbox 事件 → 期望 wake」
- **Multica**：Runtime heartbeat/claim/blocker；同样用契约测试，实现纯 TS
- **Munder**：Shell + `tasks.json`/`HiveTask.assignee` 兼容层

## 本地单节点

daemon 启动 → `RuntimeRegistry.ensureLocal()` → 所有角色默认 owner=local user。
