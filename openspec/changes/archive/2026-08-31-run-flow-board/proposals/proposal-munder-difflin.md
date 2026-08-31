# 需求提案：流程 Run 看板 - munder-difflin

## 1. 上下文
在命令中心新增「流程」Tab：hive 内 Run 投影为权威故事线；步骤 1:1 task；失败从失败步起重试；默认不抢焦点。不替换任务/动态。

## 2. 职责边界
- **做**：Run 投影 + tasks/log/send 钩子；Run IPC；Flow Tab（总览/看板/详情/重试）；shared 类型；node:test。
- **不做**：替换任务/动态；对比/导出；双轨步骤；细碎状态；空态派发台；SQLite/Baiji；UI 写 worker inbox。

## 3. 依赖
- `tasks.json` / `log.jsonl` / `hiveSend` / `board.md` 既有路径；Flow 优先投影 API。

## 4. Phase
- A 投影+钩子 → B Flow UI → C 总览+历史 → D 重试编排

## 5. 建议触及
- `src/main/hive.ts`、`src/main/index.ts`、新投影模块
- `src/preload/index.ts`
- `CommandCenterPanel.tsx` + Flow 组件
- `src/shared/` Run/Step 类型
- `test/*.test.cjs` 契约与结构检查

详见 `openspec/changes/run-flow-board/design.md` 与 plan。
