/**
 * 场景挂接页的持久化状态 —— 从 ScenarioAttachPage 组件里提出来,
 * 让"切走再回来"数据不丢(组件被 v-if/keep-alive 之外的方式销毁时 ref 全部清零)。
 *
 * 只放"跨页需要保留的状态"。纯 UI 折叠/滚动位置暂不放,由页面自己管即可。
 */
import { reactive, ref } from "vue";
import { defineStore } from "pinia";
import type { ScenarioUnit, UnitBindingSnapshot } from "@btstudio/bt-core";

export interface ScenarioRef { name: string; sdataPath: string }

/** 结构化的挂接结果 —— 替代原来 JSON.stringify 的 result。 */
export interface WrittenTree {
  kind: "BT" | "FSM";
  name: string;
  absolutePath: string;
}
export interface AttachResult {
  scenario: string;
  unit: string;
  scenarioPath: string;
  globalBlackboardPath?: string;
  writtenTrees: WrittenTree[];
  conflicts: string[];
  message: string;
}

/** 单个实体的绑定 diff:add/remove/keep 的树名(BT/FSM 分列)。 */
export interface UnitAssemblyDiff {
  unitName: string;
  bt: { add: string[]; remove: string[]; keep: string[] };
  fsm: { add: string[]; remove: string[]; keep: string[] };
  changed: boolean;
}

export const useScenarioAttachStore = defineStore("scenarioAttach", () => {
  const scenarios = ref<ScenarioRef[]>([]);
  const selScenario = ref<ScenarioRef | null>(null);
  const sdataXml = ref("");
  const units = ref<ScenarioUnit[]>([]);
  const selUnit = ref<ScenarioUnit | null>(null);
  const result = ref<AttachResult | null>(null);
  /** .sdata 里已有的 ADD Behaviac/StateMachine 命令 → baseline;pick 场景时抽出。 */
  const baseline = ref<UnitBindingSnapshot[]>([]);

  /** unit.objectHandle → 勾选的 treeId 集合。用 record<string, string[]> 便于 Pinia devtools 序列化。 */
  const assemblyMap = reactive<Record<string, string[]>>({});
  /** treeId → 校验条目是否折叠。切换实体不重置(用户偏好)。 */
  const foldedTrees = reactive<Record<string, boolean>>({});

  function assemblyOf(u: ScenarioUnit): string[] {
    return assemblyMap[u.objectHandle] ?? [];
  }
  function toggleTreeOnUnit(u: ScenarioUnit, treeId: string): void {
    const cur = assemblyMap[u.objectHandle] ?? [];
    assemblyMap[u.objectHandle] = cur.includes(treeId)
      ? cur.filter((x) => x !== treeId)
      : [...cur, treeId];
  }
  function isTreeOnUnit(u: ScenarioUnit, treeId: string): boolean {
    return assemblyMap[u.objectHandle]?.includes(treeId) ?? false;
  }
  function clearAssembly(): void {
    for (const k of Object.keys(assemblyMap)) delete assemblyMap[k];
    baseline.value = [];
  }

  function resetOnPickScenario(s: ScenarioRef, content: string, parsed: ScenarioUnit[], baselineBindings: UnitBindingSnapshot[]): void {
    selScenario.value = s;
    sdataXml.value = content;
    units.value = parsed;
    selUnit.value = null;
    clearAssembly();
    baseline.value = baselineBindings;
  }

  function removeScenario(s: ScenarioRef): void {
    scenarios.value = scenarios.value.filter((x) => x !== s);
    if (selScenario.value === s) {
      selScenario.value = null;
      sdataXml.value = "";
      units.value = [];
      selUnit.value = null;
      clearAssembly();
    }
  }

  /** 单个实体的 baseline 绑定(unit.name 键)。 */
  function baselineForUnit(unitName: string): UnitBindingSnapshot {
    return baseline.value.find((b) => b.unitName === unitName) ?? { unitName, bt: [], fsm: [] };
  }

  return {
    scenarios,
    selScenario,
    sdataXml,
    units,
    selUnit,
    result,
    baseline,
    assemblyMap,
    foldedTrees,
    assemblyOf,
    toggleTreeOnUnit,
    isTreeOnUnit,
    clearAssembly,
    resetOnPickScenario,
    removeScenario,
    baselineForUnit,
  };
});
