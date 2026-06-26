import { describe, it, expect } from "vitest";
import { validateConnectionRule, GraphCommandBus, createTree } from "../src/index.js";

describe("按类型连接规则(移植 vue2 connectionValidators)", () => {
  it("And/Or 只能连条件类叶子", () => {
    expect(validateConnectionRule("And", "Condition").ok).toBe(true);
    expect(validateConnectionRule("Or", "ConditionTransform").ok).toBe(true);
    expect(validateConnectionRule("And", "Action").ok).toBe(false);
    expect(validateConnectionRule("Or", "Sequence").ok).toBe(false);
  });

  it("监测分支只能从选择监测连入", () => {
    expect(validateConnectionRule("SelectMonitor", "MonitorBranch").ok).toBe(true);
    expect(validateConnectionRule("Sequence", "MonitorBranch").ok).toBe(false);
    expect(validateConnectionRule("MonitorBranch", "SelectMonitor").ok).toBe(false);
  });

  it("状态机:State→跳转;跳转是叶子(目标 State 走 transitionTarget 引用,不是结构子)", () => {
    expect(validateConnectionRule("State", "ConditionTransition").ok).toBe(true);
    expect(validateConnectionRule("State", "StateTransition").ok).toBe(true);
    expect(validateConnectionRule("State", "Action").ok).toBe(false);
    // 转移不接受任何结构子边(目标用引用)。
    expect(validateConnectionRule("ConditionTransition", "State").ok).toBe(false);
    expect(validateConnectionRule("StateTransition", "Sequence").ok).toBe(false);
  });

  it("Root 在状态机工程下只能连 State", () => {
    expect(validateConnectionRule("Root", "Sequence", "state_machine").ok).toBe(false);
    expect(validateConnectionRule("Root", "State", "state_machine").ok).toBe(true);
    expect(validateConnectionRule("Root", "Sequence", "behavior_tree").ok).toBe(true);
  });

  it("命令总线:And 连非条件被拒绝", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const and = bus.execute({ kind: "AddNode", nodeType: "And", parentNodeId: tree.rootNodeId });
    const seqUnder = bus.execute({ kind: "AddNode", nodeType: "Sequence" });
    const r = bus.execute({
      kind: "ConnectNodes",
      parentNodeId: and.createdNodeId!,
      childNodeId: seqUnder.createdNodeId!,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/条件/);
  });
});
