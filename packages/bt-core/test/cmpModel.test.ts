import { describe, it, expect } from "vitest";
import { parseCmp, parseCmpFiles } from "../src/index.js";

const COGNITION = `<?xml version="1.0" encoding="UTF-8"?>
<Prototypes class="FZAirFighter" text="空战决策认知" type="RuleDecision">
  <Prototype Name="Engage" ChName="交战" IntendedCmd="ENGAGE">
    <Inputs>
      <param name="TARGET_ID" type="FZIntegerType" desc="目标ID"/>
      <param name="MUNITIONNUM" type="FZIntegerType" desc="弹药数量"/>
      <param name="TARGET_POSITION" type="FZVectorType" desc="目标位置"/>
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
    expect(engage.params[0]!.malType).toBe("FZ_MARGTYPE_INTEGER");
    expect(engage.params[2]!.malType).toBe("FZ_MARGTYPE_VECTOR");
  });

  it("装备形态:views 控件→FZ 类型,FunctionCategory 决定 action/condition", () => {
    const r = parseCmp(EQUIPMENT)!;
    expect(r.class.className).toBe("FzComRadioJam");
    const jam = r.functions.find((f) => f.name === "JamTarget")!;
    expect(jam.category).toBe("action");
    const dur = jam.params.find((p) => p.name === "DURATION_TIME")!;
    expect(dur.malType).toBe("FZ_MARGTYPE_REAL");
    const finish = jam.params.find((p) => p.name === "IS_POINT_FINISH")!;
    expect(finish.malType).toBe("FZ_MARGTYPE_BOOL");
    const q = r.functions.find((f) => f.name === "QueryJammerState")!;
    expect(q.category).toBe("condition");
  });

  it("批量解析多个 .cmp", () => {
    const { classes, functions } = parseCmpFiles([COGNITION, EQUIPMENT]);
    expect(classes.map((c) => c.className).sort()).toEqual(["FZAirFighter", "FzComRadioJam"]);
    expect(functions.length).toBeGreaterThanOrEqual(3);
  });
});
