/**
 * displayType ↔ malType 映射与 MAL 值转换校验(文档 §6.0.1 / 10.2 / 10.4)。
 *
 * 这是"编辑器友好类型边界"的核心:UI 用 displayType,运行/挂接/发布用 malType。
 */
import type { DisplayType, CyberMARGType } from "../types/mal.js";

/** displayType -> 默认 malType(文档 §6.0.1 核心映射表)。 */
const DISPLAY_TO_MAL: Record<DisplayType, CyberMARGType> = {
  bool: "CYBER_MARGTYPE_BOOL",
  int: "CYBER_MARGTYPE_INTEGER",
  float: "CYBER_MARGTYPE_REAL",
  string: "CYBER_MARGTYPE_STRING",
  name: "CYBER_MARGTYPE_NAME",
  enum: "CYBER_MARGTYPE_NAME",
  list: "CYBER_MARGTYPE_TASK_ID_LIST",
  struct: "CYBER_MARGTYPE_RECORD",
  coordinate: "CYBER_MARGTYPE_COORDINATE",
  position: "CYBER_MARGTYPE_POSITION",
  vector: "CYBER_MARGTYPE_VECTOR",
  orientation: "CYBER_MARGTYPE_ORIENTATION",
  julian: "CYBER_MARGTYPE_JULIAN",
  unitId: "CYBER_MARGTYPE_UNITID",
  entityId: "CYBER_MARGTYPE_ENTITYID",
  equipmentId: "CYBER_MARGTYPE_EQUIPMENTID",
  trackId: "CYBER_MARGTYPE_TRACK_ID",
  interId: "CYBER_MARGTYPE_INTERID",
  featureId: "CYBER_MARGTYPE_FEATUREID",
  record: "CYBER_MARGTYPE_RECORD",
  mal: "CYBER_MARGTYPE_MAL",
  taskIdList: "CYBER_MARGTYPE_TASK_ID_LIST",
};

/**
 * malType -> 运行 XML 中使用的 type 字符串(对齐老引擎 Cyber* 习惯写法)。
 */
const MAL_TO_XML_TYPE: Partial<Record<CyberMARGType, string>> = {
  CYBER_MARGTYPE_BOOL: "CyberBOOL",
  CYBER_MARGTYPE_INTEGER: "CyberIntegerType",
  CYBER_MARGTYPE_REAL: "CyberRealType",
  CYBER_MARGTYPE_STRING: "CyberStringType",
  CYBER_MARGTYPE_NAME: "CyberNameType",
  CYBER_MARGTYPE_COORDINATE: "CyberCoordinateType",
  CYBER_MARGTYPE_POSITION: "CyberPositionType",
  CYBER_MARGTYPE_VECTOR: "CyberVectorType",
  CYBER_MARGTYPE_ORIENTATION: "CyberOrientationType",
  CYBER_MARGTYPE_JULIAN: "CyberJulianType",
  CYBER_MARGTYPE_UNITID: "CyberUnitIDType",
  CYBER_MARGTYPE_ENTITYID: "CyberEntityIDType",
  CYBER_MARGTYPE_EQUIPMENTID: "CyberEquipmentIDType",
  CYBER_MARGTYPE_TRACK_ID: "CyberTrackIDType",
  CYBER_MARGTYPE_RECORD: "CyberRecordType",
};

/** 文本类:空串是合法值(string/name/address),不应判为「默认值为空」。 */
export const EMPTY_ALLOWED_MAL_TYPES: ReadonlySet<CyberMARGType> = new Set([
  "CYBER_MARGTYPE_STRING",
  "CYBER_MARGTYPE_NAME",
  "CYBER_MARGTYPE_ADDRESS",
]);

/** 想定引用类型,Linked FOSim 下不允许用户自由填写后直接发布(必须工作区解析)。 */
export const SCENARIO_REF_MAL_TYPES: ReadonlySet<CyberMARGType> = new Set([
  "CYBER_MARGTYPE_UNITID",
  "CYBER_MARGTYPE_ENTITYID",
  "CYBER_MARGTYPE_EQUIPMENTID",
  "CYBER_MARGTYPE_TRACK_ID",
  "CYBER_MARGTYPE_INTERID",
  "CYBER_MARGTYPE_FEATUREID",
]);

/** Metadata Catalog::ResolveMalType */
export function resolveMalType(displayType: DisplayType): CyberMARGType {
  return DISPLAY_TO_MAL[displayType] ?? "CYBER_MARGTYPE_INVALID";
}

export function malToXmlType(malType: CyberMARGType): string {
  return MAL_TO_XML_TYPE[malType] ?? "CyberStringType";
}

/**
 * malType -> 类型对应的默认字面量值。
 * 数值类给 "0"、布尔给 "false"、字符串/名称给 ""、几何类给逗号分隔零组。
 * 想定引用类(UnitID/EntityID/... )无法凭空给默认,留空待工作区解析。
 */
const MAL_DEFAULT_VALUE: Partial<Record<CyberMARGType, string>> = {
  CYBER_MARGTYPE_BOOL: "false",
  CYBER_MARGTYPE_INTEGER: "0",
  CYBER_MARGTYPE_REAL: "0",
  CYBER_MARGTYPE_JULIAN: "0",
  CYBER_MARGTYPE_DMGRC: "0",
  CYBER_MARGTYPE_STRING: "",
  CYBER_MARGTYPE_NAME: "",
  CYBER_MARGTYPE_ADDRESS: "",
  // 几何类:验证要求逗号分隔 ≥2 个数值,给三元零组(经/纬/高 或 x/y/z)。
  CYBER_MARGTYPE_COORDINATE: "0,0,0",
  CYBER_MARGTYPE_POSITION: "0,0,0",
  CYBER_MARGTYPE_VECTOR: "0,0,0",
  CYBER_MARGTYPE_ORIENTATION: "0,0,0",
};

/**
 * 取某 malType 的默认字面量值。未知 / 引用类 / 复杂结构类返回 ""(无安全默认)。
 * fallback 参数用于 malType 缺失时按 displayType 推断后再查表。
 */
export function malTypeDefaultValue(malType: CyberMARGType | undefined): string {
  if (!malType) return "";
  return MAL_DEFAULT_VALUE[malType] ?? "";
}

/**
 * 类型的 Cyber 友好标签:绑定面板里显示「Cyber 类型名」而非内部枚举 CYBER_MARGTYPE_*。
 * 例:CYBER_MARGTYPE_INTEGER -> "CyberIntegerType"。无映射时回退到 displayType,再回退枚举名。
 */
export function malFzLabel(
  malType: CyberMARGType | undefined,
  displayType?: DisplayType,
): string {
  if (malType && MAL_TO_XML_TYPE[malType]) return MAL_TO_XML_TYPE[malType]!;
  if (malType) {
    // 无 XML 映射的引用/复杂类型:去掉 CYBER_MARGTYPE_ 前缀转驼峰,如 UNITID -> CyberUnitIDType。
    return `Cyber${malType.replace(/^CYBER_MARGTYPE_/, "").toLowerCase().replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}Type`;
  }
  return displayType ?? "?";
}

/**
 * 输出回写类型相容性:只有当方法输出参数的 malType 与目标黑板变量的 malType 一致时,
 * 才允许把输出回写到该变量(文档:类型对应才能回写)。
 * 任一侧缺 malType 时按 displayType 兜底比较;两侧都无类型信息则放行(无从判断)。
 */
export function isWritebackCompatible(
  paramMalType: CyberMARGType | undefined,
  varMalType: CyberMARGType | undefined,
  paramDisplayType?: DisplayType,
  varDisplayType?: DisplayType,
): boolean {
  if (paramMalType && varMalType) return paramMalType === varMalType;
  const p = paramMalType ?? (paramDisplayType ? resolveMalType(paramDisplayType) : undefined);
  const v = varMalType ?? (varDisplayType ? resolveMalType(varDisplayType) : undefined);
  if (p && v) return p === v;
  return true;
}

export interface MalConversionResult {
  ok: boolean;
  message?: string;
}

/**
 * ValidateMalValueConversion:按 malType 校验字符串值能否转换。
 * 文档专项:INTEGER + "1.2" => Error;REAL + "1.2" => OK。
 */
export function validateMalValueConversion(
  value: string | undefined,
  malType: CyberMARGType,
  valueFormat: string = "literal",
): MalConversionResult {
  // 引用类型不在此处做字面量校验(交给想定解析)。
  if (SCENARIO_REF_MAL_TYPES.has(malType)) {
    return value && value.trim().length > 0
      ? { ok: true }
      : { ok: false, message: `${malType} 想定引用不能为空,必须由工作区解析` };
  }
  if (valueFormat !== "literal") {
    // json/csv/ref 等非字面量,交给专门解析器;此处放行。
    return { ok: true };
  }
  const v = (value ?? "").trim();
  if (v.length === 0) {
    // 文本类(string/name/address)空串合法;其余标量类空值才算缺省。
    return EMPTY_ALLOWED_MAL_TYPES.has(malType)
      ? { ok: true }
      : { ok: false, message: "默认值为空" };
  }
  switch (malType) {
    case "CYBER_MARGTYPE_BOOL":
      return /^(true|false|0|1)$/i.test(v)
        ? { ok: true }
        : { ok: false, message: `bool 仅允许 true/false/0/1,收到 "${v}"` };
    case "CYBER_MARGTYPE_INTEGER":
      return /^[+-]?\d+$/.test(v)
        ? { ok: true }
        : { ok: false, message: `integer 不允许小数或非数字,收到 "${v}"` };
    case "CYBER_MARGTYPE_REAL":
      return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)
        ? { ok: true }
        : { ok: false, message: `real 不是合法浮点,收到 "${v}"` };
    case "CYBER_MARGTYPE_NAME":
    case "CYBER_MARGTYPE_STRING":
      return { ok: true };
    case "CYBER_MARGTYPE_COORDINATE":
    case "CYBER_MARGTYPE_POSITION":
    case "CYBER_MARGTYPE_VECTOR":
    case "CYBER_MARGTYPE_ORIENTATION": {
      // 期望以逗号分隔的数值组(如 "经度,纬度,高度")。
      const parts = v.split(",").map((s) => s.trim());
      const allNum = parts.every(
        (p) => /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(p),
      );
      return allNum && parts.length >= 2
        ? { ok: true }
        : {
            ok: false,
            message: `${malType} 需为逗号分隔的数值组(≥2 个),收到 "${v}"`,
          };
    }
    case "CYBER_MARGTYPE_JULIAN":
      return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)
        ? { ok: true }
        : { ok: false, message: `julian 时间需为数值,收到 "${v}"` };
    case "CYBER_MARGTYPE_INVALID":
      return { ok: false, message: "malType 无效(CYBER_MARGTYPE_INVALID)" };
    default:
      // record/mal/list 等复杂类型不在字面量层校验。
      return { ok: true };
  }
}

/**
 * 比较语义(compareType)与字段 malType 兼容性的轻量判断。
 */
export function isCompareCompatible(
  malType: CyberMARGType,
  op: string,
): boolean {
  const numeric =
    malType === "CYBER_MARGTYPE_INTEGER" ||
    malType === "CYBER_MARGTYPE_REAL" ||
    malType === "CYBER_MARGTYPE_JULIAN";
  const lower = op.toLowerCase();
  if (["gt", "ge", "lt", "le"].includes(lower)) {
    return numeric;
  }
  // eq/ne 适用于所有标量类型
  return ["eq", "ne", "gt", "ge", "lt", "le"].includes(lower);
}

export const VALID_COMPARE_OPS = ["eq", "ne", "gt", "ge", "lt", "le"] as const;
export type CompareOp = (typeof VALID_COMPARE_OPS)[number];

/**
 * 比较运算的人类可读符号(界面展示用)。存储/导出仍用 eq/ne/...(运行时与 XML 约定),
 * 仅在属性面板下拉与节点描述中显示为 == / != / > / >= / < / <=。
 */
export const COMPARE_OP_LABELS: Record<CompareOp, string> = {
  eq: "==",
  ne: "!=",
  gt: ">",
  ge: ">=",
  lt: "<",
  le: "<=",
};

/** 把存储的比较运算码(eq/ne/...)转为符号(==/!=/...);未知值原样返回。 */
export function compareOpSymbol(op: string | undefined | null): string {
  if (!op) return "";
  return COMPARE_OP_LABELS[op.toLowerCase() as CompareOp] ?? op;
}
