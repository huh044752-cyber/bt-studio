/**
 * BehaviorTreeDef -> *.bt.xml(文档 §7 / §8;严格对齐 BTXmlLoader 期望语法)。
 *
 * 语法基线(实测自 bt_xml_loader.cpp 与样例 .bt):
 *  - 头:<?xml version='1.0' encoding='utf-8'?>
 *  - 根:<Root id projectType="行为树" name btTemplateId modelId>
 *  - <Blackboards><Blackboard linked scope name id><Variable key id type value/></...>
 *  - <ReferencedBehaviorTrees/>
 *  - 节点元素名取 xmlType(Loop->DecoratorLoop / Subtree->SubTree 等)
 *  - Action/Condition:function | script | scriptRef;类归属仅 className(componentId 由挂接流程写到 sdata,不在此层)
 *  - DecoratorLoop/SuccessUntil/FailureUntil:count;Parallel:successThreshold/failureThreshold
 *  - SubTree:btTemplateId/btInstanceId/paramStates;End:status/externalTree;captureInputOnEnter->inputCapture="onEnter"
 *  - <Inputs><Input name type value source="blackboard" blackboardKey variableKey/></Inputs>
 *  - <Outputs><Output name blackboardKey variableKey/></Outputs>
 *  - Condition 比较:comparetype="Output" + 子 <Output name op value/>
 */
import type { BehaviorTreeDef, BTNodeDef, BlackboardDef } from "../types/runtime.js";
import { cyberTypeToOldEngine } from "../types/mal.js";
import type { CyberMARGType } from "../types/mal.js";

/**
 * 老引擎类型转换:把节点 Input/Output 上的 type 字段(可能是 CYBER_MARGTYPE_* 或已是短字符串)
 * 折算成老引擎 bt_runtime.cpp 期望的 Boolean/Integer/Real/Julian/String/Coordinate。
 * 已是短字符串就原样返回;空串返回空(由 attr() 自动忽略)。
 */
function toOldType(t: string | undefined): string {
  if (!t) return "";
  if (t.startsWith("CYBER_MARGTYPE_") || t === "CYBER_USER_DEFINED") {
    return cyberTypeToOldEngine(t as CyberMARGType);
  }
  // 老引擎短串身份直通 + Cyber*Type 长串(malToXmlType 产出)也折算短串
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

/**
 * 统一的 type-mapping 入口:节点 <Input type> / 黑板 <Variable type> / workspace <Variable type> 三处
 * 全部经它出 XML。master 分支上此函数体是恒等映射(输出 CyberIntegerType 长串);
 * old-engine-compat 上代理到 toOldType(输出 Integer/Real 短串)。
 * 两分支只在此函数体上分岔,便于跨分支同步。
 */
export function mapVariableType(t: string | undefined): string {
  return toOldType(t);
}

/** workspaceXml 用的 <Variable type> fallback 默认串(master 上是 "CyberStringType",老分支上是 "String")。 */
export const DEFAULT_VARIABLE_TYPE = "String";

/**
 * 黑板变量默认值兜底(对齐老引擎 .bt Variable 必带 value 属性)。
 * 空/undefined 时按类型返回一个"零值":Integer/Julian → "0", Real → "0.000000",
 * Boolean → "false", Coordinate → "0.000000,0.000000", 其他/String → ""。
 * 老引擎 loader 读到 value="" 也是合法的(String 空串),但缺失 value 属性会解析失败。
 */
export function defaultValueForType(shortType: string): string {
  switch (shortType) {
    case "Integer":
    case "Julian":
      return "0";
    case "Real":
      return "0.000000";
    case "Boolean":
      return "false";
    case "Coordinate":
      return "0.000000,0.000000";
    case "String":
    default:
      return "";
  }
}
export function resolveVarValue(raw: string | undefined, shortType: string): string {
  return raw === undefined || raw === "" ? defaultValueForType(shortType) : raw;
}

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

/**
 * 绑定 scope 解析:根据 blackboardId 在 def.blackboards 里查所属 <Blackboard scope>。
 * - 命中 Global → "global"(老引擎 loader:resolve 到 scenario 层 GlobalBlackboards store)
 * - 命中 Local / 未命中 → "local"(老引擎 loader:resolve 到 BT 局部 store)
 * 对齐 F:\0411\ccc\FOSimEngine\src\modules\extern\bt_xml_loader.cpp 三态 source
 * (backport 自新引擎 c4095297)。
 */
function scopeSourceOf(blackboardId: string, scopeByBoardId: Map<string, string>): "local" | "global" {
  return scopeByBoardId.get(blackboardId) === "Global" ? "global" : "local";
}

function serializeNode(node: BTNodeDef, level: number, scopeByBoardId: Map<string, string>): string {
  const el = node.xmlType || node.kind;
  const lines: string[] = [];
  let open = `${pad(level)}<${el}${attr("id", node.id)}${attr("name", node.name)}`;

  // 函数/脚本:工作空间/模板层只写 function + className(自由类型空间的类归属)。
  // componentId 是运行时挂接产物(指向 sdata unit 里对应 ModelData 的 data_id UUID),
  // 由场景挂接流程写到 sdata BehaviorTreeInstance 里,不属于工作空间 .bt 模板层 —— 这里一律不输出。
  // mdataName 同理是运行时字段,模板层不写。
  if (FUNCTION_ELEMENTS.has(el)) {
    open += attr("function", node.functionName);
    if (node.target.modelClass) open += attr("className", node.target.modelClass);
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
      let line = `${pad(level + 2)}<Input${attr("name", inp.name)}${attr("type", mapVariableType(inp.type))}`;
      if (inp.source === "Blackboard") {
        // 三态 source(老引擎 backport 后 loader 接受 blackboard/local/global):按黑板 scope 决定。
        const src = scopeSourceOf(inp.blackboardId, scopeByBoardId);
        line += ` source="${src}"${attr("blackboardKey", inp.blackboardId)}${attr("variableKey", inp.variableId)}`;
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
      const src = scopeSourceOf(out.blackboardId, scopeByBoardId);
      inner.push(
        `${pad(level + 2)}<Output${attr("name", out.name)} source="${src}"${attr("blackboardKey", out.blackboardId)}${attr("variableKey", out.variableId)} />`,
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
    inner.push(serializeNode(child, level + 1, scopeByBoardId));
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

/**
 * BT <Root> 内 <Blackboards> 只放 Local scope。
 * Global scope 归 scenario 层 ModelDatabase/global_black_boards.xml,
 * 老引擎 BTXmlLoader::SetGlobalBlackboards(...) 接收注入。
 */
function serializeBlackboards(blackboards: BlackboardDef[], level: number): string {
  const locals = blackboards.filter((bb) => bb.scope !== "Global");
  if (locals.length === 0) return `${pad(level)}<Blackboards />`;
  const lines: string[] = [`${pad(level)}<Blackboards>`];
  for (const bb of locals) {
    const head = `${pad(level + 1)}<Blackboard${attr("linked", bb.linked ? "true" : "")} scope="local"${attr("name", bb.name)}${attr("id", bb.id)}`;
    const vars = Object.values(bb.variables);
    if (vars.length === 0) {
      lines.push(`${head} />`);
      continue;
    }
    lines.push(`${head}>`);
    for (const v of vars) {
      const short = mapVariableType(v.type);
      lines.push(
        `${pad(level + 2)}<Variable${attr("key", v.key)}${attr("id", v.id)}${attr("type", short)} value="${xmlEscape(resolveVarValue(v.value, short))}" />`,
      );
    }
    lines.push(`${pad(level + 1)}</Blackboard>`);
  }
  lines.push(`${pad(level)}</Blackboards>`);
  return lines.join("\n");
}

/**
 * scenario 层全局黑板独立 XML(ModelDatabase/global_black_boards.xml)。
 * 老引擎 backport(BT::LoadBlackboardsFromXmlContent + SetGlobalBlackboards)后读取此文件。
 */
export function serializeGlobalBlackboardsXml(blackboards: BlackboardDef[]): string {
  const globals = blackboards.filter((bb) => bb.scope === "Global");
  const lines: string[] = [XML_HEADER, "<Blackboards>"];
  for (const bb of globals) {
    const head = `  <Blackboard${attr("name", bb.name)}${attr("id", bb.id)}`;
    const vars = Object.values(bb.variables);
    if (vars.length === 0) {
      lines.push(`${head} />`);
      continue;
    }
    lines.push(`${head}>`);
    for (const v of vars) {
      const short = mapVariableType(v.type);
      lines.push(
        `    <Variable${attr("key", v.key)}${attr("id", v.id)}${attr("type", short)} value="${xmlEscape(resolveVarValue(v.value, short))}" />`,
      );
    }
    lines.push("  </Blackboard>");
  }
  lines.push("</Blackboards>");
  return lines.join("\n") + "\n";
}

export function serializeBehaviorTreeXml(def: BehaviorTreeDef): string {
  if (!def.root) throw new Error("BehaviorTreeDef.root 为空,无法序列化");
  const lines: string[] = [XML_HEADER];
  // <Root> 属性:id / projectType / name / btTemplateId / modelId / cognition。
  // 类型信息落在每个叶子的 className 上,由挂接闸门校验;Root 层的 cognition 属性用于
  // 引擎 BehaviorNodeAgent 调 EmployCog(cognition_name):
  //   bt_xml_loader.cpp:236 从 <Root cognition="X"> 读入 tree_def_->cognition,
  //   behavior_node_agent.cpp:108 赋给 agent->cognition_name。
  // 缺此属性时 EmployCog 拿不到类名,想定挂载时找不到 Cognition 组件。
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

  // 构建 blackboardId → scope 索引,让 <Input>/<Output> 按绑定黑板 scope 输出 local/global。
  const scopeByBoardId = new Map<string, string>();
  for (const bb of def.blackboards) scopeByBoardId.set(bb.id, bb.scope);
  lines.push(serializeNode(def.root, 1, scopeByBoardId));
  lines.push("</Root>");
  return lines.join("\n") + "\n";
}
