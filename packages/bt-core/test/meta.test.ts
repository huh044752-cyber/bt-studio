import { describe, it, expect } from "vitest";
import { serializeMetaXml, parseMetaXml, generateCpp, type CatalogBundle } from "../src/index.js";

function sampleCatalog(): CatalogBundle {
  return {
    functionCatalog: {
      functions: [
        {
          functionId: "fn_engage",
          name: "Engage",
          displayName: "进入交战",
          category: "action",
          bindingTarget: "FZAirFighter.Engage",
          ownerClass: "FZAirFighter",
          returnType: "behaviac::EBTStatus",
          params: [
            { paramId: "p1", name: "TARGET", direction: "input", displayType: "string", valueFormat: "literal", required: true, originalType: "string" },
            { paramId: "p2", name: "RESULT", direction: "output", displayType: "int", valueFormat: "literal", required: false, originalType: "int" },
          ],
        },
      ],
    },
    globalBlackboards: [],
    enums: [
      { enumId: "e1", name: "WeaponState", displayType: "enum", malType: "FZ_MARGTYPE_NAME", items: [{ runtimeValue: "Idle", displayName: "空闲" }, { runtimeValue: "Fire", displayName: "开火" }] },
    ],
    structs: [],
    types: [],
    classes: [{ classId: "c1", className: "FZAirFighter", displayName: "战机", category: "agent", hostModule: "" }],
    members: [
      { memberId: "m1", ownerClassId: "c1", memberName: "speed", valueType: "float", accessMode: "readwrite", bindingPath: "Self.FZAirFighter::speed", static: false },
      { memberId: "m2", ownerClassId: "c1", memberName: "g_count", valueType: "int", accessMode: "readwrite", bindingPath: "Self.FZAirFighter::g_count", static: true },
    ],
  };
}

describe("meta.xml 导出/导入 + C++ 代码生成", () => {
  it("serialize→parse 往返保留类/成员/方法/枚举", () => {
    const cat = sampleCatalog();
    const xml = serializeMetaXml(cat);
    expect(xml).toContain('<agent classfullname="FZAirFighter"');
    expect(xml).toContain('<Method Name="Engage"');
    expect(xml).toContain('IsRef="true"'); // 输出参数
    expect(xml).toContain('<enumtype Type="WeaponState"');

    const back = parseMetaXml(xml);
    expect(back.classes?.[0]?.className).toBe("FZAirFighter");
    expect(back.functionCatalog?.functions?.[0]?.name).toBe("Engage");
    const fn = back.functionCatalog!.functions[0]!;
    expect(fn.params.find((p) => p.name === "RESULT")?.direction).toBe("output");
    expect(back.members?.find((m) => m.memberName === "g_count")?.static).toBe(true);
    expect(back.enums?.[0]?.items.length).toBe(2);
  });

  it("生成 behaviac 风格 C++ Agent 头 + types 头", () => {
    const files = generateCpp(sampleCatalog());
    const types = files.find((f) => f.path.endsWith("btstudio_types.h"))!;
    expect(types.content).toContain("enum WeaponState");
    const agent = files.find((f) => f.path.includes("FZAirFighter.h"))!;
    expect(agent.content).toContain("class FZAirFighter : public behaviac::Agent");
    expect(agent.content).toContain("behaviac::EBTStatus Engage(");
    expect(agent.content).toContain("///<<< BEGIN WRITING YOUR CODE");
    expect(agent.content).toContain("static int g_count;");
  });
});
