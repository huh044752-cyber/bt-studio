import { describe, it, expect } from "vitest";
import { parseCmp, parseCmpFiles, parseCmpMuiPair, parseCmpMuiPairs, parseMuiFile } from "../src/index.js";

const COGNITION = `<?xml version="1.0" encoding="UTF-8"?>
<Prototypes class="FZAirFighter" text="空战决策认知" type="RuleDecision">
  <Prototype Name="Engage" ChName="交战" IntendedCmd="ENGAGE">
    <Inputs>
      <param name="TARGET_ID" type="CyberIntegerType" desc="目标ID"/>
      <param name="MUNITIONNUM" type="CyberIntegerType" desc="弹药数量"/>
      <param name="TARGET_POSITION" type="CyberVectorType" desc="目标位置"/>
    </Inputs>
  </Prototype>
</Prototypes>`;

const EQUIPMENT = `<?xml version="1.0" encoding="UTF-8"?>
<Prototypes class="FzComRadioJam" text="通信干扰" type="Jammers">
  <Prototype Name="JamTarget" ChName="对目标干扰" FunctionCategory="Action">
    <Inputs><views>
      <param text="持续时间" data_name="DURATION_TIME" type="DoubleSpinBox" default_value="0"/>
      <param text="目标实体" data_name="TARGET_NAME" type="LineEditor" select="Unit"/>
      <param text="是否在点上完成" data_name="IS_POINT_FINISH" type="CheckBox" default_value="0"/>
    </views></Inputs>
  </Prototype>
  <Prototype Name="QueryJammerState" ChName="查询状态" FunctionCategory="Condition">
    <Inputs><views></views></Inputs>
  </Prototype>
</Prototypes>`;

describe("真实模型 .cmp 解析(R1)", () => {
  it("认知形态:FZ 类型直读,方法+参数", () => {
    const r = parseCmp(COGNITION)!;
    expect(r.class.className).toBe("FZAirFighter");
    expect(r.class.source).toBe("model");
    const engage = r.functions.find((f) => f.name === "Engage")!;
    expect(engage.ownerClass).toBe("FZAirFighter");
    expect(engage.category).toBe("action");
    expect(engage.params.map((p) => p.name)).toEqual(["TARGET_ID", "MUNITIONNUM", "TARGET_POSITION"]);
    expect(engage.params[0]!.malType).toBe("CYBER_MARGTYPE_INTEGER");
    expect(engage.params[2]!.malType).toBe("CYBER_MARGTYPE_VECTOR");
  });

  it("装备形态:views 控件→FZ 类型,FunctionCategory 决定 action/condition", () => {
    const r = parseCmp(EQUIPMENT)!;
    expect(r.class.className).toBe("FzComRadioJam");
    const jam = r.functions.find((f) => f.name === "JamTarget")!;
    expect(jam.category).toBe("action");
    const dur = jam.params.find((p) => p.name === "DURATION_TIME")!;
    expect(dur.malType).toBe("CYBER_MARGTYPE_REAL");
    const finish = jam.params.find((p) => p.name === "IS_POINT_FINISH")!;
    expect(finish.malType).toBe("CYBER_MARGTYPE_BOOL");
    const q = r.functions.find((f) => f.name === "QueryJammerState")!;
    expect(q.category).toBe("condition");
  });

  it("批量解析多个 .cmp", () => {
    const { classes, functions } = parseCmpFiles([COGNITION, EQUIPMENT]);
    expect(classes.map((c) => c.className).sort()).toEqual(["FZAirFighter", "FzComRadioJam"]);
    expect(functions.length).toBeGreaterThanOrEqual(3);
  });
});

const OLD_COGNITION_CMP = `<?xml version="1.0"?>
<Prototypes>
  <Prototype Name="Fire" Type="Process Method" ClassName="" IsChange="false" AutoEnable="true">
    <IntendedCmd Value="FIRE"/>
    <Description Value="开火"/>
    <Delay Value="1"/>
    <Inputs>
      <Input Name="time"><Optional Value="true"/><Description Value=""/><DataType Value="Julian"/></Input>
      <Input Name="min_range"><Optional Value="false"/><Description Value="米"/><DataType Value="Real"/></Input>
      <Input Name="TargetType"><Optional Value="false"/><DataType Value="Integer"/></Input>
    </Inputs>
    <Commands>
      <Command>
        <Outputs>
          <Output Name="status"><DataType Value="Integer"/></Output>
        </Outputs>
      </Command>
    </Commands>
  </Prototype>
  <Prototype Name="Fly_Status" Type="Process Method" ClassName="" IsChange="false" AutoEnable="true">
    <IntendedCmd Value="FLY_STATUS"/>
    <Description Value="飞行状态"/>
    <Inputs></Inputs>
    <Commands><Command><Outputs></Outputs></Command></Commands>
  </Prototype>
  <Prototype Name="Is_Found_Target" Type="Process Method">
    <IntendedCmd Value="IS_FOUND_TARGET"/>
    <Inputs></Inputs>
    <Commands><Command><Outputs></Outputs></Command></Commands>
  </Prototype>
</Prototypes>`;

const OLD_COGNITION_MUI = `<?xml version='1.0'?>
<views model_type="common" type="proprety_view" remarks="空地打击认知" class="BTAirToMCog"/>`;

const OLD_EQUIPMENT_MUI = `<?xml version="1.0"?>
<views type="proprety_view" class="FzTarget" model_type="common" remarks="目标特征">
  <param text="长度" data_name="Length" type="DoubleSpinBox" default_value="0"/>
  <param text="目标类型" data_name="TargetType" type="ComboBox" default_value="飞机"/>
</views>`;

describe("老引擎 .cmp + .mui 配对解析", () => {
  it("老 .cmp 嵌套 Input/Output(<DataType Value=.../>)→ FunctionParam", () => {
    const r = parseCmp(OLD_COGNITION_CMP, "BTAirToMCog")!;
    expect(r.class.className).toBe("BTAirToMCog");
    expect(r.class.category).toBe("RuleDecision");
    expect(r.class.baseClass).toBe("CyberCognitionImpl");
    const fire = r.functions.find((f) => f.name === "Fire")!;
    expect(fire.intendedCmd).toBe("FIRE");
    expect(fire.delay).toBe(1);
    expect(fire.params.map((p) => p.name)).toEqual(["time", "min_range", "TargetType", "status"]);
    expect(fire.params[0]!.malType).toBe("CYBER_MARGTYPE_JULIAN");
    expect(fire.params[0]!.required).toBe(false); // Optional=true
    expect(fire.params[1]!.malType).toBe("CYBER_MARGTYPE_REAL");
    expect(fire.params[3]!.direction).toBe("output");
    // 空 Inputs 也登记函数(用户要求)
    const fly = r.functions.find((f) => f.name === "Fly_Status")!;
    expect(fly.params).toEqual([]);
    // 命名约定推断 condition
    const found = r.functions.find((f) => f.name === "Is_Found_Target")!;
    expect(found.category).toBe("condition");
  });

  it("老 .mui:class / model_type / remarks → ClassDescriptor", () => {
    const m = parseMuiFile(OLD_COGNITION_MUI)!;
    expect(m.cls.className).toBe("BTAirToMCog");
    expect(m.cls.baseClass).toBe("CyberCognitionImpl");
    expect(m.cls.displayName).toBe("空地打击认知");
    const eq = parseMuiFile(OLD_EQUIPMENT_MUI)!;
    expect(eq.cls.className).toBe("FzTarget");
    expect(eq.params.map((p) => p.name)).toEqual(["Length", "TargetType"]);
  });

  it("配对解析:.mui 提供元数据,.cmp 提供函数", () => {
    const r = parseCmpMuiPair(OLD_COGNITION_CMP, OLD_COGNITION_MUI, "BTAirToMCog")!;
    expect(r.class.displayName).toBe("空地打击认知");
    expect(r.class.baseClass).toBe("CyberCognitionImpl");
    expect(r.functions.find((f) => f.name === "Fire")).toBeDefined();
    const r2 = parseCmpMuiPairs([
      { baseName: "BTAirToMCog", cmp: OLD_COGNITION_CMP, mui: OLD_COGNITION_MUI },
      { baseName: "FzTarget", mui: OLD_EQUIPMENT_MUI },
    ]);
    expect(r2.classes.length).toBe(2);
    expect(r2.functions.length).toBeGreaterThanOrEqual(3);
  });
});
