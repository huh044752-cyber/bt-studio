/**
 * 节点描述的【单一数据源】(行为树 / 状态机统一)。
 * 画布悬停提示(useGraphEditor)与属性面板(PropertiesPanel)都用它,保证两处描述一致。
 */
import {
  defaultRegistry,
  functionOwnerClass,
  compareOpSymbol,
  type DesignNode,
  type DesignTree,
  type FunctionCatalog,
} from "@btstudio/bt-core";

export interface NodeInfoParam {
  name: string;
  type: string;
  dir: "input" | "output";
  required: boolean;
  desc?: string;
}

export interface NodeInfo {
  /** 类型显示名(如「动作」「状态」) */
  typeName: string;
  /** 类型说明(registry.description) */
  typeDesc: string;
  /** 节点名 */
  name: string;
  /** 范式标记 */
  paradigm: "behavior_tree" | "state_machine";
  className?: string;
  method?: string;
  /** 绑定方法的说明(functionCatalog.description / displayName) */
  methodDesc?: string;
  params: NodeInfoParam[];
  /** 绑定函数的输出参数(输出比较的候选字段)。 */
  outputs: NodeInfoParam[];
  /** 比较判断的人类可读描述(如「函数返回值 == 1」「输出 hp < 10」),无判断则为空。 */
  judgment?: string;
  /** FSM 转移目标状态名 */
  targetState?: string;
  /** State 是否结束态 */
  endState?: boolean;
  comment?: string;
}

/** 构建节点的统一描述信息(行为树 / 状态机通用)。 */
export function describeNode(
  node: DesignNode,
  tree: DesignTree | undefined,
  catalog: FunctionCatalog,
): NodeInfo {
  const def = defaultRegistry.get(node.nodeType);
  const className = node.targetSelector?.modelClass || undefined;
  const method = node.functionRef || undefined;

  let methodDesc: string | undefined;
  const params: NodeInfoParam[] = [];
  const outputs: NodeInfoParam[] = [];
  if (method) {
    const fn = catalog.functions.find(
      (f) => f.name === method && (!className || functionOwnerClass(f) === className),
    );
    if (fn) {
      methodDesc = fn.description || fn.displayName;
      for (const p of fn.params ?? []) {
        const item: NodeInfoParam = {
          name: p.name,
          type: p.originalType ?? p.malType ?? p.displayType ?? "",
          dir: p.direction === "output" ? "output" : "input",
          required: !!p.required,
          desc: p.description || p.displayName,
        };
        params.push(item);
        if (item.dir === "output") outputs.push(item);
      }
    }
  }

  // 比较判断:条件 / 条件跳转节点。Output 模式比较函数输出字段,否则比较函数返回值。
  let judgment: string | undefined;
  const opSym = compareOpSymbol(node.compareOp);
  if (opSym) {
    const rhs = node.compareValue ?? "";
    if (node.compareType === "Output") {
      const field = node.compareOutputName || "?";
      judgment = `输出 ${field} ${opSym} ${rhs}`.trim();
    } else {
      judgment = `${method ? method + " 返回值" : "返回值"} ${opSym} ${rhs}`.trim();
    }
  }

  let targetState: string | undefined;
  if (node.transitionTarget && tree) targetState = tree.nodes[node.transitionTarget]?.name;

  return {
    typeName: def?.displayName ?? node.nodeType,
    typeDesc: def?.description ?? "",
    name: node.name,
    paradigm: (tree?.projectKind ?? "behavior_tree") === "state_machine" ? "state_machine" : "behavior_tree",
    className,
    method,
    methodDesc,
    params,
    outputs,
    judgment,
    targetState,
    endState: node.nodeType === "State" ? node.endStatusSuccess : undefined,
    comment: node.comment,
  };
}
