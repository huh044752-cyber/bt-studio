/**
 * Validation Engine(文档 §10.4 / §14)。
 * 规则取自 Node Registry;结果分 Error / Warning / Info;Error 阻断导出/运行/发布。
 * 每条结果含 nodeId / nodeType / fieldPath / message / level / source。
 */
import type { DesignTree, DesignNode, StudioMode } from "../types/editor.js";
import type { Blackboard, CatalogBundle, Issue, Variable } from "../types/catalog.js";
import type { NodeRegistry } from "../registry/NodeRegistry.js";
import { defaultRegistry } from "../registry/NodeRegistry.js";
import {
  validateMalValueConversion,
  isCompareCompatible,
  isWritebackCompatible,
  VALID_COMPARE_OPS,
  EMPTY_ALLOWED_MAL_TYPES,
} from "../mal/malMapping.js";

/**
 * 校验阶段(phase):同一条规则在不同阶段严重度不同。
 *
 * - **editing**(默认):画布编辑、复制粘贴、拖线过程中的"实时校验"。
 *   用户操作中间态里出现的"孤儿""必填未填""容量不足"是**过程正常态**,
 *   一律降级为 warning —— 用户仍能在问题面板看到黄字提示,但不会
 *   被红字轰炸(尤其粘贴子树后先落孤儿再手接父的场景)。
 * - **export**:点导出/生成 C++ 前的闸门,所有 soft 项升级为 error,
 *   保证导出物一定完整可跑。
 *
 * 硬规则(结构性错误,任何阶段都是 error):
 *   - 缺 Root / 多 Root / Root 子数量不为 1
 *   - 未注册节点类型 / 受限节点未替换
 *   - 复合/装饰节点子数量违反 min/max(拒绝了本就不合法的结构)
 *   - Parallel 阈值非法 / Subtree 引用缺失或循环 / IfElse-MonitorBranch 子数量
 *   - MAL 值转换失败(输入的常量根本不是合法字面量)
 *
 * 软规则(editing 降 warning,export 升 error):
 *   - 节点未悬挂(未连接到 Root)
 *   - 叶子节点未绑定函数 / 未选类 / 方法不存在
 *   - 必填参数未赋值
 *   - 类型不匹配(输入 malType 与方法定义不一致等)
 *   - 输出回写变量缺失 / 类型不匹配
 */
export type ValidationPhase = "editing" | "export";

export interface ValidationContext {
  mode: StudioMode;
  catalogs?: CatalogBundle;
  /** 本树可见黑板(本地 + 已链接全局),用于变量引用解析 */
  blackboards?: Blackboard[];
  registry?: NodeRegistry;
  /** 校验阶段:决定 soft 规则的严重度。缺省 editing。 */
  phase?: ValidationPhase;
}

const FUNCTION_KINDS = new Set(["Action", "Condition", "ConditionTransform", "Wait"]);

export class ValidationEngine {
  private readonly registry: NodeRegistry;

  constructor(registry: NodeRegistry = defaultRegistry) {
    this.registry = registry;
  }

  validate(tree: DesignTree, ctx: ValidationContext): Issue[] {
    const issues: Issue[] = [];
    const push = (
      level: Issue["level"],
      message: string,
      extra: Partial<Issue> = {},
    ): void => {
      issues.push({ level, message, source: "ValidationEngine", treeId: tree.treeId, ...extra });
    };
    // soft 规则的严重度:editing 降级 warning,export 升 error。
    const phase: ValidationPhase = ctx.phase ?? "editing";
    const softLevel: Issue["level"] = phase === "export" ? "error" : "warning";
    const softPush = (message: string, extra: Partial<Issue> = {}): void => {
      push(softLevel, message, extra);
    };

    const registry = ctx.registry ?? this.registry;
    const nodes = Object.values(tree.nodes);

    // --- Root 校验 ---
    const roots = nodes.filter((n) => n.nodeType === "Root");
    if (roots.length === 0) {
      push("error", "缺少 Root 节点", { source: "structure" });
    } else if (roots.length > 1) {
      push("error", `存在多个 Root(${roots.length} 个),只允许一个`, { source: "structure" });
    } else {
      const root = roots[0]!;
      if (root.childOrder.length !== 1) {
        push("error", `Root 必须且只能有 1 个子节点,当前 ${root.childOrder.length} 个`, {
          nodeId: root.nodeId,
          nodeType: "Root",
          source: "structure",
        });
      }
    }

    // --- 变量索引 ---
    const varIndex = buildVariableIndex(ctx.blackboards ?? []);

    // --- 逐节点校验 ---
    for (const node of nodes) {
      this.validateNode(node, tree, ctx, registry, varIndex, push);
    }

    // --- 孤儿(未悬挂)节点 —— **软规则** ---
    // 编辑态:粘贴子树/新拖节点尚未接父是"过程中间态",红字轰炸反而干扰;
    // 导出态:必须完整,升级 error 阻断导出。
    // 行为树:沿 childOrder 可达;状态机:还要沿转移节点的 transitionTarget 引用可达
    // (状态扁平、入口 State 为 Root 子,其余 State 经条件/状态跳转 Goto 到达)。
    const reachable = collectReachable(tree);
    for (const node of nodes) {
      if (node.nodeType === "Root") continue;
      if (!reachable.has(node.nodeId)) {
        softPush(`节点未悬挂(未连接到 Root,孤立节点)`, {
          nodeId: node.nodeId,
          nodeType: node.nodeType,
          source: "structure",
        });
      }
    }

    return issues;
  }

  private validateNode(
    node: DesignNode,
    tree: DesignTree,
    ctx: ValidationContext,
    registry: NodeRegistry,
    varIndex: Map<string, Variable>,
    push: (level: Issue["level"], message: string, extra?: Partial<Issue>) => void,
  ): void {
    const phase: ValidationPhase = ctx.phase ?? "editing";
    const softLevel: Issue["level"] = phase === "export" ? "error" : "warning";
    const softPush = (message: string, extra: Partial<Issue> = {}): void => {
      push(softLevel, message, extra);
    };
    const at = (fieldPath?: string): Partial<Issue> => ({
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      fieldPath,
    });

    // 受限节点不可发布
    if (node.restricted || !registry.isPublishable(node.nodeType)) {
      push("error", `受限/不支持节点 ${node.nodeType} 不能发布,需替换或删除`, {
        ...at(),
        source: "export-compat",
      });
      return;
    }

    const def = registry.get(node.nodeType);
    if (!def) {
      push("error", `未注册节点类型 ${node.nodeType}`, { ...at(), source: "registry" });
      return;
    }

    // 子节点数量
    const cc = node.childOrder.length;
    if (node.nodeType !== "Root") {
      if (cc < def.minChildren) {
        push("error", `${def.displayName} 至少需要 ${def.minChildren} 个子节点,当前 ${cc}`, {
          ...at("children"),
          source: "structure",
        });
      }
      if (cc > def.maxChildren) {
        push("error", `${def.displayName} 子节点不能超过 ${def.maxChildren},当前 ${cc}`, {
          ...at("children"),
          source: "structure",
        });
      }
    }

    // 函数绑定(Action/Condition/ConditionTransform/Wait/State/ConditionTransition):
    // Condition 已收敛为叶子节点(对齐 C++ 新引擎 bt_xml_loader:Condition 必须叶子;vue2 nodeConfig 也归入 condition 叶子类)。
    // **全部走 softPush**:editing 阶段用户可能边拖边配,红字过早出现干扰;export 时才升 error。
    if (FUNCTION_KINDS.has(node.nodeType)) {
      const bound = node.functionRef && node.functionRef.trim();
      if (!bound) {
        softPush(`${def.displayName} 未绑定函数`, {
          ...at("functionRef"),
          source: "binding",
        });
      }
      // 模型校验:有函数目录时,(类, 方法) 必须真实存在(R3)
      const fns = ctx.catalogs?.functionCatalog.functions ?? [];
      if (fns.length > 0 && node.functionRef && node.functionRef.trim()) {
        const cls = node.targetSelector?.modelClass ?? "";
        const matched = fns.find(
          (f) => f.name === node.functionRef && (!cls || (f.ownerClass ?? f.bindingTarget.split(".")[0]) === cls),
        );
        if (!cls) {
          softPush(`${def.displayName} 未选择类(className)`, { ...at("targetSelector.modelClass"), source: "binding" });
        } else if (!matched) {
          softPush(`方法 ${node.functionRef} 不存在于类 ${cls}(模型校验失败)`, { ...at("functionRef"), source: "binding" });
        } else {
          // 必填参数齐全性:输入绑定应覆盖必填输入参数
          const requiredInputs = matched.params.filter((p) => p.direction !== "output" && p.required);
          for (const rp of requiredInputs) {
            const ib = node.inputBindings.find((b) => b.name === rp.name);
            // 文本类(string/name/address)空串是合法值,视为已赋值;数值/引用类空值才算未赋值。
            const mal = ib?.malType ?? rp.malType;
            const emptyOk = !!mal && EMPTY_ALLOWED_MAL_TYPES.has(mal);
            const hasVal =
              ib &&
              ((ib.source === "blackboard" && ib.variableId) ||
                (ib.source !== "blackboard" && (emptyOk || (ib.value ?? "").trim() !== "")));
            if (!hasVal) {
              // 必填参数未完整输入 —— soft:editing 提示,export 阻断
              softPush(`必填参数 ${rp.name} 未赋值(参数未完整输入)`, { ...at(`inputBindings.${rp.name}`), source: "binding" });
            }
          }
          // 参数类型校验:每个输入/输出绑定的 displayType/malType 与方法参数定义一致(不一致为 soft)。
          for (const bp of matched.params) {
            const ib = node.inputBindings.find((b) => b.name === bp.name);
            if (ib && ib.malType && bp.malType && ib.malType !== bp.malType) {
              softPush(`输入参数 ${bp.name} 类型不匹配:节点绑 ${ib.malType},方法定义 ${bp.malType}`, { ...at(`inputBindings.${bp.name}`), source: "binding" });
            }
            if (ib && ib.displayType && bp.displayType && ib.displayType !== bp.displayType) {
              push("warning", `输入参数 ${bp.name} displayType 不匹配:节点 ${ib.displayType},方法 ${bp.displayType}`, { ...at(`inputBindings.${bp.name}`), source: "binding" });
            }
            // 常量输入即时 MAL 值转换校验:**硬规则** —— 用户已经填了值但填的是垃圾,任何阶段都要红字。
            if (ib && ib.source !== "blackboard") {
              const mal = ib.malType ?? bp.malType;
              const val = ib.value ?? "";
              if (mal && val.trim() !== "") {
                const conv = validateMalValueConversion(val, mal, ib.valueFormat ?? bp.valueFormat ?? "literal");
                if (!conv.ok) {
                  push("error", `输入参数 ${bp.name} 取值非法:${conv.message}`, { ...at(`inputBindings.${bp.name}`), source: "mal" });
                }
              }
            }
          }
          // 输出方向校验 + 回写类型相容:输出绑定只能对应 output 参数,且回写黑板变量类型必须一致。
          for (const ob of node.outputBindings) {
            const mp = matched.params.find((p) => p.name === ob.name);
            if (!mp) {
              push("warning", `输出绑定 ${ob.name} 不在方法参数列表中`, { ...at(`outputBindings.${ob.name}`), source: "binding" });
            } else if (mp.direction !== "output") {
              softPush(`输出绑定 ${ob.name} 的方法参数方向为 "${mp.direction}"(应为 output)`, { ...at(`outputBindings.${ob.name}`), source: "binding" });
            }
            // 选了回写变量(variableId 非空)才校验类型;留空表示「不回写」,输出仍走原 MAL 数据,合法。
            if (mp && ob.variableId) {
              const tv = varIndex.get(ob.variableId);
              if (tv && !isWritebackCompatible(mp.malType, tv.malType, mp.displayType, tv.displayType)) {
                softPush(`输出 ${ob.name} 回写类型不匹配:方法输出 ${mp.malType ?? mp.displayType},变量 ${tv.name} 为 ${tv.malType ?? tv.displayType}(类型对应才能回写)`, { ...at(`outputBindings.${ob.name}`), source: "binding" });
              }
            }
          }
        }
      }
    }

    // Parallel 阈值
    if (node.nodeType === "Parallel") {
      const s = node.parallelSuccessThreshold;
      const f = node.parallelFailureThreshold;
      if (!s || s < 1) push("error", "Parallel 成功阈值非法(需 ≥1)", { ...at("parallelSuccessThreshold"), source: "structure" });
      if (!f || f < 1) push("error", "Parallel 失败阈值非法(需 ≥1)", { ...at("parallelFailureThreshold"), source: "structure" });
    }

    // Subtree 引用
    if (node.nodeType === "Subtree") {
      const ref = node.subtreeRef?.trim();
      if (!ref) {
        push("error", "Subtree 未设置子树引用", { ...at("subtreeRef"), source: "binding" });
      } else if (!tree.referencedTreeIds.includes(ref)) {
        push("error", `Subtree 引用 ${ref} 缺失(未在 referencedTreeIds 中)`, {
          ...at("subtreeRef"),
          source: "subtree",
        });
      }
      // 循环引用:引用自身
      if (ref && ref === tree.treeId) {
        push("error", "Subtree 不能引用自身", { ...at("subtreeRef"), source: "subtree" });
      }
    }

    // Condition 比较语义
    if (node.nodeType === "Condition" && node.compareType === "Output") {
      if (!node.compareOutputName?.trim()) {
        push("error", "比较模式=Output 时 compareOutputName 不能为空", {
          ...at("compareOutputName"),
          source: "binding",
        });
      }
      const op = (node.compareOp ?? "").toLowerCase();
      if (!VALID_COMPARE_OPS.includes(op as never)) {
        push("error", `比较运算非法: "${node.compareOp}"(允许 ${VALID_COMPARE_OPS.join("/")})`, {
          ...at("compareOp"),
          source: "binding",
        });
      }
      // 比较值 MAL 转换:用绑定字段或输出变量的 malType(若可解析)
      if (node.compareValue !== undefined && node.compareValue !== "") {
        // 比较字段类型:尝试从 output 绑定解析
        const outVar = node.compareOutputName
          ? resolveOutputVar(node, node.compareOutputName, varIndex)
          : undefined;
        if (outVar?.malType) {
          const conv = validateMalValueConversion(node.compareValue, outVar.malType);
          if (!conv.ok) {
            push("error", `比较值无法转换为 ${outVar.malType}: ${conv.message}`, {
              ...at("compareValue"),
              source: "mal",
            });
          }
          if (!isCompareCompatible(outVar.malType, op)) {
            push("warning", `比较运算 ${op} 与字段类型 ${outVar.malType} 可能不兼容`, {
              ...at("compareOp"),
              source: "mal",
            });
          }
        }
      }
    }

    // 输入绑定 MAL 校验
    for (const [i, inb] of node.inputBindings.entries()) {
      const fp = `inputBindings[${i}]`;
      if (inb.source === "blackboard") {
        const v = inb.variableId ? varIndex.get(inb.variableId) : undefined;
        if (!v) {
          push("error", `输入 ${inb.name} 绑定的黑板变量缺失`, {
            ...at(fp),
            source: "blackboard",
          });
        } else if (ctx.mode === "linked_fosim" && !v.malType) {
          push("error", `Linked FOSim:变量 ${v.name} 缺少 malType,不能发布`, {
            ...at(fp),
            source: "mal",
          });
        } else if (inb.malType && v.malType && inb.malType !== v.malType) {
          push("warning", `输入 ${inb.name} 期望 ${inb.malType} 但变量为 ${v.malType}`, {
            ...at(fp),
            source: "mal",
          });
        }
      } else {
        // 常量:MAL 值转换
        if (inb.malType) {
          const conv = validateMalValueConversion(inb.value, inb.malType, inb.valueFormat);
          if (!conv.ok) {
            push("error", `输入 ${inb.name} 常量无法转换为 ${inb.malType}: ${conv.message}`, {
              ...at(fp),
              source: "mal",
            });
          }
        } else if (ctx.mode === "linked_fosim") {
          push("error", `Linked FOSim:输入 ${inb.name} 缺少 malType`, { ...at(fp), source: "mal" });
        }
      }
    }

    // 输出回写变量存在性:仅当用户选了回写(variableId 非空)才校验;不回写则输出留在原 MAL 数据,合法。
    for (const [i, outb] of node.outputBindings.entries()) {
      if (!outb.variableId) continue;
      const fp = `outputBindings[${i}]`;
      const v = varIndex.get(outb.variableId);
      if (!v) {
        push("error", `输出 ${outb.name} 回写的黑板变量缺失`, { ...at(fp), source: "blackboard" });
      } else if (ctx.mode === "linked_fosim" && !v.malType) {
        push("error", `Linked FOSim:输出变量 ${v.name} 缺少 malType`, { ...at(fp), source: "mal" });
      }
    }
  }

  /** 是否存在阻断级错误。 */
  hasBlockingErrors(issues: Issue[]): boolean {
    return issues.some((i) => i.level === "error");
  }
}

function buildVariableIndex(blackboards: Blackboard[]): Map<string, Variable> {
  const map = new Map<string, Variable>();
  for (const bb of blackboards) {
    for (const v of bb.variables) map.set(v.variableId, v);
  }
  return map;
}

function resolveOutputVar(
  node: DesignNode,
  outputName: string,
  varIndex: Map<string, Variable>,
): Variable | undefined {
  const ob = node.outputBindings.find((o) => o.name === outputName);
  if (ob?.variableId) return varIndex.get(ob.variableId);
  return undefined;
}

function collectReachable(tree: DesignTree): Set<string> {
  const reachable = new Set<string>();
  if (!tree.rootNodeId) return reachable;
  const stack = [tree.rootNodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = tree.nodes[id];
    if (!node) continue;
    for (const c of node.childOrder) stack.push(c);
    // 状态机:转移节点的目标状态经 transitionTarget 引用可达(Goto),非结构子边。
    if (node.transitionTarget && tree.nodes[node.transitionTarget]) {
      stack.push(node.transitionTarget);
    }
  }
  return reachable;
}

export const defaultValidationEngine = new ValidationEngine();
