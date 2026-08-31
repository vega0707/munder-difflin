# Fleet Strategies — A / B / C 三仓交接索引

本目录是 **三条并行整合路线** 的脚手架与交接文档。  
目标产品：**Munder** 表现层 + 单一 Fleet 协议（本地 = 单节点，无 solo/distributed 双模式）+ 对齐/抄 Aion 与 Multica。

> Cloud Agent 的 GitHub token **不能** `createRepository`。  
> 完整独立 git 历史在本机 `/home/ubuntu/repos/munder-fleet-{a,b,c}`，并已打包到 artifacts。  
> 请用下方脚本在你有权限的账号下发布为三个 GitHub 仓库。

## 三仓怎么选

| 目录 | 策略 | 一句话 |
|------|------|--------|
| [`a/`](./a/) | **A 激进** | Fork **AionCore** 当主后端；Multica **语义重写** claim/runtime；Munder 做壳 |
| [`b/`](./b/) | **B 中等** | **Munder/TS** 主栈；用契约测试对齐 Aion/Multica 行为并模块化重写（最可能成主路径） |
| [`c/`](./c/) | **C 规格自研** | 不合上游源码；`PRODUCT_SPEC`/`PROTOCOL` 权威；spike 自研 |

每仓必读：`README.md` → `docs/HANDOFF.md` → `docs/COPY_MAP.md`。

## 已拍板（跨仓）

1. 本地是分布式的一种用法，**不要**两种模式开关  
2. 看板保持 **assignee**  
3. Electron 本机免鉴权；Web 必鉴权  
4. 待定列表 **硬闸**  
5. Multica 有附加许可条件 → **默认协议重写**，不整仓 vendor  
6. 产品品牌 **Munder**（不要用 munder-aion-multica 当对外名）

## 发布为三个 GitHub 仓库

```bash
# 在有 repo create 权限的机器上：
./fleet-strategies/scripts/publish-to-github.sh vega0707
```

或手动：

```bash
# 解压 artifacts 或使用 /home/ubuntu/repos/*
cd munder-fleet-a
gh repo create vega0707/munder-fleet-a --private --source=. --remote=origin --push
# 对 b、c 重复
```

## Artifacts

- `/opt/cursor/artifacts/fleet-strategies/munder-fleet-a.tar.gz`
- `/opt/cursor/artifacts/fleet-strategies/munder-fleet-b.tar.gz`
- `/opt/cursor/artifacts/fleet-strategies/munder-fleet-c.tar.gz`
