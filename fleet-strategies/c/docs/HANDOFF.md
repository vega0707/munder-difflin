# HANDOFF — munder-fleet-c

## 定位

本仓是 **规格 + 自研 spike**，不是 fork 整合车间。A/B 负责「抄/合」；C 负责「就算零上游代码，产品定义也完整」。

## 立刻该做

1. 冻结 `PRODUCT_SPEC.md`（单一 Fleet、本地单节点、Munder 壳、assignee 看板、待定硬闸）
2. 写 `PROTOCOL.md`（JSON schema 级）
3. 填 `CAPABILITY_MATRIX.md`：从 Aion Team / Multica daemon / Munder hive 逐条映射到自研模块名
4. `spikes/single-node-fleet`：内存版 RuntimeRegistry + Claim（无 CLI 也可）

## 不要做

- 不要 git submodule 进 AionCore/Multica 当实现依赖
- 不要双模式
- 不要空口「对齐」——矩阵每行必须有验收

## 与 A/B 协同

- C 的 PROTOCOL 可作为 A/B 的验收 oracle
- A/B 若偏离 C 规格，先改 DECISIONS，再改规格
