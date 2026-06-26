import { describe, it, expect } from "vitest";
import { parseScenarioUnits, attachTreeToScenario, validateTreeForUnit } from "../src/index.js";

const SDATA = `<?xml version="1.0" encoding="utf-8"?>
<Scenario>
  <Name>测试</Name>
  <Units>
    <Unit>
      <ObjectHandle>1</ObjectHandle>
      <Name>J-10</Name>
      <TypeOfUnit>飞机</TypeOfUnit>
      <ModelID>ef03d74a</ModelID>
      <ModelData>
        <FzFixedWing data_id="88b58942-bfa3-4c64-8211-3c7b8a7b5c5d" />
        <FzAPSDP data_id="cdd1899f-3d35-491b-92af-a0e319d3b7e4" />
      </ModelData>
    </Unit>
  </Units>
</Scenario>`;

const TREE = `<?xml version='1.0' encoding='utf-8'?>
<Root id="1" projectType="行为树" name="t" btTemplateId="tpl-1" modelId="m1">
  <Action id="1" name="a" function="Engage" className="FZAirFighter" />
</Root>`;

describe("场景 .sdata 解析与挂接(R4)", () => {
  it("解析 Units + 组件 className/componentId", () => {
    const units = parseScenarioUnits(SDATA);
    expect(units.length).toBe(1);
    expect(units[0]!.name).toBe("J-10");
    expect(units[0]!.objectHandle).toBe("1");
    const fw = units[0]!.components.find((c) => c.className === "FzFixedWing")!;
    expect(fw.componentId).toBe("88b58942-bfa3-4c64-8211-3c7b8a7b5c5d");
  });

  it("挂接树:无 BehaviorLogic 时新建并插入实例", () => {
    const r = attachTreeToScenario(SDATA, { instanceName: "空战树", belongUnit: "1", btTemplateId: "tpl-1", modelId: "m1", treeXml: TREE, policy: "backup_then_overwrite" });
    expect(r.ok).toBe(true);
    expect(r.xml).toContain("<BehaviorLogic>");
    expect(r.xml).toContain('<BehaviorTreeInstance id="1" name="空战树" belongUnit="1"');
    expect(r.xml).toContain('function="Engage"');
    // 仅保留场景自身的 1 个 xml 头;内联 Root 的头已去除
    expect((r.xml!.match(/<\?xml/g) || []).length).toBe(1);
    expect(r.conflict).toBe(false);
  });

  it("挂接校验:实体组件是否含节点函数", () => {
    const unit = parseScenarioUnits(SDATA)[0]!;
    const fns = [
      { name: "AvoidThread", ownerClass: "FzFixedWing", bindingTarget: "FzFixedWing.AvoidThread" },
      { name: "Engage", ownerClass: "FZAirFighter", bindingTarget: "FZAirFighter.Engage" },
    ];
    const tree = {
      nodes: {
        n1: { nodeId: "n1", nodeType: "Action", name: "规避", functionRef: "AvoidThread", targetSelector: { modelClass: "FzFixedWing" } },
        n2: { nodeId: "n2", nodeType: "Action", name: "交战", functionRef: "Engage", targetSelector: { modelClass: "FZAirFighter" } },
        n3: { nodeId: "n3", nodeType: "Action", name: "缺方法", functionRef: "Nope", targetSelector: { modelClass: "FzFixedWing" } },
      },
    };
    const v = validateTreeForUnit(tree, unit, fns);
    // FzFixedWing 是 J-10 的组件且含 AvoidThread → ok
    expect(v.issues.find((i) => i.nodeId === "n1")?.level).toBe("ok");
    // FZAirFighter 不是 J-10 的组件 → error
    expect(v.issues.find((i) => i.nodeId === "n2")?.level).toBe("error");
    // FzFixedWing 不含 Nope → error
    expect(v.issues.find((i) => i.nodeId === "n3")?.level).toBe("error");
    expect(v.errorCount).toBe(2);
  });

  it("同名实例:reject 拒绝,overwrite 替换", () => {
    const once = attachTreeToScenario(SDATA, { instanceName: "空战树", belongUnit: "1", btTemplateId: "tpl-1", modelId: "m1", treeXml: TREE, policy: "backup_then_overwrite" }).xml!;
    const rej = attachTreeToScenario(once, { instanceName: "空战树", belongUnit: "1", btTemplateId: "tpl-1", modelId: "m1", treeXml: TREE, policy: "reject" });
    expect(rej.ok).toBe(false);
    expect(rej.conflict).toBe(true);
    const ow = attachTreeToScenario(once, { instanceName: "空战树", belongUnit: "1", btTemplateId: "tpl-1", modelId: "m1", treeXml: TREE, policy: "overwrite" });
    expect(ow.ok).toBe(true);
    // 只应有一个该名实例
    expect((ow.xml!.match(/name="空战树"/g) || []).length).toBe(1);
  });
});
