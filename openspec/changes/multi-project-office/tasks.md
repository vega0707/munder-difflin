# 任务清单：多项目多 Hive

实现步骤与验收表以 plan 为准：`docs/superpowers/plans/2026-08-31-multi-project-office.md`  
设计：`openspec/changes/multi-project-office/design.md`  
**自动化用例：** 见 plan §自动化用例（此处不抄表）

| ID | plan | 里程碑 |
| --- | --- | --- |
| T1 | Task 1 | Shared 类型 + PersistStore `projects` 表 |
| T2 | Task 2 | HiveManager 以 projectRoot 为根 |
| T3 | Task 3 | PtyManager 按项目暂停 / 恢复 / 计数 |
| T4 | Task 4 | ProjectRegistry + 旧版迁移 |
| T5 | Task 5 | 项目生命周期 IPC + preload |
| T6 | Task 6 | hive / pty IPC 按 projectId 路由 |
| T7 | Task 7 | HookServer 与共享服务按项目找实例 |
| T8 | Task 8 | 切换编排与并发上限收口 |
| T9 | Task 9 | Store + useHive 按项目分区 |
| T10 | Task 10 | 标签栏、对话框、OfficeFloor |
| T11 | Task 11 | 去掉缺省回退 + 回归 |

依赖：T1 → T2 / T3 → T4 → T5 → T6 → T7 / T8 → T9 → T10 → T11。T2 与 T3 可并行。
