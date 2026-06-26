import { describe, it, expect } from "vitest";
import { serializeWorkspaceXml, parseWorkspaceXml, createBlackboard, createTree, GraphCommandBus, type CatalogBundle } from "../src/index.js";
import { buildMinimalTree } from "./helpers.js";

const emptyCatalog: CatalogBundle = {
  functionCatalog: { functions: [] },
  globalBlackboards: [],
  enums: [],
  structs: [],
  types: [],
  classes: [],
  members: [],
};

describe("workspace.xml 序列化(全 XML 持久化)", () => {
  it("内联 meta + 全局黑板 + 行为 XML", () => {
    const { tree } = buildMinimalTree();
    const bb = createBlackboard("全局板", "global", { blackboardId: "nd_g" });
    bb.variables.push({ variableId: "v1", name: "speed", scope: "global", displayType: "float", malType: "FZ_MARGTYPE_REAL", valueFormat: "literal", defaultValue: "10" });
    const xml = serializeWorkspaceXml({
      name: "demo_ws",
      trees: [tree],
      globalBlackboards: [bb],
      catalog: emptyCatalog,
    });
    expect(xml).toContain('<Workspace name="demo_ws"');
    expect(xml).toContain("<GlobalBlackboards>");
    expect(xml).toContain('key="speed"');
    expect(xml).toContain("<Behaviors>");
    expect(xml).toContain('kind="behavior_tree"');
    // 内联运行 XML
    expect(xml).toContain('projectType="行为树"');
    expect(xml).toContain("<Sequence");
  });

  it("BT 往返:edges 还原(导入后有连线)", () => {
    const { tree } = buildMinimalTree();
    const xml = serializeWorkspaceXml({ name: "edge_ws", trees: [tree], globalBlackboards: [], catalog: emptyCatalog });
    const { behaviorTrees } = parseWorkspaceXml(xml);
    expect(behaviorTrees.length).toBe(1);
    const imported = behaviorTrees[0]!;
    // Root → Sequence → [Action, Condition]:至少 3 条边
    expect(Object.keys(imported.edges).length).toBeGreaterThanOrEqual(3);
    // childOrder 与 edges 一致
    for (const parent of Object.values(imported.nodes)) {
      for (const childId of parent.childOrder) {
        const hasEdge = Object.values(imported.edges).some(
          (e) => e.sourceNodeId === parent.nodeId && e.targetNodeId === childId,
        );
        expect(hasEdge).toBe(true);
      }
    }
  });

  it("FSM 往返:状态机导入后还原为 DesignTree + projectKind", () => {
    const fsmTree = createTree({ treeName: "test_fsm", projectKind: "state_machine", withRoot: true });
    const bus = new GraphCommandBus(fsmTree);
    const s1 = bus.execute({ kind: "AddNode", nodeType: "State", name: "巡逻", parentNodeId: fsmTree.rootNodeId }).createdNodeId!;
    const s2 = bus.execute({ kind: "AddNode", nodeType: "State", name: "交战", parentNodeId: fsmTree.rootNodeId }).createdNodeId!;
    const ct = bus.execute({ kind: "AddNode", nodeType: "ConditionTransition", name: "发现目标", parentNodeId: s1 }).createdNodeId!;
    bus.execute({ kind: "UpdateNodeProperty", nodeId: ct, patch: { transitionTarget: s2 } });
    const built = bus.getTree();
    const xml = serializeWorkspaceXml({ name: "fsm_ws", trees: [built], globalBlackboards: [], catalog: emptyCatalog });
    expect(xml).toContain('kind="state_machine"');
    const { behaviorTrees } = parseWorkspaceXml(xml);
    expect(behaviorTrees.length).toBe(1);
    const imported = behaviorTrees[0]!;
    expect(imported.projectKind).toBe("state_machine");
    // 有 State 节点
    const states = Object.values(imported.nodes).filter((n) => n.nodeType === "State");
    expect(states.length).toBeGreaterThanOrEqual(2);
    // 转移节点存在
    const transitions = Object.values(imported.nodes).filter((n) => n.nodeType === "ConditionTransition");
    expect(transitions.length).toBeGreaterThanOrEqual(1);
    // 转移有 transitionTarget
    expect(transitions[0]!.transitionTarget).toBeTruthy();
    // 边存在
    expect(Object.keys(imported.edges).length).toBeGreaterThan(0);
  });

  it("配置(模型目录/导出目录/命名空间)往返保存与恢复", () => {
    const { tree } = buildMinimalTree();
    const xml = serializeWorkspaceXml({
      name: "cfg_ws",
      language: "cpp",
      config: { modelRoot: "F:/FOSim/FZFOSimModel", exportCodeDir: "D:/out/gen", cppNamespace: "myproj", engineSrcDir: "F:/FOSim/FOSimEngine" },
      trees: [tree],
      globalBlackboards: [],
      catalog: emptyCatalog,
    });
    expect(xml).toContain('<Config modelRoot="F:/FOSim/FZFOSimModel"');
    expect(xml).toContain('exportCodeDir="D:/out/gen"');
    expect(xml).toContain('cppNamespace="myproj"');

    const parsed = parseWorkspaceXml(xml);
    expect(parsed.name).toBe("cfg_ws");
    expect(parsed.language).toBe("cpp");
    expect(parsed.config.modelRoot).toBe("F:/FOSim/FZFOSimModel");
    expect(parsed.config.exportCodeDir).toBe("D:/out/gen");
    expect(parsed.config.cppNamespace).toBe("myproj");
    expect(parsed.config.engineSrcDir).toBe("F:/FOSim/FOSimEngine");
    expect(parsed.behaviorTrees.length).toBe(1);
  });
});
