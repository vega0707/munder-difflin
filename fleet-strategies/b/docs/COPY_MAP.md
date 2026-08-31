# COPY_MAP — Strategy B

## 直接抄（可进主仓的实现）

| 来源 | 内容 | 方式 |
|------|------|------|
| Munder | 几乎全部产品壳与 hive/pty | 本仓基线 |
| Aion 文档/行为 | auth cookie 模式、team tool 清单、wake 时序 | 重写为 TS + 契约测试 |
| Multica 文档/行为 | daemon 注册、claim、heartbeat、review | 重写为 TS + 契约测试 |

## 不整仓合入

| 来源 | 原因 |
|------|------|
| AionCore Rust 树 | 本策略坚持 TS 主栈；需要时当 `refs` 对照 |
| Multica server/ | 许可 + 栈；只对齐语义 |

## 可选择性拷贝的「小块」

- AionUi 远程访问文档中的安全头/CSRF 思路
- Multica CLI_AND_DAEMON 用户流程文案（重写进本仓 docs）
