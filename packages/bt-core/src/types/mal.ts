/**
 * FOSim MAL 类型体系镜像。
 *
 * 真相源:F:\0411\ccc\FOSimEngine\include\FOSim\Engine\cyber_enum_type.h (enum CyberMARGType)。
 * 前端不得直接操作 CyberMalImpl;此处只维护类型标识、显示类型到 MAL 类型的映射与值转换校验,
 * 真正的 MAL 构造/读取在 C++ Runtime Adapter 中完成。
 */

/** 与 cyber_enum_type.h::CyberMARGType 一一对应(保持声明顺序)。 */
export type CyberMARGType =
  | "CYBER_MARGTYPE_INVALID"
  | "CYBER_MARGTYPE_TRACK_HANDLE"
  | "CYBER_MARGTYPE_TRACK_HANDLE_LIST"
  | "CYBER_MARGTYPE_ENGAGEMENT_INFO"
  | "CYBER_MARGTYPE_BOOL"
  | "CYBER_MARGTYPE_NAME"
  | "CYBER_MARGTYPE_UNITID"
  | "CYBER_MARGTYPE_EQUIPMENTID"
  | "CYBER_MARGTYPE_ENTITYID"
  | "CYBER_MARGTYPE_TRACK_ID"
  | "CYBER_MARGTYPE_INTERID"
  | "CYBER_MARGTYPE_FEATUREID"
  | "CYBER_MARGTYPE_RECORD"
  | "CYBER_MARGTYPE_COORDINATE"
  | "CYBER_MARGTYPE_JULIAN"
  | "CYBER_MARGTYPE_REAL"
  | "CYBER_MARGTYPE_INTEGER"
  | "CYBER_MARGTYPE_POSITION"
  | "CYBER_MARGTYPE_VECTOR"
  | "CYBER_MARGTYPE_ORIENTATION"
  | "CYBER_MARGTYPE_DMGRC"
  | "CYBER_MARGTYPE_MAL"
  | "CYBER_MARGTYPE_STRING"
  | "CYBER_MARGTYPE_ADDRESS"
  | "CYBER_MARGTYPE_TASK_ID_LIST"
  | "CYBER_USER_DEFINED";

export const ALL_MAL_TYPES: readonly CyberMARGType[] = [
  "CYBER_MARGTYPE_INVALID",
  "CYBER_MARGTYPE_TRACK_HANDLE",
  "CYBER_MARGTYPE_TRACK_HANDLE_LIST",
  "CYBER_MARGTYPE_ENGAGEMENT_INFO",
  "CYBER_MARGTYPE_BOOL",
  "CYBER_MARGTYPE_NAME",
  "CYBER_MARGTYPE_UNITID",
  "CYBER_MARGTYPE_EQUIPMENTID",
  "CYBER_MARGTYPE_ENTITYID",
  "CYBER_MARGTYPE_TRACK_ID",
  "CYBER_MARGTYPE_INTERID",
  "CYBER_MARGTYPE_FEATUREID",
  "CYBER_MARGTYPE_RECORD",
  "CYBER_MARGTYPE_COORDINATE",
  "CYBER_MARGTYPE_JULIAN",
  "CYBER_MARGTYPE_REAL",
  "CYBER_MARGTYPE_INTEGER",
  "CYBER_MARGTYPE_POSITION",
  "CYBER_MARGTYPE_VECTOR",
  "CYBER_MARGTYPE_ORIENTATION",
  "CYBER_MARGTYPE_DMGRC",
  "CYBER_MARGTYPE_MAL",
  "CYBER_MARGTYPE_STRING",
  "CYBER_MARGTYPE_ADDRESS",
  "CYBER_MARGTYPE_TASK_ID_LIST",
  "CYBER_USER_DEFINED",
];

/**
 * 编辑器友好展示类型。仅用于 UI 展示与表单输入;运行/挂接/发布以 malType 为准。
 */
export type DisplayType =
  | "bool"
  | "int"
  | "float"
  | "string"
  | "name"
  | "enum"
  | "list"
  | "struct"
  | "coordinate"
  | "position"
  | "vector"
  | "orientation"
  | "julian"
  | "unitId"
  | "entityId"
  | "equipmentId"
  | "trackId"
  | "interId"
  | "featureId"
  | "record"
  | "mal"
  | "taskIdList";

/**
 * 值的字符串保存格式(进入 XML/JSON 的默认值表示)。
 */
export type ValueFormat =
  | "literal"
  | "json"
  | "csv"
  | "fosim-ref"
  | "record-binary-ref";

/**
 * 老引擎类型字符串（对齐 F:\0411\ccc\FOSimEngine bt_runtime.cpp IsIntegerType/IsRealType）。
 * 老版 BT XML 的 Input/Output type 属性使用这些简短字符串。
 */
export type OldEngineType = "Boolean" | "Integer" | "Real" | "Julian" | "String" | "Coordinate";

/**
 * 将 CYBER_MARGTYPE_* 枚举转换为老引擎类型字符串（用于 BT XML 导出）。
 */
export function cyberTypeToOldEngine(cyberType: CyberMARGType): OldEngineType {
  const map: Record<CyberMARGType, OldEngineType> = {
    CYBER_MARGTYPE_INTEGER: "Integer",
    CYBER_MARGTYPE_REAL: "Real",
    CYBER_MARGTYPE_BOOL: "Boolean",
    CYBER_MARGTYPE_JULIAN: "Julian",
    CYBER_MARGTYPE_STRING: "String",
    CYBER_MARGTYPE_NAME: "String",
    CYBER_MARGTYPE_COORDINATE: "Coordinate",
    CYBER_MARGTYPE_POSITION: "Coordinate",
    CYBER_MARGTYPE_UNITID: "Integer",
    CYBER_MARGTYPE_EQUIPMENTID: "Integer",
    CYBER_MARGTYPE_ENTITYID: "Integer",
    CYBER_MARGTYPE_TRACK_ID: "Integer",
    CYBER_MARGTYPE_INTERID: "Integer",
    CYBER_MARGTYPE_FEATUREID: "Integer",
    // 其余类型默认映射为 String（老引擎 bt_runtime 会按需处理）
    CYBER_MARGTYPE_INVALID: "String",
    CYBER_MARGTYPE_TRACK_HANDLE: "String",
    CYBER_MARGTYPE_TRACK_HANDLE_LIST: "String",
    CYBER_MARGTYPE_ENGAGEMENT_INFO: "String",
    CYBER_MARGTYPE_RECORD: "String",
    CYBER_MARGTYPE_VECTOR: "String",
    CYBER_MARGTYPE_ORIENTATION: "String",
    CYBER_MARGTYPE_DMGRC: "String",
    CYBER_MARGTYPE_MAL: "String",
    CYBER_MARGTYPE_ADDRESS: "String",
    CYBER_MARGTYPE_TASK_ID_LIST: "String",
    CYBER_USER_DEFINED: "String",
  };
  return map[cyberType] ?? "String";
}
