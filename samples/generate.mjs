// 用 bt-core 生成样例运行 XML,保证与序列化器/loader 格式一致。
// 运行:node samples/generate.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createTree,
  GraphCommandBus,
  ExportPipeline,
  createBlackboard,
} from "../packages/bt-core/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const exporter = new ExportPipeline();

function emit(name, tree, blackboards = []) {
  const dir = join(here, name);
  mkdirSync(dir, { recursive: true });
  const res = exporter.exportAll({ doc: { tree, dirty: false }, blackboards });
  if (!res.ok) {
    console.error(`[FAIL] ${name}: ${res.error}`);
    return;
  }
  writeFileSync(join(dir, `${name}.bt.xml`), res.artifacts.xml);
  writeFileSync(join(dir, `${name}.bt.meta.json`), res.artifacts.meta);
  writeFileSync(join(dir, `binding_manifest.json`), res.artifacts.bindingManifest);
  console.log(`[OK] ${name}`);
}

// 1) minimal: Root -> Sequence -> Action
{
  const t = createTree({ treeName: "sample_minimal_tree" });
  const bus = new GraphCommandBus(t);
  const seq = bus.execute({ kind: "AddNode", nodeType: "Sequence", name: "主序列", parentNodeId: t.rootNodeId });
  const a = bus.execute({ kind: "AddNode", nodeType: "Action", name: "动作", parentNodeId: seq.createdNodeId });
  bus.execute({ kind: "BindFunction", nodeId: a.createdNodeId, functionRef: "DoThing" });
  emit("sample_minimal_tree", bus.getTree());
}

// 2) condition + action selector
{
  const t = createTree({ treeName: "sample_condition_action_tree" });
  const bus = new GraphCommandBus(t);
  const sel = bus.execute({ kind: "AddNode", nodeType: "Selector", name: "选择", parentNodeId: t.rootNodeId });
  const c = bus.execute({ kind: "AddNode", nodeType: "Condition", name: "允许交战", parentNodeId: sel.createdNodeId });
  bus.execute({ kind: "BindFunction", nodeId: c.createdNodeId, functionRef: "CheckEngage" });
  const a = bus.execute({ kind: "AddNode", nodeType: "Action", name: "进入交战", parentNodeId: sel.createdNodeId });
  bus.execute({ kind: "BindFunction", nodeId: a.createdNodeId, functionRef: "Engage" });
  emit("sample_condition_action_tree", bus.getTree());
}

// 3) blackboard binding
{
  const t = createTree({ treeName: "sample_blackboard_binding_tree" });
  const bus = new GraphCommandBus(t);
  const bb = createBlackboard("全局参数板", "global", { blackboardId: "nd_global" });
  bb.variables.push({ variableId: "bb_duration", name: "duration", scope: "global", displayType: "float", malType: "FZ_MARGTYPE_REAL", valueFormat: "literal", defaultValue: "600" });
  t.linkedGlobalBlackboardIds.push(bb.blackboardId);
  const a = bus.execute({ kind: "AddNode", nodeType: "Action", name: "干扰", parentNodeId: t.rootNodeId });
  bus.execute({ kind: "BindFunction", nodeId: a.createdNodeId, functionRef: "JamTarget" });
  bus.execute({ kind: "BindVariable", nodeId: a.createdNodeId, direction: "input", binding: { name: "DURATION_TIME", type: "FZRealType", source: "blackboard", blackboardId: "nd_global", variableId: "bb_duration", malType: "FZ_MARGTYPE_REAL" } });
  emit("sample_blackboard_binding_tree", bus.getTree(), [bb]);
}

// 4) loop + compare
{
  const t = createTree({ treeName: "sample_loop_compare_tree" });
  const bus = new GraphCommandBus(t);
  const loop = bus.execute({ kind: "AddNode", nodeType: "Loop", name: "循环", parentNodeId: t.rootNodeId });
  bus.execute({ kind: "UpdateNodeProperty", nodeId: loop.createdNodeId, patch: { loopCount: 3 } });
  const cond = bus.execute({ kind: "AddNode", nodeType: "Condition", name: "查询状态", parentNodeId: loop.createdNodeId });
  bus.execute({ kind: "BindFunction", nodeId: cond.createdNodeId, functionRef: "QueryState" });
  bus.execute({ kind: "UpdateNodeProperty", nodeId: cond.createdNodeId, patch: { compareType: "Output", compareOutputName: "STATUS", compareOp: "eq", compareValue: "1" } });
  emit("sample_loop_compare_tree", bus.getTree());
}

// 5) parallel threshold
{
  const t = createTree({ treeName: "sample_parallel_threshold_tree" });
  const bus = new GraphCommandBus(t);
  const par = bus.execute({ kind: "AddNode", nodeType: "Parallel", name: "并行", parentNodeId: t.rootNodeId });
  bus.execute({ kind: "UpdateNodeProperty", nodeId: par.createdNodeId, patch: { parallelSuccessThreshold: 2, parallelFailureThreshold: 1 } });
  for (const n of ["探测", "分配"]) {
    const a = bus.execute({ kind: "AddNode", nodeType: "Action", name: n, parentNodeId: par.createdNodeId });
    bus.execute({ kind: "BindFunction", nodeId: a.createdNodeId, functionRef: n });
  }
  emit("sample_parallel_threshold_tree", bus.getTree());
}

console.log("样例生成完成");
