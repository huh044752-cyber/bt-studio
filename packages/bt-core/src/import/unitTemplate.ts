/**
 * UnitTemplate —— 从想定(.sdata)里派生"实体模板"快照,给 Root 绑定用。
 *
 * 业务链:想定 → 实体(Unit) → 组件类 → 组件里的决策函数。
 * Root 选中某模板 == "这颗行为树是给该类实体用的",叶子节点的类/函数下拉
 * 会自动过滤到该模板挂载的组件类范围,避免用户在全类目里错选。
 *
 * 场景挂接页仍以 Unit 为写回目标(<BehaviorTreeInstance belongUnit=..>),
 * 模板只是"设计态过滤器",不改变运行时行为。
 */
import type { ClassDescriptor, FunctionDescriptor } from "../types/catalog.js";
import { functionOwnerClass } from "../types/catalog.js";
import { parseScenarioUnits, type ScenarioUnit } from "./scenario.js";

export interface UnitTemplate {
  /** 稳定 id:优先用 Unit.modelId(UUID),兜底 `${scenario}::${unit}`。 */
  templateId: string;
  /** 派生来源想定名(去后缀),用于 UI 显示。 */
  scenarioName: string;
  /** 实体名(J-10 / 基地 ...)。 */
  unitName: string;
  typeOfUnit?: string;
  /** 该实体挂载的组件类(去重后)。 */
  componentClasses: string[];
  /** 组件中被标为 type="Cognition" 的第一个组件类,回填 <Root cognition="..."> 用。 */
  cognitionClass?: string;
}

/** 单份 .sdata → 模板列表(每个 Unit 一个模板)。 */
export function unitToTemplate(scenarioName: string, unit: ScenarioUnit): UnitTemplate {
  const componentClasses = Array.from(new Set(unit.components.map((c) => c.className))).filter(Boolean);
  const cognitionComp = unit.components.find(
    (c) => (c.componentType ?? "").toLowerCase() === "cognition",
  );
  const templateId = unit.modelId && unit.modelId.length > 0
    ? unit.modelId
    : `${scenarioName}::${unit.name}`;
  return {
    templateId,
    scenarioName,
    unitName: unit.name,
    typeOfUnit: unit.typeOfUnit,
    componentClasses,
    cognitionClass: cognitionComp?.className,
  };
}

/**
 * 从多份想定派生 UnitTemplate 集合。
 * - 同 templateId 后来居上覆盖(用户改动 .sdata 后重扫想定,以最新为准)。
 * - 空 componentClasses 的 Unit 不产出模板(通常是 .sdata 里只有壳的实体)。
 */
export function deriveUnitTemplates(
  scenarios: { name: string; sdataXml: string }[],
): UnitTemplate[] {
  const byId = new Map<string, UnitTemplate>();
  for (const s of scenarios) {
    const units = parseScenarioUnits(s.sdataXml);
    for (const u of units) {
      if (!u.name) continue;
      const t = unitToTemplate(s.name, u);
      if (t.componentClasses.length === 0) continue;
      byId.set(t.templateId, t);
    }
  }
  return Array.from(byId.values());
}

/** 模板未选 → 全量;已选 → 按 componentClasses ∩ 类目返回。 */
export function filterClassesByTemplate(
  allClasses: ClassDescriptor[],
  template: UnitTemplate | undefined,
): ClassDescriptor[] {
  if (!template) return allClasses;
  const allowed = new Set(template.componentClasses);
  return allClasses.filter((c) => allowed.has(c.className));
}

/** 模板未选 → 全量;已选 → 按 ownerClass ∈ componentClasses 过滤。 */
export function filterFunctionsByTemplate(
  allFunctions: FunctionDescriptor[],
  template: UnitTemplate | undefined,
): FunctionDescriptor[] {
  if (!template) return allFunctions;
  const allowed = new Set(template.componentClasses);
  return allFunctions.filter((f) => allowed.has(functionOwnerClass(f) ?? ""));
}
