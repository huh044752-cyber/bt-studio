/**
 * Node Registry 类型(文档 §6.4.1 / 6.4.2 / 6.4.0.1)。
 */
import type { BTNodeKind } from "../types/runtime.js";
import type { CyberMARGType } from "../types/mal.js";

export type NodeCategory =
  | "Root"
  | "Action"
  | "Condition"
  | "Composite"
  | "Decorator"
  | "Subtree"
  | "Utility";

export interface PortSchema {
  group: "top" | "bottom";
  defaultCount: number;
  maxCount: number;
  fixed: boolean;
  semanticRole?:
    | "parent-input"
    | "child-output"
    | "true-branch"
    | "false-branch"
    | "default-branch";
}

export type PropertyEditorType =
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "function-picker"
  | "variable-picker"
  | "mal-value"
  | "subtree-picker"
  | "target-picker"
  | "target-state-picker"
  | "compare-op"
  | "unit-template-picker";

export interface PropertySchema {
  propName: string;
  /** 运行态字段名(导出器据此写入 BTNodeDef);为空表示只进设计态/Meta */
  runtimeField?: keyof import("../types/runtime.js").BTNodeDef;
  displayName: string;
  category: "基础" | "函数" | "参数" | "控制" | "调试" | "注释";
  editorType: PropertyEditorType;
  displayMode: "parameter" | "list" | "advanced" | "hidden";
  required: boolean;
  readonly: boolean;
  noExport: boolean;
  noSave: boolean;
  /** 创建节点时的字段默认值;AddNode 自动写入,防止拖拽即报校验错误。 */
  default?: string | number | boolean;
  malType?: CyberMARGType;
  dependsOn?: string;
  enumValues?: string[];
}

export interface NodeDefinition {
  nodeType: string;
  runtimeKind: BTNodeKind;
  /** 导出 XML 时使用的元素名(注意 Loop->DecoratorLoop 等差异) */
  xmlElement: string;
  displayName: string;
  category: NodeCategory;
  icon: string;
  colorToken: string;
  /** vue2 节点配色(hex),用于画布描边/标题色。 */
  color?: string;
  /** vue2 渐变填充两端色 [from,to],用于画布节点渐变。 */
  gradient?: [string, string];
  /** 画布形状(对齐 vue2:rect/ellipse/polygon)。 */
  shape?: "rect" | "ellipse" | "polygon";
  minChildren: number;
  maxChildren: number;
  allowedParentKinds?: BTNodeKind[];
  inputPort: PortSchema;
  outputPort: PortSchema;
  properties: PropertySchema[];
  /** 是否当前 FOSim 运行时支持(false 默认隐藏,仅模板/受限) */
  fosimSupported: boolean;
  /** 适用范式:行为树 / 状态机 / 两者。默认 bt。 */
  paradigm?: "bt" | "fsm" | "both";
  description: string;
}
