# AGENTS.md — munder-fleet-b

1. 保持 TypeScript/Electron 主栈；Rust 仅 refs 对照。
2. 每个对齐上游的行为必须有契约测试（输入→期望状态），禁止「看起来像」。
3. 禁止 `solo|distributed` 模式旗标。
4. Multica 源码默认不进 `packages/`。
5. 架构变更先写 `docs/DECISIONS.md`。
