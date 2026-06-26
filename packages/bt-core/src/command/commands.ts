/**
 * Graph Command 定义(文档 §11.2)。所有编辑动作必须走 Command Bus,
 * 否则撤销重做、dirty、校验、导出状态会断链。
 */
import type { DesignNode, InputBindingDraft, OutputBindingDraft } from "../types/editor.js";

export interface AddNodeCommand {
  kind: "AddNode";
  nodeType: string;
  name?: string;
  x?: number;
  y?: number;
  /** 可选:创建后立即连接到该父节点 */
  parentNodeId?: string;
  /** 可选:复制粘贴时携带的节点属性快照(name/properties/functionRef/targetSelector/outputBindings 等),合并到新节点。 */
  init?: Record<string, unknown>;
}

export interface DeleteNodeCommand {
  kind: "DeleteNode";
  nodeId: string;
}

export interface MoveNodeCommand {
  kind: "MoveNode";
  nodeId: string;
  x: number;
  y: number;
}

export interface ConnectNodesCommand {
  kind: "ConnectNodes";
  parentNodeId: string;
  childNodeId: string;
  order?: number;
}

export interface DisconnectNodesCommand {
  kind: "DisconnectNodes";
  parentNodeId: string;
  childNodeId: string;
}

export interface ReorderChildrenCommand {
  kind: "ReorderChildren";
  parentNodeId: string;
  childOrder: string[];
}

export interface UpdateNodePropertyCommand {
  kind: "UpdateNodeProperty";
  nodeId: string;
  patch: Partial<DesignNode>;
}

export interface BindFunctionCommand {
  kind: "BindFunction";
  nodeId: string;
  functionRef: string;
  inputBindings?: InputBindingDraft[];
  outputBindings?: OutputBindingDraft[];
}

export interface BindVariableCommand {
  kind: "BindVariable";
  nodeId: string;
  direction: "input" | "output";
  binding: InputBindingDraft | OutputBindingDraft;
}

export interface SetSubtreeRefCommand {
  kind: "SetSubtreeRef";
  nodeId: string;
  subtreeRef: string;
}

export type GraphCommand =
  | AddNodeCommand
  | DeleteNodeCommand
  | MoveNodeCommand
  | ConnectNodesCommand
  | DisconnectNodesCommand
  | ReorderChildrenCommand
  | UpdateNodePropertyCommand
  | BindFunctionCommand
  | BindVariableCommand
  | SetSubtreeRefCommand;

export interface CommandResult {
  ok: boolean;
  reason?: string;
  /** 受影响节点 id(用于回显/校验定位) */
  affectedNodeIds: string[];
  /** 新建节点时返回其 id */
  createdNodeId?: string;
}
