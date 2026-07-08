/**
 * 设计态 -> 运行态:TreeDesignDocument -> BehaviorTreeDef(文档 §7.5 / §8)。
 *
 * 关键:
 * - 编辑器 Root 节点是 <Root> 包装,它的唯一子节点才是 BehaviorTreeDef.root。
 * - 运行态节点 id 按 BFS 从 1 重新编号(BTXmlLoader 要求唯一非零正整数)。
 * - UI 字段(坐标/折叠/注释)不进入运行态。
 */
import type { DesignTree, DesignNode } from "../types/editor.js";
import type { Blackboard } from "../types/catalog.js";
import type {
  BehaviorTreeDef,
  BTNodeDef,
  BlackboardDef,
  BlackboardValue,
  InputBinding,
  OutputBinding,
} from "../types/runtime.js";
import { emptyModelSelector, FOSIM_PROJECT_TYPE } from "../types/runtime.js";
import type { NodeRegistry } from "../registry/NodeRegistry.js";
import { defaultRegistry } from "../registry/NodeRegistry.js";
import { malToXmlType } from "../mal/malMapping.js";

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

export interface ToDefOptions {
  blackboards?: Blackboard[];
  registry?: NodeRegistry;
}

export function toBehaviorTreeDef(tree: DesignTree, opts: ToDefOptions = {}): BehaviorTreeDef {
  const registry = opts.registry ?? defaultRegistry;

  // 1. 定位编辑器 Root 与行为根
  const editorRoot = tree.nodes[tree.rootNodeId];
  if (!editorRoot) throw new ExportError("缺少 Root 节点,无法导出");
  if (editorRoot.childOrder.length !== 1) {
    throw new ExportError(
      `Root 必须且只能有 1 个子节点,当前 ${editorRoot.childOrder.length} 个,导出阻断`,
    );
  }
  const behaviorRootId = editorRoot.childOrder[0]!;

  // 2. BFS 编号
  const numbering = new Map<string, number>();
  let seq = 0;
  const order: string[] = [];
  const stack = [behaviorRootId];
  while (stack.length) {
    const id = stack.shift()!;
    if (numbering.has(id)) continue;
    seq += 1;
    numbering.set(id, seq);
    order.push(id);
    const node = tree.nodes[id];
    if (node) for (const c of node.childOrder) stack.push(c);
  }

  const nodesById: Record<number, BTNodeDef> = {};

  const convert = (nodeId: string): BTNodeDef => {
    const node = tree.nodes[nodeId];
    if (!node) throw new ExportError(`节点 ${nodeId} 不存在`);
    if (node.restricted) {
      throw new ExportError(`受限节点 ${node.nodeType} 不能导出,需替换或删除`);
    }
    const def = registry.get(node.nodeType);
    if (!def) throw new ExportError(`未注册节点类型 ${node.nodeType},无法导出`);

    const btNode: BTNodeDef = {
      id: numbering.get(nodeId)!,
      xmlType: def.xmlElement,
      name: node.name,
      functionName: node.functionRef ?? "",
      behaviorTreeName: "",
      behaviorTreeTemplateId: "",
      behaviorTreeInstanceId: node.subtreeRef ?? "",
      paramStates: node.paramStates ?? "",
      script: node.script ?? "",
      scriptRef: node.scriptRef ?? "",
      kind: def.runtimeKind,
      target: { ...emptyModelSelector(), ...(node.targetSelector ?? {}) },
      captureInputOnEnter: node.captureInputOnEnter ?? false,
      loopCount: node.loopCount ?? 1,
      endStatusSuccess: node.endStatusSuccess ?? true,
      endExternalTree: node.endExternalTree ?? false,
      parallelSuccessThreshold: node.parallelSuccessThreshold ?? 0,
      parallelFailureThreshold: node.parallelFailureThreshold ?? 0,
      compareType: node.compareType ?? "",
      compareOutputName: node.compareOutputName ?? "",
      compareOp: node.compareOp ?? "",
      compareValue: node.compareValue ?? "",
      inputs: node.inputBindings.map(toInputBinding),
      // 不回写(variableId 为空)= 输出留在原 MAL 数据,不发 Output 元素。
      outputs: node.outputBindings.filter((b) => !!b.variableId).map(toOutputBinding),
      children: node.childOrder.map(convert),
    };
    nodesById[btNode.id] = btNode;
    return btNode;
  };

  const root = convert(behaviorRootId);

  // 3. 黑板转换
  const blackboards = (opts.blackboards ?? []).map(toBlackboardDef);

  // 4. 引用子树
  const referencedBehaviorTreesById: Record<string, string> = {};
  tree.referencedTreeIds.forEach((id, idx) => {
    referencedBehaviorTreesById[String(idx)] = id;
  });

  return {
    id: 1,
    name: tree.treeName,
    projectType: FOSIM_PROJECT_TYPE,
    behaviorTreeTemplateId: tree.templateId ?? "",
    modelId: tree.modelId ?? "",
    blackboards,
    root,
    nodesById,
    referencedBehaviorTreesById,
  };
}

function toInputBinding(d: import("../types/editor.js").InputBindingDraft): InputBinding {
  return {
    name: d.name,
    type: d.type || (d.malType ? malToXmlType(d.malType) : ""),
    value: d.value ?? "",
    source: d.source === "blackboard" ? "Blackboard" : "Constant",
    blackboardId: d.blackboardId ?? "",
    variableId: d.variableId ?? "",
  };
}

function toOutputBinding(d: import("../types/editor.js").OutputBindingDraft): OutputBinding {
  return { name: d.name, blackboardId: d.blackboardId, variableId: d.variableId };
}

function toBlackboardDef(bb: Blackboard): BlackboardDef {
  const variables: Record<string, BlackboardValue> = {};
  for (const v of bb.variables) {
    variables[v.name] = {
      id: v.variableId,
      key: v.name,
      type: v.malType ? malToXmlType(v.malType) : "CyberStringType",
      value: v.defaultValue ?? "",
    };
  }
  return {
    id: bb.blackboardId,
    name: bb.name,
    scope: bb.runtimeScope,
    linked: bb.linked,
    variables,
  };
}
