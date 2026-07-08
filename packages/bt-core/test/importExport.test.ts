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

    // 全局黑板已迁到 scenario 层 global_black_boards.xml,BT XML 里 <Blackboards> 只剩 local。
    // 单文件 importRuntimeXml 只能恢复 local BB。
    expect(imported.globalBlackboards.length).toBe(0);
    expect(res.artifacts!.globalBlackboardsXml).toContain('key="duration"');
    expect(res.artifacts!.globalBlackboardsXml).toContain('id="nd_global"');
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

  it("老引擎 <Condition> 带子归一为 Sequence(对齐 C++ 新引擎:Condition 必须叶子)", () => {
    // C++ bt_xml_loader (L525):Condition must be a leaf。vue2 nodeConfig 也把 condition 归入叶子类。
    // 老 .bt 里的 <Condition><Action/><Action/></Condition> = AND 组合,与 Sequence 语义等价 →
    // 导入时归一为 Sequence,保证 registry 合法性(Condition 的 min/max=0)。
    const xml = `<?xml version='1.0' encoding='utf-8'?>
<Root>
  <Sequence>
    <Condition>
      <Action function="Get_Sensor_Status" />
      <Action function="ConfigureOnUnit" />
    </Condition>
    <Action function="Check_Weaspon_Enable" />
  </Sequence>
</Root>`;
    const res = importer.importRuntimeXml(xml);
    const seqs = Object.values(res.tree.nodes).filter((n) => n.nodeType === "Sequence");
    // 外层 Sequence + 归一后的原 Condition = 2 个 Sequence
    expect(seqs.length).toBe(2);
    const normalized = seqs.find((n) => n.childOrder.length === 2);
    expect(normalized).toBeTruthy();
    const actions = Object.values(res.tree.nodes).filter((n) => n.nodeType === "Action");
    expect(actions.length).toBe(3);
  });

  it("叶子 <Condition function=.../> 保持 Condition 类型(不归一)", () => {
    // 无子的 Condition 是条件谓词叶子,保留 nodeType=Condition。
    const xml = `<?xml version='1.0' encoding='utf-8'?>
<Root>
  <Sequence>
    <Condition function="Check_Enemy" />
    <Action function="Fire" />
  </Sequence>
</Root>`;
    const res = importer.importRuntimeXml(xml);
    const cond = Object.values(res.tree.nodes).find((n) => n.nodeType === "Condition");
    expect(cond?.functionRef).toBe("Check_Enemy");
    expect(cond?.childOrder.length).toBe(0);
    const out = exporter.exportAll({ doc: createDocument(res.tree) });
    expect(out.ok).toBe(true);
    expect(out.artifacts!.xml).toContain("<Condition");
  });
});
