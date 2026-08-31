# Fleet Strategies — A / B / C / D 交接索引

本目录是 **四条并行整合路线** 的脚手架与交接文档。  
目标：**单一 Fleet 协议**（本地 = 单节点）+ 按策略选择主核。

> Cloud Agent 的 GitHub token **不能** `createRepository`。  
> 独立 git：`/home/ubuntu/repos/munder-fleet-{a,b,c,d}`；artifacts 已打包。  
> 有写权限时：`./fleet-strategies/scripts/publish-to-github.sh vega0707`

## 怎么选

| 目录 | 策略 | 一句话 |
|------|------|--------|
| [`a/`](./a/) | **A** | Fork **AionCore** 主后端；Multica 语义自研；Munder 壳 |
| [`b/`](./b/) | **B** | **Munder/TS** 主栈；契约对齐 Aion/Multica |
| [`c/`](./c/) | **C** | 规格权威 + 自研；零上游源码 |
| [`d/`](./d/) | **D** | **Multica 主核**；参考 Aion + Munder 壳（分布式最强；注意许可） |

每仓：`README.md` → `docs/HANDOFF.md` → `docs/COPY_MAP.md`（D 另读 `LICENSE_NOTES.md`）。

## 已拍板（跨仓）

1. 本地是分布式单节点，**不要**双模式开关  
2. 看板保持 **assignee**  
3. 品牌对外 **Munder**  
4. Electron 本机免鉴权（Munder 壳）；Web/上游控制台按各主核鉴权  
5. Multica 作**主核（D）**或**语义来源（A/B）**时都要读其附加许可条件  

## 发布

```bash
./fleet-strategies/scripts/publish-to-github.sh vega0707
```

## Artifacts

`/opt/cursor/artifacts/fleet-strategies/munder-fleet-{a,b,c,d}.tar.gz`
