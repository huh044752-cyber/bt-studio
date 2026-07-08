/**
 * FSM XML -> DesignTree (对齐 fsmXml.ts 导出格式)。
 * 引擎格式:Root → State(入口) → ConditionTransform/StateTransform (内嵌 State 或 Goto)。
 */
import { XMLParser } from "fast-xml-parser";
import type { DesignTree, DesignNode, InputBindingDraft, OutputBindingDraft } from "../types/editor.js";
import type { NodeRegistry } from "../registry/NodeRegistry.js";
import { defaultRegistry } from "../registry/NodeRegistry.js";
import { createTree, createEdge } from "../model/factory.js";
import { newNodeId } from "../model/ids.js";

interface POEntry {
  [key: string]: unknown;
  ":@"?: Record<string, string>;
}

function attrs(entry: POEntry): Record<string, string> {
  return entry[":@"] ?? {};
}
function tagOf(entry: POEntry): string {
  for (const k of Object.keys(entry)) if (k !== ":@") return k;
  return "";
}
function childrenOf(entry: POEntry, tag: string): POEntry[] {
  const v = entry[tag];
  return Array.isArray(v) ? (v as POEntry[]) : [];
}
function normalizeAttrs(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k.startsWith("@_") ? k.slice(2) : k] = String(v);
  return out;
}

const TRANSITION_XML = new Set(["ConditionTransform", "StateTransform"]);

export function parseFsmXml(xml: string, registry: NodeRegistry = defaultRegistry): DesignTree {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as POEntry[];
  const rootEntry = parsed.find((e) => tagOf(e) === "Root");
  if (!rootEntry) throw new Error("FSM XML 缺少 <Root>");
  const rootAttr = normalizeAttrs(attrs(rootEntry));

  const tree = createTree({
    treeName: rootAttr["name"] ?? "imported_fsm",
    mode: "standalone",
    projectKind: "state_machine",
    withRoot: true,
  });

  // id → nodeId 映射(FSM XML 用数字 id;我们恢复成 node_xxx)
  const idToNodeId = new Map<string, string>();
  const editorRootId = tree.rootNodeId;

  // 递归解析 State(及其转移)
  const parseState = (entry: POEntry, parentNodeId: string): string => {
    const tag = tagOf(entry);
    if (tag !== "State") throw new Error(`期望 <State>,得到 <${tag}>`);
    const a = normalizeAttrs(attrs(entry));
    const sid = a["id"];
    // 已解析过(Goto 引用的目标 State 已在前面遇到)→ 返回已有 nodeId
    if (sid && idToNodeId.has(sid)) return idToNodeId.get(sid)!;

    const nodeId = newNodeId();
    if (sid) idToNodeId.set(sid, nodeId);
    // 新格式统一:类绑定只读 className,不再兼容 cognition/mdataName;
    // componentId 由挂接流程写到 sdata,不属于工作空间层,导入时忽略。
    const cls = a["className"];
    const node: DesignNode = {
      nodeId,
      nodeType: "State",
      xmlType: "State",
      name: a["name"] ?? a["action"] ?? a["function"] ?? "状态",
      functionRef: a["action"] ?? a["function"],
      subtreeRef: a["behaviac_tree"],
      endStatusSuccess: (a["IsEndState"] ?? "").toLowerCase() === "true",
      targetSelector: cls ? { modelClass: cls } : undefined,
      inputBindings: [],
      outputBindings: [],
      childOrder: [],
    };
    tree.nodes[nodeId] = node;

    // 连接到父节点(Root 或无)
    if (parentNodeId && tree.nodes[parentNodeId]) {
      tree.nodes[parentNodeId]!.childOrder.push(nodeId);
      const edge = createEdge(parentNodeId, nodeId, tree.nodes[parentNodeId]!.childOrder.length - 1);
      tree.edges[edge.edgeId] = edge;
    }

    // 解析 State 的子元素:Inputs / Outputs / 转移
    const inner = childrenOf(entry, "State");
    for (const c of inner) {
      const ctag = tagOf(c);
      if (ctag === "Inputs") {
        for (const ie of childrenOf(c, "Inputs")) {
          if (tagOf(ie) !== "Input") continue;
          const ia = normalizeAttrs(attrs(ie));
          node.inputBindings.push({
            name: ia["name"] ?? "",
            type: ia["type"] ?? "",
            source: (ia["source"] ?? "").toLowerCase() === "blackboard" ? "blackboard" : "constant",
            value: ia["value"],
            blackboardId: ia["blackboardKey"],
            variableId: ia["variableKey"],
          } as InputBindingDraft);
        }
      } else if (ctag === "Outputs") {
        for (const oe of childrenOf(c, "Outputs")) {
          if (tagOf(oe) !== "Output") continue;
          const oa = normalizeAttrs(attrs(oe));
          node.outputBindings.push({
            name: oa["name"] ?? "",
            blackboardId: oa["blackboardKey"] ?? "",
            variableId: oa["variableKey"] ?? "",
          } as OutputBindingDraft);
        }
      } else if (TRANSITION_XML.has(ctag)) {
        const transNode = parseTransition(c, nodeId);
        // 转移是 State 的结构子
        node.childOrder.push(transNode.nodeId);
        const edge = createEdge(nodeId, transNode.nodeId, node.childOrder.length - 1);
        tree.edges[edge.edgeId] = edge;
      }
    }
    return nodeId;
  };

  const parseTransition = (entry: POEntry, parentStateId: string): DesignNode => {
    const tag = tagOf(entry);
    const a = normalizeAttrs(attrs(entry));
    // 映射 XML 名到编辑器节点类型
    const nodeType = tag === "ConditionTransform" ? "ConditionTransition" : "StateTransition";
    const nodeId = newNodeId();
    // 老 .sm 里转移一般没写 name(fight_status.sm 全无 name 属性):
    //  1) 优先用 action/function 作 name(信息量最大,e.g. Fly_to_Fight_congition)
    //  2) 否则回落中文 displayName("条件跳转"/"状态跳转"),避免画布"条件跳转\nConditionTransition"上下不齐。
    const fallbackCn = nodeType === "ConditionTransition" ? "条件跳转" : "状态跳转";
    const name = a["name"] ?? a["action"] ?? a["function"] ?? fallbackCn;
    // 转移节点同 State:只读 className。
    const tCls = a["className"];
    const node: DesignNode = {
      nodeId,
      nodeType,
      xmlType: tag,
      name,
      functionRef: a["action"] ?? a["function"],
      script: a["conditionScript"],
      subtreeRef: a["btInstanceId"],
      compareOp: a["compareOp"],
      compareValue: a["compareValue"],
      targetSelector: tCls ? { modelClass: tCls } : undefined,
      inputBindings: [],
      outputBindings: [],
      childOrder: [],
    };
    tree.nodes[nodeId] = node;

    // 解析转移的子元素:Inputs/Outputs/目标 State/Goto
    const inner = childrenOf(entry, tag);
    for (const c of inner) {
      const ctag = tagOf(c);
      if (ctag === "Inputs") {
        for (const ie of childrenOf(c, "Inputs")) {
          if (tagOf(ie) !== "Input") continue;
          const ia = normalizeAttrs(attrs(ie));
          node.inputBindings.push({
            name: ia["name"] ?? "",
            type: ia["type"] ?? "",
            source: (ia["source"] ?? "").toLowerCase() === "blackboard" ? "blackboard" : "constant",
            value: ia["value"],
            blackboardId: ia["blackboardKey"],
            variableId: ia["variableKey"],
          } as InputBindingDraft);
        }
      } else if (ctag === "Outputs") {
        for (const oe of childrenOf(c, "Outputs")) {
          if (tagOf(oe) !== "Output") continue;
          const oa = normalizeAttrs(attrs(oe));
          node.outputBindings.push({
            name: oa["name"] ?? "",
            blackboardId: oa["blackboardKey"] ?? "",
            variableId: oa["variableKey"] ?? "",
          } as OutputBindingDraft);
        }
      } else if (ctag === "Goto") {
        // Goto → transitionTarget 引用(不是结构子)
        const gotoId = normalizeAttrs(attrs(c))["id"];
        if (gotoId && idToNodeId.has(gotoId)) {
          node.transitionTarget = idToNodeId.get(gotoId)!;
        }
      } else if (ctag === "State") {
        // 嵌套 State = 该转移的目标状态。设计模型里非入口 State 不做 Root 的结构子
        // (Root.maxChildren=1,只挂入口 State;老代码把每个目标 State 都挂 Root 造成
        // "Root 必须且只能有 1 个子节点,当前 N 个" 阻断挂接),只以 transitionTarget
        // 引用可达 —— ValidationEngine.collectReachable 已沿 transitionTarget 链遍历。
        const targetNodeId = parseState(c, "");
        node.transitionTarget = targetNodeId;
      }
    }
    return node;
  };

  // 解析入口 State(Root 的唯一子)
  const rootChildren = childrenOf(rootEntry, "Root");
  const entryStateEntry = rootChildren.find((c) => tagOf(c) === "State");
  if (entryStateEntry) parseState(entryStateEntry, editorRootId);

  return tree;
}
