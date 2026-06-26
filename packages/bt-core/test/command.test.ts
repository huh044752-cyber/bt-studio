import { describe, it, expect } from "vitest";
import { GraphCommandBus, createTree, autoLayout } from "../src/index.js";

describe("Graph Command Bus(文档 §10.3.2 / §11.2)", () => {
  it("拒绝创建受限/不支持节点", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const r = bus.execute({ kind: "AddNode", nodeType: "DoesNotExist", parentNodeId: tree.rootNodeId });
    expect(r.ok).toBe(false);
  });

  it("不允许第二个 Root", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const r = bus.execute({ kind: "AddNode", nodeType: "Root" });
    expect(r.ok).toBe(false);
  });

  it("输入端口唯一:子节点不能有两个父", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const seqA = bus.execute({ kind: "AddNode", nodeType: "Sequence", parentNodeId: tree.rootNodeId });
    const act = bus.execute({ kind: "AddNode", nodeType: "Action", parentNodeId: seqA.createdNodeId });
    // Root 已满(maxChildren 1),换一个能容纳的:把 action 连到另一个序列
    const seqB = bus.execute({ kind: "AddNode", nodeType: "Sequence" });
    const r = bus.execute({
      kind: "ConnectNodes",
      parentNodeId: seqB.createdNodeId!,
      childNodeId: act.createdNodeId!,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/已被占用/);
  });

  it("循环检测:把祖先接到后代之下被拒绝", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const seq = bus.execute({ kind: "AddNode", nodeType: "Sequence", parentNodeId: tree.rootNodeId });
    const child = bus.execute({ kind: "AddNode", nodeType: "Sequence", parentNodeId: seq.createdNodeId });
    // 先把 seq 从 root 断开,使其无父(可被连接),再尝试接到自己的后代之下 -> 纯循环
    bus.execute({ kind: "DisconnectNodes", parentNodeId: tree.rootNodeId, childNodeId: seq.createdNodeId! });
    const r = bus.execute({
      kind: "ConnectNodes",
      parentNodeId: child.createdNodeId!,
      childNodeId: seq.createdNodeId!,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/循环/);
  });

  it("undo/redo 恢复结构与 dirty", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const before = Object.keys(bus.getTree().nodes).length;
    bus.execute({ kind: "AddNode", nodeType: "Sequence", parentNodeId: tree.rootNodeId });
    expect(Object.keys(bus.getTree().nodes).length).toBe(before + 1);
    expect(bus.getDirtyState()).toBe(true);
    bus.undo();
    expect(Object.keys(bus.getTree().nodes).length).toBe(before);
    bus.redo();
    expect(Object.keys(bus.getTree().nodes).length).toBe(before + 1);
  });

  it("删除子树级联删除后代与边", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const seq = bus.execute({ kind: "AddNode", nodeType: "Sequence", parentNodeId: tree.rootNodeId });
    bus.execute({ kind: "AddNode", nodeType: "Action", parentNodeId: seq.createdNodeId });
    bus.execute({ kind: "AddNode", nodeType: "Condition", parentNodeId: seq.createdNodeId });
    bus.execute({ kind: "DeleteNode", nodeId: seq.createdNodeId! });
    // 只剩 Root
    expect(Object.keys(bus.getTree().nodes).length).toBe(1);
    expect(Object.keys(bus.getTree().edges).length).toBe(0);
  });

  it("自动布局:Root 在顶层", () => {
    const tree = createTree({ treeName: "t" });
    const bus = new GraphCommandBus(tree);
    const seq = bus.execute({ kind: "AddNode", nodeType: "Sequence", parentNodeId: tree.rootNodeId });
    bus.execute({ kind: "AddNode", nodeType: "Action", parentNodeId: seq.createdNodeId });
    bus.execute({ kind: "AddNode", nodeType: "Action", parentNodeId: seq.createdNodeId });
    const layouts = autoLayout(bus.getTree());
    const rootLayout = layouts.find((l) => l.nodeId === tree.rootNodeId)!;
    const others = layouts.filter((l) => l.nodeId !== tree.rootNodeId);
    expect(others.every((l) => l.y > rootLayout.y)).toBe(true);
  });
});
