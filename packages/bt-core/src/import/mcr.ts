/**
 * McrTemplate —— 从 FOSim 老引擎的 .mcr 文件(Model Class Registry)派生"实体模板"。
 *
 * 业务链:.mcr 文件(装配好的实体类型) → 组件类清单 → 决策函数目录。
 * Root 选中某模板 == "这颗行为树是给该类实体用的";叶子节点从模板 components 里挑
 * 具体组件实例,className+componentId 一并写回 targetSelector,再从该 className
 * 下的方法里挑函数。场景挂接前不引入 Unit 概念 —— .mcr 独立成体。
 *
 * .mcr 老格式(装备命名子节点,组件 type 属性直接可见)—— 本轮主力路径:
 *   <MCR icon_2d="..." LocateType="空中">
 *     <CyCFWPilot uuid="1" name="飞行员认知" type="Cognition" count="1"/>
 *     <FzFixedWing uuid="9" name="Fz_J_16" type="Platforms" count="1"><MaxSpeed>...</MaxSpeed></FzFixedWing>
 *   </MCR>
 *
 * .mcr 新格式(泛型 <member data_id=...>)—— 组件 className 不在 .mcr 本身,需外部反查:
 *   <MCR id="uuid-..." locate_type="">
 *     <member count="1" data_type="common" data_id="uuid-96320164-..."/>
 *   </MCR>
 * 新格式条目在 unresolvedCount 计数;不参与函数过滤,UI 显示为占位。
 */
import { XMLParser } from "fast-xml-parser";
import type { ClassDescriptor, FunctionDescriptor } from "../types/catalog.js";
import { functionOwnerClass } from "../types/catalog.js";
import type { ScenarioComponent } from "./scenario.js";

/** 磁盘文件描述:mcrScanner 产出,parseMcrTemplate 消费。 */
export interface McrTemplateFile {
  /** 完整磁盘路径 —— 用于追溯与再扫描 key。 */
  path: string;
  /** 文件名去后缀:F16 / 卫星 / HQ-9A地导系统 —— 展示与兜底 templateId。 */
  templateName: string;
  /** 父目录名(FZMCR 下一层):飞机 / 舰船 / ... —— 展示分类。 */
  category: string;
  /** 原始 XML 文本。 */
  xml: string;
}

export interface McrTemplate {
  /** 优先 <MCR id=...>,兜底 `${category}::${templateName}`(老格式无 id 属性时)。 */
  templateId: string;
  /** 文件名去后缀,展示用。 */
  templateName: string;
  /** 分类目录名。 */
  category: string;
  /** locate_type / LocateType 属性(空中/地面/太空/...)。 */
  locateType?: string;
  /**
   * 装配的组件实例集合(className/componentId/componentType)。
   * 叶子节点从这里挑一条即同时锁 className(过滤函数)与 componentId(供 attach 写回 targetSelector)。
   * 新格式的 <member data_id> 因 className 不可得,不进入这里,只累计 unresolvedCount。
   */
  components: ScenarioComponent[];
  /** 去重后的 className 列表(过滤类/函数用)。 */
  componentClasses: string[];
  /** 第一个 type="Cognition" 的组件类 —— 供 <Root cognition="..."> 兜底填充。 */
  cognitionClass?: string;
  /** 新格式无法解析 className 的 <member> 条目数,供 UI 提示"还有 N 个未解析成员"。 */
  unresolvedCount: number;
}

const MCR_META_ATTRS = new Set([
  "@_id",
  "@_icon_2d",
  "@_model_3d",
  "@_note",
  "@_LocateType",
  "@_locate_type",
]);

function arr<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** 解析单个 .mcr 文件为 McrTemplate。 */
export function parseMcrTemplate(file: McrTemplateFile): McrTemplate {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: () => false });
  let root: Record<string, unknown> = {};
  try {
    root = parser.parse(file.xml) as Record<string, unknown>;
  } catch {
    // 空文件/损坏:返回空模板,不阻断扫描。
    return emptyTemplate(file);
  }
  const mcr = (root["MCR"] as Record<string, unknown> | undefined) ?? undefined;
  if (!mcr) return emptyTemplate(file);

  const locateType =
    (mcr["@_LocateType"] as string | undefined) ??
    (mcr["@_locate_type"] as string | undefined) ??
    undefined;
  const idAttr = mcr["@_id"] as string | undefined;
  const templateId = idAttr && idAttr.length > 0
    ? idAttr
    : `${file.category}::${file.templateName}`;

  const components: ScenarioComponent[] = [];
  let unresolvedCount = 0;

  for (const [key, val] of Object.entries(mcr)) {
    if (key.startsWith("@_")) continue; // 属性:MCR_META_ATTRS
    if (key === "#text") continue;
    for (const raw of arr<Record<string, unknown>>(val as never)) {
      if (!raw || typeof raw !== "object") continue;
      // 新格式:<member data_id="...">
      if (key === "member") {
        const dataId = raw["@_data_id"];
        if (typeof dataId === "string" && dataId.length > 0) unresolvedCount++;
        continue;
      }
      // 老格式:<ClassName uuid="..." type="Cognition" count="1"/>
      const uuid = raw["@_uuid"] ?? raw["@_data_id"];
      const componentId = uuid !== undefined && uuid !== null ? String(uuid) : "";
      if (!componentId) continue;
      const rawType = raw["@_type"];
      const componentType = rawType !== undefined && rawType !== null ? String(rawType) : undefined;
      components.push({ className: key, componentId, componentType });
    }
  }
  // 消除 lint 未用变量
  void MCR_META_ATTRS;

  const componentClasses = Array.from(new Set(components.map((c) => c.className))).filter(Boolean);
  const cognitionComp = components.find(
    (c) => (c.componentType ?? "").toLowerCase() === "cognition",
  );
  return {
    templateId,
    templateName: file.templateName,
    category: file.category,
    locateType,
    components,
    componentClasses,
    cognitionClass: cognitionComp?.className,
    unresolvedCount,
  };
}

function emptyTemplate(file: McrTemplateFile): McrTemplate {
  return {
    templateId: `${file.category}::${file.templateName}`,
    templateName: file.templateName,
    category: file.category,
    components: [],
    componentClasses: [],
    unresolvedCount: 0,
  };
}

/**
 * 从多份 .mcr 文件派生模板集合。
 * - 同 templateId 后来居上覆盖(用户改动 .mcr 后重扫,以最新为准)。
 * - 保留空 componentClasses 的模板(新格式全 unresolved 时也要在 Root 下拉里可见,
 *   给用户提示"这个模板暂不可用于函数过滤")。
 */
export function deriveMcrTemplates(files: McrTemplateFile[]): McrTemplate[] {
  const byId = new Map<string, McrTemplate>();
  for (const f of files) {
    const t = parseMcrTemplate(f);
    byId.set(t.templateId, t);
  }
  return Array.from(byId.values());
}

/** 模板未选 → 全量;已选 → 按 componentClasses ∩ 类目返回。 */
export function filterClassesByTemplate(
  allClasses: ClassDescriptor[],
  template: McrTemplate | undefined,
): ClassDescriptor[] {
  if (!template) return allClasses;
  const allowed = new Set(template.componentClasses);
  return allClasses.filter((c) => allowed.has(c.className));
}

/** 模板未选 → 全量;已选 → 按 ownerClass ∈ componentClasses 过滤。 */
export function filterFunctionsByTemplate(
  allFunctions: FunctionDescriptor[],
  template: McrTemplate | undefined,
): FunctionDescriptor[] {
  if (!template) return allFunctions;
  const allowed = new Set(template.componentClasses);
  return allFunctions.filter((f) => allowed.has(functionOwnerClass(f) ?? ""));
}
