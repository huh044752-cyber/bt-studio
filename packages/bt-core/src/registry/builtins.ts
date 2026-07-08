/**
 * 内置节点表(文档 §6.4.1 / §8.2)。
 *
 * 关键:节点进入正式库必须满足 runtimeKind 可映射 BTNodeKind,且导出 XML 能被 BTXmlLoader 解析。
 * xmlElement 注意与 kind 不完全同名:Loop->DecoratorLoop、SuccessUntil->DecoratorSuccessUntil、
 * FailureUntil->DecoratorFailureUntil、Subtree->SubTree。
 */
import type { NodeDefinition, PortSchema, PropertySchema } from "./schema.js";

const IN_SINGLE: PortSchema = {
  group: "top",
  defaultCount: 1,
  maxCount: 1,
  fixed: true,
  semanticRole: "parent-input",
};
const IN_NONE: PortSchema = { group: "top", defaultCount: 0, maxCount: 0, fixed: true };
const OUT_NONE: PortSchema = { group: "bottom", defaultCount: 0, maxCount: 0, fixed: true };
const OUT_SINGLE: PortSchema = {
  group: "bottom",
  defaultCount: 1,
  maxCount: 1,
  fixed: true,
  semanticRole: "child-output",
};
const OUT_DYNAMIC: PortSchema = {
  group: "bottom",
  defaultCount: 0,
  maxCount: 64,
  fixed: false,
  semanticRole: "child-output",
};

// --- 复用属性 ---
const P_NAME: PropertySchema = {
  propName: "name",
  runtimeField: "name",
  displayName: "节点名",
  category: "基础",
  editorType: "text",
  displayMode: "parameter",
  required: true,
  readonly: false,
  noExport: false,
  noSave: false,
};
const P_COMMENT: PropertySchema = {
  propName: "comment",
  displayName: "注释",
  category: "注释",
  editorType: "text",
  displayMode: "advanced",
  required: false,
  readonly: false,
  noExport: true,
  noSave: false,
};
const P_FUNCTION: PropertySchema = {
  propName: "functionRef",
  runtimeField: "functionName",
  displayName: "函数",
  category: "函数",
  editorType: "function-picker",
  displayMode: "parameter",
  required: true,
  readonly: false,
  noExport: false,
  noSave: false,
};
const P_TARGET: PropertySchema = {
  propName: "targetSelector",
  runtimeField: "target",
  displayName: "目标选择器",
  category: "参数",
  editorType: "target-picker",
  displayMode: "advanced",
  required: false,
  readonly: false,
  noExport: false,
  noSave: false,
};
// FSM 转移节点指向的目标状态(引用 nodeId,而非结构子边)。
const P_TARGET_STATE: PropertySchema = {
  propName: "transitionTarget",
  displayName: "目标状态",
  category: "基础",
  editorType: "target-state-picker",
  displayMode: "parameter",
  required: false,
  readonly: false,
  noExport: false,
  noSave: false,
};

function action(): NodeDefinition {
  return {
    nodeType: "Action",
    runtimeKind: "Action",
    xmlElement: "Action",
    displayName: "动作",
    category: "Action",
    icon: "play",
    colorToken: "accent",
    minChildren: 0,
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_NONE,
    fosimSupported: true,
    description: "执行宿主 Action 函数,构造输入 MAL,回写输出黑板。叶子节点。",
    properties: [P_NAME, P_FUNCTION, P_TARGET, P_COMMENT],
  };
}

function builtins(): NodeDefinition[] {
  const list: NodeDefinition[] = [];

  // Root —— 编辑器根容器,导出为 <Root>,恰好 1 子。
  // Root 不绑任何模板/类型信息:行为树只与"类型空间"(ws.classes / ws.functionCatalog)有关,
  // 叶子节点从类型空间自由选类与函数;完整性由"场景挂接"页对选定 Unit 做闸门校验落地。
  list.push({
    nodeType: "Root",
    runtimeKind: "Unknown",
    xmlElement: "Root",
    displayName: "根",
    category: "Root",
    icon: "target",
    colorToken: "ok",
    minChildren: 1,
    maxChildren: 1,
    inputPort: IN_NONE,
    outputPort: OUT_SINGLE,
    fosimSupported: true,
    description: "行为树根。固定 0 入 1 出,必须且只能有 1 个子节点。",
    properties: [P_NAME, P_COMMENT],
  });

  // Composite
  const composite = (
    nodeType: string,
    kind: NodeDefinition["runtimeKind"],
    displayName: string,
    min: number,
    extra: PropertySchema[] = [],
  ): NodeDefinition => ({
    nodeType,
    runtimeKind: kind,
    xmlElement: nodeType,
    displayName,
    category: "Composite",
    icon: "git-branch",
    colorToken: "accent-2",
    minChildren: min,
    maxChildren: 64,
    inputPort: IN_SINGLE,
    outputPort: OUT_DYNAMIC,
    fosimSupported: true,
    description: `${displayName} 组合节点,输出端口随子节点动态增加。`,
    properties: [P_NAME, ...extra, P_COMMENT],
  });

  list.push(composite("Sequence", "Sequence", "顺序", 1));
  list.push(composite("Selector", "Selector", "选择", 1));
  list.push(composite("And", "And", "与", 1));
  list.push(composite("Or", "Or", "或", 1));
  list.push(
    composite("Parallel", "Parallel", "并行", 2, [
      {
        propName: "parallelSuccessThreshold",
        runtimeField: "parallelSuccessThreshold",
        displayName: "成功阈值",
        category: "控制",
        editorType: "number",
        displayMode: "parameter",
        required: true,
        readonly: false,
        noExport: false,
        noSave: false,
        default: 1,
      },
      {
        propName: "parallelFailureThreshold",
        runtimeField: "parallelFailureThreshold",
        displayName: "失败阈值",
        category: "控制",
        editorType: "number",
        displayMode: "parameter",
        required: true,
        readonly: false,
        noExport: false,
        noSave: false,
        default: 1,
      },
    ]),
  );

  // IfElse(恰好 3 子)/ MonitorBranch(恰好 2 子)—— loader 强校验
  const ifElse = composite("IfElse", "IfElse", "条件分支", 3);
  ifElse.maxChildren = 3;
  ifElse.description = "条件分支:固定 3 子(条件、真分支、假分支)。";
  list.push(ifElse);
  const monitor = composite("MonitorBranch", "MonitorBranch", "监视分支", 2);
  monitor.maxChildren = 2;
  monitor.description = "监视分支:固定 2 子。";
  list.push(monitor);
  list.push(composite("SelectMonitor", "SelectMonitor", "选择监视", 1));

  // Decorator(恰好 1 子)
  const decorator = (
    nodeType: string,
    kind: NodeDefinition["runtimeKind"],
    xmlElement: string,
    displayName: string,
    extra: PropertySchema[] = [],
  ): NodeDefinition => ({
    nodeType,
    runtimeKind: kind,
    xmlElement,
    displayName,
    category: "Decorator",
    icon: "repeat",
    colorToken: "warn",
    minChildren: 1,
    maxChildren: 1,
    inputPort: IN_SINGLE,
    outputPort: OUT_SINGLE,
    fosimSupported: true,
    description: `${displayName} 装饰器,固定 1 入 1 出,恰好 1 个子节点。`,
    properties: [P_NAME, ...extra, P_COMMENT],
  });

  const COUNT_PROP: PropertySchema = {
    propName: "loopCount",
    runtimeField: "loopCount",
    displayName: "次数",
    category: "控制",
    editorType: "number",
    displayMode: "parameter",
    required: true,
    readonly: false,
    noExport: false,
    noSave: false,
    default: 1,
  };

  list.push(decorator("Loop", "Loop", "DecoratorLoop", "循环", [COUNT_PROP]));
  // 新引擎 bt_xml_loader (e5b8d8d1) 只识别 <Not>,老引擎 backport 后同一收口 → xmlElement = "Not"。
  list.push(decorator("Invert", "Invert", "Not", "反相"));
  list.push(
    decorator("SuccessUntil", "SuccessUntil", "DecoratorSuccessUntil", "成功直到", [COUNT_PROP]),
  );
  list.push(
    decorator("FailureUntil", "FailureUntil", "DecoratorFailureUntil", "失败直到", [COUNT_PROP]),
  );
  list.push(decorator("AlwaysSuccess", "AlwaysSuccess", "AlwaysSuccess", "恒成功"));
  list.push(decorator("AlwaysFailure", "AlwaysFailure", "AlwaysFailure", "恒失败"));

  // Action / Wait(Wait 是 Action 的便捷别名,仍需绑定函数,保证 loader 可解析)
  list.push(action());
  const wait = action();
  wait.nodeType = "Wait";
  wait.displayName = "等待";
  wait.icon = "clock";
  wait.description =
    "等待节点(映射为 Action,导出元素为 Action)。需绑定一个等待类宿主函数。";
  list.push(wait);

  // Condition —— 叶子条件谓词。对齐:
  //   - C++ 新引擎 bt_xml_loader (L525):Condition must be a leaf;
  //   - vue2 nodeConfig.js L484:'condition' → 'Condition' 分类在 condition 叶子类;
  //   - 结构分支一律走 IfElse(恰好 3 子)。
  // 老 .bt 里 <Condition><Action/><Action/></Condition> 会由 importer 归一成 Sequence(见 xmlParser)。
  list.push({
    nodeType: "Condition",
    runtimeKind: "Condition",
    xmlElement: "Condition",
    displayName: "条件",
    category: "Action",
    icon: "help-circle",
    colorToken: "accent",
    minChildren: 0,
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_NONE,
    fosimSupported: true,
    description:
      "条件谓词(叶子):绑函数,或用 compareType=Output 做函数返回值比较。结构分支请用「条件分支(IfElse)」。",
    properties: [
      P_NAME,
      P_FUNCTION,
      {
        propName: "compareType",
        runtimeField: "compareType",
        displayName: "比较模式",
        category: "控制",
        editorType: "enum",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
        enumValues: ["Function", "Output"],
      },
      {
        propName: "compareOutputName",
        runtimeField: "compareOutputName",
        displayName: "比较字段",
        category: "控制",
        editorType: "text",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
        dependsOn: "compareType",
      },
      {
        propName: "compareOp",
        runtimeField: "compareOp",
        displayName: "比较运算",
        category: "控制",
        editorType: "compare-op",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
        dependsOn: "compareType",
      },
      {
        propName: "compareValue",
        runtimeField: "compareValue",
        displayName: "比较值",
        category: "控制",
        editorType: "mal-value",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
        dependsOn: "compareType",
      },
      P_TARGET,
      P_COMMENT,
    ],
  });

  // ConditionTransform —— FSM 专用(paradigm=fsm),BT 面板不列出。
  // 保留定义以便老 .bt 里遗留 <ConditionTransform> 读回时不落成 restricted。
  list.push({
    nodeType: "ConditionTransform",
    runtimeKind: "ConditionTransform",
    xmlElement: "ConditionTransform",
    displayName: "条件变换",
    category: "Utility",
    icon: "shuffle",
    colorToken: "accent",
    minChildren: 0,
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_NONE,
    fosimSupported: true,
    paradigm: "fsm",
    description: "FSM 条件变换。把函数查询结果变换为条件状态。叶子节点。",
    properties: [P_NAME, P_FUNCTION, P_TARGET, P_COMMENT],
  });

  // Subtree
  list.push({
    nodeType: "Subtree",
    runtimeKind: "Subtree",
    xmlElement: "SubTree",
    displayName: "子树",
    category: "Subtree",
    icon: "layers",
    colorToken: "ok",
    minChildren: 0,
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_NONE,
    fosimSupported: true,
    description: "引用另一棵行为树。固定 1 入 0 出,不可引用自身或祖先。",
    properties: [
      P_NAME,
      {
        propName: "subtreeRef",
        runtimeField: "behaviorTreeInstanceId",
        displayName: "子树引用",
        category: "基础",
        editorType: "subtree-picker",
        displayMode: "parameter",
        required: true,
        readonly: false,
        noExport: false,
        noSave: false,
      },
      {
        propName: "paramStates",
        runtimeField: "paramStates",
        displayName: "参数状态",
        category: "参数",
        editorType: "text",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
      },
      P_COMMENT,
    ],
  });

  // End
  list.push({
    nodeType: "End",
    runtimeKind: "End",
    xmlElement: "End",
    displayName: "结束",
    category: "Utility",
    icon: "flag",
    colorToken: "err",
    minChildren: 0,
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_NONE,
    fosimSupported: true,
    description: "显式结束行为树。叶子节点。",
    properties: [
      P_NAME,
      {
        propName: "endStatusSuccess",
        runtimeField: "endStatusSuccess",
        displayName: "成功结束",
        category: "控制",
        editorType: "boolean",
        displayMode: "parameter",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
      },
      {
        propName: "endExternalTree",
        runtimeField: "endExternalTree",
        displayName: "结束外部树",
        category: "控制",
        editorType: "boolean",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
      },
      P_COMMENT,
    ],
  });

  // Null / Noop
  list.push({
    nodeType: "Null",
    runtimeKind: "Null",
    xmlElement: "Null",
    displayName: "空操作",
    category: "Utility",
    icon: "circle",
    colorToken: "muted",
    minChildren: 0,
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_NONE,
    fosimSupported: true,
    description: "空节点 / 占位。叶子节点。",
    properties: [P_NAME, P_COMMENT],
  });

  // --- 状态机(FSM)节点(对齐 vue2 state/condition-transition/state-transition/transition)---
  const IN_DYN: PortSchema = { group: "top", defaultCount: 1, maxCount: 100, fixed: false, semanticRole: "parent-input" };
  const OUT_DYN_FSM: PortSchema = { group: "bottom", defaultCount: 1, maxCount: 100, fixed: false, semanticRole: "child-output" };

  list.push({
    nodeType: "State",
    runtimeKind: "Unknown",
    xmlElement: "State",
    displayName: "状态",
    category: "Utility",
    icon: "box",
    colorToken: "accent",
    minChildren: 0,
    maxChildren: 100,
    inputPort: IN_DYN,
    outputPort: OUT_DYN_FSM,
    fosimSupported: true,
    paradigm: "fsm",
    description: "状态节点:执行指定函数;通过条件跳转/状态跳转切换到其他状态。可设为结束态。",
    properties: [
      P_NAME,
      P_FUNCTION,
      {
        propName: "endStatusSuccess",
        runtimeField: "endStatusSuccess",
        displayName: "结束态",
        category: "控制",
        editorType: "boolean",
        displayMode: "parameter",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
      },
      P_TARGET,
      P_COMMENT,
    ],
  });

  const transition = (
    nodeType: string,
    xmlElement: string,
    displayName: string,
    desc: string,
    extra: PropertySchema[],
  ): NodeDefinition => ({
    nodeType,
    runtimeKind: "Unknown",
    xmlElement,
    displayName,
    category: "Utility",
    icon: "arrow-right",
    colorToken: "accent-2",
    minChildren: 0,
    // 转移无结构子(目标 State 走 transitionTarget 引用 Goto,单父树约束);
    // 但保留底部输出端口,用于在画布上拖出"指向目标状态"的引用边。
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_SINGLE,
    fosimSupported: true,
    paradigm: "fsm",
    description: desc,
    properties: [P_NAME, ...extra, P_TARGET, P_TARGET_STATE, P_COMMENT],
  });

  list.push(
    transition("ConditionTransition", "ConditionTransform", "条件跳转", "根据条件结果决定是否跳转到目标状态(默认按函数返回状态;切到「输出比较」时对比 output 字段与常量)。", [
      P_FUNCTION,
      // 与 Condition 对齐:默认「函数比较」看返回状态,不显示 op/value;
      // 切到「输出比较」才出现比较字段/运算/比较值。
      {
        propName: "compareType",
        runtimeField: "compareType",
        displayName: "比较模式",
        category: "控制",
        editorType: "enum",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
        enumValues: ["Function", "Output"],
      },
      {
        propName: "compareOutputName",
        runtimeField: "compareOutputName",
        displayName: "比较字段",
        category: "控制",
        editorType: "text",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
        dependsOn: "compareType",
      },
      {
        propName: "compareOp",
        runtimeField: "compareOp",
        displayName: "比较运算",
        category: "控制",
        editorType: "compare-op",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
        dependsOn: "compareType",
      },
      {
        propName: "compareValue",
        runtimeField: "compareValue",
        displayName: "比较值",
        category: "控制",
        editorType: "mal-value",
        displayMode: "advanced",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
        dependsOn: "compareType",
      },
    ]),
  );
  list.push(
    transition("StateTransition", "StateTransform", "状态跳转", "根据引用行为树的返回值跳转到目标状态。", [
      {
        propName: "subtreeRef",
        runtimeField: "behaviorTreeInstanceId",
        displayName: "行为树",
        category: "基础",
        editorType: "subtree-picker",
        displayMode: "parameter",
        required: true,
        readonly: false,
        noExport: false,
        noSave: false,
      },
    ]),
  );
  list.push(transition("Transition", "Transition", "转换", "连接两个状态的直接转换。", []));

  // 行为树范式标记(其余节点默认 bt;Root 两者通用)
  for (const def of list) {
    if (def.paradigm) continue;
    def.paradigm = def.nodeType === "Root" ? "both" : "bt";
  }

  // 产品化节点配色(2026 版):按 category 收敛为语义色板,不再每个节点一种糖果糖果双色渐变。
  //   - Root/子树 → 品牌蓝(结构性入口)
  //   - Composite(顺序/选择/并行/And/Or/IfElse/…) → 中性靛(骨架)
  //   - Condition/Transition(逻辑判断) → 青绿(判断/流转)
  //   - Action/Wait(执行) → 琥珀(动作)
  //   - Decorator(循环/直到/恒/反相) → 紫(装饰)
  //   - End/Null(终止/空) → 中灰(收敛)
  //   - AlwaysSuccess / SuccessUntil → 绿状态色;AlwaysFailure / FailureUntil → 红状态色。
  // 渐变改为"同色系顶部提亮 8%"的浅→深单向过渡,视觉柔和,不再撞色。
  const PBrand = { c: "#4c8dff", g: ["#5b98ff", "#3d7be6"] as [string, string] };
  const PComposite = { c: "#7c8db5", g: ["#8a9bc2", "#697aa4"] as [string, string] };
  const PLogic = { c: "#3fb8a4", g: ["#4dc4b0", "#2fa290"] as [string, string] };
  const PAction = { c: "#e0b341", g: ["#eac153", "#c99b2c"] as [string, string] };
  const PDecorator = { c: "#9a7be0", g: ["#a88ce6", "#8a6bd0"] as [string, string] };
  // 条件分支专属色:紫粉(magenta),既区别于 Composite 灰(Sequence/Selector)、
  // 也区别于 Condition 青绿(叶子谓词)、Decorator 淡紫。视觉上明确"决策分岔"语义。
  const PBranch = { c: "#c266d9", g: ["#d178e6", "#a84fc2"] as [string, string] };
  const PUtil = { c: "#7d8590", g: ["#8b939e", "#6a727d"] as [string, string] };
  const PSuccess = { c: "#3fb950", g: ["#4fc760", "#2ea241"] as [string, string] };
  const PDanger = { c: "#f85149", g: ["#fa6259", "#df3d36"] as [string, string] };

  const VISUALS: Record<string, { color: string; gradient: [string, string]; shape: "rect" | "ellipse" | "polygon" }> = {
    Root: { color: PBrand.c, gradient: PBrand.g, shape: "rect" },
    Subtree: { color: PBrand.c, gradient: PBrand.g, shape: "rect" },
    Sequence: { color: PComposite.c, gradient: PComposite.g, shape: "rect" },
    Selector: { color: PComposite.c, gradient: PComposite.g, shape: "rect" },
    Parallel: { color: PComposite.c, gradient: PComposite.g, shape: "rect" },
    And: { color: PComposite.c, gradient: PComposite.g, shape: "polygon" },
    Or: { color: PComposite.c, gradient: PComposite.g, shape: "polygon" },
    // 条件分支/监视分支:菱形(UML 决策符)+ 独立紫粉,与 Sequence/Selector 拉开。
    IfElse: { color: PBranch.c, gradient: PBranch.g, shape: "polygon" },
    MonitorBranch: { color: PBranch.c, gradient: PBranch.g, shape: "polygon" },
    SelectMonitor: { color: PBranch.c, gradient: PBranch.g, shape: "polygon" },
    Condition: { color: PLogic.c, gradient: PLogic.g, shape: "polygon" },
    ConditionTransform: { color: PLogic.c, gradient: PLogic.g, shape: "polygon" },
    ConditionTransition: { color: PLogic.c, gradient: PLogic.g, shape: "polygon" },
    StateTransition: { color: PLogic.c, gradient: PLogic.g, shape: "polygon" },
    Transition: { color: PLogic.c, gradient: PLogic.g, shape: "polygon" },
    Action: { color: PAction.c, gradient: PAction.g, shape: "ellipse" },
    Wait: { color: PAction.c, gradient: PAction.g, shape: "ellipse" },
    Loop: { color: PDecorator.c, gradient: PDecorator.g, shape: "rect" },
    Invert: { color: PDecorator.c, gradient: PDecorator.g, shape: "rect" },
    SuccessUntil: { color: PSuccess.c, gradient: PSuccess.g, shape: "rect" },
    FailureUntil: { color: PDanger.c, gradient: PDanger.g, shape: "rect" },
    AlwaysSuccess: { color: PSuccess.c, gradient: PSuccess.g, shape: "rect" },
    AlwaysFailure: { color: PDanger.c, gradient: PDanger.g, shape: "rect" },
    State: { color: PBrand.c, gradient: PBrand.g, shape: "rect" },
    End: { color: PUtil.c, gradient: PUtil.g, shape: "ellipse" },
    Null: { color: PUtil.c, gradient: PUtil.g, shape: "ellipse" },
  };
  for (const def of list) {
    const v = VISUALS[def.nodeType];
    if (v) {
      def.color = v.color;
      def.gradient = v.gradient;
      def.shape = v.shape;
    }
  }

  return list;
}

export const BUILTIN_NODES: readonly NodeDefinition[] = builtins();
