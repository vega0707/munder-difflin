# AGENTS.md — munder-fleet-a

## 硬规则

1. **单一协议**：禁止添加 `solo`/`distributed` 模式枚举；本地 = 单节点。
2. **表现层品牌是 Munder**：不要把默认 UI 换成 AionUi。
3. **Multica 源码默认不 vendor**：实现 claim/runtime 时自己写；引用上游仅作行为对照。
4. **AionCore 变更要可追溯**：记录 fork 点 commit；保留 Apache-2.0 归属。
5. **先更新 `docs/DECISIONS.md` 再改架构方向**。
6. **断言上游 CLI 行为必须有依据**（抓包/文档/本仓测试）——继承 AionCore AGENTS 精神。

## 开工命令

```bash
./scripts/bootstrap-forks.sh
# 然后按 docs/HANDOFF.md
```
