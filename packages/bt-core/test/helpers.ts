import {
  createTree,
  GraphCommandBus,
  type DesignTree,
  type Blackboard,
  createBlackboard,
} from "../src/index.js";

export interface BuiltTree {
  tree: DesignTree;
  bus: GraphCommandBus;
  ids: Record<string, string>;
}

/** 构建:Root -> Sequence -> [Action(fn), Condition(fn)] 的最小合法树。 */
export function buildMinimalTree(): BuiltTree {
  const tree = createTree({ treeName: "sample_minimal_tree" });
  const bus = new GraphCommandBus(tree);
  const ids: Record<string, string> = { root: tree.rootNodeId };

  const seq = bus.execute({ kind: "AddNode", nodeType: "Sequence", name: "主序列", parentNodeId: tree.rootNodeId });
  ids.seq = seq.createdNodeId!;

  const act = bus.execute({ kind: "AddNode", nodeType: "Action", name: "动作A", parentNodeId: ids.seq });
  ids.action = act.createdNodeId!;
  bus.execute({ kind: "BindFunction", nodeId: ids.action, functionRef: "DoThing" });

  const cond = bus.execute({ kind: "AddNode", nodeType: "Condition", name: "条件C", parentNodeId: ids.seq });
  ids.cond = cond.createdNodeId!;
  bus.execute({ kind: "BindFunction", nodeId: ids.cond, functionRef: "CheckThing" });

  return { tree: bus.getTree(), bus, ids };
}

export function makeBlackboard(): Blackboard {
  const bb = createBlackboard("全局板", "global", { blackboardId: "nd_global" });
  bb.variables.push({
    variableId: "bb_duration",
    name: "duration",
    scope: "global",
    displayType: "float",
    malType: "CYBER_MARGTYPE_REAL",
    valueFormat: "literal",
    defaultValue: "600",
  });
  return bb;
}
