# 架构说明

## 三层类型包(总设计文档 §6.0)

1. **运行态(真相源,导出目标)** — `bt-core/src/types/runtime.ts`:`BehaviorTreeDef` / `BTNodeDef` / `BTNodeKind` / `InputBinding` / `OutputBinding` / `ModelSelector` / `BlackboardDef` / `BlackboardValue` / `BTStatus`,与 FOSimEngine 头文件字段一一对应。
2. **设计态 / UI** — `editor.ts`:`TreeDesignDocument` / `DesignTree` / `DesignNode` / `DesignEdge` / `EditorMeta` / `GraphDocument` 等;不进运行 XML。
3. **目录 / 流程** — `catalog.ts` / `mal.ts`:函数/变量/类型目录、`FZMARGType`、`Issue`、`ImportMappingReport`、工程包、控制台日志。

## 核心引擎模块(`packages/bt-core`)

| 模块 | 职责 |
| --- | --- |
| `model/` | 设计态工厂、稳定 ID、变量 key 合法化 |
| `registry/` | Node Registry:内置节点表、端口规则、属性 Schema、可发布/受限判定 |
| `command/` | Graph Command Bus:所有编辑动作唯一入口,快照式 undo/redo,连接预检(端口占用/循环/容量) |
| `validation/` | Validation Engine:结构/绑定/MAL/子树/黑板/导出兼容,Error 阻断 |
| `mal/` | displayType↔malType 映射、MAL 值转换校验、比较兼容性 |
| `export/` | `DesignTree→BehaviorTreeDef→*.bt.xml`(严格对齐 loader)+ meta + binding manifest |
| `import/` | `XML→BehaviorTreeDef→DesignTree` + 四级映射修复报告 |
| `layout/` | 层级自动布局(只改 EditorMeta) |

## 前端(`apps/desktop`)

- `stores/`:`workspace`(树/目录/命令/校验/导出)、`console`(审计日志)。
- `composables/useGraphEditor`:X6 生命周期;画布事件 → Graph Command(不直接改 store)。
- `components/`:`palette`(节点库,Registry 驱动)、`properties`(Schema 驱动属性面板)、`problems`、`console`、`common/ActionButton`(§18.10 按钮状态机)。
- `services/tauri`:Tauri invoke 封装 + 浏览器降级。
- 10 个页面见 `pages/`。

## 本地服务层(`apps/desktop/src-tauri`,Rust)

`fs_ops`(原子写入)、`zip_ops`(工程包)、`workspace_scan`(ModelDatabase/ScenarioSource)、`behaviorlogic`(冲突策略/备份/回滚)、`runtime`(stub,接 C++ SDK)。

## 导出/导入数据流

```
GraphDocument → TreeDesignDocument → BehaviorTreeDef → *.bt.xml → (BTXmlLoader 复读)
*.bt.xml → BehaviorTreeDef → TreeDesignDocument → 映射修复 → 可编辑
```

## 关键边界

- 保存 ≠ 导出;发布 ≠ 导出(发布才写工程/挂接)。
- `treeId`/`nodeId` 是编辑器稳定 ID;导出时映射到 `BehaviorTreeDef.name`/`BTNodeDef.id`。
- 前端不接触 `FZMalImpl`;MAL 构造在 C++ Runtime Adapter。
