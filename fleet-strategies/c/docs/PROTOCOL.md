# PROTOCOL — Fleet wire（草案）

## 原则

- 单一协议；节点数 ≥ 1
- Task.assignee 为权威「谁做」
- PendingDecision.ownerId 为权威「谁拍板」

## 资源（逻辑）

### Runtime
```json
{
  "id": "rt_...",
  "ownerUserId": "user_...",
  "hostLabel": "vega-mbp",
  "clis": ["claude", "codex", "cursor"],
  "lastHeartbeatAt": "ISO-8601",
  "status": "online|offline"
}
```

### Task（兼容 Munder HiveTask）
```json
{
  "id": "task_...",
  "projectId": "proj_...",
  "title": "...",
  "assignee": "agent_or_role_id",
  "status": "todo|doing|blocked|done",
  "claimedByRuntimeId": null,
  "result": null
}
```

### PendingDecision
```json
{
  "id": "pd_...",
  "projectId": "proj_...",
  "taskId": "task_...",
  "runtimeId": "rt_...",
  "ownerId": "user_...",
  "kind": "tool_permission|clarification|destructive|brainstorm",
  "prompt": "...",
  "status": "pending|resolved|rejected"
}
```

### Claim
`POST /runtimes/{id}/claims { taskId }` → 原子占用；冲突 409。

### Heartbeat
`POST /runtimes/{id}/heartbeat` 每 15s 量级。

## 非目标报文

不在此协议复制 Multica/Aion 的私有帧；仅保证语义可对拍 CAPABILITY_MATRIX。
