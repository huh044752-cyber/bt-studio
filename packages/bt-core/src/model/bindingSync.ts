/**
 * 函数绑定同步 —— 依据函数目录(FunctionCatalog)重建节点的输入/输出参数绑定。
 *
 * 解决:重新打开/导入工程时,节点虽带 functionRef,但 inputBindings 为空(运行 XML
 * 仅在有 <Inputs> 时才回填),导致属性面板「输入参数」不显示,必须再次手选方法才出现;
 * 同时空 inputBindings 会被校验误判为「必填参数未赋值」从而阻断导出。
 *
 * 设计:纯函数,保留已填值,补齐缺失参数(输入参数恒带默认值),丢弃目录已删除的旧参数。
 */
import type { FunctionCatalog, FunctionParam } from "../types/catalog.js";
import { functionOwnerClass } from "../types/catalog.js";
import type { DesignNode, InputBindingDraft, OutputBindingDraft } from "../types/editor.js";
import { malToXmlType, malTypeDefaultValue, resolveMalType } from "../mal/malMapping.js";

/** 可绑定函数的节点类型(与属性面板 isFnNode 保持一致)。 */
const FUNCTION_NODE_TYPES = new Set(["Action", "Condition", "ConditionTransform", "Wait", "State"]);

export function isFunctionNode(nodeType: string): boolean {
  return FUNCTION_NODE_TYPES.has(nodeType);
}

/**
 * 入参默认值:显式 defaultValue 优先,否则按 MAL 类型给类型对应默认值
 * (FZ_MARGTYPE_INTEGER→"0"、FZ_MARGTYPE_STRING→""、FZ_MARGTYPE_BOOL→"false" 等)。
 * malType 缺失时先由 displayType 解析出 malType 再取默认,保证「所有输入参数都有类型默认值」。
 */
export function defaultValueForParam(p: FunctionParam): string {
  if (p.defaultValue !== undefined && p.defaultValue !== "") return p.defaultValue;
  const mal = p.malType ?? (p.displayType ? resolveMalType(p.displayType) : undefined);
  return malTypeDefaultValue(mal);
}

/** 输入参数的运行态 type 字符串:originalType 优先,否则由 malType 推导。 */
function inputType(p: FunctionParam, prev?: InputBindingDraft): string {
  return p.originalType ?? (p.malType ? malToXmlType(p.malType) : (prev?.type ?? ""));
}

/** 是否已有"有效取值"(常量非空 或 已选黑板变量)。 */
function hasValue(b: InputBindingDraft | undefined): boolean {
  if (!b) return false;
  return (b.source === "blackboard" && !!b.variableId) || (b.value ?? "").trim() !== "";
}

/**
 * 依据函数目录重建单个节点的输入/输出绑定草稿。
 * 返回 null 表示无需处理(非函数节点、未绑定方法、或目录暂无该函数)。
 */
export function reconcileNodeBindings(
  node: DesignNode,
  catalog: FunctionCatalog,
): { inputBindings: InputBindingDraft[]; outputBindings: OutputBindingDraft[] } | null {
  if (!isFunctionNode(node.nodeType) || !node.functionRef) return null;
  const className = node.targetSelector?.modelClass || "";
  const fn = catalog.functions.find(
    (f) => f.name === node.functionRef && (!className || functionOwnerClass(f) === className),
  );
  if (!fn) return null;

  const prevIn = new Map((node.inputBindings ?? []).map((b) => [b.name, b]));
  const prevOut = new Map((node.outputBindings ?? []).map((b) => [b.name, b]));
  const params = fn.params ?? [];

  const inputBindings: InputBindingDraft[] = params
    .filter((p) => p.direction !== "output")
    .map((p) => {
      const prev = prevIn.get(p.name);
      return {
        name: p.name,
        type: inputType(p, prev),
        source: prev?.source ?? "constant",
        // 保留已填值;否则用默认值(显式 defaultValue 或按类型推断)。
        value: hasValue(prev) ? prev!.value : defaultValueForParam(p),
        blackboardId: prev?.blackboardId,
        variableId: prev?.variableId,
        displayType: p.displayType,
        malType: p.malType,
        valueFormat: p.valueFormat,
      };
    });

  const outputBindings: OutputBindingDraft[] = params
    .filter((p) => p.direction === "output")
    .map((p) => {
      const prev = prevOut.get(p.name);
      return {
        name: p.name,
        blackboardId: prev?.blackboardId ?? "",
        variableId: prev?.variableId ?? "",
        displayType: p.displayType,
        malType: p.malType,
      };
    });

  return { inputBindings, outputBindings };
}

function sameBindings(
  node: DesignNode,
  next: { inputBindings: InputBindingDraft[]; outputBindings: OutputBindingDraft[] },
): boolean {
  return (
    JSON.stringify(node.inputBindings ?? []) === JSON.stringify(next.inputBindings) &&
    JSON.stringify(node.outputBindings ?? []) === JSON.stringify(next.outputBindings)
  );
}

/**
 * 就地重建整棵树所有函数节点的绑定;返回被修改的节点数。
 * 在导入工程 / 导入 XML / 抽取类型空间后调用,确保重开即显示入参(含默认值),
 * 无需再次手选方法。
 */
export function reconcileTreeBindings(
  tree: { nodes: Record<string, DesignNode> },
  catalog: FunctionCatalog,
): number {
  let changed = 0;
  for (const node of Object.values(tree.nodes)) {
    const next = reconcileNodeBindings(node, catalog);
    if (next && !sameBindings(node, next)) {
      node.inputBindings = next.inputBindings;
      node.outputBindings = next.outputBindings;
      changed++;
    }
  }
  return changed;
}
