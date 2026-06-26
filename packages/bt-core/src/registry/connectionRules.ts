/**
 * 按节点类型的连接校验(移植自 F:\0411\vue2 src/utils/connectionValidators.js)。
 *
 * 规则(以本项目 PascalCase nodeType 表达):
 *  - And/Or 的输出只能连到条件类叶子(Condition / ConditionTransform)。
 *  - MonitorBranch 的输入只能来自 SelectMonitor。
 *  - SelectMonitor 的输出只能连到 MonitorBranch。
 *  - MonitorBranch 的输出不能连回 SelectMonitor(避免环)。
 *  - 状态机:Root 在状态机工程下只能连 State;State 只能连 ConditionTransition/StateTransition;
 *    ConditionTransition/StateTransition 只能连 State。
 */
import { defaultRegistry, type NodeRegistry } from "./NodeRegistry.js";
import type { ProjectKind } from "../types/editor.js";

export interface ConnRuleResult {
  ok: boolean;
  reason?: string;
}

const CONDITION_LEAVES = new Set(["Condition", "ConditionTransform"]);

export function validateConnectionRule(
  parentType: string,
  childType: string,
  projectKind: ProjectKind = "behavior_tree",
  registry: NodeRegistry = defaultRegistry,
): ConnRuleResult {
  // 目标是 MonitorBranch:只能从 SelectMonitor 连入
  if (childType === "MonitorBranch" && parentType !== "SelectMonitor") {
    return { ok: false, reason: "监测分支只能从『选择监测』节点连入" };
  }

  switch (parentType) {
    case "Root":
      if (projectKind === "state_machine" && childType !== "State") {
        return { ok: false, reason: "状态机工程的根只能连到『状态』节点" };
      }
      return { ok: true };
    case "And":
    case "Or":
      if (!CONDITION_LEAVES.has(childType)) {
        return { ok: false, reason: `${parentType} 的子节点只能是条件类节点(Condition/ConditionTransform)` };
      }
      return { ok: true };
    case "SelectMonitor":
      if (childType !== "MonitorBranch") {
        return { ok: false, reason: "『选择监测』只能连到『监测分支』" };
      }
      return { ok: true };
    case "MonitorBranch":
      if (childType === "SelectMonitor") {
        return { ok: false, reason: "『监测分支』不能连回『选择监测』" };
      }
      return { ok: true };
    case "State":
      if (childType !== "ConditionTransition" && childType !== "StateTransition" && childType !== "Transition") {
        return { ok: false, reason: "『状态』后只能接『条件跳转』/『状态跳转』/『转换』" };
      }
      return { ok: true };
    case "ConditionTransition":
    case "StateTransition":
    case "Transition":
      // 转移是叶子:目标 State 走 transitionTarget 引用(Goto),不接受任何结构子边。
      return { ok: false, reason: "跳转节点的目标状态请在属性面板/画布以引用方式设置,不能作为结构子节点" };
    default:
      void registry;
      return { ok: true };
  }
}
