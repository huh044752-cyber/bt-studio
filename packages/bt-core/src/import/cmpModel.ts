/**
 * 解析真实 FOSim 模型 .cmp 文件 -> 类 + 方法(函数)目录。
 *
 * 两种 .cmp 形态(均已勘察 F:\FOSim\FZFOSimModel\ModelSource):
 *  A) 认知/RuleDecision:<Prototype Name="Engage"><Inputs><param name="TARGET_ID" type="FZIntegerType" desc=".."/></Inputs></Prototype>
 *  B) 装备/Equipment:<Prototype Name="JamTarget" FunctionCategory="Action"><Inputs><views>
 *        <param text=".." data_name="DURATION_TIME" type="DoubleSpinBox" default_value="0" select="Unit"/></views></Inputs></Prototype>
 *
 * 输出 className/category/方法/参数(FZ→displayType/malType),供节点 类→方法→组件 绑定与校验。
 */
import { XMLParser } from "fast-xml-parser";
import type { ClassDescriptor, FunctionDescriptor, FunctionParam } from "../types/catalog.js";
import { categoryToBaseClass } from "../types/catalog.js";
import type { DisplayType, FZMARGType } from "../types/mal.js";
import { newFunctionId, prefixedId } from "../model/ids.js";

function arr<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** FZ 运行类型串 -> (displayType, malType)。 */
function fzToTypes(fz: string): { displayType: DisplayType; malType: FZMARGType } {
  switch (fz) {
    case "FZIntegerType": return { displayType: "int", malType: "FZ_MARGTYPE_INTEGER" };
    case "FZRealType": return { displayType: "float", malType: "FZ_MARGTYPE_REAL" };
    case "FZBOOL": return { displayType: "bool", malType: "FZ_MARGTYPE_BOOL" };
    case "FZStringType": return { displayType: "string", malType: "FZ_MARGTYPE_STRING" };
    case "FZNameType": return { displayType: "name", malType: "FZ_MARGTYPE_NAME" };
    case "FZVectorType": return { displayType: "vector", malType: "FZ_MARGTYPE_VECTOR" };
    case "FZPositionType": return { displayType: "position", malType: "FZ_MARGTYPE_POSITION" };
    case "FZCoordinateType": return { displayType: "coordinate", malType: "FZ_MARGTYPE_COORDINATE" };
    case "FZOrientationType": return { displayType: "orientation", malType: "FZ_MARGTYPE_ORIENTATION" };
    case "FZJulianType": return { displayType: "julian", malType: "FZ_MARGTYPE_JULIAN" };
    default: return { displayType: "string", malType: "FZ_MARGTYPE_STRING" };
  }
}

/** 装备 UI 控件类型 -> FZ 运行类型串。 */
function widgetToFz(widget: string): string {
  switch (widget) {
    case "DoubleSpinBox": return "FZRealType";
    case "SpinBox": return "FZIntegerType";
    case "CheckBox": return "FZBOOL";
    case "LineEditor": return "FZStringType";
    case "Coordinate": return "FZCoordinateType";
    default: return "FZStringType";
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
  const widgetOrFz = String(raw["@_type"] ?? "");
  // 形态 A 的 type 已是 FZ*;形态 B 的 type 是控件名
  const fz = widgetOrFz.startsWith("FZ") ? widgetOrFz : widgetToFz(widgetOrFz);
  const { displayType, malType } = fzToTypes(fz);
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
    originalType: fz,
  };
}

export interface CmpParseResult {
  class: ClassDescriptor;
  functions: FunctionDescriptor[];
}

export function parseCmp(xml: string): CmpParseResult | null {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const root = parser.parse(xml) as { Prototypes?: Record<string, unknown> };
  const protos = root.Prototypes;
  if (!protos) return null;

  const className = String(protos["@_class"] ?? "");
  if (!className) return null;
  const classId = prefixedId("class");
  const category0 = String(protos["@_type"] ?? "model");
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
    const cat = String(p["@_FunctionCategory"] ?? "").toLowerCase();
    const category: FunctionDescriptor["category"] = cat === "condition" ? "condition" : "action";
    // 参数:Inputs.param(A) 或 Inputs.views.param(B)
    const inputs = (p["Inputs"] as Record<string, unknown>) ?? {};
    let rawParams: RawParam[] = arr<RawParam>(inputs["param"] as never);
    if (rawParams.length === 0 && inputs["views"]) {
      const views = inputs["views"] as Record<string, unknown>;
      rawParams = arr<RawParam>(views["param"] as never);
    }
    const cmd = String(p["@_IntendedCmd"] ?? name.toUpperCase());
    functions.push({
      functionId: newFunctionId(),
      name,
      displayName: String(p["@_ChName"] ?? name),
      category,
      bindingTarget: `${className}.${name}`,
      ownerClass: className,
      // FOSim 模型决策/条件函数运行时统一返回 FZDFMPFRC(见 *.h / *_register.cpp)
      returnType: "FZDFMPFRC", // 固定:类方法返回值只能是 FZDFMPFRC
      description: String(p["@_Desc"] ?? ""),
      params: rawParams.map(toParam),
      version: cmd,
      intendedCmd: cmd,
      delay: p["@_Delay"] !== undefined ? Number(p["@_Delay"]) : undefined,
      delayDelta: p["@_DelayDelta"] !== undefined ? Number(p["@_DelayDelta"]) : undefined,
      repeat: p["@_Repeat"] !== undefined ? Number(p["@_Repeat"]) : undefined,
      repeatDelta: p["@_RepeatDelta"] !== undefined ? Number(p["@_RepeatDelta"]) : undefined,
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
