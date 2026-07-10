/**
 * 图辅助函数(不改变状态,纯函数)。
 * 目前只有 findAcceptableParent —— 从 seed 出发找第一个能收 childType 的父。
 * 命令层(GraphCommandBus.canExecute)会做最终的强校验,这里只做"建议父"
 * 供 UI 拖拽/双击的智能选父。
 */
import type { DesignTree } from "../types/editor.js";
import { defaultRegistry, type NodeRegistry } from "../registry/NodeRegistry.js";
import { validateConnectionRule } from "../registry/connectionRules.js";

/**
 * 找第一个能作为新子 childType 挂载点的父节点。
 *  1) seed 自身可收 → 返回 seed
 *  2) 沿 childOrder 深度优先 → 第一个可收的可组合后代
 *  3) 兜底 Root
 *  4) 都不行 → null(整棵树都没地方挂)
 *
 * "可收"= 是可组合节点(maxChildren > 0)+ 当前 childOrder 未满 +
 *        validateConnectionRule(parentType, childType, projectKind).ok
 */
export function findAcceptableParent(
  tree: DesignTree,
  seedId: string,
  childType: string,
  registry: NodeRegistry = defaultRegistry,
): string | null {
  const kind = tree.projectKind ?? "behavior_tree";
  const canTake = (pid: string): boolean => {
    const p = tree.nodes[pid];
    if (!p) return false;
    const def = registry.get(p.nodeType);
    if (!def || def.maxChildren <= 0) return false;
    if (p.childOrder.length >= def.maxChildren) return false;
    return validateConnectionRule(p.nodeType, childType, kind, registry).ok;
  };

  if (canTake(seedId)) return seedId;

  const seen = new Set<string>();
  const stack = [seedId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id !== seedId && canTake(id)) return id;
    const n = tree.nodes[id];
    if (n) for (const c of n.childOrder) stack.push(c);
  }

  if (tree.rootNodeId && tree.rootNodeId !== seedId && canTake(tree.rootNodeId)) {
    return tree.rootNodeId;
  }
  return null;
}
