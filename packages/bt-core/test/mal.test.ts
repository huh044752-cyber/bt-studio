import { describe, it, expect } from "vitest";
import {
  resolveMalType,
  validateMalValueConversion,
  malToXmlType,
  compareOpSymbol,
  COMPARE_OP_LABELS,
} from "../src/index.js";

describe("MAL 类型映射与值转换(文档 §6.0.1 / 16.x)", () => {
  it("ResolveMalType(int) = CYBER_MARGTYPE_INTEGER", () => {
    expect(resolveMalType("int")).toBe("CYBER_MARGTYPE_INTEGER");
    expect(resolveMalType("float")).toBe("CYBER_MARGTYPE_REAL");
    expect(resolveMalType("bool")).toBe("CYBER_MARGTYPE_BOOL");
    expect(resolveMalType("string")).toBe("CYBER_MARGTYPE_STRING");
    expect(resolveMalType("name")).toBe("CYBER_MARGTYPE_NAME");
    expect(resolveMalType("position")).toBe("CYBER_MARGTYPE_POSITION");
    expect(resolveMalType("vector")).toBe("CYBER_MARGTYPE_VECTOR");
  });

  it("INTEGER + 1.2 => Error;REAL + 1.2 => OK", () => {
    expect(validateMalValueConversion("1.2", "CYBER_MARGTYPE_INTEGER").ok).toBe(false);
    expect(validateMalValueConversion("3", "CYBER_MARGTYPE_INTEGER").ok).toBe(true);
    expect(validateMalValueConversion("1.2", "CYBER_MARGTYPE_REAL").ok).toBe(true);
  });

  it("各类型至少一条转换用例:int/real/bool/name/string/position/vector", () => {
    expect(validateMalValueConversion("5", "CYBER_MARGTYPE_INTEGER").ok).toBe(true);
    expect(validateMalValueConversion("5.5", "CYBER_MARGTYPE_REAL").ok).toBe(true);
    expect(validateMalValueConversion("true", "CYBER_MARGTYPE_BOOL").ok).toBe(true);
    expect(validateMalValueConversion("Patrol", "CYBER_MARGTYPE_NAME").ok).toBe(true);
    expect(validateMalValueConversion("any text", "CYBER_MARGTYPE_STRING").ok).toBe(true);
    expect(validateMalValueConversion("120.1,30.2,1000", "CYBER_MARGTYPE_POSITION").ok).toBe(true);
    expect(validateMalValueConversion("1,2,3", "CYBER_MARGTYPE_VECTOR").ok).toBe(true);
    // 坐标格式非法
    expect(validateMalValueConversion("abc", "CYBER_MARGTYPE_POSITION").ok).toBe(false);
  });

  it("想定引用类型空值阻断", () => {
    expect(validateMalValueConversion("", "CYBER_MARGTYPE_UNITID").ok).toBe(false);
    expect(validateMalValueConversion("unit-1", "CYBER_MARGTYPE_UNITID").ok).toBe(true);
  });

  it("比较运算符号:eq/ne/gt/ge/lt/le => ==/!=/>/>=/</<=", () => {
    expect(COMPARE_OP_LABELS).toEqual({
      eq: "==",
      ne: "!=",
      gt: ">",
      ge: ">=",
      lt: "<",
      le: "<=",
    });
    expect(compareOpSymbol("eq")).toBe("==");
    expect(compareOpSymbol("GE")).toBe(">="); // 大小写不敏感
    expect(compareOpSymbol("")).toBe("");
    expect(compareOpSymbol("unknown")).toBe("unknown"); // 未知值原样返回
  });

  it("malToXmlType 映射到 FOSim 习惯类型串", () => {
    expect(malToXmlType("CYBER_MARGTYPE_REAL")).toBe("CyberRealType");
    expect(malToXmlType("CYBER_MARGTYPE_INTEGER")).toBe("CyberIntegerType");
    expect(malToXmlType("CYBER_MARGTYPE_STRING")).toBe("CyberStringType");
    expect(malToXmlType("CYBER_MARGTYPE_BOOL")).toBe("CyberBOOL");
  });
});
