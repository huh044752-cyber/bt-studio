/**
 * 设计态对象工厂(Asset Designer Core,文档 §5.3)。
 */
import type {
  DesignTree,
  DesignNode,
  DesignEdge,
  StudioMode,
  TreeDesignDocument,
} from "../types/editor.js";
import { defaultEditorMeta, defaultPublishConfig } from "../types/editor.js";
import type { Blackboard, Variable } from "../types/catalog.js";
import {
  newTreeId,
  newNodeId,
  newEdgeId,
  newBlackboardId,
  nowIso,
} from "./ids.js";

export function createNode(
  nodeType: string,
  name: string,
  partial: Partial<DesignNode> = {},
): DesignNode {
  return {
    nodeId: partial.nodeId ?? newNodeId(),
    nodeType,
    name,
    inputBindings: [],
    outputBindings: [],
    childOrder: [],
    ...partial,
  };
}

export function createEdge(
  sourceNodeId: string,
  targetNodeId: string,
  order: number,
  partial: Partial<DesignEdge> = {},
): DesignEdge {
  return {
    edgeId: partial.edgeId ?? newEdgeId(),
    sourceNodeId,
    targetNodeId,
    order,
    ...partial,
  };
}

export function createBlackboard(
  name: string,
  scope: "global" | "tree",
  partial: Partial<Blackboard> = {},
): Blackboard {
  return {
    blackboardId: partial.blackboardId ?? newBlackboardId(),
    name,
    scope,
    runtimeScope: scope === "global" ? "Global" : "Local",
    linked: scope === "global",
    variables: partial.variables ?? [],
  };
}

export interface CreateTreeOptions {
  treeName: string;
  displayName?: string;
  mode?: StudioMode;
  projectKind?: import("../types/editor.js").ProjectKind;
  withRoot?: boolean;
}

/**
 * 新建一棵树。默认自动创建 Root 节点(文档:`+树` 自动生成 Root)。
 */
export function createTree(opts: CreateTreeOptions): DesignTree {
  const treeId = newTreeId();
  const localBb = createBlackboard(`${opts.treeName}-本地板`, "tree");
  const tree: DesignTree = {
    treeId,
    treeName: opts.treeName,
    displayName: opts.displayName ?? opts.treeName,
    description: "",
    mode: opts.mode ?? "standalone",
    projectKind: opts.projectKind ?? "behavior_tree",
    rootNodeId: "",
    nodes: {},
    edges: {},
    localBlackboardId: localBb.blackboardId,
    linkedGlobalBlackboardIds: [],
    referencedTreeIds: [],
    publishConfig: defaultPublishConfig(),
    editorMeta: defaultEditorMeta(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    version: "0.1.0",
  };
  if (opts.withRoot !== false) {
    const root = createNode("Root", "Root");
    tree.nodes[root.nodeId] = root;
    tree.rootNodeId = root.nodeId;
    tree.editorMeta.nodeLayouts.push({
      nodeId: root.nodeId,
      x: 360,
      y: 40,
      width: 160,
      height: 54,
    });
  }
  // 本地黑板挂在 document 之外由 store 维护;此处仅返回 tree。
  return tree;
}

export function createDocument(tree: DesignTree): TreeDesignDocument {
  return { tree, dirty: false };
}

export function createVariable(
  name: string,
  partial: Partial<Variable> = {},
): Variable {
  return {
    variableId: partial.variableId ?? `var_${name}`,
    name,
    scope: partial.scope ?? "tree",
    displayType: partial.displayType ?? "string",
    valueFormat: partial.valueFormat ?? "literal",
    ...partial,
  };
}

/** 深拷贝设计树(保存前从画布读取后深拷贝,避免视图引用泄漏)。 */
export function cloneTree(tree: DesignTree): DesignTree {
  return structuredClone(tree);
}
