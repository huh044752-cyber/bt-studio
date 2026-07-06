import { describe, it, expect } from "vitest";
import {
  parseMcrTemplate,
  deriveMcrTemplates,
  filterClassesByTemplate,
  filterFunctionsByTemplate,
  type ClassDescriptor,
  type FunctionDescriptor,
  type McrTemplateFile,
} from "../src/index.js";

// 老格式 MCR:命名子节点,uuid + type 直接可见。样例简化自 F16.mcr 结构。
const OLD_MCR_F16 = `<?xml version="1.0" encoding="UTF-8"?>
<MCR icon_2d="方州军标库/歼击机" model_3d="" note="" LocateType="空中">
  <CyCFWPilot uuid="1" name="飞行员认知" type="Cognition" count="1" parent_uuid=""/>
  <FzBaseC3I uuid="2" name="Fz通信认知" type="Cognition" count="1" parent_uuid=""/>
  <FzAPSDP uuid="3" name="FZData处理器" type="DataProcessors" count="1" parent_uuid="">
    <TransmitFrequency>1.000</TransmitFrequency>
  </FzAPSDP>
  <FzFixedWing uuid="9" name="Fz_J_16" type="Platforms" count="1" parent_uuid="">
    <MaxSpeed>300.000</MaxSpeed>
  </FzFixedWing>
</MCR>`;

// 新格式 MCR:泛型 <member data_id=...>,className 不可得。样例简化自 HQ-9A.mcr。
const NEW_MCR_HQ9A = `<?xml version="1.0" encoding="UTF-8"?>
<MCR id="3b91320b-034e-400d-876e-5fe03b1880dc" icon_2d="" model_3d="8dd50eba-55f6-44c3-9ac9-1338851880aa" note="" locate_type="">
  <member count="1" data_type="common" data_id="96320164-377e-4162-bfc3-443b314cc9a3"/>
  <member count="1" data_type="common" data_id="cdd1899f-3d35-491b-92af-a0e319d3b7e4"/>
  <member count="1" data_type="common" data_id="edaf002f-0202-43ae-b751-54ae8b12084d"/>
</MCR>`;

// 空 MCR:根节点存在但无子 —— 应稳定返回空模板。
const EMPTY_MCR = `<?xml version="1.0" encoding="UTF-8"?><MCR/>`;

function fixture(name: string, category: string, xml: string): McrTemplateFile {
  return { path: `F:/fake/${category}/${name}.mcr`, templateName: name, category, xml };
}

describe("mcr 解析", () => {
  it("老格式:命名子节点全部进 components,cognitionClass 取首个 type=Cognition", () => {
    const t = parseMcrTemplate(fixture("F16", "飞机", OLD_MCR_F16));
    expect(t.templateName).toBe("F16");
    expect(t.category).toBe("飞机");
    expect(t.locateType).toBe("空中");
    // 老格式无 id → 兜底 `${category}::${templateName}`
    expect(t.templateId).toBe("飞机::F16");
    expect(t.components.length).toBe(4);
    expect(t.componentClasses.sort()).toEqual(
      ["CyCFWPilot", "FzAPSDP", "FzBaseC3I", "FzFixedWing"],
    );
    expect(t.cognitionClass).toBe("CyCFWPilot"); // 首个 Cognition
    expect(t.unresolvedCount).toBe(0);
    const cog = t.components.find((c) => c.className === "CyCFWPilot");
    expect(cog?.componentId).toBe("1");
    expect(cog?.componentType).toBe("Cognition");
  });

  it("新格式:<member> 全部记 unresolvedCount,components/componentClasses 为空;id 属性作 templateId", () => {
    const t = parseMcrTemplate(fixture("HQ-9A地导系统", "地导阵地", NEW_MCR_HQ9A));
    expect(t.templateId).toBe("3b91320b-034e-400d-876e-5fe03b1880dc");
    expect(t.components).toHaveLength(0);
    expect(t.componentClasses).toHaveLength(0);
    expect(t.cognitionClass).toBeUndefined();
    expect(t.unresolvedCount).toBe(3);
  });

  it("空 MCR:稳定返回空模板,不抛异常", () => {
    const t = parseMcrTemplate(fixture("empty", "测试", EMPTY_MCR));
    expect(t.components).toHaveLength(0);
    expect(t.componentClasses).toHaveLength(0);
    expect(t.unresolvedCount).toBe(0);
  });
});

describe("deriveMcrTemplates 合并", () => {
  it("多文件汇总;同 templateId 后来居上覆盖", () => {
    const list = deriveMcrTemplates([
      fixture("F16", "飞机", OLD_MCR_F16),
      fixture("HQ-9A地导系统", "地导阵地", NEW_MCR_HQ9A),
    ]);
    expect(list).toHaveLength(2);
    // 同名同分类的 F16 再传一份,内容变更 —— 后者胜出
    const F16_V2 = OLD_MCR_F16.replace("<FzFixedWing", "<FzMissile");
    const list2 = deriveMcrTemplates([
      fixture("F16", "飞机", OLD_MCR_F16),
      fixture("F16", "飞机", F16_V2),
    ]);
    const f16 = list2.find((t) => t.templateName === "F16")!;
    expect(f16.componentClasses).not.toContain("FzFixedWing");
    expect(f16.componentClasses).toContain("FzMissile");
  });
});

describe("过滤契约", () => {
  const classes: ClassDescriptor[] = [
    { classId: "1", className: "CyCFWPilot", displayName: "飞行员", category: "RuleDecision", hostModule: "RuleDecision", source: "model" },
    { classId: "2", className: "FzFixedWing", displayName: "固翼", category: "Equipment", hostModule: "Equipment", source: "model" },
    { classId: "3", className: "FzRadar", displayName: "雷达", category: "Equipment", hostModule: "Equipment", source: "model" },
  ];
  const fns: FunctionDescriptor[] = [
    { functionId: "f1", name: "Think", ownerClass: "CyCFWPilot", category: "action", params: [] },
    { functionId: "f2", name: "Fly", ownerClass: "FzFixedWing", category: "action", params: [] },
    { functionId: "f3", name: "Scan", ownerClass: "FzRadar", category: "action", params: [] },
  ];

  it("模板未选 → 全量返回", () => {
    expect(filterClassesByTemplate(classes, undefined)).toHaveLength(3);
    expect(filterFunctionsByTemplate(fns, undefined)).toHaveLength(3);
  });

  it("模板已选 → componentClasses ∩ 类目 / ownerClass", () => {
    const [t] = deriveMcrTemplates([fixture("F16", "飞机", OLD_MCR_F16)]);
    const c = filterClassesByTemplate(classes, t);
    expect(c.map((x) => x.className).sort()).toEqual(["CyCFWPilot", "FzFixedWing"]);
    const f = filterFunctionsByTemplate(fns, t);
    expect(f.map((x) => x.name).sort()).toEqual(["Fly", "Think"]);
  });
});
