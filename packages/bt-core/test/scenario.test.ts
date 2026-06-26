import { describe, it, expect } from "vitest";
import { parseScenarioUnits, attachTreeToScenario, validateTreeForUnit, attachOldScenario } from "../src/index.js";

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

  it("老版 .sdata:ModelData 含中文包装层(uuid 属性)也能解析组件", () => {
    const oldSdata = `<?xml version="1.0"?>
<Scenario>
  <Units>
    <Unit>
      <ObjectHandle>1</ObjectHandle>
      <Name>基地</Name>
      <ModelName>基地</ModelName>
      <ModelData>
        <基地>
          <FzOOIC note="" uuid="1" name="FzOOIC" type="Cognition" count="1" parent_uuid=""/>
          <FzBaseC3I note="" uuid="4" name="Fz通信认知" type="Cognition" count="1" parent_uuid=""/>
        </基地>
      </ModelData>
      <Script></Script>
    </Unit>
  </Units>
</Scenario>`;
    const units = parseScenarioUnits(oldSdata);
    expect(units.length).toBe(1);
    const u = units[0]!;
    expect(u.name).toBe("基地");
    expect(u.components.find((c) => c.className === "FzOOIC")?.componentId).toBe("1");
    expect(u.components.find((c) => c.className === "FzBaseC3I")?.componentId).toBe("4");
  });

  it("attachOldScenario:把 ADD Behaviac 写入 <Unit><Script>", () => {
    const oldSdata = `<?xml version="1.0"?>
<Scenario>
  <Units>
    <Unit>
      <ObjectHandle>1</ObjectHandle>
      <Name>歼-10</Name>
      <ModelData><机型><FzOOIC uuid="1" type="Cognition"/></机型></ModelData>
      <Script></Script>
    </Unit>
    <Unit>
      <ObjectHandle>2</ObjectHandle>
      <Name>基地</Name>
      <Script></Script>
    </Unit>
  </Units>
</Scenario>`;
    const r = attachOldScenario(oldSdata, "歼-10", "air_to_m", "overwrite");
    expect(r.ok).toBe(true);
    expect(r.xml).toMatch(/歼-10[\s\S]*<Script>ADD Behaviac "air_to_m";<\/Script>/);
    // 不影响其它 Unit
    expect(r.xml).toMatch(/<Name>基地<\/Name>[\s\S]*?<Script><\/Script>/);
    // reject 重复
    const dup = attachOldScenario(r.xml!, "歼-10", "air_to_m", "reject");
    expect(dup.ok).toBe(false);
    expect(dup.conflict).toBe(true);
    // 不存在的 Unit
    const miss = attachOldScenario(oldSdata, "无此实体", "x", "overwrite");
    expect(miss.ok).toBe(false);
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
