import type { FunctionDescriptor, Variable } from "@btstudio/bt-core";
import { createBlackboard } from "@btstudio/bt-core";
import { useWorkspaceStore } from "./workspace";


/**
 * 演示数据(空战决策示例:函数目录 + 全局黑板 + 一棵大行为树 + 一棵状态机)。
 * 不再于 App.vue onMounted 自动调用;由「概览页 → 加载示例」按钮按需触发。
 * 用户首次进入工作空间见到的是空状态,可选「新建 / 打开 XML / 加载示例」。
 */
export function seedWorkspace(): void {
  const ws = useWorkspaceStore();
  if (ws.trees.length > 0) return;

  ws.functionCatalog.functions = sampleFunctions();
  ws.classes.push(
    { classId: "cls_air", className: "CyberAirFighter", displayName: "战机 CyberAirFighter", category: "RuleDecision", hostModule: "air", source: "model", baseClass: "CyberCognitionImpl" },
    { classId: "cls_jam", className: "CyberComRadioJam", displayName: "通信干扰 CyberComRadioJam", category: "Jammers", hostModule: "ew", source: "model", baseClass: "CyberJammerImpl" },
    { classId: "cls_sensor", className: "CyberSensor", displayName: "传感器 CyberSensor", category: "Sensors", hostModule: "avionic", source: "model", baseClass: "CyberSensorImpl" },
  );

  const bb = createBlackboard("空战全局板", "global", { blackboardId: "nd_air_global" });
  bb.variables = sampleVariables();
  ws.globalBlackboards.push(bb);

  buildBigBT(ws, bb);
  buildFSM(ws, bb);
  // 绑定方法时仅写了 functionRef,这里依据目录补齐各节点输入/输出参数(输入恒带默认值)。
  // 否则属性面板「输入参数」不渲染,且必填参数被误判为未赋值阻断导出。
  ws.reconcileAllBindings();
  // 两棵树进来即格式化布局(行为树层级 / 状态机图布局)。
  for (const t of ws.trees) ws.layoutTree(t.treeId);
  ws.switchTree(ws.trees[0]!.treeId); // 默认显示行为树
  ws.validate();
}

function buildBigBT(ws: ReturnType<typeof useWorkspaceStore>, bb: ReturnType<typeof createBlackboard>) {
  const tree = ws.newTree("空战决策树");
  tree.linkedGlobalBlackboardIds.push(bb.blackboardId);
  const root = tree.rootNodeId;
  const a = (t: string, n: string, p: string, cls: string, fn: string) => {
    const r = ws.run({ kind: "AddNode", nodeType: t, name: n, parentNodeId: p });
    if (r.createdNodeId) {
      if (cls) ws.run({ kind: "UpdateNodeProperty", nodeId: r.createdNodeId, patch: { targetSelector: { modelClass: cls } } });
      if (fn) ws.run({ kind: "BindFunction", nodeId: r.createdNodeId, functionRef: fn });
    }
    return r.createdNodeId ?? "";
  };

  // Root -> Selector
  const sel = a("Selector", "空战逻辑", root, "", "");
  // Selector -> Sequence: 先探测再决策
  const seqDetect = a("Sequence", "探测与判定", sel, "", "");
  // 探测分支:Sequence 下 Condition + Action 对
  a("Condition", "雷达在射程内", seqDetect, "CyberAirFighter", "CheckEngage");
  a("Action", "锁定目标", seqDetect, "CyberAirFighter", "Engage");
  // 并行分支:并行监测威胁并干扰
  const parallel = a("Parallel", "并行威胁响应", sel, "", "");
  a("Action", "通信干扰", parallel, "CyberComRadioJam", "JamTarget");
  a("Action", "发射诱饵", parallel, "CyberAirFighter", "Deploy");
  // 回退:Selector -> Sequence: 撤退
  const seqRetreat = a("Sequence", "撤退程序", sel, "", "");
  a("Condition", "威胁解除", seqRetreat, "CyberAirFighter", "CheckSafe");
  a("Action", "巡逻待命", seqRetreat, "CyberAirFighter", "Patrol");
  // 再加一个 Selector 分支:Selector 下 Sequence -> 传感器激活
  const seqSensor = a("Sequence", "传感器联调", sel, "", "");
  a("Action", "激活雷达", seqSensor, "CyberSensor", "Activate");
  a("Action", "校准对准", seqSensor, "CyberSensor", "Align");
  a("Action", "开始扫描", seqSensor, "CyberSensor", "Scan");
}

function buildFSM(ws: ReturnType<typeof useWorkspaceStore>, bb: ReturnType<typeof createBlackboard>) {
  const fsm = ws.newTree("空战状态机", "state_machine");
  fsm.linkedGlobalBlackboardIds.push(bb.blackboardId);
  const root = fsm.rootNodeId;

  const a = (t: string, n: string, p: string, cls = "", fn = "", extra: Record<string, unknown> = {}) => {
    const r = ws.run({ kind: "AddNode", nodeType: t, name: n, parentNodeId: p });
    if (r.createdNodeId) {
      if (cls) ws.run({ kind: "UpdateNodeProperty", nodeId: r.createdNodeId, patch: { targetSelector: { modelClass: cls } } });
      if (fn) ws.run({ kind: "BindFunction", nodeId: r.createdNodeId, functionRef: fn });
      if (Object.keys(extra).length) ws.run({ kind: "UpdateNodeProperty", nodeId: r.createdNodeId, patch: extra });
    }
    return r.createdNodeId ?? "";
  };

  // behaviac/vue2 式 FSM:Root 只连【初始状态】一个(StartCondition→入口);其余状态是平级节点,
  // 仅通过转移的 transitionTarget(Goto)到达。这样根节点只有 1 条连接。
  // 转移节点是其"源 State"的结构子;转移指向的"目标 State"用 transitionTarget 引用。
  const sPatrol = a("State", "巡逻", root, "CyberAirFighter", "Patrol"); // 初始状态(Root 唯一子)
  const sEngage = a("State", "交战", "", "CyberAirFighter", "Engage"); // 平级状态(无结构父,经转移到达)
  const sRetreat = a("State", "撤退", "", "CyberAirFighter", "Retreat");

  // 巡逻 --发现目标--> 交战
  a("ConditionTransition", "发现目标", sPatrol, "CyberAirFighter", "DetectTarget", { transitionTarget: sEngage });
  // 交战 --弹药不足--> 撤退
  a("ConditionTransition", "弹药不足", sEngage, "CyberAirFighter", "CheckAmmoLow", { transitionTarget: sRetreat });
  // 撤退 --安全--> 巡逻(回连)
  a("ConditionTransition", "安全", sRetreat, "CyberAirFighter", "CheckSafe", { transitionTarget: sPatrol });
}

function sampleFunctions(): FunctionDescriptor[] {
  return [
    {
      functionId: "fn_engage",
      name: "Engage",
      displayName: "进入交战",
      category: "action",
      bindingTarget: "CyberAirFighter.Engage",
      ownerClass: "CyberAirFighter",
      returnType: "CyberDFMPFRC",
      description: "命令战机进入交战",
      params: [
        { paramId: "p1", name: "TARGET_NAME", direction: "input", displayType: "string", malType: "CYBER_MARGTYPE_STRING", valueFormat: "literal", required: true },
        { paramId: "p2", name: "RESULT", direction: "output", displayType: "int", malType: "CYBER_MARGTYPE_INTEGER", valueFormat: "literal", required: false },
      ],
    },
    {
      functionId: "fn_check_engage",
      name: "CheckEngage",
      displayName: "允许交战判定",
      category: "condition",
      bindingTarget: "CyberAirFighter.CheckEngage",
      ownerClass: "CyberAirFighter",
      returnType: "CyberDFMPFRC",
      params: [
        { paramId: "p1", name: "RANGE", direction: "input", displayType: "float", malType: "CYBER_MARGTYPE_REAL", valueFormat: "literal", required: true },
      ],
    },
    {
      functionId: "fn_jam",
      name: "JamTarget",
      displayName: "通信干扰",
      category: "action",
      bindingTarget: "CyberComRadioJam.JamTarget",
      ownerClass: "CyberComRadioJam",
      returnType: "CyberDFMPFRC",
      params: [
        { paramId: "p1", name: "DURATION_TIME", direction: "input", displayType: "float", malType: "CYBER_MARGTYPE_REAL", valueFormat: "literal", required: true },
        { paramId: "p2", name: "JAMMER_STATUS", direction: "output", displayType: "int", malType: "CYBER_MARGTYPE_INTEGER", valueFormat: "literal", required: false },
      ],
    },
    { functionId: "fn_deploy", name: "Deploy", displayName: "发射诱饵", category: "action", bindingTarget: "CyberAirFighter.Deploy", ownerClass: "CyberAirFighter", returnType: "CyberDFMPFRC", params: [] },
    { functionId: "fn_check_safe", name: "CheckSafe", displayName: "威胁解除判定", category: "condition", bindingTarget: "CyberAirFighter.CheckSafe", ownerClass: "CyberAirFighter", returnType: "CyberDFMPFRC", params: [] },
    { functionId: "fn_patrol", name: "Patrol", displayName: "巡逻待命", category: "action", bindingTarget: "CyberAirFighter.Patrol", ownerClass: "CyberAirFighter", returnType: "CyberDFMPFRC", params: [{ paramId: "p1", name: "REGION", direction: "input", displayType: "string", malType: "CYBER_MARGTYPE_STRING", valueFormat: "literal", required: true }] },
    { functionId: "fn_activate", name: "Activate", displayName: "激活雷达", category: "action", bindingTarget: "CyberSensor.Activate", ownerClass: "CyberSensor", returnType: "CyberDFMPFRC", params: [] },
    { functionId: "fn_align", name: "Align", displayName: "校准对准", category: "action", bindingTarget: "CyberSensor.Align", ownerClass: "CyberSensor", returnType: "CyberDFMPFRC", params: [{ paramId: "p1", name: "AZIMUTH", direction: "input", displayType: "float", malType: "CYBER_MARGTYPE_REAL", valueFormat: "literal", required: true }] },
    { functionId: "fn_scan", name: "Scan", displayName: "开始扫描", category: "action", bindingTarget: "CyberSensor.Scan", ownerClass: "CyberSensor", returnType: "CyberDFMPFRC", params: [{ paramId: "p1", name: "SCAN_RESULT", direction: "output", displayType: "vector", malType: "CYBER_MARGTYPE_VECTOR", valueFormat: "literal", required: false }] },
    { functionId: "fn_retreat", name: "Retreat", displayName: "撤退", category: "action", bindingTarget: "CyberAirFighter.Retreat", ownerClass: "CyberAirFighter", returnType: "CyberDFMPFRC", params: [{ paramId: "p1", name: "RETREAT_POS", direction: "output", displayType: "position", malType: "CYBER_MARGTYPE_POSITION", valueFormat: "literal", required: false }] },
    { functionId: "fn_detect", name: "DetectTarget", displayName: "目标探测", category: "condition", bindingTarget: "CyberAirFighter.DetectTarget", ownerClass: "CyberAirFighter", returnType: "CyberDFMPFRC", params: [{ paramId: "p1", name: "MIN_SIGNAL", direction: "input", displayType: "float", malType: "CYBER_MARGTYPE_REAL", valueFormat: "literal", required: true }] },
    { functionId: "fn_ammo", name: "CheckAmmoLow", displayName: "弹药不足判定", category: "condition", bindingTarget: "CyberAirFighter.CheckAmmoLow", ownerClass: "CyberAirFighter", returnType: "CyberDFMPFRC", params: [{ paramId: "p1", name: "THRESHOLD", direction: "input", displayType: "int", malType: "CYBER_MARGTYPE_INTEGER", valueFormat: "literal", required: true }] },
  ];
}

function sampleVariables(): Variable[] {
  return [
    { variableId: "bb_scan_azimuth", name: "scan_azimuth", scope: "global", displayType: "float", malType: "CYBER_MARGTYPE_REAL", valueFormat: "literal", defaultValue: "45", unit: "deg" },
    { variableId: "bb_allow_commit", name: "allow_commit", scope: "global", displayType: "bool", malType: "CYBER_MARGTYPE_BOOL", valueFormat: "literal", defaultValue: "true" },
    { variableId: "bb_target_name", name: "target_name", scope: "global", displayType: "string", malType: "CYBER_MARGTYPE_STRING", valueFormat: "literal", defaultValue: "红方-目标-1" },
  ];
}
