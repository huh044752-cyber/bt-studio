import { describe, it, expect } from "vitest";
import { mergePreservedRegions, hasPreservedRegions } from "../src/index.js";

describe("保留区合并(重新导出不覆盖 <<<BEGIN 内手写代码)", () => {
  const oldCode = [
    "FZDFMPFRC MyAgent::Engage(FZMalImpl* in_mal, FZMalImpl* out_mal)",
    "{",
    "    FZIntegerType TARGET_ID = in_mal->GetInteger(\"TARGET_ID\");",
    "    ///<<< BEGIN WRITING YOUR CODE Engage",
    "    // 用户手写:发起交战",
    "    fire(TARGET_ID);",
    "    ///<<< END WRITING YOUR CODE",
    "    return FZ_DFMPFRC_SINGLE;",
    "}",
  ].join("\n");

  const newCode = [
    "FZDFMPFRC MyAgent::Engage(FZMalImpl* in_mal, FZMalImpl* out_mal)",
    "{",
    "    FZIntegerType TARGET_ID = in_mal->GetInteger(\"TARGET_ID\");",
    "    FZRealType RANGE = in_mal->GetReal(\"RANGE\");", // 新增参数(应保留新签名)
    "    ///<<< BEGIN WRITING YOUR CODE Engage",
    "    // TODO: 在此实现决策逻辑",
    "    ///<<< END WRITING YOUR CODE",
    "    return FZ_DFMPFRC_SINGLE;",
    "}",
  ].join("\n");

  it("保留用户正文,采用新生成的签名/参数读取", () => {
    expect(hasPreservedRegions(newCode)).toBe(true);
    const merged = mergePreservedRegions(oldCode, newCode);
    // 用户手写代码被保留
    expect(merged).toContain("fire(TARGET_ID);");
    expect(merged).toContain("// 用户手写:发起交战");
    // 新生成的占位被替换掉
    expect(merged).not.toContain("// TODO: 在此实现决策逻辑");
    // 新增的参数读取(保留区外)保留
    expect(merged).toContain('FZRealType RANGE = in_mal->GetReal("RANGE");');
  });

  it("首次生成(无旧文件)原样返回新内容", () => {
    expect(mergePreservedRegions("", newCode)).toBe(newCode);
  });

  it("旧文件无保留区时原样返回新内容", () => {
    expect(mergePreservedRegions("// 普通文件", newCode)).toBe(newCode);
  });
});
