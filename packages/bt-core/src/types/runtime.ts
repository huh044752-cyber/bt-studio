/**
 * 运行态类型镜像 — 与 FOSimEngine 头文件字段一一对应,是导出 XML 的真相源。
 *
 * 真相源:
 *   F:\FOSim\FOSimEngine\include\FOSim\Engine\modules\extern\bt_tree_def.h
 *   F:\FOSim\FOSimEngine\include\FOSim\Engine\modules\extern\bt_node_def.h
 *   F:\FOSim\FOSimEngine\include\FOSim\Engine\modules\extern\bt_blackboard.h
 *   F:\FOSim\FOSimEngine\include\FOSim\Engine\modules\extern\bt_status.h
 *
 * 约束:不得在这些结构里放入 UI 字段(坐标/颜色/折叠/注释)。UI 字段进入 editor.ts。
 */

/** bt_node_def.h::BTNodeKind(保持声明顺序) */
export type BTNodeKind =
  | "Action"
  | "Condition"
  | "Sequence"
  | "Selector"
  | "And"
  | "Or"
  | "Parallel"
  | "IfElse"
  | "MonitorBranch"
  | "SelectMonitor"
  | "Loop"
  | "End"
  | "AlwaysSuccess"
  | "AlwaysFailure"
  | "SuccessUntil"
  | "FailureUntil"
  | "Invert"
  | "ConditionTransform"
  | "Subtree"
  | "Null"
  | "Unknown";

export const ALL_NODE_KINDS: readonly BTNodeKind[] = [
  "Action",
  "Condition",
  "Sequence",
  "Selector",
  "And",
  "Or",
  "Parallel",
  "IfElse",
  "MonitorBranch",
  "SelectMonitor",
  "Loop",
  "End",
  "AlwaysSuccess",
  "AlwaysFailure",
  "SuccessUntil",
  "FailureUntil",
  "Invert",
  "ConditionTransform",
  "Subtree",
  "Null",
  "Unknown",
];

/** bt_node_def.h::InputSource */
export type InputSource = "Constant" | "Blackboard";

/** bt_node_def.h::InputBinding */
export interface InputBinding {
  name: string;
  type: string;
  value: string;
  source: InputSource;
  blackboardId: string;
  variableId: string;
}

/** bt_node_def.h::OutputBinding */
export interface OutputBinding {
  name: string;
  blackboardId: string;
  variableId: string;
}

/** bt_node_def.h::ModelSelector — 编辑器只用 className 表达类归属;componentId 由挂接流程写入,不在此建模 */
export interface ModelSelector {
  modelName: string;
  modelClass: string;
  modelType: string;
  componentId: string;
  componentName: string;
  componentClass: string;
  componentType: string;
}

/** bt_node_def.h::BTNodeDef */
export interface BTNodeDef {
  id: number;
  xmlType: string;
  name: string;
  functionName: string;
  behaviorTreeName: string;
  behaviorTreeTemplateId: string;
  behaviorTreeInstanceId: string;
  paramStates: string;
  script: string;
  scriptRef: string;
  kind: BTNodeKind;
  target: ModelSelector;
  captureInputOnEnter: boolean;
  loopCount: number;
  endStatusSuccess: boolean;
  endExternalTree: boolean;
  parallelSuccessThreshold: number;
  parallelFailureThreshold: number;
  compareType: string;
  compareOutputName: string;
  compareOp: string;
  compareValue: string;
  inputs: InputBinding[];
  outputs: OutputBinding[];
  children: BTNodeDef[];
}

/** bt_blackboard.h::BlackboardScope */
export type BlackboardScope = "Global" | "Local";

/** bt_blackboard.h::BlackboardValue */
export interface BlackboardValue {
  id: string;
  key: string;
  type: string;
  value: string;
}

/** bt_blackboard.h::BlackboardDef */
export interface BlackboardDef {
  id: string;
  name: string;
  scope: BlackboardScope;
  linked: boolean;
  /** key -> value */
  variables: Record<string, BlackboardValue>;
}

/** bt_tree_def.h::BehaviorTreeDef */
export interface BehaviorTreeDef {
  id: number;
  name: string;
  projectType: string;
  behaviorTreeTemplateId: string;
  modelId: string;
  /**
   * 该 BT 使用的认知类名(用于 <Root cognition="…"> 属性)。
   * 引擎:bt_xml_loader.cpp 从 Root 读该属性 → tree_def_->cognition;
   * BehaviorNodeAgent.LoadByNode 里赋给 agent->cognition_name,
   * 后续 EmployCog 用它到 unit->GetCognitionByName(name) 或全局 component_mgr
   * 里找 Cognition 类(FZFOSimModel 里已注册的 dll)。
   * 单类树(所有叶子同一 className)——由 toBehaviorTreeDef 从叶子聚合得到。
   */
  cognition: string;
  /** bt_tree_def.h::BlackboardStore — 这里以 BlackboardDef 列表表达 */
  blackboards: BlackboardDef[];
  root: BTNodeDef | null;
  /** id -> node(扁平索引,导出时由 root 递归生成) */
  nodesById: Record<number, BTNodeDef>;
  /** instanceId -> tree name/ref */
  referencedBehaviorTreesById: Record<string, string>;
}

/** bt_status.h::BTStatus */
export type BTStatus = "Invalid" | "Success" | "Failure" | "Running";

/** 运行 XML 的 projectType 固定值(BTXmlLoader 强校验)。 */
export const FOSIM_PROJECT_TYPE = "行为树";

export function emptyModelSelector(): ModelSelector {
  return {
    modelName: "",
    modelClass: "",
    modelType: "",
    componentId: "",
    componentName: "",
    componentClass: "",
    componentType: "",
  };
}
