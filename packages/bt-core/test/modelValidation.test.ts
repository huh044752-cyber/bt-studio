import { describe, it, expect } from "vitest";
import {
  ValidationEngine,
  GraphCommandBus,
  createTree,
  parseCmpFiles,
  type CatalogBundle,
} from "../src/index.js";

const CMP = `<?xml version="1.0" encoding="UTF-8"?>
<Prototypes class="FZAirFighter" type="RuleDecision">
  <Prototype Name="Engage"><Inputs><param name="TARGET_ID" type="FZIntegerType"/></Inputs></Prototype>
</Prototypes>`;

function catalog(): CatalogBundle {
  const { classes, functions } = parseCmpFiles([CMP]);
  return { functionCatalog: { functions }, globalBlackboards: [], enums: [], structs: [], types: [], classes, members: [] };
}

describe("模型校验(R3):节点 类+方法 必须真实存在", () => {
  const ve = new ValidationEngine();

  it("方法存在于类 → 无绑定错误", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const a = bus.execute({ kind: "AddNode", nodeType: "Action", parentNodeId: tree.rootNodeId });
    bus.execute({ kind: "UpdateNodeProperty", nodeId: a.createdNodeId!, patch: { targetSelector: { modelClass: "FZAirFighter" } } });
    bus.execute({ kind: "BindFunction", nodeId: a.createdNodeId!, functionRef: "Engage" });
    const issues = ve.validate(bus.getTree(), { mode: "standalone", catalogs: catalog() });
    expect(issues.some((i) => /不存在于类/.test(i.message))).toBe(false);
  });

  it("方法不存在于类 → 报错", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const a = bus.execute({ kind: "AddNode", nodeType: "Action", parentNodeId: tree.rootNodeId });
    bus.execute({ kind: "UpdateNodeProperty", nodeId: a.createdNodeId!, patch: { targetSelector: { modelClass: "FZAirFighter" } } });
    bus.execute({ kind: "BindFunction", nodeId: a.createdNodeId!, functionRef: "NoSuchMethod" });
    const issues = ve.validate(bus.getTree(), { mode: "standalone", catalogs: catalog() });
    expect(issues.some((i) => i.level === "error" && /不存在于类/.test(i.message))).toBe(true);
  });

  it("未选类 → 报错", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const a = bus.execute({ kind: "AddNode", nodeType: "Action", parentNodeId: tree.rootNodeId });
    bus.execute({ kind: "BindFunction", nodeId: a.createdNodeId!, functionRef: "Engage" });
    const issues = ve.validate(bus.getTree(), { mode: "standalone", catalogs: catalog() });
    expect(issues.some((i) => /未选择类/.test(i.message))).toBe(true);
  });
});
