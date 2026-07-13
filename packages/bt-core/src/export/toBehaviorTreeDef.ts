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

  // 3. 从所有叶子 className 聚合出 cognition —— 单类树取叶子共同的 className。
  //    真引擎 EmployCog(cognition_name) 需要 <Root cognition="…"> 才能找到 Cognition 类;
  //    树里叶子必须同一 className,否则挂载语义歧义。多类混用时取第一个非空作为 cognition,
  //    并让 export 校验器另行处理"不一致 warning"(见 ValidationEngine 后续扩展)。
  const cognition = pickTreeCognition(tree);

  // 4. 黑板转换
  const blackboards = (opts.blackboards ?? []).map(toBlackboardDef);

  // 5. 引用子树
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
    cognition,
    blackboards,
    root,
    nodesById,
    referencedBehaviorTreesById,
  };
}

/**
 * 从设计树里聚合 cognition:遍历所有 Action/Condition 等叶子的 targetSelector.modelClass。
 * 取"出现次数最多"的那一个作为该树 cognition —— 允许有个别不同类的叶子(常见于混用),
 * 但引擎侧只用一个 cognition 到 EmployCog,主导者用众数。
 */
function pickTreeCognition(tree: DesignTree): string {
  const counts = new Map<string, number>();
  for (const node of Object.values(tree.nodes)) {
    const cls = node.targetSelector?.modelClass?.trim();
    if (!cls) continue;
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) { bestN = n; best = k; }
  }
  return best;
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
