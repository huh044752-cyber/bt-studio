import { describe, it, expect } from "vitest";
import {
  ExportPipeline,
  ValidationEngine,
  GraphCommandBus,
  createDocument,
  FOSIM_PROJECT_TYPE,
  type Blackboard,
} from "../src/index.js";
import { buildMinimalTree, makeBlackboard } from "./helpers.js";

const pipeline = new ExportPipeline();
const validation = new ValidationEngine();

describe("Export Pipeline(文档 §16.2)", () => {
  it("单 Root 正常树导出成功,根 projectType=行为树", () => {
    const { tree } = buildMinimalTree();
    const res = pipeline.exportAll({ doc: createDocument(tree) });
    expect(res.ok).toBe(true);
    expect(res.artifacts?.xml).toContain(`projectType="${FOSIM_PROJECT_TYPE}"`);
    expect(res.artifacts?.xml).toContain("<?xml version='1.0' encoding='utf-8'?>");
    expect(res.artifacts?.xml).toContain("<Sequence");
    expect(res.artifacts?.xml).toContain('function="DoThing"');
  });

  it("多 Root 被校验阻断", () => {
    const { tree, bus } = buildMinimalTree();
    // 直接注入第二个 Root 节点(绕过 bus 的 Root 限制,模拟非法状态)
    const extra = "node_extra_root";
    tree.nodes[extra] = {
      nodeId: extra,
      nodeType: "Root",
      name: "Root2",
      inputBindings: [],
      outputBindings: [],
      childOrder: [],
    };
    void bus;
    const issues = validation.validate(tree, { mode: "standalone" });
    expect(issues.some((i) => i.level === "error" && /多个 Root/.test(i.message))).toBe(true);
    const res = pipeline.exportAll({ doc: createDocument(tree) });
    expect(res.ok).toBe(false);
  });

  it("缺失函数绑定被阻止发布", () => {
    const { tree, bus, ids } = buildMinimalTree();
    bus.execute({ kind: "UpdateNodeProperty", nodeId: ids.action!, patch: { functionRef: "" } });
    const res = pipeline.exportAll({ doc: createDocument(bus.getTree()) });
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.level === "error" && /未绑定函数/.test(i.message))).toBe(true);
  });

  it("子树引用缺失被阻止发布", () => {
    const { tree, bus, ids } = buildMinimalTree();
    const sub = bus.execute({ kind: "AddNode", nodeType: "Subtree", name: "子树X", parentNodeId: ids.seq! });
    bus.execute({ kind: "SetSubtreeRef", nodeId: sub.createdNodeId!, subtreeRef: "missing_tree_id" });
    void tree;
    const res = pipeline.exportAll({ doc: createDocument(bus.getTree()) });
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.source === "subtree")).toBe(true);
  });

  it("Blackboard 输入输出映射写入 XML", () => {
    const { tree, bus, ids } = buildMinimalTree();
    const bb: Blackboard = makeBlackboard();
    bus.execute({
      kind: "BindVariable",
      nodeId: ids.action!,
      direction: "input",
      binding: {
        name: "DURATION_TIME",
        type: "CyberRealType",
        source: "blackboard",
        blackboardId: bb.blackboardId,
        variableId: "bb_duration",
        malType: "CYBER_MARGTYPE_REAL",
      },
    });
    bus.execute({
      kind: "BindVariable",
      nodeId: ids.action!,
      direction: "output",
      binding: { name: "RESULT", blackboardId: bb.blackboardId, variableId: "bb_duration" },
    });
    void tree;
    const res = pipeline.exportAll({ doc: createDocument(bus.getTree()), blackboards: [bb] });
    expect(res.ok).toBe(true);
    const xml = res.artifacts!.xml;
    expect(xml).toContain('source="blackboard"');
    expect(xml).toContain('blackboardKey="nd_global"');
    expect(xml).toContain('variableKey="bb_duration"');
    expect(xml).toContain("<Outputs>");
    // 黑板段
    expect(xml).toContain('scope="global"');
  });

  it("条件比较字段映射(comparetype=Output + Output op/value)", () => {
    const { bus, ids } = buildMinimalTree();
    bus.execute({
      kind: "UpdateNodeProperty",
      nodeId: ids.cond!,
      patch: {
        compareType: "Output",
        compareOutputName: "JAMMER_STATUS",
        compareOp: "eq",
        compareValue: "1",
      },
    });
    const res = pipeline.exportAll({ doc: createDocument(bus.getTree()) });
    expect(res.ok).toBe(true);
    const xml = res.artifacts!.xml;
    expect(xml).toContain('comparetype="Output"');
    expect(xml).toContain('<Output name="JAMMER_STATUS" op="eq" value="1" />');
  });

  it("导出 Meta 不含运行字段,binding manifest 记录函数", () => {
    const { tree } = buildMinimalTree();
    const res = pipeline.exportAll({ doc: createDocument(tree) });
    expect(res.ok).toBe(true);
    const meta = JSON.parse(res.artifacts!.meta);
    expect(meta.editorMeta).toBeDefined();
    const manifest = JSON.parse(res.artifacts!.bindingManifest);
    expect(manifest.functions.map((f: { ref: string }) => f.ref)).toContain("DoThing");
  });

  it("Linked FOSim:缺少 malType 的输入被阻断", () => {
    const { bus, ids } = buildMinimalTree();
    const tree = bus.getTree();
    tree.mode = "linked_fosim";
    bus.execute({
      kind: "BindVariable",
      nodeId: ids.action!,
      direction: "input",
      binding: { name: "X", type: "", source: "constant", value: "1" }, // 无 malType
    });
    const res = pipeline.exportAll({ doc: createDocument(bus.getTree()) });
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.source === "mal")).toBe(true);
  });

  it("不回写(variableId 为空)的输出参数不写入 <Outputs> 元素", () => {
    const { bus, ids } = buildMinimalTree();
    // 设置输出参数但不选回写变量(variableId 留空)
    bus.execute({
      kind: "BindVariable",
      nodeId: ids.action!,
      direction: "output",
      binding: { name: "RESULT", blackboardId: "", variableId: "" },
    });
    const res = pipeline.exportAll({ doc: createDocument(bus.getTree()) });
    expect(res.ok).toBe(true);
    expect(res.artifacts!.xml).not.toContain("<Outputs>");
  });

  it("回写类型不匹配被校验为 error", () => {
    const { bus, ids } = buildMinimalTree();
    // 模拟绑定了类型不匹配的黑板变量
    const issues = validation.validate(bus.getTree(), {
      mode: "standalone",
      catalogs: {
        functionCatalog: {
          functions: [{
            functionId: "fn_t", name: "DoThing", category: "action", bindingTarget: "X.DoThing",
            ownerClass: "X", returnType: "CyberDFMPFRC",
            params: [{ paramId: "p1", name: "RESULT", direction: "output", displayType: "int", malType: "CYBER_MARGTYPE_INTEGER", valueFormat: "literal", required: false }],
          }],
        },
        globalBlackboards: [],
        enums: [], structs: [], types: [], classes: [], members: [],
      },
      blackboards: [{
        blackboardId: "bb1", name: "test", scope: "global", runtimeScope: "Global", linked: true,
        variables: [{ variableId: "v1", name: "s", scope: "global", displayType: "string", malType: "CYBER_MARGTYPE_STRING", valueFormat: "literal" }],
      }],
    });
    // Force output binding with type mismatch
    const n = bus.getTree().nodes[ids.action!]!;
    n.functionRef = "DoThing"; n.targetSelector = { modelClass: "X" };
    n.outputBindings = [{ name: "RESULT", blackboardId: "bb1", variableId: "v1", malType: "CYBER_MARGTYPE_INTEGER" }];
    const issues2 = validation.validate(bus.getTree(), {
      mode: "standalone",
      catalogs: { functionCatalog: { functions: [{ functionId: "fn_t", name: "DoThing", category: "action", bindingTarget: "X.DoThing", ownerClass: "X", returnType: "CyberDFMPFRC", params: [{ paramId: "p1", name: "RESULT", direction: "output", displayType: "int", malType: "CYBER_MARGTYPE_INTEGER", valueFormat: "literal", required: false }] }] }, globalBlackboards: [], enums: [], structs: [], types: [], classes: [], members: [] },
      blackboards: [{ blackboardId: "bb1", name: "test", scope: "global", runtimeScope: "Global", linked: true, variables: [{ variableId: "v1", name: "s", scope: "global", displayType: "string", malType: "CYBER_MARGTYPE_STRING", valueFormat: "literal" }] }],
    });
    expect(issues2.some((i) => i.level === "error" && /回写类型不匹配/.test(i.message))).toBe(true);
    void issues;
  });

  it("AddNode 自动注入注册表字段默认值(Parallel 阈值)", () => {
    const { bus, ids } = buildMinimalTree();
    const r = bus.execute({ kind: "AddNode", nodeType: "Parallel", parentNodeId: ids.seq! });
    const node = bus.getTree().nodes[r.createdNodeId!]!;
    expect(node.parallelSuccessThreshold).toBe(1);
    expect(node.parallelFailureThreshold).toBe(1);
  });
});
