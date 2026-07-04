/**
 * @btstudio/bt-core — BT Studio 核心引擎对外入口。
 * 纯 TS,无 DOM / Tauri 依赖,可被前端与测试直接消费。
 */

// 类型
export * from "./types/mal.js";
export * from "./types/runtime.js";
export * from "./types/editor.js";
export * from "./types/catalog.js";

// 模型
export * from "./model/ids.js";
export * from "./model/factory.js";
export * from "./model/bindingSync.js";

// MAL
export * from "./mal/malMapping.js";

// 节点注册表
export * from "./registry/schema.js";
export * from "./registry/builtins.js";
export * from "./registry/NodeRegistry.js";
export * from "./registry/connectionRules.js";

// 命令总线
export * from "./command/commands.js";
export * from "./command/GraphCommandBus.js";

// 校验
export * from "./validation/ValidationEngine.js";

// 导出
export * from "./export/toBehaviorTreeDef.js";
export * from "./export/xmlSerializer.js";
export * from "./export/fsmXml.js";
export * from "./export/metaXml.js";
export * from "./export/workspaceXml.js";
export * from "./export/codegen/cppCodegen.js";
export * from "./export/codegen/projectGen.js";
export * from "./export/codegen/preserve.js";
export * from "./export/ExportPipeline.js";

// 导入
export * from "./import/xmlParser.js";
export * from "./import/ImportPipeline.js";
export * from "./import/metaXml.js";
export * from "./import/workspaceXml.js";
export * from "./import/fsmXml.js";
export * from "./import/cmpModel.js";
export * from "./import/scenario.js";
export * from "./import/unitTemplate.js";

// 布局
export * from "./layout/autoLayout.js";
