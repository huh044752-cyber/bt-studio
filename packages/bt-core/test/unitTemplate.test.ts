import { describe, it, expect } from "vitest";
import {
  deriveUnitTemplates,
  filterClassesByTemplate,
  filterFunctionsByTemplate,
  unitToTemplate,
  parseScenarioUnits,
  type ClassDescriptor,
  type FunctionDescriptor,
} from "../src/index.js";

// 老版 .sdata:ModelData 里有一层"模型名"包装,组件带 type="Cognition/Equipment/..."
const OLD_SDATA_A = `<?xml version="1.0" encoding="UTF-8"?>
<Scenario>
  <Units>
    <Unit>
      <ObjectHandle>1</ObjectHandle>
      <Name>J-10</Name>
      <TypeOfUnit>飞机</TypeOfUnit>
      <ModelID>uuid-j10</ModelID>
      <ModelData>
        <J10包>
          <FzFixedWing data_id="wing-1" type="Equipment"/>
          <FzOOIC uuid="cog-1" type="Cognition"/>
          <FzAPSDP data_id="sen-1" type="Equipment"/>
        </J10包>
      </ModelData>
    </Unit>
    <Unit>
      <ObjectHandle>2</ObjectHandle>
      <Name>基地</Name>
      <ModelData>
        <基地包>
          <FzBase uuid="base-1" type="Platform"/>
        </基地包>
      </ModelData>
    </Unit>
  </Units>
</Scenario>`;

// 新版 .sdata:一层扁平,组件无 type 属性
const NEW_SDATA_B = `<?xml version="1.0" encoding="UTF-8"?>
<Scenario>
  <Units>
    <Unit>
      <ObjectHandle>7</ObjectHandle>
      <Name>SU-27</Name>
      <ModelID>uuid-su27</ModelID>
      <ModelData>
        <FzFixedWing data_id="w2"/>
        <FzRadar data_id="r2"/>
      </ModelData>
    </Unit>
  </Units>
</Scenario>`;

// 空 Unit(没有可用组件)不应产生模板
const EMPTY_SDATA = `<?xml version="1.0" encoding="UTF-8"?>
<Scenario><Units><Unit><Name>空壳</Name><ModelData/></Unit></Units></Scenario>`;

describe("unitTemplate", () => {
  it("解析老版 .sdata 后 componentType 被保留", () => {
    const units = parseScenarioUnits(OLD_SDATA_A);
    const j10 = units.find((u) => u.name === "J-10");
    expect(j10).toBeTruthy();
    const cog = j10!.components.find((c) => c.className === "FzOOIC");
    expect(cog?.componentType).toBe("Cognition");
  });

  it("unitToTemplate:cognition 组件类被抽出为 cognitionClass,组件实例完整保留", () => {
    const units = parseScenarioUnits(OLD_SDATA_A);
    const j10 = units.find((u) => u.name === "J-10")!;
    const t = unitToTemplate("场景A", j10);
    expect(t.templateId).toBe("uuid-j10");
    expect(t.unitName).toBe("J-10");
    expect(t.scenarioName).toBe("场景A");
    expect(t.componentClasses.sort()).toEqual(["FzAPSDP", "FzFixedWing", "FzOOIC"]);
    expect(t.cognitionClass).toBe("FzOOIC");
    expect(t.typeOfUnit).toBe("飞机");
    expect(t.components.length).toBe(3);
    const cog = t.components.find((c) => c.className === "FzOOIC");
    expect(cog?.componentId).toBe("cog-1");
    expect(cog?.componentType).toBe("Cognition");
  });

  it("deriveUnitTemplates:多份想定合并 + 空壳 Unit 被跳过", () => {
    const list = deriveUnitTemplates([
      { name: "场景A", sdataXml: OLD_SDATA_A },
      { name: "场景B", sdataXml: NEW_SDATA_B },
      { name: "空场景", sdataXml: EMPTY_SDATA },
    ]);
    expect(list.length).toBe(3); // J-10 + 基地 + SU-27
    expect(list.find((t) => t.unitName === "空壳")).toBeUndefined();
    const su27 = list.find((t) => t.unitName === "SU-27")!;
    expect(su27.componentClasses.sort()).toEqual(["FzFixedWing", "FzRadar"]);
    expect(su27.cognitionClass).toBeUndefined(); // 新版无 type 属性
  });

  it("deriveUnitTemplates:同 templateId(UUID) 后来居上覆盖", () => {
    const first = deriveUnitTemplates([{ name: "旧", sdataXml: OLD_SDATA_A }]);
    const updated = OLD_SDATA_A.replace(
      "<FzAPSDP data_id=\"sen-1\" type=\"Equipment\"/>",
      "",
    );
    const list = deriveUnitTemplates([
      { name: "旧", sdataXml: OLD_SDATA_A },
      { name: "新", sdataXml: updated },
    ]);
    const j10 = list.find((t) => t.templateId === "uuid-j10")!;
    expect(j10.componentClasses).not.toContain("FzAPSDP"); // 后来的少了传感器
    expect(first.find((t) => t.templateId === "uuid-j10")!.componentClasses).toContain("FzAPSDP");
  });

  const classes: ClassDescriptor[] = [
    { classId: "1", className: "FzFixedWing", displayName: "固翼", category: "Equipment", hostModule: "Equipment", source: "model" },
    { classId: "2", className: "FzOOIC", displayName: "认知", category: "RuleDecision", hostModule: "RuleDecision", source: "model" },
    { classId: "3", className: "FzRadar", displayName: "雷达", category: "Equipment", hostModule: "Equipment", source: "model" },
    { classId: "4", className: "FzOther", displayName: "无关", category: "Equipment", hostModule: "Equipment", source: "model" },
  ];
  const fns: FunctionDescriptor[] = [
    { functionId: "f1", name: "Fly", ownerClass: "FzFixedWing", category: "action", params: [] },
    { functionId: "f2", name: "Think", ownerClass: "FzOOIC", category: "action", params: [] },
    { functionId: "f3", name: "Scan", ownerClass: "FzRadar", category: "action", params: [] },
    { functionId: "f4", name: "Noop", ownerClass: "FzOther", category: "action", params: [] },
  ];

  it("filterClassesByTemplate:模板已选 → 只留组件类;未选 → 全量", () => {
    const [t] = deriveUnitTemplates([{ name: "A", sdataXml: OLD_SDATA_A }]);
    const filtered = filterClassesByTemplate(classes, t);
    expect(filtered.map((c) => c.className).sort()).toEqual(["FzFixedWing", "FzOOIC"]);
    expect(filterClassesByTemplate(classes, undefined)).toHaveLength(4);
  });

  it("filterFunctionsByTemplate:按 ownerClass ∈ 模板 过滤,FzOther 被剔除", () => {
    const [t] = deriveUnitTemplates([{ name: "A", sdataXml: OLD_SDATA_A }]);
    const filtered = filterFunctionsByTemplate(fns, t);
    expect(filtered.map((f) => f.name).sort()).toEqual(["Fly", "Think"]);
    expect(filterFunctionsByTemplate(fns, undefined)).toHaveLength(4);
  });
});
