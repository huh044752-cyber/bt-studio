/**
 * FOSim MAL 类型体系镜像。
 *
 * 真相源:F:\FOSim\FOSimEngine\include\FOSim\Engine\fz_enum_type.h (enum FZMARGType)。
 * 前端不得直接操作 FZMalImpl;此处只维护类型标识、显示类型到 MAL 类型的映射与值转换校验,
 * 真正的 MAL 构造/读取在 C++ Runtime Adapter 中完成。
 */

/** 与 fz_enum_type.h::FZMARGType 一一对应(保持声明顺序)。 */
export type FZMARGType =
  | "FZ_MARGTYPE_INVALID"
  | "FZ_MARGTYPE_TRACK_HANDLE"
  | "FZ_MARGTYPE_TRACK_HANDLE_LIST"
  | "FZ_MARGTYPE_ENGAGEMENT_INFO"
  | "FZ_MARGTYPE_BOOL"
  | "FZ_MARGTYPE_NAME"
  | "FZ_MARGTYPE_UNITID"
  | "FZ_MARGTYPE_EQUIPMENTID"
  | "FZ_MARGTYPE_ENTITYID"
  | "FZ_MARGTYPE_TRACK_ID"
  | "FZ_MARGTYPE_INTERID"
  | "FZ_MARGTYPE_FEATUREID"
  | "FZ_MARGTYPE_RECORD"
  | "FZ_MARGTYPE_COORDINATE"
  | "FZ_MARGTYPE_JULIAN"
  | "FZ_MARGTYPE_REAL"
  | "FZ_MARGTYPE_INTEGER"
  | "FZ_MARGTYPE_POSITION"
  | "FZ_MARGTYPE_VECTOR"
  | "FZ_MARGTYPE_ORIENTATION"
  | "FZ_MARGTYPE_DMGRC"
  | "FZ_MARGTYPE_MAL"
  | "FZ_MARGTYPE_STRING"
  | "FZ_MARGTYPE_ADDRESS"
  | "FZ_MARGTYPE_TASK_ID_LIST"
  | "FZ_USER_DEFINED";

export const ALL_MAL_TYPES: readonly FZMARGType[] = [
  "FZ_MARGTYPE_INVALID",
  "FZ_MARGTYPE_TRACK_HANDLE",
  "FZ_MARGTYPE_TRACK_HANDLE_LIST",
  "FZ_MARGTYPE_ENGAGEMENT_INFO",
  "FZ_MARGTYPE_BOOL",
  "FZ_MARGTYPE_NAME",
  "FZ_MARGTYPE_UNITID",
  "FZ_MARGTYPE_EQUIPMENTID",
  "FZ_MARGTYPE_ENTITYID",
  "FZ_MARGTYPE_TRACK_ID",
  "FZ_MARGTYPE_INTERID",
  "FZ_MARGTYPE_FEATUREID",
  "FZ_MARGTYPE_RECORD",
  "FZ_MARGTYPE_COORDINATE",
  "FZ_MARGTYPE_JULIAN",
  "FZ_MARGTYPE_REAL",
  "FZ_MARGTYPE_INTEGER",
  "FZ_MARGTYPE_POSITION",
  "FZ_MARGTYPE_VECTOR",
  "FZ_MARGTYPE_ORIENTATION",
  "FZ_MARGTYPE_DMGRC",
  "FZ_MARGTYPE_MAL",
  "FZ_MARGTYPE_STRING",
  "FZ_MARGTYPE_ADDRESS",
  "FZ_MARGTYPE_TASK_ID_LIST",
  "FZ_USER_DEFINED",
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
 * 将新版 FZ_MARGTYPE_* 枚举转换为老引擎类型字符串（用于 BT XML 导出）。
 */
export function fzTypeToOldEngine(fzType: FZMARGType): OldEngineType {
  const map: Record<FZMARGType, OldEngineType> = {
    FZ_MARGTYPE_INTEGER: "Integer",
    FZ_MARGTYPE_REAL: "Real",
    FZ_MARGTYPE_BOOL: "Boolean",
    FZ_MARGTYPE_JULIAN: "Julian",
    FZ_MARGTYPE_STRING: "String",
    FZ_MARGTYPE_NAME: "String",
    FZ_MARGTYPE_COORDINATE: "Coordinate",
    FZ_MARGTYPE_POSITION: "Coordinate",
    FZ_MARGTYPE_UNITID: "Integer",
    FZ_MARGTYPE_EQUIPMENTID: "Integer",
    FZ_MARGTYPE_ENTITYID: "Integer",
    FZ_MARGTYPE_TRACK_ID: "Integer",
    FZ_MARGTYPE_INTERID: "Integer",
    FZ_MARGTYPE_FEATUREID: "Integer",
    // 其余类型默认映射为 String（老引擎 bt_runtime 会按需处理）
    FZ_MARGTYPE_INVALID: "String",
    FZ_MARGTYPE_TRACK_HANDLE: "String",
    FZ_MARGTYPE_TRACK_HANDLE_LIST: "String",
    FZ_MARGTYPE_ENGAGEMENT_INFO: "String",
    FZ_MARGTYPE_RECORD: "String",
    FZ_MARGTYPE_VECTOR: "String",
    FZ_MARGTYPE_ORIENTATION: "String",
    FZ_MARGTYPE_DMGRC: "String",
    FZ_MARGTYPE_MAL: "String",
    FZ_MARGTYPE_ADDRESS: "String",
    FZ_MARGTYPE_TASK_ID_LIST: "String",
    FZ_USER_DEFINED: "String",
  };
  return map[fzType] ?? "String";
}
