/**
 * 运行 XML -> 设计态(文档 §9)。先解析为结构,再恢复编辑器图结构。
 * 使用 fast-xml-parser 的 preserveOrder 模式以保留子节点顺序。
 */
import { XMLParser } from "fast-xml-parser";
import type { DesignTree, DesignNode } from "../types/editor.js";
import type { Blackboard, Variable } from "../types/catalog.js";
import type { NodeRegistry } from "../registry/NodeRegistry.js";
import { defaultRegistry } from "../registry/NodeRegistry.js";
import { createTree, createBlackboard, createEdge } from "../model/factory.js";
import { newNodeId, newVariableId } from "../model/ids.js";

const META_ELEMENTS = new Set([
  "Blackboards",
  "Blackboard",
  "Variable",
  "ReferencedBehaviorTrees",
  "ReferencedBehaviorTree",
  "Inputs",
  "Input",
  "Outputs",
  "Output",
]);

/** xmlElement -> nodeType 反查(由 Registry 构建)。 */
function buildElementToNodeType(registry: NodeRegistry): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of registry.list()) {
    // 首个注册者优先:Action 先于其别名 Wait 注册,保证 <Action> 还原为 Action。
    if (!map.has(def.xmlElement)) map.set(def.xmlElement, def.nodeType);
  }
  return map;
}

interface POEntry {
  [key: string]: unknown;
  ":@"?: Record<string, string>;
}

function attrs(entry: POEntry): Record<string, string> {
  return entry[":@"] ?? {};
}

function tagOf(entry: POEntry): string {
  for (const k of Object.keys(entry)) {
    if (k !== ":@") return k;
  }
  return "";
}

function childrenOf(entry: POEntry, tag: string): POEntry[] {
  const v = entry[tag];
  return Array.isArray(v) ? (v as POEntry[]) : [];
}

export interface ParseResult {
  tree: DesignTree;
  localBlackboard: Blackboard;
  globalBlackboards: Blackboard[];
  /** 导入产生的受限/未知节点类型 */
  restrictedTypes: string[];
  /** 引用到的函数名(供映射修复) */
  referencedFunctions: string[];
}

export function importXmlToDesignTree(
  xml: string,
  registry: NodeRegistry = defaultRegistry,
): ParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as POEntry[];

  const rootEntry = parsed.find((e) => tagOf(e) === "Root");
  if (!rootEntry) throw new Error("XML 缺少 <Root> 元素");
  const rootAttr = normalizeAttrs(attrs(rootEntry));

  const tree = createTree({
    treeName: rootAttr["name"] ?? "imported_tree",
    mode: "standalone",
    withRoot: true,
  });
  tree.templateId = rootAttr["btTemplateId"] ?? rootAttr["templateId"];
  tree.modelId = rootAttr["modelId"];
  tree.cognition = rootAttr["cognition"];

  const editorRootId = tree.rootNodeId;
  const restrictedTypes: string[] = [];
  const referencedFunctions: string[] = [];
  const elementToNodeType = buildElementToNodeType(registry);

  // 黑板
  const localBb = createBlackboard(`${tree.treeName}-本地板`, "tree");
  tree.localBlackboardId = localBb.blackboardId;
  const globalBbs: Blackboard[] = [];
  const bbsEntry = childrenOf(rootEntry, "Root").find((e) => tagOf(e) === "Blackboards");
  // 注意 preserveOrder:Root 的子节点直接挂在 rootEntry["Root"] 数组里
  const rootChildren = (rootEntry["Root"] as POEntry[]) ?? [];
  void bbsEntry;
  for (const child of rootChildren) {
    const tag = tagOf(child);
    if (tag === "Blackboards") {
      for (const bbEntry of (child["Blackboards"] as POEntry[]) ?? []) {
        if (tagOf(bbEntry) !== "Blackboard") continue;
        const a = normalizeAttrs(attrs(bbEntry));
        const scope = (a["scope"] ?? "local").toLowerCase() === "global" ? "global" : "tree";
        const bb = createBlackboard(a["name"] ?? a["id"] ?? "板", scope, {
          blackboardId: a["id"],
        });
        bb.linked = (a["linked"] ?? "").toLowerCase() === "true" || a["linked"] === "1";
        for (const vEntry of (bbEntry["Blackboard"] as POEntry[]) ?? []) {
          if (tagOf(vEntry) !== "Variable") continue;
          const va = normalizeAttrs(attrs(vEntry));
          const variable: Variable = {
            variableId: va["id"] ?? newVariableId(),
            name: va["key"] ?? "var",
            scope: scope === "global" ? "global" : "tree",
            displayType: "string",
            valueFormat: "literal",
            defaultValue: va["value"],
            source: "imported",
          };
          bb.variables.push(variable);
        }
        if (scope === "global") globalBbs.push(bb);
        else localBb.variables.push(...bb.variables);
      }
    }
  }

  // 行为根节点(跳过 meta 元素)
  const behaviorEntries = rootChildren.filter(
    (c) => !META_ELEMENTS.has(tagOf(c)),
  );

  const buildNode = (entry: POEntry): DesignNode => {
    const el = tagOf(entry);
    const a = normalizeAttrs(attrs(entry));
    const nodeType = elementToNodeType.get(el);
    const node: DesignNode = {
      nodeId: newNodeId(),
      nodeType: nodeType ?? el,
      xmlType: el,
      name: a["name"] ?? el,
      inputBindings: [],
      outputBindings: [],
      childOrder: [],
    };
    if (!nodeType) {
      node.restricted = true;
      if (!restrictedTypes.includes(el)) restrictedTypes.push(el);
    }
    // 通用属性
    if (a["function"]) {
      node.functionRef = a["function"];
      if (!referencedFunctions.includes(a["function"])) referencedFunctions.push(a["function"]);
    }
    if (a["script"]) node.script = a["script"];
    if (a["scriptRef"]) node.scriptRef = a["scriptRef"];
    if (a["count"] || a["loopCount"]) node.loopCount = Number(a["count"] ?? a["loopCount"]);
    if (a["successThreshold"]) node.parallelSuccessThreshold = Number(a["successThreshold"]);
    if (a["failureThreshold"]) node.parallelFailureThreshold = Number(a["failureThreshold"]);
    if (a["btTemplateId"]) node.paramStates = node.paramStates;
    if (a["btInstanceId"]) node.subtreeRef = a["btInstanceId"];
    if (a["paramStates"]) node.paramStates = a["paramStates"];
    if (a["status"]) node.endStatusSuccess = a["status"].toUpperCase() === "SUCCESS";
    if (a["externalTree"]) node.endExternalTree = a["externalTree"].toLowerCase() === "true";
    if (a["inputCapture"] === "onEnter") node.captureInputOnEnter = true;
    if (a["comparetype"]) node.compareType = a["comparetype"];
    // 组件选择器
    if (a["mdataName"] || a["className"] || a["typeName"] || a["componentId"] || a["componentName"]) {
      node.targetSelector = {
        modelName: a["mdataName"],
        modelClass: a["className"],
        modelType: a["typeName"],
        componentId: a["componentId"],
        componentName: a["componentName"],
      };
    }

    // 子内容
    const inner = (entry[el] as POEntry[]) ?? [];
    for (const c of inner) {
      const ctag = tagOf(c);
      if (ctag === "Inputs") {
        for (const ie of (c["Inputs"] as POEntry[]) ?? []) {
          const ia = normalizeAttrs(attrs(ie));
          node.inputBindings.push({
            name: ia["name"] ?? "",
            type: ia["type"] ?? "",
            source: (ia["source"] ?? "").toLowerCase() === "blackboard" ? "blackboard" : "constant",
            value: ia["value"],
            blackboardId: ia["blackboardKey"],
            variableId: ia["variableKey"],
          });
        }
      } else if (ctag === "Outputs") {
        for (const oe of (c["Outputs"] as POEntry[]) ?? []) {
          const oa = normalizeAttrs(attrs(oe));
          node.outputBindings.push({
            name: oa["name"] ?? "",
            blackboardId: oa["blackboardKey"] ?? "",
            variableId: oa["variableKey"] ?? "",
          });
        }
      } else if (ctag === "Output") {
        // 比较 Output(顶层子元素)
        const oa = normalizeAttrs(attrs(c));
        node.compareOutputName = oa["name"];
        node.compareOp = oa["op"];
        node.compareValue = oa["value"];
      } else if (!META_ELEMENTS.has(ctag)) {
        const childNode = buildNode(c);
        tree.nodes[childNode.nodeId] = childNode;
        node.childOrder.push(childNode.nodeId);
      }
    }
    return node;
  };

  for (const be of behaviorEntries) {
    const node = buildNode(be);
    tree.nodes[node.nodeId] = node;
    tree.nodes[editorRootId]!.childOrder.push(node.nodeId);
  }

  // 依据 childOrder 重建结构边(运行 XML 没有显式 edgeId,但画布渲染从 tree.edges 读)。
  // 注意:转移节点(FSM)虽是源 State 的结构子,这里同样建边没问题——
  // 状态机的 Goto 虚线另由 transitionTarget 引用渲染,与此并不冲突。
  for (const parent of Object.values(tree.nodes)) {
    parent.childOrder.forEach((childId, order) => {
      if (!tree.nodes[childId]) return;
      const edge = createEdge(parent.nodeId, childId, order);
      tree.edges[edge.edgeId] = edge;
    });
  }

  return {
    tree,
    localBlackboard: localBb,
    globalBlackboards: globalBbs,
    restrictedTypes,
    referencedFunctions,
  };
}

function normalizeAttrs(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.startsWith("@_") ? k.slice(2) : k] = String(v);
  }
  return out;
}
