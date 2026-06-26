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
