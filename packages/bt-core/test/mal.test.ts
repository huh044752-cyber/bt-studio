import { describe, it, expect } from "vitest";
import {
  resolveMalType,
  validateMalValueConversion,
  malToXmlType,
  compareOpSymbol,
  COMPARE_OP_LABELS,
} from "../src/index.js";

describe("MAL 类型映射与值转换(文档 §6.0.1 / 16.x)", () => {
  it("ResolveMalType(int) = FZ_MARGTYPE_INTEGER", () => {
    expect(resolveMalType("int")).toBe("FZ_MARGTYPE_INTEGER");
    expect(resolveMalType("float")).toBe("FZ_MARGTYPE_REAL");
    expect(resolveMalType("bool")).toBe("FZ_MARGTYPE_BOOL");
    expect(resolveMalType("string")).toBe("FZ_MARGTYPE_STRING");
    expect(resolveMalType("name")).toBe("FZ_MARGTYPE_NAME");
    expect(resolveMalType("position")).toBe("FZ_MARGTYPE_POSITION");
    expect(resolveMalType("vector")).toBe("FZ_MARGTYPE_VECTOR");
  });

  it("INTEGER + 1.2 => Error;REAL + 1.2 => OK", () => {
    expect(validateMalValueConversion("1.2", "FZ_MARGTYPE_INTEGER").ok).toBe(false);
    expect(validateMalValueConversion("3", "FZ_MARGTYPE_INTEGER").ok).toBe(true);
    expect(validateMalValueConversion("1.2", "FZ_MARGTYPE_REAL").ok).toBe(true);
  });

  it("各类型至少一条转换用例:int/real/bool/name/string/position/vector", () => {
    expect(validateMalValueConversion("5", "FZ_MARGTYPE_INTEGER").ok).toBe(true);
    expect(validateMalValueConversion("5.5", "FZ_MARGTYPE_REAL").ok).toBe(true);
    expect(validateMalValueConversion("true", "FZ_MARGTYPE_BOOL").ok).toBe(true);
    expect(validateMalValueConversion("Patrol", "FZ_MARGTYPE_NAME").ok).toBe(true);
    expect(validateMalValueConversion("any text", "FZ_MARGTYPE_STRING").ok).toBe(true);
    expect(validateMalValueConversion("120.1,30.2,1000", "FZ_MARGTYPE_POSITION").ok).toBe(true);
    expect(validateMalValueConversion("1,2,3", "FZ_MARGTYPE_VECTOR").ok).toBe(true);
    // 坐标格式非法
    expect(validateMalValueConversion("abc", "FZ_MARGTYPE_POSITION").ok).toBe(false);
  });

  it("想定引用类型空值阻断", () => {
    expect(validateMalValueConversion("", "FZ_MARGTYPE_UNITID").ok).toBe(false);
    expect(validateMalValueConversion("unit-1", "FZ_MARGTYPE_UNITID").ok).toBe(true);
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
    expect(malToXmlType("FZ_MARGTYPE_REAL")).toBe("FZRealType");
    expect(malToXmlType("FZ_MARGTYPE_INTEGER")).toBe("FZIntegerType");
    expect(malToXmlType("FZ_MARGTYPE_STRING")).toBe("FZStringType");
    expect(malToXmlType("FZ_MARGTYPE_BOOL")).toBe("FZBOOL");
  });
});
