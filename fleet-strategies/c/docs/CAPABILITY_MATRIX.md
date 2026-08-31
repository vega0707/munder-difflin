# CAPABILITY_MATRIX

| 能力 | Munder 现状 | Aion | Multica | 本仓自研模块名 | 验收 |
|------|-------------|------|---------|----------------|------|
| 办公楼可视化 | ✅ | — | — | shell-munder | 手动 UI |
| assignee 看板 | ✅ | team_tasks | issues board | task-board | API+UI |
| God/Lead 编排 | Michael | Lead | squad leader | orchestrator | 回传消息 |
| 文件 inbox 协作 | ✅ | — | — | （可保留单机实现细节） | — |
| Team MCP/工具协作 | — | ✅ | CLI/API | team-tools | 契约测试 |
| wake/dispatch | Stop hook | ✅ Scheduler | assign→daemon | scheduler | 契约测试 |
| 远程 Web+鉴权 | 弱 | ✅ | ✅ | gateway-auth | e2e 登录 |
| Runtime 注册 | — | — | ✅ | runtime-registry | 双机模拟 |
| Claim 任务 | — | — | ✅ | claim-service | 并发 409 |
| Blocker→人 | 弱 | 待确认 | Inbox/review | decision-gate | 硬闸单测 |
| 执行日志 | 部分 | 部分 | ✅ | run-log | 只读 API |
| 多渠道 Slack 等 | 有 | 有 | 有 | channels | 延后 |

上游只读路径：运行 A/B 的 `bootstrap` 或本仓 `scripts/fetch-refs.sh` 到 `refs/`（gitignore）。
