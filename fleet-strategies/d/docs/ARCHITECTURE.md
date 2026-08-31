# ARCHITECTURE — Strategy D

```
┌──────────────────────────────────────────────────────────┐
│ MUNDER SHELL（可选一期 / 必做品牌层）                       │
│ 办公楼 · Command Center · 本机免鉴权 Electron               │
│ 通过 API / WS / 嵌入 消费 Multica 工作区状态                 │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│ MULTICA CONTROL PLANE（主核）                              │
│ Go server · Postgres · Issues/Tasks · Inbox · Review     │
│ Web/Desktop（可过渡使用）· Auth · Workspaces               │
└───────────────┬────────────────────────────▲─────────────┘
                │ assign / wake                │ heartbeat / claim result
┌───────────────▼────────────────────────────┴─────────────┐
│ MULTICA DAEMON（每台机器）                                  │
│ 检测 CLI · 注册 runtime · 执行 · 日志回传                    │
│ 本地版 = 仅 1 个 daemon                                     │
└──────────────────────────────────────────────────────────┘
        │
        ▼
  Claude / Codex / Cursor / …（参考 Aion 的 ACP/会话体验作增强）
```

## 本地退化

组织内一台电脑：server（可 docker）+ 本机 daemon → 即「本地版」。  
不必第二套 hive 协议；Munder hive 仅作迁移来源或壳内可视化。

## Aion 参考挂载点

- 关口拍板 UX → 映射 Multica Inbox/review + 壳内待定列表  
- Team MCP 细粒度工具 → P1/P2 评估是做 Multica skill 还是旁路 gateway  
- 远程 Web 鉴权 → 优先用 Multica 已有；Munder Web 作品牌壳时再桥接 session  
