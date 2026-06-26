import { describe, it, expect } from "vitest";
import {
  ExportPipeline,
  ImportPipeline,
  createDocument,
} from "../src/index.js";
import { buildMinimalTree, makeBlackboard } from "./helpers.js";

const exporter = new ExportPipeline();
const importer = new ImportPipeline();

describe("导入/导出往返(文档 §9 / §16.2)", () => {
  it("导出 XML 可被解析并恢复节点结构", () => {
    const { bus, ids } = buildMinimalTree();
    const bb = makeBlackboard();
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
    const res = exporter.exportAll({ doc: createDocument(bus.getTree()), blackboards: [bb] });
    expect(res.ok).toBe(true);

    const imported = importer.importRuntimeXml(res.artifacts!.xml);
    // 行为根下应有 Sequence,Sequence 下有 Action + Condition
    const nodeTypes = Object.values(imported.tree.nodes).map((n) => n.nodeType);
    expect(nodeTypes).toContain("Sequence");
    expect(nodeTypes).toContain("Action");
    expect(nodeTypes).toContain("Condition");

    // 输入绑定恢复
    const action = Object.values(imported.tree.nodes).find((n) => n.functionRef === "DoThing");
    expect(action).toBeDefined();
    expect(action!.inputBindings[0]?.source).toBe("blackboard");
    expect(action!.inputBindings[0]?.variableId).toBe("bb_duration");

    // 全局黑板恢复
    expect(imported.globalBlackboards.length).toBe(1);
    expect(imported.globalBlackboards[0]?.variables[0]?.name).toBe("duration");
  });

  it("未知节点类型导入为受限节点并进入映射修复", () => {
    const xml = `<?xml version='1.0' encoding='utf-8'?>
<Root id="1" projectType="行为树" name="legacy">
  <Blackboards />
  <ReferencedBehaviorTrees />
  <Sequence id="10" name="s">
    <WeirdLegacyNode id="11" name="x" />
  </Sequence>
</Root>`;
    const imported = importer.importRuntimeXml(xml);
    const weird = Object.values(imported.tree.nodes).find((n) => n.xmlType === "WeirdLegacyNode");
    expect(weird?.restricted).toBe(true);
    expect(imported.report.unresolvedCount).toBeGreaterThan(0);
  });

  it("comparetype=Output 比较字段往返恢复", () => {
    const { bus, ids } = buildMinimalTree();
    bus.execute({
      kind: "UpdateNodeProperty",
      nodeId: ids.cond!,
      patch: { compareType: "Output", compareOutputName: "S", compareOp: "ge", compareValue: "2" },
    });
    const res = exporter.exportAll({ doc: createDocument(bus.getTree()) });
    const imported = importer.importRuntimeXml(res.artifacts!.xml);
    const cond = Object.values(imported.tree.nodes).find((n) => n.nodeType === "Condition");
    expect(cond?.compareType).toBe("Output");
    expect(cond?.compareOutputName).toBe("S");
    expect(cond?.compareOp).toBe("ge");
    expect(cond?.compareValue).toBe("2");
  });
});
