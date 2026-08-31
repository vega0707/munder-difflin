# PRODUCT_SPEC — Munder Fleet（Strategy C 权威规格草案）

## 愿景

一个人或一支队伍，用 **Munder** 办公楼/看板驾驭本机（及多机）上的真实 coding CLI agent：派活、接活、拍板、回传。本地开箱即用；多机不换协议。

## 非目标

- 公有云代跑密钥与代码（默认）
- 用 AionUi/Multica UI 替换 Munder 表现层
- `solo|distributed` 双协议

## 角色

| 角色 | 职责 |
|------|------|
| 主控人类 | 建项目、看全局看板、解自己的待定（本地即全部） |
| Michael（编排者） | 拆活、assignee、收完成 |
| 角色（如 vega/开发） | 绑定 runtime/CLI；claim；开发中问题问主人 |
| Runtime | 某机器上可用的 CLI 执行器 |

## 功能需求

1. **Task 看板**：沿用 assignee + todo/doing/blocked/done；全员只读可见进行中；接活按角色/claim 策略
2. **PendingDecision 硬闸**：权限/澄清/破坏性操作；owner 未解不得继续工具
3. **Runtime 注册与 heartbeat**
4. **Claim**：手动 + 自动（并发上限）
5. **完成回传** Michael
6. **鉴权**：本机 Electron 免；Web 必；密码/令牌 + 可选 OAuth 白名单
7. **穿透**：文档自备，产品不内置一期

## 验收故事（本地）

给定仅一台电脑：启动 → 自动 runtime → Michael 派卡到 vega → vega claim → 遇 ambiguity 进待定 → 人在列表拍板 → 完成后 Michael 收到结果。

## 验收故事（多机）

开发机与测试机各注册 runtime；测试角色只解自己的 blocker；开发只读可见测试进行中任务。
