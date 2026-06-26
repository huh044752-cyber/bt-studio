/**
 * behaviac 风格 meta.xml -> 类型目录(CatalogBundle 片段)。
 * 从模型工作空间/已有 meta 解析出类、成员、方法(函数)、枚举、结构体。
 */
import { XMLParser } from "fast-xml-parser";
import type {
  CatalogBundle,
  ClassDescriptor,
  MemberDescriptor,
  FunctionDescriptor,
  FunctionParam,
  EnumDescriptor,
  StructDescriptor,
} from "../types/catalog.js";
import type { DisplayType } from "../types/mal.js";
import { newFunctionId, newEnumId, newStructId, prefixedId } from "../model/ids.js";

function arr<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** behaviac/C++ 类型串 -> 编辑器 displayType(粗映射)。 */
function toDisplayType(t: string): DisplayType {
  const s = (t || "").toLowerCase();
  if (s.includes("bool")) return "bool";
  if (s.includes("float") || s.includes("double") || s.includes("real")) return "float";
  if (s.includes("int") || s.includes("uint") || s.includes("long")) return "int";
  if (s.includes("string")) return "string";
  if (s.includes("coordinate")) return "coordinate";
  if (s.includes("position")) return "position";
  if (s.includes("vector")) return "vector";
  return "string";
}

export function parseMetaXml(xml: string): Partial<CatalogBundle> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const root = parser.parse(xml) as { meta?: Record<string, unknown> };
  return parseMetaObject(root.meta ?? {});
}

/** 从已解析的 <meta> 对象构建目录(供 workspace.xml 复用)。 */
export function parseMetaObject(meta: Record<string, unknown>): Partial<CatalogBundle> {

  const classes: ClassDescriptor[] = [];
  const members: MemberDescriptor[] = [];
  const functions: FunctionDescriptor[] = [];
  const enums: EnumDescriptor[] = [];
  const structs: StructDescriptor[] = [];

  // types
  const typesNode = (meta["types"] as Record<string, unknown>) ?? {};
  for (const e of arr<Record<string, unknown>>(typesNode["enumtype"] as never)) {
    const name = String(e["@_Type"] ?? e["@_DisplayName"] ?? "Enum");
    enums.push({
      enumId: newEnumId(),
      name,
      displayType: "enum",
      malType: "FZ_MARGTYPE_NAME",
      items: arr<Record<string, unknown>>(e["enum"] as never).map((it) => ({
        runtimeValue: String(it["@_Value"] ?? it["@_NativeValue"] ?? ""),
        displayName: String(it["@_DisplayName"] ?? it["@_Value"] ?? ""),
      })),
    });
  }
  for (const s of arr<Record<string, unknown>>(typesNode["struct"] as never)) {
    const name = String(s["@_Type"] ?? s["@_DisplayName"] ?? "Struct");
    structs.push({
      structId: newStructId(),
      name,
      malType: "FZ_MARGTYPE_RECORD",
      fields: arr<Record<string, unknown>>(s["Member"] as never).map((m) => ({
        fieldId: prefixedId("field"),
        fieldName: String(m["@_Name"] ?? ""),
        displayType: String(m["@_Type"] ?? "string"),
        malType: "FZ_MARGTYPE_RECORD",
        required: false,
      })),
    });
  }

  // agents
  const agentsNode = (meta["agents"] as Record<string, unknown>) ?? {};
  for (const a of arr<Record<string, unknown>>(agentsNode["agent"] as never)) {
    const className = String(a["@_classfullname"] ?? a["@_DisplayName"] ?? "Agent");
    const classId = prefixedId("class");
    classes.push({
      classId,
      className,
      displayName: String(a["@_DisplayName"] ?? className),
      category: "agent",
      hostModule: "",
    });
    for (const m of arr<Record<string, unknown>>(a["Member"] as never)) {
      const valueType = String(m["@_Type"] ?? "");
      members.push({
        memberId: prefixedId("member"),
        ownerClassId: classId,
        memberName: String(m["@_Name"] ?? ""),
        valueType,
        accessMode: "readwrite",
        bindingPath: `Self.${className}::${String(m["@_Name"] ?? "")}`,
        static: String(m["@_Static"] ?? "") === "true",
        defaultValue: m["@_defaultvalue"] ? String(m["@_defaultvalue"]) : undefined,
        displayType: toDisplayType(valueType),
      });
    }
    for (const mth of arr<Record<string, unknown>>(a["Method"] as never)) {
      const name = String(mth["@_Name"] ?? "");
      const returnType = String(mth["@_ReturnType"] ?? "void");
      const isCondition = /bool/i.test(returnType);
      const params: FunctionParam[] = arr<Record<string, unknown>>(mth["Param"] as never).map((p) => {
        const type = String(p["@_Type"] ?? "");
        const isRef = String(p["@_IsRef"] ?? "") === "true";
        return {
          paramId: prefixedId("param"),
          name: String(p["@_Name"] ?? p["@_DisplayName"] ?? ""),
          direction: isRef ? "output" : "input",
          displayType: toDisplayType(type),
          valueFormat: "literal",
          required: !isRef,
          originalType: type,
        };
      });
      functions.push({
        functionId: newFunctionId(),
        name,
        displayName: String(mth["@_DisplayName"] ?? name),
        category: isCondition ? "condition" : "action",
        bindingTarget: `${className}.${name}`,
        ownerClass: className,
        returnType,
        static: String(mth["@_Static"] ?? "") === "true",
        isTask: String(mth["@_istask"] ?? "") === "true",
        params,
      });
    }
  }

  return {
    classes,
    members,
    functionCatalog: { functions },
    enums,
    structs,
  };
}
