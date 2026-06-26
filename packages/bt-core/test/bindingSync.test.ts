import { describe, it, expect } from "vitest";
import {
  reconcileNodeBindings,
  reconcileTreeBindings,
  defaultValueForParam,
  type DesignNode,
  type FunctionCatalog,
} from "../src/index.js";

const catalog: FunctionCatalog = {
  functions: [
    {
      functionId: "fn_engage",
      name: "Engage",
      category: "action",
      bindingTarget: "FZAirFighter.Engage",
      ownerClass: "FZAirFighter",
      returnType: "CyberDFMPFRC",
      params: [
        { paramId: "p1", name: "TARGET_NAME", direction: "input", displayType: "string", malType: "CYBER_MARGTYPE_STRING", valueFormat: "literal", required: true },
        { paramId: "p2", name: "RESULT", direction: "output", displayType: "int", malType: "CYBER_MARGTYPE_INTEGER", valueFormat: "literal", required: false },
      ],
    },
    {
      functionId: "fn_check",
      name: "CheckEngage",
      category: "condition",
      bindingTarget: "FZAirFighter.CheckEngage",
      ownerClass: "FZAirFighter",
      returnType: "CyberDFMPFRC",
      params: [
        { paramId: "p1", name: "RANGE", direction: "input", displayType: "float", malType: "CYBER_MARGTYPE_REAL", valueFormat: "literal", required: true, defaultValue: "5000" },
      ],
    },
  ],
};

function fnNode(over: Partial<DesignNode> = {}): DesignNode {
  return {
    nodeId: "n1",
    nodeType: "Action",
    name: "锁定目标",
    functionRef: "Engage",
    targetSelector: { modelClass: "FZAirFighter" },
    inputBindings: [],
    outputBindings: [],
    childOrder: [],
    ...over,
  };
}

describe("bindingSync — 依目录重建节点绑定", () => {
  it("functionRef 存在但 inputBindings 为空时,补齐输入参数(含默认值)和输出参数", () => {
    const node = fnNode();
    const res = reconcileNodeBindings(node, catalog);
    expect(res).not.toBeNull();
    expect(res!.inputBindings.map((b) => b.name)).toEqual(["TARGET_NAME"]);
    expect(res!.outputBindings.map((b) => b.name)).toEqual(["RESULT"]);
    // 输入参数必带 type / malType,常量来源。
    expect(res!.inputBindings[0]!.source).toBe("constant");
    expect(res!.inputBindings[0]!.malType).toBe("CYBER_MARGTYPE_STRING");
  });

  it("显式 defaultValue 用作默认输入值", () => {
    const node = fnNode({ functionRef: "CheckEngage", nodeType: "Condition" });
    const res = reconcileNodeBindings(node, catalog);
    expect(res!.inputBindings[0]!.name).toBe("RANGE");
    expect(res!.inputBindings[0]!.value).toBe("5000");
  });

  it("保留用户已填的常量值,不被默认值覆盖", () => {
    const node = fnNode({
      inputBindings: [{ name: "TARGET_NAME", type: "CyberStringType", source: "constant", value: "红方-1" }],
    });
    const res = reconcileNodeBindings(node, catalog);
    expect(res!.inputBindings[0]!.value).toBe("红方-1");
  });

  it("保留用户已选的黑板变量绑定", () => {
    const node = fnNode({
      inputBindings: [{ name: "TARGET_NAME", type: "CyberStringType", source: "blackboard", variableId: "bb_target", blackboardId: "bb1" }],
    });
    const res = reconcileNodeBindings(node, catalog);
    expect(res!.inputBindings[0]!.source).toBe("blackboard");
    expect(res!.inputBindings[0]!.variableId).toBe("bb_target");
  });

  it("非函数节点 / 未绑定方法 / 目录无此函数 → 返回 null", () => {
    expect(reconcileNodeBindings(fnNode({ nodeType: "Sequence", functionRef: undefined }), catalog)).toBeNull();
    expect(reconcileNodeBindings(fnNode({ functionRef: undefined }), catalog)).toBeNull();
    expect(reconcileNodeBindings(fnNode({ functionRef: "NotInCatalog" }), catalog)).toBeNull();
  });

  it("reconcileTreeBindings 就地写回并返回修改节点数", () => {
    const node = fnNode();
    const tree = { nodes: { n1: node } };
    const changed = reconcileTreeBindings(tree, catalog);
    expect(changed).toBe(1);
    expect(node.inputBindings.map((b) => b.name)).toEqual(["TARGET_NAME"]);
    // 幂等:再次执行无变化。
    expect(reconcileTreeBindings(tree, catalog)).toBe(0);
  });

  it("defaultValueForParam 按 MAL 类型给类型默认值", () => {
    const mk = (malType: string, displayType = "string") =>
      ({ paramId: "x", name: "p", direction: "input", displayType, malType, valueFormat: "literal", required: true }) as never;
    expect(defaultValueForParam(mk("CYBER_MARGTYPE_BOOL", "bool"))).toBe("false");
    expect(defaultValueForParam(mk("CYBER_MARGTYPE_INTEGER", "int"))).toBe("0");
    expect(defaultValueForParam(mk("CYBER_MARGTYPE_REAL", "float"))).toBe("0");
    expect(defaultValueForParam(mk("CYBER_MARGTYPE_STRING", "string"))).toBe("");
    expect(defaultValueForParam(mk("CYBER_MARGTYPE_NAME", "name"))).toBe("");
    expect(defaultValueForParam(mk("CYBER_MARGTYPE_POSITION", "position"))).toBe("0,0,0");
    // 想定引用类无安全默认 → 空。
    expect(defaultValueForParam(mk("CYBER_MARGTYPE_UNITID", "unitId"))).toBe("");
  });

  it("malType 缺失时按 displayType 解析后给默认值", () => {
    const p = { paramId: "x", name: "n", direction: "input", displayType: "int", valueFormat: "literal", required: true } as never;
    expect(defaultValueForParam(p)).toBe("0");
  });
});
