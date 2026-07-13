/**
 * 状态机(FSM)导出 —— 严格对齐真实引擎 F:\FOSim\FOSimEngine\src\modules\extern\state_machine_loader.cpp。
 *
 * 引擎约定(state_machine_loader.cpp):
 *  - <Root projectType="状态机"> 必须恰好包含【一个】<State>(入口状态);
 *  - <State id action="函数名" ...> 通过 action 属性绑定执行函数(回退 function);
 *  - 转移是 State 的子元素 <ConditionTransform>/<StateTransform id action ...>,
 *    每个转移内部恰好包含【一个】目标:嵌套的 <State>(完整定义)或 <Goto id="目标状态id"/>;
 *  - 已经定义过的状态再次被指向时用 <Goto id>,避免无限嵌套 / 重复 id;
 *  - <Inputs>/<Outputs> 与行为树一致(Input name type value source blackboardKey variableKey)。
 *
 * 编辑器模型 → 引擎:State 节点为状态;转移节点(ConditionTransition/StateTransition/Transition)
 * 是源 State 的结构子,其目标 State 经 transitionTarget 引用(Goto)。入口状态 = Root 的唯一子 State。
 */
import type { DesignTree, DesignNode } from "../types/editor.js";
import { malToXmlType } from "../mal/malMapping.js";
import { xmlEscape } from "./xmlSerializer.js";
import { cyberTypeToOldEngine } from "../types/mal.js";
import type { CyberMARGType } from "../types/mal.js";

/**
 * 老引擎类型转换(与 xmlSerializer.toOldType 同义)。
 * canonical 源:packages/bt-core/src/export/xmlSerializer.ts::toOldType —— 修改时两处保持字节一致。
 * (此处不直接 import 以避免 fsmXml <-> xmlSerializer 的循环导出。)
 */
function toOldType(t: string | undefined): string {
  if (!t) return "";
  if (t.startsWith("CYBER_MARGTYPE_") || t === "CYBER_USER_DEFINED") {
    return cyberTypeToOldEngine(t as CyberMARGType);
  }
  switch (t) {
    case "Int": case "Integer": case "SpinBox": case "CyberIntegerType": return "Integer";
    case "Real": case "DoubleSpinBox": case "Float": case "float": case "CyberRealType": return "Real";
    case "Boolean": case "Bool": case "CheckBox": case "CyberBOOL": return "Boolean";
    case "Julian": case "CyberJulianType": return "Julian";
    case "String": case "Name": case "LineEditor": case "CyberStringType": case "CyberNameType": return "String";
    case "Coordinate": case "Position": case "CyberCoordinateType": case "CyberPositionType": case "CyberVectorType": case "CyberOrientationType": return "Coordinate";
    default: return t;
  }
}

export class FsmExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FsmExportError";
  }
}

function attr(name: string, value: string | number | boolean | undefined): string {
  if (value === undefined || value === "" || value === false) return "";
  return ` ${name}="${xmlEscape(String(value))}"`;
}

const TRANSITION_TYPES = new Set(["ConditionTransition", "StateTransition", "Transition"]);

/**
 * State / Transition 目标选择器属性:只输出 className(自由类型空间选类的结果)。
 * componentId 是运行时挂接才写入的 data_id UUID —— 工作空间 / 模板层不输出,由场景挂接闸门在 sdata 侧补齐。
 */
function targetAttrs(n: DesignNode): string {
  const t = n.targetSelector;
  if (!t) return "";
  return t.modelClass ? attr("className", t.modelClass) : "";
}

/** FSM 版 scope 解析(与 xmlSerializer 一致)。 */
function fsmScopeSourceOf(blackboardId: string, scopeByBoardId: Map<string, string>): "local" | "global" {
  return scopeByBoardId.get(blackboardId) === "Global" ? "global" : "local";
}

/** <Inputs>/<Outputs> 块(与行为树一致)。返回缩进好的多行;空则返回 []。 */
function ioBlocks(n: DesignNode, indent: string, scopeByBoardId: Map<string, string>): string[] {
  const lines: string[] = [];
  if (n.inputBindings.length) {
    lines.push(`${indent}<Inputs>`);
    for (const b of n.inputBindings) {
      const type = toOldType(b.type || (b.malType ? malToXmlType(b.malType) : ""));
      if (b.source === "blackboard") {
        const src = fsmScopeSourceOf(b.blackboardId ?? "", scopeByBoardId);
        lines.push(
          `${indent}  <Input${attr("name", b.name)}${attr("type", type)} value="" source="${src}"${attr("blackboardKey", b.blackboardId)}${attr("variableKey", b.variableId)} />`,
        );
      } else {
        lines.push(`${indent}  <Input${attr("name", b.name)}${attr("type", type)}${attr("value", b.value)} />`);
      }
    }
    lines.push(`${indent}</Inputs>`);
  }
  if (n.outputBindings.length) {
    lines.push(`${indent}<Outputs>`);
    for (const b of n.outputBindings) {
      const src = fsmScopeSourceOf(b.blackboardId ?? "", scopeByBoardId);
      lines.push(
        `${indent}  <Output${attr("name", b.name)} source="${src}"${attr("blackboardKey", b.blackboardId)}${attr("variableKey", b.variableId)} />`,
      );
    }
    lines.push(`${indent}</Outputs>`);
  }
  return lines;
}

export function serializeFsmXml(tree: DesignTree, scopeByBoardId: Map<string, string> = new Map()): string {
  const states = Object.values(tree.nodes).filter((n) => n.nodeType === "State");
  if (states.length === 0) throw new FsmExportError("状态机为空:至少需要一个 State 节点");

  // 数字 id:State 1..N;转移 id 从 N+1 起,保证全局唯一非零。
  const idOf = new Map<string, number>();
  states.forEach((s, i) => idOf.set(s.nodeId, i + 1));
  let nextTransId = states.length + 1;

  // 入口状态 = Root 的唯一子 State(回退:第一个 State)。
  const root = tree.rootNodeId ? tree.nodes[tree.rootNodeId] : undefined;
  const entryId =
    root?.childOrder.find((c) => tree.nodes[c]?.nodeType === "State") ?? states[0]!.nodeId;

  const emitted = new Set<string>();

  /** 递归输出一个 State(及其转移)。已输出过的状态由调用方改用 Goto。 */
  function emitState(stateNodeId: string, indent: string): string[] {
    const s = tree.nodes[stateNodeId];
    if (!s) return [];
    emitted.add(stateNodeId);
    const sid = idOf.get(stateNodeId)!;
    const lines: string[] = [];
    const head =
      `${indent}<State${attr("id", sid)}${attr("name", s.name)}${attr("action", s.functionRef)}` +
      `${attr("behaviac_tree", s.subtreeRef)}${attr("IsEndState", s.endStatusSuccess ? "true" : "")}${targetAttrs(s)}`;

    // 该 State 的转移(结构子里类型属于转移的节点)。
    const transitions = s.childOrder
      .map((c) => tree.nodes[c])
      .filter((c): c is DesignNode => !!c && TRANSITION_TYPES.has(c.nodeType));

    const inner: string[] = [...ioBlocks(s, indent + "  ", scopeByBoardId)];
    for (const t of transitions) {
      const cls = t.nodeType === "StateTransition" ? "StateTransform" : "ConditionTransform";
      const tid = nextTransId++;
      // 老版分支:转移不挂 btInstanceId(uuid),behaviac_tree 也只在状态上用。
      const thead =
        `${indent}  <${cls}${attr("id", tid)}${attr("name", t.name)}${attr("action", t.functionRef)}` +
        `${targetAttrs(t)}`;
      const tInner: string[] = [...ioBlocks(t, indent + "    ", scopeByBoardId)];

      // 目标:首次出现 → 嵌套完整 <State>;已出现 → <Goto id>。
      const targetNodeId =
        t.transitionTarget && tree.nodes[t.transitionTarget]?.nodeType === "State"
          ? t.transitionTarget
          : undefined;
      if (targetNodeId) {
        if (emitted.has(targetNodeId)) {
          tInner.push(`${indent}    <Goto${attr("id", idOf.get(targetNodeId)!)} />`);
        } else {
          tInner.push(...emitState(targetNodeId, indent + "    "));
        }
      }

      if (tInner.length === 0) {
        inner.push(`${thead} />`);
      } else {
        inner.push(`${thead}>`);
        inner.push(...tInner);
        inner.push(`${indent}  </${cls}>`);
      }
    }

    if (inner.length === 0) {
      lines.push(`${head} />`);
    } else {
      lines.push(`${head}>`);
      lines.push(...inner);
      lines.push(`${indent}</State>`);
    }
    return lines;
  }

  const lines: string[] = ["<?xml version='1.0' encoding='utf-8'?>"];
  // 与 BT 同理:Root 上带 cognition 让引擎 StateMachineTask 侧的 Agent EmployCog 找到类。
  // FSM 里 cognition = 出现最多的 State/Transition.className(单类 FSM 场景恒定为该类)。
  const counts = new Map<string, number>();
  for (const n of Object.values(tree.nodes)) {
    const cls = n.targetSelector?.modelClass?.trim();
    if (cls) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  let cognition = "";
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; cognition = k; }
  lines.push(`<Root${attr("id", 0)} projectType="状态机"${attr("name", tree.treeName)}${attr("cognition", cognition)}>`);
  lines.push(...emitState(entryId, "  "));
  lines.push("</Root>");
  return lines.join("\n") + "\n";
}
