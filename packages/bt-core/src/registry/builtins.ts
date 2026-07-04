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
// 根节点绑定的"实体模板"(UnitTemplate)。模板从想定 .sdata 的 Unit 派生,
// 承载"这颗树是给哪类实体用的"语义,叶子节点的类/函数下拉据此过滤到
// 该实体挂载的组件类范围。未选时叶子下拉降级为全量,场景挂接页仍可继续。
const P_TEMPLATE: PropertySchema = {
  propName: "templateId",
  displayName: "实体模板",
  category: "基础",
  editorType: "unit-template-picker",
  displayMode: "parameter",
  required: false,
  readonly: false,
  noExport: true,
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
  // Root 只绑"实体模板"(UnitTemplate):从当前工作空间的想定派生。
  // 选中模板后,树内叶子节点的"类/函数"下拉自动过滤到该模板挂载的组件类范围
  // —— 类是 UI 过滤维度,不落进 XML;运行时仍按 <Action className=... function=...>
  // 装配。类和函数的绑定仍在叶子节点上完成。
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
    description: "行为树根。固定 0 入 1 出,必须且只能有 1 个子节点。可选绑定实体模板,过滤叶子节点的类/函数下拉。",
    properties: [P_NAME, P_TEMPLATE, P_COMMENT],
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

  // Condition
  list.push({
    nodeType: "Condition",
    runtimeKind: "Condition",
    xmlElement: "Condition",
    displayName: "条件",
    category: "Condition",
    icon: "help-circle",
    colorToken: "accent",
    minChildren: 0,
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_NONE,
    fosimSupported: true,
    description: "条件判断。可用函数返回值或对输出 MAL 字段做比较(comparetype=Output)。叶子节点。",
    properties: [
      P_NAME,
      P_FUNCTION,
      {
        propName: "compareType",
        runtimeField: "compareType",
        displayName: "比较模式",
        category: "控制",
        editorType: "enum",
        displayMode: "parameter",
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
        displayMode: "parameter",
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
        displayMode: "parameter",
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
        displayMode: "parameter",
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

  // ConditionTransform
  list.push({
    nodeType: "ConditionTransform",
    runtimeKind: "ConditionTransform",
    xmlElement: "ConditionTransform",
    displayName: "条件变换",
    category: "Condition",
    icon: "shuffle",
    colorToken: "accent",
    minChildren: 0,
    maxChildren: 0,
    inputPort: IN_SINGLE,
    outputPort: OUT_NONE,
    fosimSupported: true,
    description: "把函数查询结果变换为条件状态。叶子节点。",
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
    transition("ConditionTransition", "ConditionTransform", "条件跳转", "根据条件结果决定是否跳转到目标状态。", [
      P_FUNCTION,
      {
        propName: "compareOp",
        runtimeField: "compareOp",
        displayName: "比较运算",
        category: "控制",
        editorType: "compare-op",
        displayMode: "parameter",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
      },
      {
        propName: "compareValue",
        runtimeField: "compareValue",
        displayName: "比较值",
        category: "控制",
        editorType: "mal-value",
        displayMode: "parameter",
        required: false,
        readonly: false,
        noExport: false,
        noSave: false,
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

  // 应用 vue2 节点配色/渐变/形状(对齐 F:\0411\vue2 src/config/nodeConfig.js)
  const VUE2_VISUALS: Record<string, { color: string; gradient: [string, string]; shape: "rect" | "ellipse" | "polygon" }> = {
    Root: { color: "#409EFF", gradient: ["#667eea", "#764ba2"], shape: "rect" },
    Action: { color: "#ffd700", gradient: ["#f093fb", "#f5576c"], shape: "ellipse" },
    Wait: { color: "#ffd700", gradient: ["#f093fb", "#f5576c"], shape: "ellipse" },
    Condition: { color: "#67C23A", gradient: ["#4facfe", "#00f2fe"], shape: "polygon" },
    ConditionTransform: { color: "#67C23A", gradient: ["#4facfe", "#00f2fe"], shape: "polygon" },
    Sequence: { color: "#E6A23C", gradient: ["#fa709a", "#fee140"], shape: "rect" },
    Selector: { color: "#909399", gradient: ["#30cfd0", "#330867"], shape: "rect" },
    Parallel: { color: "#00BCD4", gradient: ["#a8edea", "#fed6e3"], shape: "rect" },
    Subtree: { color: "#9c27b0", gradient: ["#9c27b0", "#ba68c8"], shape: "rect" },
    Or: { color: "#67C23A", gradient: ["#ffecd2", "#fcb69f"], shape: "polygon" },
    And: { color: "#409EFF", gradient: ["#ff9a9e", "#fecfef"], shape: "polygon" },
    End: { color: "#909399", gradient: ["#d299c2", "#fef9d7"], shape: "ellipse" },
    Null: { color: "#C0C4CC", gradient: ["#89f7fe", "#66a6ff"], shape: "ellipse" },
    Loop: { color: "#E6A23C", gradient: ["#fad961", "#f76b1c"], shape: "rect" },
    SuccessUntil: { color: "#52c41a", gradient: ["#52c41a", "#73d13d"], shape: "rect" },
    FailureUntil: { color: "#ff6b6b", gradient: ["#ff6b6b", "#ee5a6f"], shape: "rect" },
    AlwaysSuccess: { color: "#52c41a", gradient: ["#52c41a", "#73d13d"], shape: "rect" },
    AlwaysFailure: { color: "#ff4d4f", gradient: ["#ff4d4f", "#ff7875"], shape: "rect" },
    IfElse: { color: "#67C23A", gradient: ["#96deda", "#50c9c3"], shape: "rect" },
    MonitorBranch: { color: "#9c27b0", gradient: ["#9c27b0", "#ba68c8"], shape: "rect" },
    SelectMonitor: { color: "#9c27b0", gradient: ["#9c27b0", "#ba68c8"], shape: "rect" },
    Invert: { color: "#f5b65c", gradient: ["#fad961", "#f76b1c"], shape: "rect" },
    State: { color: "#409EFF", gradient: ["#667eea", "#764ba2"], shape: "rect" },
    ConditionTransition: { color: "#67C23A", gradient: ["#4facfe", "#00f2fe"], shape: "polygon" },
    StateTransition: { color: "#E6A23C", gradient: ["#f093fb", "#f5576c"], shape: "polygon" },
    Transition: { color: "#E6A23C", gradient: ["#f093fb", "#f5576c"], shape: "polygon" },
  };
  for (const def of list) {
    const v = VUE2_VISUALS[def.nodeType];
    if (v) {
      def.color = v.color;
      def.gradient = v.gradient;
      def.shape = v.shape;
    }
  }

  return list;
}

export const BUILTIN_NODES: readonly NodeDefinition[] = builtins();
