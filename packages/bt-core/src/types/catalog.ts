/**
 * 宿主绑定目录 / 工作空间 / 工程包 / 控制台 / 会话类型(文档 §6)。
 */
import type { DisplayType, FZMARGType, ValueFormat } from "./mal.js";
import type { BlackboardScope } from "./runtime.js";
import type { DesignTree } from "./editor.js";

export type IssueLevel = "error" | "warning" | "info";

/** 统一校验/解析问题模型(文档 §10.4)。 */
export interface Issue {
  level: IssueLevel;
  message: string;
  source: string;
  treeId?: string;
  nodeId?: string;
  nodeType?: string;
  fieldPath?: string;
  relatedFile?: string;
}

// --- 函数目录(6.8) ---

export type ParamDirection = "input" | "output" | "inout";

export interface FunctionParam {
  paramId: string;
  name: string;
  /** 中文名(.cmp 的 text/ChName)。 */
  displayName?: string;
  /** 说明(.cmp 的 note/desc)。 */
  description?: string;
  direction: ParamDirection;
  displayType: DisplayType;
  malType?: FZMARGType;
  valueFormat: ValueFormat;
  required: boolean;
  defaultValue?: string;
  min?: number;
  max?: number;
  unit?: string;
  originalType?: string;
  bindingPath?: string;
}

export interface FunctionDescriptor {
  functionId: string;
  name: string;
  displayName?: string;
  category: "action" | "condition" | "condition_transform";
  bindingTarget: string;
  returnType: string;
  description?: string;
  params: FunctionParam[];
  signatureHash?: string;
  version?: string;
  /** 所属类(behaviac:Method.Class)。根类绑定模型据此过滤函数。缺省取 bindingTarget 前缀。 */
  ownerClass?: string;
  /** 静态方法(behaviac Static)。 */
  static?: boolean;
  /** 命名事件/任务(behaviac istask)。 */
  isTask?: boolean;
  // --- FOSim 引擎决策函数注册信息(对齐 *_register.cpp)---
  /** IntendedCmd 注册命令令牌(如 "ENGAGE")。 */
  intendedCmd?: string;
  delay?: number;
  delayDelta?: number;
  repeat?: number;
  repeatDelta?: number;
}

/** 取函数所属类名(优先 ownerClass,否则取 bindingTarget 的 "类.方法" 前缀)。 */
export function functionOwnerClass(fn: FunctionDescriptor): string {
  if (fn.ownerClass) return fn.ownerClass;
  const t = fn.bindingTarget ?? "";
  const dot = t.lastIndexOf(".");
  return dot > 0 ? t.slice(0, dot) : "";
}

export interface FunctionCatalog {
  functions: FunctionDescriptor[];
}

// --- 变量(6.5) ---

export interface Variable {
  variableId: string;
  name: string;
  scope: "global" | "tree";
  displayType: DisplayType;
  malType?: FZMARGType;
  valueFormat: ValueFormat;
  defaultValue?: string;
  unit?: string;
  description?: string;
  enumRef?: string;
  structRef?: string;
  source?: "manual" | "fosim-model" | "fosim-scenario" | "imported";
}

/** 编辑器侧黑板(含展示类型变量列表 + 运行态 scope)。 */
export interface Blackboard {
  blackboardId: string;
  name: string;
  scope: "global" | "tree";
  runtimeScope: BlackboardScope;
  linked: boolean;
  variables: Variable[];
}

// --- 枚举 / 结构体 / 类 / 成员(6.6 / 6.7) ---

export interface EnumItem {
  displayName: string;
  runtimeValue: string;
}

export interface EnumDescriptor {
  enumId: string;
  name: string;
  displayType: "enum";
  malType: "FZ_MARGTYPE_NAME" | "FZ_MARGTYPE_STRING" | "FZ_MARGTYPE_INTEGER";
  items: EnumItem[];
}

export interface StructField {
  fieldId: string;
  fieldName: string;
  displayType: string;
  malType: FZMARGType;
  required: boolean;
}

export interface StructDescriptor {
  structId: string;
  name: string;
  malType: "FZ_MARGTYPE_RECORD" | "FZ_MARGTYPE_MAL";
  recordId?: string;
  fields: StructField[];
}

export interface TypeDescriptor {
  typeId: string;
  name: string;
  displayType: DisplayType;
  malType: FZMARGType;
  description?: string;
}

export interface ClassDescriptor {
  classId: string;
  className: string;
  displayName: string;
  category: string;
  hostModule: string;
  /** 说明(.cmp 的 remarks)。 */
  description?: string;
  version?: string;
  /** 来源:model=从真实模型 .cmp 解析(已存在 C++,不重生);user=用户新建(生成完整 C++)。 */
  source?: "model" | "user";
  /** 引擎基类(对齐 model.list:RuleDecision→FZCognitionImpl、Jammers→FZJammerImpl 等)。 */
  baseClass?: string;
}

/** .cmp type(模型分类)-> 引擎基类（老引擎 Cyber* 前缀）。 */
export function categoryToBaseClass(category: string): string {
  const map: Record<string, string> = {
    RuleDecision: "CyberCognitionImpl",
    MissionAction: "CyberBaseMissionAction",
    Jammers: "CyberJammerImpl",
    Platforms: "CyberPlatformImpl",
    DataProcessors: "CyberDataProcessorImpl",
    Sensors: "CyberSensorImpl",
    Munitions: "CyberMunitionImpl",
    WeaponSystems: "CyberWeaponSystemImpl",
    ComDevices: "CyberComDeviceImpl",
    SubSystems: "CyberSubSystemImpl",
  };
  return map[category] ?? "CyberCognitionImpl";
}

export interface MemberDescriptor {
  memberId: string;
  ownerClassId: string;
  memberName: string;
  valueType: string;
  accessMode: "read" | "write" | "readwrite";
  bindingPath: string;
  /** 静态成员(behaviac Static)=全局黑板候选;实例成员=本地黑板候选。 */
  static?: boolean;
  defaultValue?: string;
  displayType?: DisplayType;
  malType?: FZMARGType;
}

// --- 模型工作空间(6.12) ---

export interface ModelWorkspace {
  workspaceId: string;
  workspaceName: string;
  workspaceType: "conditional_logic" | "equipment_control" | "generic";
  rootPath?: string;
  sourceFormat: "json" | "folder" | "mixed";
  classes: ClassDescriptor[];
  functions: FunctionDescriptor[];
  members: MemberDescriptor[];
  types: TypeDescriptor[];
  parseWarnings: Issue[];
  signatureVersion: string;
}

// --- 项目工作空间包(6.13) ---

export interface ExportArtifact {
  kind: "xml" | "meta" | "binding_manifest" | "catalog" | "zip" | "folder";
  path: string;
  bytes?: number;
  createdAt: string;
}

export interface ProjectWorkspacePackage {
  packageId: string;
  packageName: string;
  packageVersion: string;
  mode: "standalone" | "linked_fosim";
  trees: DesignTree[];
  globalBlackboards: Blackboard[];
  functionCatalog: FunctionCatalog;
  enums: EnumDescriptor[];
  structs: StructDescriptor[];
  types: TypeDescriptor[];
  classes: ClassDescriptor[];
  members: MemberDescriptor[];
  modelWorkspaces: ModelWorkspace[];
  recentExportResults: ExportArtifact[];
  toolVersion: string;
  signatureHash?: string;
  exportedAt?: string;
}

// --- 项目列表项(6.14) ---

export interface ProjectListItem {
  projectId: string;
  projectName: string;
  groupName?: string;
  assetPath?: string;
  treeCount: number;
  selected: boolean;
  expanded: boolean;
  dirty: boolean;
  lastModified: string;
}

// --- 控制台日志(6.15) ---

export type LogLevel = "info" | "success" | "warning" | "error";
export type LogCategory =
  | "workspace"
  | "import"
  | "export"
  | "validation"
  | "debug"
  | "publish"
  | "canvas";

export interface ConsoleLog {
  logId: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  detail?: string;
  relatedAssetId?: string;
  relatedNodeId?: string;
  timestamp: string;
  read: boolean;
}

// --- 工作区导入导出会话(6.16) ---

export interface RollbackInfo {
  backupPath: string;
  originalPath: string;
}

export interface WorkspaceImportExportSession {
  sessionId: string;
  operation: "import" | "export" | "publish";
  sourcePath?: string;
  targetPath?: string;
  format: "xml" | "json" | "zip" | "folder";
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  issues: Issue[];
  artifacts: ExportArtifact[];
  rollbackInfo?: RollbackInfo;
}

// --- 导入映射报告(6.0.2 / 9) ---

export type MappingMatchLevel =
  | "stable-id"
  | "binding-target"
  | "mal-signature"
  | "weak-name"
  | "unmatched";

export interface MappingEntry {
  kind: "function" | "variable" | "subtree" | "class" | "member";
  sourceRef: string;
  resolvedId?: string;
  matchLevel: MappingMatchLevel;
  needsManualRepair: boolean;
  message?: string;
}

export interface ImportMappingReport {
  assetName: string;
  entries: MappingEntry[];
  unresolvedCount: number;
}

/** 设计器消费的统一目录中心快照。 */
export interface CatalogBundle {
  functionCatalog: FunctionCatalog;
  globalBlackboards: Blackboard[];
  enums: EnumDescriptor[];
  structs: StructDescriptor[];
  types: TypeDescriptor[];
  classes: ClassDescriptor[];
  members: MemberDescriptor[];
}
