/**
 * 解析真实 FOSim 模型 .cmp 文件 -> 类 + 方法(函数)目录。
 *
 * 三种 .cmp 形态(均已勘察):
 *  A) 新版认知/RuleDecision:<Prototype Name="Engage"><Inputs><param name="TARGET_ID" type="CyberIntegerType" desc=".."/></Inputs></Prototype>
 *  B) 新版装备/Equipment:<Prototype Name="JamTarget" FunctionCategory="Action"><Inputs><views>
 *        <param text=".." data_name="DURATION_TIME" type="DoubleSpinBox" default_value="0" select="Unit"/></views></Inputs></Prototype>
 *  C) 老版(F:\0411\ccc\FZFOSimModel,Cyber* 引擎):
 *     <Prototype Name="Fire" Type="Process Method"><IntendedCmd Value="FIRE"/><Description Value="开火"/>
 *       <Inputs>
 *         <Input Name="time"><Optional Value="true"/><Description Value=""/><DataType Value="Julian"/></Input>
 *         <Input Name="min_range"><DataType Value="Real"/></Input>
 *       </Inputs>
 *       <Commands><Command><Outputs><Output Name="status"><DataType Value="Integer"/></Output></Outputs></Command></Commands>
 *     </Prototype>
 *   (多数老版 Cognition .cmp 的 Inputs/Outputs 为空 —— 仍需登记为无参函数。)
 *
 * 输出 className/category/方法/参数(Cyber→displayType/malType),供节点 类→方法→组件 绑定与校验。
 */
import { XMLParser } from "fast-xml-parser";
import type { ClassDescriptor, FunctionDescriptor, FunctionParam } from "../types/catalog.js";
import { categoryToBaseClass } from "../types/catalog.js";
import type { DisplayType, CyberMARGType } from "../types/mal.js";
import { newFunctionId, prefixedId } from "../model/ids.js";

function arr<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Cyber 运行类型串 -> (displayType, malType)。 */
function cyberToTypes(cyber: string): { displayType: DisplayType; malType: CyberMARGType } {
  switch (cyber) {
    case "CyberIntegerType": return { displayType: "int", malType: "CYBER_MARGTYPE_INTEGER" };
    case "CyberRealType": return { displayType: "float", malType: "CYBER_MARGTYPE_REAL" };
    case "CyberBOOL": return { displayType: "bool", malType: "CYBER_MARGTYPE_BOOL" };
    case "CyberStringType": return { displayType: "string", malType: "CYBER_MARGTYPE_STRING" };
    case "CyberNameType": return { displayType: "name", malType: "CYBER_MARGTYPE_NAME" };
    case "CyberVectorType": return { displayType: "vector", malType: "CYBER_MARGTYPE_VECTOR" };
    case "CyberPositionType": return { displayType: "position", malType: "CYBER_MARGTYPE_POSITION" };
    case "CyberCoordinateType": return { displayType: "coordinate", malType: "CYBER_MARGTYPE_COORDINATE" };
    case "CyberOrientationType": return { displayType: "orientation", malType: "CYBER_MARGTYPE_ORIENTATION" };
    case "CyberJulianType": return { displayType: "julian", malType: "CYBER_MARGTYPE_JULIAN" };
    default: return { displayType: "string", malType: "CYBER_MARGTYPE_STRING" };
  }
}

/** 装备 UI 控件类型 -> Cyber 运行类型串。 */
function widgetToCyber(widget: string): string {
  switch (widget) {
    case "DoubleSpinBox": return "CyberRealType";
    case "SpinBox": return "CyberIntegerType";
    case "CheckBox": return "CyberBOOL";
    case "LineEditor": return "CyberStringType";
    case "Coordinate": return "CyberCoordinateType";
    case "ComboBox": return "CyberIntegerType";
    default: return "CyberStringType";
  }
}

/** 老引擎短类型(Integer/Real/Boolean/Julian/Name/Coordinate) -> Cyber 运行类型串。 */
function oldEngineToCyber(t: string): string {
  switch (t) {
    case "Integer": return "CyberIntegerType";
    case "Real": return "CyberRealType";
    case "Boolean": case "Bool": return "CyberBOOL";
    case "Julian": return "CyberJulianType";
    case "Name": return "CyberNameType";
    case "String": return "CyberStringType";
    case "Coordinate": return "CyberCoordinateType";
    case "Position": return "CyberPositionType";
    case "Vector": return "CyberVectorType";
    case "Orientation": return "CyberOrientationType";
    case "CyberInteger": case "CyberIntegerType": return "CyberIntegerType";
    case "CyberReal": case "CyberRealType": return "CyberRealType";
    case "CyberBoolean": case "CyberBOOL": return "CyberBOOL";
    case "CyberName": case "CyberNameType": return "CyberNameType";
    case "CyberCoordinate": case "CyberCoordinateType": return "CyberCoordinateType";
    default: return "";
  }
}

interface RawParam {
  "@_name"?: string;
  "@_data_name"?: string;
  "@_type"?: string;
  "@_desc"?: string;
  "@_note"?: string;
  "@_text"?: string;
  "@_default_value"?: string;
  "@_select"?: string;
  "@_require"?: string;
}

function toParam(raw: RawParam): FunctionParam {
  const name = String(raw["@_name"] ?? raw["@_data_name"] ?? "");
  const widgetOrCyber = String(raw["@_type"] ?? "");
  // 形态 A 的 type 已是 Cyber*;形态 B 的 type 是控件名
  const cyber = widgetOrCyber.startsWith("Cyber") ? widgetOrCyber : widgetToCyber(widgetOrCyber);
  const { displayType, malType } = cyberToTypes(cyber);
  const displayName = raw["@_text"] ? String(raw["@_text"]) : undefined;
  const description = raw["@_desc"] ?? raw["@_note"];
  return {
    paramId: prefixedId("param"),
    name,
    displayName,
    description: description ? String(description) : undefined,
    direction: "input",
    displayType,
    malType,
    valueFormat: "literal",
    required: raw["@_require"] !== "false",
    defaultValue: raw["@_default_value"] ? String(raw["@_default_value"]) : undefined,
    originalType: cyber,
  };
}

/** 老版 .cmp 嵌套元素形态(<Input Name="x"><DataType Value="Integer"/></Input>)解析成 FunctionParam。 */
function oldNestedToParam(
  ioNode: Record<string, unknown>,
  direction: "input" | "output",
): FunctionParam | null {
  const name = String(ioNode["@_Name"] ?? ioNode["@_name"] ?? "");
  if (!name) return null;
  const dt = ioNode["DataType"] as Record<string, unknown> | undefined;
  const rawType = dt ? String(dt["@_Value"] ?? "") : "";
  const cyber = oldEngineToCyber(rawType) || "CyberStringType";
  const { displayType, malType } = cyberToTypes(cyber);
  const optionalNode = ioNode["Optional"] as Record<string, unknown> | undefined;
  const optional = optionalNode && String(optionalNode["@_Value"] ?? "false") === "true";
  const descNode = ioNode["Description"] as Record<string, unknown> | undefined;
  const desc = descNode ? String(descNode["@_Value"] ?? "") : "";
  return {
    paramId: prefixedId("param"),
    name,
    description: desc || undefined,
    direction,
    displayType,
    malType,
    valueFormat: "literal",
    required: !optional,
    originalType: rawType || cyber,
  };
}

export interface CmpParseResult {
  class: ClassDescriptor;
  functions: FunctionDescriptor[];
}

/**
 * 解析单个 .cmp。className/category 优先取 Prototypes 的属性(新版),
 * 否则由调用方通过 fallbackClassName 补全(老版 .cmp 仅是 <Prototypes><Prototype/>...</Prototypes>,
 * 真正的类元数据在同目录的 .mui 里)。
 */
export function parseCmp(xml: string, fallbackClassName?: string): CmpParseResult | null {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const root = parser.parse(xml) as { Prototypes?: Record<string, unknown> };
  const protos = root.Prototypes;
  if (!protos) return null;

  const className = String(protos["@_class"] ?? fallbackClassName ?? "");
  if (!className) return null;
  const classId = prefixedId("class");
  // 新版属性形态:@_type;老版无;若无则按 RuleDecision(认知)缺省。
  const category0 = String(protos["@_type"] ?? "RuleDecision");
  const clsDesc = protos["@_remarks"] ?? protos["@_Desc"];
  const cls: ClassDescriptor = {
    classId,
    className,
    displayName: String(protos["@_text"] ?? className),
    category: category0,
    hostModule: category0,
    description: clsDesc ? String(clsDesc) : undefined,
    source: "model",
    baseClass: categoryToBaseClass(category0),
  };

  const functions: FunctionDescriptor[] = [];
  for (const p of arr<Record<string, unknown>>(protos["Prototype"] as never)) {
    const name = String(p["@_Name"] ?? "");
    if (!name) continue;
    // FunctionCategory(新版属性) 或 Type(老版属性,"Process Method" 全部按 action 登记)
    const newCat = String(p["@_FunctionCategory"] ?? "").toLowerCase();
    const oldType = String(p["@_Type"] ?? "");
    let category: FunctionDescriptor["category"] = newCat === "condition" ? "condition" : "action";
    // 老版按命名约定推断 Condition(*_congition/Judge_*/Is_* 等结尾/前缀)。
    if (!newCat && oldType === "Process Method") {
      if (/(_congition|_condition|^Is_|^Judge_|^Check_)/i.test(name)) category = "condition";
    }

    // ---- 参数 / 输出解析 ----
    const inputsNode = (p["Inputs"] as Record<string, unknown>) ?? {};
    // 形态 A:<param .../>;形态 B:<views><param .../></views>;形态 C(老):<Input Name=".."><DataType Value=".."/></Input>
    let rawParams: RawParam[] = arr<RawParam>(inputsNode["param"] as never);
    if (rawParams.length === 0 && inputsNode["views"]) {
      const views = inputsNode["views"] as Record<string, unknown>;
      rawParams = arr<RawParam>(views["param"] as never);
    }
    const params: FunctionParam[] = rawParams.map(toParam);
    // 老版嵌套 Input
    for (const inp of arr<Record<string, unknown>>(inputsNode["Input"] as never)) {
      const fp = oldNestedToParam(inp, "input");
      if (fp) params.push(fp);
    }

    // 老版 Outputs 在 Commands/Command/Outputs
    const cmds = arr<Record<string, unknown>>(p["Commands"] as never)
      .flatMap((cs) => arr<Record<string, unknown>>(cs["Command"] as never));
    for (const cmdNode of cmds) {
      const outsNode = (cmdNode["Outputs"] as Record<string, unknown>) ?? {};
      for (const o of arr<Record<string, unknown>>(outsNode["Output"] as never)) {
        const fp = oldNestedToParam(o, "output");
        if (fp) params.push(fp);
      }
    }

    // IntendedCmd:新版是属性 @_IntendedCmd;老版是子元素 <IntendedCmd Value="FIRE"/>
    const intendedNode = p["IntendedCmd"] as Record<string, unknown> | undefined;
    const cmd = String(
      p["@_IntendedCmd"] ?? intendedNode?.["@_Value"] ?? name.toUpperCase(),
    );
    // 老版子元素形态的 Description / Delay 等
    const desc = String(
      p["@_Desc"] ??
        (p["Description"] as Record<string, unknown> | undefined)?.["@_Value"] ??
        "",
    );
    const readNum = (key: string): number | undefined => {
      const attr = p[`@_${key}`];
      if (attr !== undefined) return Number(attr);
      const el = p[key] as Record<string, unknown> | undefined;
      if (el && el["@_Value"] !== undefined) return Number(el["@_Value"]);
      return undefined;
    };

    functions.push({
      functionId: newFunctionId(),
      name,
      displayName: String(p["@_ChName"] ?? name),
      category,
      bindingTarget: `${className}.${name}`,
      ownerClass: className,
      // FOSim 模型决策/条件函数运行时统一返回 CyberDFMPFRC(见 *.h / *_register.cpp)
      returnType: "CyberDFMPFRC", // 固定:类方法返回值只能是 CyberDFMPFRC
      description: desc,
      params,
      version: cmd,
      intendedCmd: cmd,
      delay: readNum("Delay"),
      delayDelta: readNum("DelayDelta"),
      repeat: readNum("Repeat"),
      repeatDelta: readNum("RepeatDelta"),
    });
  }

  return { class: cls, functions };
}

/** 批量解析多个 .cmp 内容。 */
export function parseCmpFiles(contents: string[]): { classes: ClassDescriptor[]; functions: FunctionDescriptor[] } {
  const classes: ClassDescriptor[] = [];
  const functions: FunctionDescriptor[] = [];
  for (const c of contents) {
    const r = parseCmp(c);
    if (!r) continue;
    if (!classes.find((x) => x.className === r.class.className)) classes.push(r.class);
    functions.push(...r.functions);
  }
  return { classes, functions };
}

/**
 * 解析老版 .mui:`<views class="X" model_type="common" remarks="备注" type="proprety_view">`。
 * - class:类名
 * - model_type:模型分类(common 表示通用认知 → 仍按 RuleDecision 处理)
 * - remarks:中文备注/displayName
 * 装备 .mui 的 <param data_name=".." type="DoubleSpinBox" .../> 当前作为类的"成员属性"采集(用于未来挂载),
 * 老引擎决策方法不读 .mui 的 param,函数签名以 .cmp 为准。
 */
export function parseMuiFile(xml: string, fallbackClassName?: string): {
  cls: ClassDescriptor;
  params: { name: string; widget: string; defaultValue?: string; displayName?: string }[];
} | null {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const root = parser.parse(xml) as { views?: Record<string, unknown> };
  const v = root.views;
  if (!v) return null;
  const className = String(v["@_class"] ?? fallbackClassName ?? "");
  if (!className) return null;
  const modelType = String(v["@_model_type"] ?? "common");
  const remarks = String(v["@_remarks"] ?? "");
  // 类分类:老版 .mui 的 model_type 多为 "common"(认知)/ "Equipment" / "Cognition" 等。
  // 兜底统一映射为 RuleDecision(老引擎决策函数挂 Cyber 认知)。
  const category =
    modelType.toLowerCase().includes("equipment") ? "Equipment"
    : modelType.toLowerCase().includes("platform") ? "Platforms"
    : "RuleDecision";
  const cls: ClassDescriptor = {
    classId: prefixedId("class"),
    className,
    displayName: remarks && remarks !== "null" ? remarks : className,
    category,
    hostModule: category,
    description: remarks && remarks !== "null" ? remarks : undefined,
    source: "model",
    baseClass: categoryToBaseClass(category),
  };
  const params: { name: string; widget: string; defaultValue?: string; displayName?: string }[] = [];
  for (const p of arr<Record<string, unknown>>(v["param"] as never)) {
    const dn = String(p["@_data_name"] ?? "");
    if (!dn) continue;
    params.push({
      name: dn,
      widget: String(p["@_type"] ?? "LineEditor"),
      defaultValue: p["@_default_value"] !== undefined ? String(p["@_default_value"]) : undefined,
      displayName: p["@_text"] ? String(p["@_text"]) : undefined,
    });
  }
  return { cls, params };
}

/**
 * 配对解析:同一目录下同名 baseName 的 .cmp + .mui。
 * - 若 .mui 在 → 用 .mui 的 class/displayName/category 为准
 * - .cmp 提供方法签名
 * - 老版 Cognition 多数 .mui 是 `<views class="X" model_type="common" remarks=""/>`,.cmp 函数 Inputs 多空
 */
export function parseCmpMuiPair(
  cmpXml: string | null,
  muiXml: string | null,
  baseName: string,
): CmpParseResult | null {
  let cls: ClassDescriptor | null = null;
  if (muiXml) {
    const m = parseMuiFile(muiXml, baseName);
    if (m) cls = m.cls;
  }
  if (cmpXml) {
    const r = parseCmp(cmpXml, cls?.className ?? baseName);
    if (!r) return null;
    if (cls) {
      // 用 .mui 的元数据覆盖 .cmp 缺省值,保留 .cmp 提供的函数列表。
      return {
        class: { ...r.class, ...cls, classId: r.class.classId },
        functions: r.functions,
      };
    }
    return r;
  }
  // 仅有 .mui:登记空函数类
  if (cls) return { class: cls, functions: [] };
  return null;
}

/**
 * 批量配对解析:输入一组 { baseName, cmp?, mui? },返回汇总类/函数。
 * 用于扫描老模型目录后逐对处理。
 */
export function parseCmpMuiPairs(
  pairs: { baseName: string; cmp?: string; mui?: string }[],
): { classes: ClassDescriptor[]; functions: FunctionDescriptor[] } {
  const classes: ClassDescriptor[] = [];
  const functions: FunctionDescriptor[] = [];
  for (const pair of pairs) {
    const r = parseCmpMuiPair(pair.cmp ?? null, pair.mui ?? null, pair.baseName);
    if (!r) continue;
    if (!classes.find((x) => x.className === r.class.className)) classes.push(r.class);
    functions.push(...r.functions);
  }
  return { classes, functions };
}
