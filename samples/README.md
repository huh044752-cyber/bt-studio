# 样例资产与回归

每个样例最少包含:运行资产 `*.bt.xml`、编辑器 Meta `*.bt.meta.json`、绑定清单 `binding_manifest.json`、说明与预期。
用 `node samples/generate.mjs` 重新生成(基于 `@btstudio/bt-core`,保证与序列化器一致)。

## 样例清单

| 样例 | 覆盖点 | 预期 |
| --- | --- | --- |
| `sample_minimal_tree` | Root→Sequence→Action 最小可导出树 | 导出成功;Root.projectType=行为树 |
| `sample_condition_action_tree` | Selector + Condition + Action | 函数绑定齐全;导出成功 |
| `sample_blackboard_binding_tree` | 全局黑板 + Input source=blackboard | XML 含 `blackboardKey/variableKey`;黑板段 scope=global |
| `sample_loop_compare_tree` | DecoratorLoop(count) + Condition comparetype=Output | XML 含 `count` 与 `<Output op=.. value=../>` |
| `sample_parallel_threshold_tree` | Parallel + 成功/失败阈值 | XML 含 `successThreshold/failureThreshold` |
| `sample_subtree_ref_tree` | Subtree 引用(需在工程内补子树) | 引用存在则导出成功,缺失则 Error 阻断(见 import 回归) |
| `sample_behaviorlogic_linked_tree` | Linked FOSim 想定挂接 | 仅 Linked 模式;malType 完整方可发布 |
| `sample_legacy_import_repair_tree` | 历史 XML 含受限节点 | 导入为受限节点,进入映射修复,不可直接发布 |

> 前 5 个由 `generate.mjs` 自动生成完整产物;后 3 个为流程型样例,在 `回归与样例` 页与
> `bt-core` 测试中按场景构造(子树缺失阻断、Linked malType 校验、受限节点导入)。

## 回归目录(`samples/tests/regression`)

| 目录 | 阶段 | 入口 |
| --- | --- | --- |
| `export/` | 设计态→XML 导出 | `bt-core` `export.test.ts` + 前端 `回归与样例` 页 |
| `import/` | XML→设计态恢复 + 映射 | `importExport.test.ts` |
| `runtime/` | 独立宿主 Tick(mock / C++) | 调试页 mock;接引擎后用 SDK |
| `compat/` | BTXmlLoader 复读 | 结构层在 TS;端到端见 `docs/BUILD.md` |
| `linked_fosim/` | 发布 + BehaviorLogic 挂接 | `src-tauri` `behaviorlogic` cargo 测试 |

## 变更驱动规则(文档 §15.4)

- 新增节点类型 → 补样例 + compat/runtime 回归。
- 改 XML 导出字段 → 跑 loader 兼容回归。
- 改导入映射 → 跑 import 回归。
- 改挂接逻辑 → 跑 BehaviorLogic 回归。
