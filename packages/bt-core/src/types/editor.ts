/**
 * 设计态 / 编辑器 UI 协议类型。这些字段不进入运行 XML,只进入 *.bt.meta.json 或内存视图。
 */
import type { BTNodeKind, InputBinding, OutputBinding, ModelSelector } from "./runtime.js";
import type { DisplayType, FZMARGType, ValueFormat } from "./mal.js";

export type StudioMode = "standalone" | "linked_fosim" | "hybrid";

/** 工程范式:行为树 或 状态机(对齐 vue2 projectType)。 */
export type ProjectKind = "behavior_tree" | "state_machine";

/** 设计态输入绑定草稿(比运行态多 displayType/malType/valueFormat 追踪)。 */
export interface InputBindingDraft {
  name: string;
  /** 运行态 type 字符串(FZStringType 等),由 malType 推导 */
  type: string;
  source: "constant" | "blackboard";
  value?: string;
  blackboardId?: string;
  variableId?: string;
  displayType?: DisplayType;
  malType?: FZMARGType;
  valueFormat?: ValueFormat;
}

export interface OutputBindingDraft {
  name: string;
  blackboardId: string;
  variableId: string;
  displayType?: DisplayType;
  malType?: FZMARGType;
}

export interface TargetSelectorDraft extends Partial<ModelSelector> {}

/** 设计态节点(6.3)。运行态主体映射为 BTNodeDef。 */
export interface DesignNode {
  nodeId: string;
  nodeType: string;
  xmlType?: string;
  name: string;
  comment?: string;
  functionRef?: string;
  subtreeRef?: string;
  /** FSM 转移节点(ConditionTransition/StateTransition/Transition)指向的目标 State nodeId。
   * 引用而非结构父子边:目标 State 已是 Root 的结构子,转移仅以此字段"Goto"指向它。 */
  transitionTarget?: string;
  paramStates?: string;
  captureInputOnEnter?: boolean;
  loopCount?: number;
  endStatusSuccess?: boolean;
  endExternalTree?: boolean;
  parallelSuccessThreshold?: number;
  parallelFailureThreshold?: number;
  compareType?: string;
  compareOutputName?: string;
  compareOp?: string;
  compareValue?: string;
  /** script / scriptRef 兼容导入的脚本节点 */
  script?: string;
  scriptRef?: string;
  targetSelector?: TargetSelectorDraft;
  inputBindings: InputBindingDraft[];
  outputBindings: OutputBindingDraft[];
  childOrder: string[];
  /** 导入时无法映射到当前 Registry 的节点 -> 受限,仅查看/删除/替换 */
  restricted?: boolean;
}

/** 设计态边(6.4)。仅属于编辑器图模型,运行态不消费。 */
export interface DesignEdge {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  order: number;
  label?: string;
  sourcePortId?: string;
  targetPortId?: string;
}

export interface NodeLayout {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 6.11 EditorMeta */
export interface EditorMeta {
  canvasScale: number;
  canvasOffsetX: number;
  canvasOffsetY: number;
  nodeLayouts: NodeLayout[];
  collapsedNodeIds: string[];
  selectedNodeId?: string;
  editorVersion: string;
  /** 项目树分组折叠态等 */
  collapsedGroups?: string[];
}

/** 6.10 PublishConfig */
export interface PublishConfig {
  assetOutputPath: string;
  metaOutputPath: string;
  bindingManifestOutputPath?: string;
  allowWriteBehaviorLogic: boolean;
  scenarioName?: string;
  targetObjectRef?: string;
  overwritePolicy: "reject" | "overwrite" | "backup_then_overwrite";
}

export function defaultPublishConfig(): PublishConfig {
  return {
    assetOutputPath: "",
    metaOutputPath: "",
    allowWriteBehaviorLogic: false,
    overwritePolicy: "backup_then_overwrite",
  };
}

export function defaultEditorMeta(): EditorMeta {
  return {
    canvasScale: 1,
    canvasOffsetX: 0,
    canvasOffsetY: 0,
    nodeLayouts: [],
    collapsedNodeIds: [],
    editorVersion: "0.1.0",
  };
}

/** 设计态树(6.2)。 */
export interface DesignTree {
  treeId: string;
  treeName: string;
  displayName: string;
  description: string;
  mode: StudioMode;
  /** 行为树 / 状态机(默认 behavior_tree)。 */
  projectKind?: ProjectKind;
  /** 根类名(根类函数绑定模型:Action/Condition 函数来自该类)。 */
  rootClassName?: string;
  templateId?: string;
  modelId?: string;
  projectType?: string;
  cognition?: string;
  rootNodeId: string;
  /** nodeId -> DesignNode */
  nodes: Record<string, DesignNode>;
  /** edgeId -> DesignEdge */
  edges: Record<string, DesignEdge>;
  /** 本地树黑板 */
  localBlackboardId: string;
  /** 已链接的全局黑板 id */
  linkedGlobalBlackboardIds: string[];
  referencedTreeIds: string[];
  publishConfig: PublishConfig;
  editorMeta: EditorMeta;
  createdAt: string;
  updatedAt: string;
  version: string;
}

/** TreeDesignDocument:设计态文档,包裹一棵 DesignTree + 脏状态 + 路径。 */
export interface TreeDesignDocument {
  tree: DesignTree;
  dirty: boolean;
  filePath?: string;
  lastExportedAt?: string;
}

// --- X6 Graph ViewModel (6.4.0) ---

export type PortGroup = "top" | "bottom";

export interface PortView {
  portId: string;
  group: PortGroup;
  label?: string;
  order: number;
  maxConnections: number;
  dynamic: boolean;
  semanticRole?:
    | "parent-input"
    | "child-output"
    | "true-branch"
    | "false-branch"
    | "default-branch";
}

export interface GraphNodeView {
  x6CellId: string;
  nodeId: string;
  nodeType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ports: PortView[];
  selected: boolean;
  restricted: boolean;
  errorLevel?: "error" | "warning";
}

export interface GraphEdgeView {
  x6CellId: string;
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePortId?: string;
  targetPortId?: string;
}

export interface GraphDocument {
  treeId: string;
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
}

/** 运行态绑定草稿别名,re-export 方便导出器使用。 */
export type { InputBinding, OutputBinding, BTNodeKind };
