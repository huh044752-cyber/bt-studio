import { describe, it, expect } from "vitest";
import { createTree, GraphCommandBus, serializeFsmXml, defaultRegistry } from "../src/index.js";

describe("状态机(FSM)节点与导出", () => {
  it("注册表含 4 个 FSM 节点,按范式过滤", () => {
    const fsm = defaultRegistry.listForParadigm("state_machine").map((d) => d.nodeType);
    expect(fsm).toContain("State");
    expect(fsm).toContain("ConditionTransition");
    expect(fsm).toContain("StateTransition");
    expect(fsm).toContain("Root"); // both
    expect(fsm).not.toContain("Sequence");
    const bt = defaultRegistry.listForParadigm("behavior_tree").map((d) => d.nodeType);
    expect(bt).toContain("Sequence");
    expect(bt).not.toContain("State");
  });

  it("State→ConditionTransition(目标 State 走 transitionTarget 引用)导出 behaviac 式 FSM XML", () => {
    const tree = createTree({ treeName: "fsm_demo", projectKind: "state_machine", withRoot: false });
    tree.rootNodeId = "";
    const bus = new GraphCommandBus(tree);
    const s1 = bus.execute({ kind: "AddNode", nodeType: "State", name: "巡逻" });
    const s2 = bus.execute({ kind: "AddNode", nodeType: "State", name: "追击" });
    bus.execute({ kind: "UpdateNodeProperty", nodeId: s1.createdNodeId!, patch: { functionRef: "Patrol" } });
    bus.execute({ kind: "UpdateNodeProperty", nodeId: s2.createdNodeId!, patch: { functionRef: "Chase", endStatusSuccess: true } });
    // 转移是源 State 的结构子;目标 State 通过 transitionTarget 引用(Goto)。
    const tr = bus.execute({ kind: "AddNode", nodeType: "ConditionTransition", name: "发现敌人", parentNodeId: s1.createdNodeId });
    bus.execute({ kind: "UpdateNodeProperty", nodeId: tr.createdNodeId!, patch: { functionRef: "SeeEnemy", compareOp: "eq", compareValue: "1", transitionTarget: s2.createdNodeId } });
    // 转移不接受结构子边(目标是引用)。
    const c = bus.execute({ kind: "ConnectNodes", parentNodeId: tr.createdNodeId!, childNodeId: s2.createdNodeId! });
    expect(c.ok).toBe(false);

    const xml = serializeFsmXml(bus.getTree());
    // 真实引擎嵌套格式:<Root projectType=状态机> 含一个入口 <State>,
    // 转移 <ConditionTransform> 内嵌目标 <State>(首次)或 <Goto id>(回指)。
    expect(xml).toContain('projectType="状态机"');
    expect(xml).toContain("<State");
    expect(xml).toContain('action="Patrol"');
    expect(xml).toContain("<ConditionTransform");
    expect(xml).toContain('action="SeeEnemy"');
    expect(xml).toContain('action="Chase"'); // 目标状态首次嵌套输出
    expect(xml).toContain('IsEndState="true"');
    expect(xml).not.toContain("FSMNodes"); // 旧 behaviac 扁平格式已废弃
  });

  it("State 不能直接连 State(必须经跳转)", () => {
    const tree = createTree({ treeName: "fsm2", projectKind: "state_machine", withRoot: false });
    const bus = new GraphCommandBus(tree);
    const a = bus.execute({ kind: "AddNode", nodeType: "State", name: "A" });
    const b = bus.execute({ kind: "AddNode", nodeType: "State", name: "B" });
    const r = bus.execute({ kind: "ConnectNodes", parentNodeId: a.createdNodeId!, childNodeId: b.createdNodeId! });
    expect(r.ok).toBe(false);
  });
});
