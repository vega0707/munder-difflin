# COPY_MAP — Strategy D

## 直接抄 / fork（主核）

| 来源 | 内容 | 注意 |
|------|------|------|
| **Multica** | server、daemon、CLI、任务生命周期、runtime、自托管部署 | 遵守 Multica License Part I；保留 NOTICE |
| **Multica docs** | daemon-runtimes、assigning、review、inbox | 本仓 ROADMAP 的验收来源 |

## 参考实现（不默认整仓合入）

| 来源 | 参考什么 | 用法 |
|------|----------|------|
| **Munder** | 办公楼、Michael、assignee 看板交互、设计 tokens | `shell/` 客户端；API 适配 |
| **AionCore / AionUi** | Team wake、权限/AskUser 关口、远程会话 | 差距表 + 选择性移植到壳或 Multica skill |
| **Aion aionrs** | 多 provider CLI 编排细节 | 对照 daemon 执行质量 |

## 不抄

- 再实现一套与 Multica 并行的 claim 总线（除非弃 D）  
- 把 AionCore 再当第二主核（那是策略 A）  
