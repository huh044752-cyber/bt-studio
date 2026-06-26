/**
 * BehaviorTreeDef -> *.bt.xml(文档 §7 / §8;严格对齐 BTXmlLoader 期望语法)。
 *
 * 语法基线(实测自 bt_xml_loader.cpp 与样例 .bt):
 *  - 头:<?xml version='1.0' encoding='utf-8'?>
 *  - 根:<Root id projectType="行为树" name btTemplateId modelId [cognition]>
 *  - <Blackboards><Blackboard linked scope name id><Variable key id type value/></...>
 *  - <ReferencedBehaviorTrees/>
 *  - 节点元素名取 xmlType(Loop->DecoratorLoop / Subtree->SubTree 等)
 *  - Action/Condition:function | script | scriptRef;组件 mdataName/className/typeName/componentId/componentName
 *  - DecoratorLoop/SuccessUntil/FailureUntil:count;Parallel:successThreshold/failureThreshold
 *  - SubTree:btTemplateId/btInstanceId/paramStates;End:status/externalTree;captureInputOnEnter->inputCapture="onEnter"
 *  - <Inputs><Input name type value source="blackboard" blackboardKey variableKey/></Inputs>
 *  - <Outputs><Output name blackboardKey variableKey/></Outputs>
 *  - Condition 比较:comparetype="Output" + 子 <Output name op value/>
 */
import type { BehaviorTreeDef, BTNodeDef, BlackboardDef } from "../types/runtime.js";

const XML_HEADER = "<?xml version='1.0' encoding='utf-8'?>";
const INDENT = "  ";

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attr(name: string, value: string | number | boolean | undefined): string {
  if (value === undefined || value === "" || value === false) return "";
  return ` ${name}="${xmlEscape(String(value))}"`;
}

function pad(level: number): string {
  return INDENT.repeat(level);
}

const FUNCTION_ELEMENTS = new Set(["Action", "Condition", "ConditionTransform"]);

function serializeNode(node: BTNodeDef, level: number): string {
  const el = node.xmlType || node.kind;
  const lines: string[] = [];
  let open = `${pad(level)}<${el}${attr("id", node.id)}${attr("name", node.name)}`;

  // 函数/脚本与组件选择器
  if (FUNCTION_ELEMENTS.has(el)) {
    open += attr("function", node.functionName);
    open += attr("script", node.script);
    open += attr("scriptRef", node.scriptRef);
    const t = node.target;
    open += attr("mdataName", t.modelName);
    open += attr("className", t.modelClass || t.componentClass);
    open += attr("typeName", t.modelType || t.componentType);
    open += attr("componentId", t.componentId);
    open += attr("componentName", t.componentName);
  }

  // 装饰器次数
  if (el === "DecoratorLoop" || el === "DecoratorSuccessUntil" || el === "DecoratorFailureUntil") {
    open += attr("count", node.loopCount);
  }

  // 并行阈值
  if (el === "Parallel") {
    open += attr("successThreshold", node.parallelSuccessThreshold);
    open += attr("failureThreshold", node.parallelFailureThreshold);
  }

  // 子树
  if (el === "SubTree") {
    open += attr("btTemplateId", node.behaviorTreeTemplateId);
    open += attr("btInstanceId", node.behaviorTreeInstanceId);
    open += attr("paramStates", node.paramStates);
  }

  // End
  if (el === "End") {
    open += attr("status", node.endStatusSuccess ? "SUCCESS" : "Failure");
    open += attr("externalTree", node.endExternalTree ? "true" : "");
  }

  // 输入捕获
  if (node.captureInputOnEnter) open += attr("inputCapture", "onEnter");

  // 比较模式
  const isOutputCompare = el === "Condition" && node.compareType === "Output";
  if (isOutputCompare) open += attr("comparetype", "Output");

  // 子内容
  const inner: string[] = [];
  if (node.inputs.length) {
    inner.push(`${pad(level + 1)}<Inputs>`);
    for (const inp of node.inputs) {
      let line = `${pad(level + 2)}<Input${attr("name", inp.name)}${attr("type", inp.type)}`;
      if (inp.source === "Blackboard") {
        line += ` source="blackboard"${attr("blackboardKey", inp.blackboardId)}${attr("variableKey", inp.variableId)}`;
      } else {
        line += attr("value", inp.value);
      }
      line += " />";
      inner.push(line);
    }
    inner.push(`${pad(level + 1)}</Inputs>`);
  }
  if (node.outputs.length) {
    inner.push(`${pad(level + 1)}<Outputs>`);
    for (const out of node.outputs) {
      inner.push(
        `${pad(level + 2)}<Output${attr("name", out.name)}${attr("blackboardKey", out.blackboardId)}${attr("variableKey", out.variableId)} />`,
      );
    }
    inner.push(`${pad(level + 1)}</Outputs>`);
  }
  if (isOutputCompare) {
    inner.push(
      `${pad(level + 1)}<Output${attr("name", node.compareOutputName)}${attr("op", node.compareOp)}${attr("value", node.compareValue)} />`,
    );
  }
  for (const child of node.children) {
    inner.push(serializeNode(child, level + 1));
  }

  if (inner.length === 0) {
    lines.push(`${open} />`);
  } else {
    lines.push(`${open}>`);
    lines.push(...inner);
    lines.push(`${pad(level)}</${el}>`);
  }
  return lines.join("\n");
}

function serializeBlackboards(blackboards: BlackboardDef[], level: number): string {
  if (blackboards.length === 0) return `${pad(level)}<Blackboards />`;
  const lines: string[] = [`${pad(level)}<Blackboards>`];
  for (const bb of blackboards) {
    const scope = bb.scope === "Global" ? "global" : "local";
    const head = `${pad(level + 1)}<Blackboard${attr("linked", bb.linked ? "true" : "")}${attr("scope", scope)}${attr("name", bb.name)}${attr("id", bb.id)}`;
    const vars = Object.values(bb.variables);
    if (vars.length === 0) {
      lines.push(`${head} />`);
      continue;
    }
    lines.push(`${head}>`);
    for (const v of vars) {
      lines.push(
        `${pad(level + 2)}<Variable${attr("key", v.key)}${attr("id", v.id)}${attr("type", v.type)}${attr("value", v.value)} />`,
      );
    }
    lines.push(`${pad(level + 1)}</Blackboard>`);
  }
  lines.push(`${pad(level)}</Blackboards>`);
  return lines.join("\n");
}

export function serializeBehaviorTreeXml(def: BehaviorTreeDef): string {
  if (!def.root) throw new Error("BehaviorTreeDef.root 为空,无法序列化");
  const lines: string[] = [XML_HEADER];
  let rootOpen = `<Root${attr("id", def.id)}${attr("projectType", def.projectType)}${attr("name", def.name)}${attr("btTemplateId", def.behaviorTreeTemplateId)}${attr("modelId", def.modelId)}${attr("cognition", def.cognition)}>`;
  lines.push(rootOpen);
  lines.push(serializeBlackboards(def.blackboards, 1));

  const refIds = Object.keys(def.referencedBehaviorTreesById);
  if (refIds.length === 0) {
    lines.push(`${pad(1)}<ReferencedBehaviorTrees />`);
  } else {
    lines.push(`${pad(1)}<ReferencedBehaviorTrees>`);
    for (const instId of refIds) {
      lines.push(
        `${pad(2)}<ReferencedBehaviorTree${attr("id", instId)}${attr("ref", def.referencedBehaviorTreesById[instId])} />`,
      );
    }
    lines.push(`${pad(1)}</ReferencedBehaviorTrees>`);
  }

  lines.push(serializeNode(def.root, 1));
  lines.push("</Root>");
  return lines.join("\n") + "\n";
}
