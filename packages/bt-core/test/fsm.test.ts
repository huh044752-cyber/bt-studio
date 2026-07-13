import { describe, it, expect } from "vitest";
import { createTree, GraphCommandBus, serializeFsmXml, defaultRegistry } from "../src/index.js";
import { parseFsmXml } from "../src/import/fsmXml.js";
import { defaultValidationEngine } from "../src/validation/ValidationEngine.js";

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

  it("导入嵌套 FSM(fight_status 模式)后 Root 只有 1 个入口 State,校验 0 错", () => {
    // 老引擎 .sm 真身:所有目标状态都嵌套在上级 ConditionTransform 里(fight_status.sm 原样)。
    // 修复前 parseFsmXml 会把每个嵌套 State 都挂 Root → Root 子数 > 1 → 校验拒绝挂接。
    // 修复后:非入口 State 只由 transitionTarget 引用可达,Root 结构上只挂入口。
    // 注:类信息统一用 className(与 BT .bt 对齐);cognition/mdataName 老属性不再兼容。
    const xml =
      '<?xml version="1.0"?><Root id="1">' +
      '<State function="Fly_Status" id="2" className="BT空地打击">' +
      '<ConditionTransform function="Fly_to_Fight_congition" id="3" className="BT空地打击">' +
      '<State function="Fight_Status" id="4" className="BT空地打击">' +
      '<ConditionTransform function="Fight_To_Fire_Congition" id="5" className="BT空地打击">' +
      '<State function="Fire_Again_Status" id="7" className="BT空地打击">' +
      '<ConditionTransform function="Fight_Again_Congition" id="8" className="BT空地打击"><Goto id="4"/></ConditionTransform>' +
      '<ConditionTransform function="Fire_To_Return_Congition" id="9" className="BT空地打击">' +
      '<State function="Return" id="10" className="BT空地打击" IsEndState="true"/>' +
      "</ConditionTransform></State></ConditionTransform>" +
      '<ConditionTransform function="Fire_To_Return_Congition" id="6" className="BT空地打击"><Goto id="10"/></ConditionTransform>' +
      "</State></ConditionTransform></State></Root>";
    const tree = parseFsmXml(xml);

    const root = tree.nodes[tree.rootNodeId]!;
    expect(root.childOrder.length).toBe(1);
    const entryStateId = root.childOrder[0]!;
    expect(tree.nodes[entryStateId]!.functionRef).toBe("Fly_Status");

    // 4 个 State + 5 个 ConditionTransition(fight_status.sm 里 id=3,5,6,8,9)= 9;加 Root 共 10。
    const states = Object.values(tree.nodes).filter((n) => n.nodeType === "State");
    expect(states.length).toBe(4);
    const trans = Object.values(tree.nodes).filter((n) => n.nodeType === "ConditionTransition");
    expect(trans.length).toBe(5);

    // 所有转移都有 transitionTarget 指向真正的目标 State。
    for (const t of trans) {
      expect(t.transitionTarget).toBeTruthy();
      expect(tree.nodes[t.transitionTarget!]?.nodeType).toBe("State");
    }

    // node.name 用 action(函数名)兜底,不再是英文 nodeType(避免画布"条件跳转\nConditionTransition"上下不齐)。
    // fight_status.sm 里 State/ConditionTransform 都无 name 属性 —— name 应回落到 action(Fly_Status / Fly_to_Fight_congition 等)。
    const fly = states.find((s) => s.functionRef === "Fly_Status");
    expect(fly?.name).toBe("Fly_Status");
    const t1 = trans.find((t) => t.functionRef === "Fly_to_Fight_congition");
    expect(t1?.name).toBe("Fly_to_Fight_congition");
    expect(trans.every((t) => t.name !== "ConditionTransition")).toBe(true);

    // 校验通过(0 错)—— 修复前 Root 有 4 个 State 子 + 转移下有 State 子会连出多错。
    const issues = defaultValidationEngine.validate(tree, { mode: "standalone" });
    const errs = issues.filter((i) => i.level === "error" && i.source === "structure");
    expect(errs).toEqual([]);

    // 反向导出:重新序列化能还原 <Root projectType=状态机> + Fly_Status 入口 + Goto 回指。
    const out = serializeFsmXml(tree);
    expect(out).toContain('projectType="状态机"');
    expect(out).toContain('action="Fly_Status"');
    expect(out).toContain('action="Return"');
    expect(out).toContain("<Goto");

    // ▼ 类信息双向对称:导入输入 className="X" → targetSelector.modelClass;
    //   导出统一写 className,不再写 cognition/componentId。
    for (const s of states) {
      expect(s.targetSelector?.modelClass).toBe("BT空地打击");
    }
    for (const t of trans) {
      expect(t.targetSelector?.modelClass).toBe("BT空地打击");
    }
    expect(out).toContain('className="BT空地打击"');
    // 2026-07:Root 需带 cognition,让引擎 Agent EmployCog 找 Cognition 类。
    // FSM 序列化时按叶子 className 众数聚合 —— 单类 FSM 恒定为该类。
    expect(out).toContain('cognition="BT空地打击"');
    expect(out).not.toContain('componentId=');
  });
});
