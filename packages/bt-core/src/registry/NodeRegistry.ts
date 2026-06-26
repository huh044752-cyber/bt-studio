/**
 * Node Registry Service(文档 §10.3.1)。
 * 节点必须先注册才能进入节点库、属性面板、校验器、导出器。
 */
import type { NodeDefinition } from "./schema.js";
import type { BTNodeKind } from "../types/runtime.js";
import { BUILTIN_NODES } from "./builtins.js";

export class NodeRegistry {
  private readonly byType = new Map<string, NodeDefinition>();
  /** 当前 FOSim 运行时支持的 kind 集合(QueryRuntimeCapabilities 注入) */
  private supportedKinds: Set<BTNodeKind> | null = null;

  constructor(defs: readonly NodeDefinition[] = BUILTIN_NODES) {
    for (const d of defs) this.register(d);
  }

  register(def: NodeDefinition): void {
    this.byType.set(def.nodeType, def);
  }

  /** QueryRuntimeCapabilities:限定可发布的 kind。null 表示不限制。 */
  setRuntimeCapabilities(kinds: BTNodeKind[] | null): void {
    this.supportedKinds = kinds ? new Set(kinds) : null;
  }

  get(nodeType: string): NodeDefinition | undefined {
    return this.byType.get(nodeType);
  }

  /** 找不到时抛错,供导出器/校验器使用。 */
  require(nodeType: string): NodeDefinition {
    const def = this.byType.get(nodeType);
    if (!def) throw new Error(`未注册的节点类型: ${nodeType}`);
    return def;
  }

  list(): NodeDefinition[] {
    return [...this.byType.values()];
  }

  /** 节点库默认显示项:fosimSupported 且(若有能力表)kind 受支持。 */
  listPublishable(): NodeDefinition[] {
    return this.list().filter((d) => this.isPublishable(d.nodeType));
  }

  listRestricted(): NodeDefinition[] {
    return this.list().filter((d) => !this.isPublishable(d.nodeType));
  }

  /** 按范式(行为树/状态机)列出可发布节点;Root 等 both 节点两边都出现。 */
  listForParadigm(kind: "behavior_tree" | "state_machine"): NodeDefinition[] {
    const want = kind === "state_machine" ? "fsm" : "bt";
    return this.listPublishable().filter((d) => {
      const p = d.paradigm ?? "bt";
      return p === "both" || p === want;
    });
  }

  isPublishable(nodeType: string): boolean {
    const def = this.byType.get(nodeType);
    if (!def) return false;
    if (!def.fosimSupported) return false;
    if (this.supportedKinds && def.runtimeKind !== "Unknown") {
      return this.supportedKinds.has(def.runtimeKind);
    }
    return true;
  }

  resolveSchema(nodeType: string) {
    return this.require(nodeType).properties;
  }

  /** 该节点是否可作为父节点连接子节点。 */
  canHaveChildren(nodeType: string): boolean {
    const def = this.byType.get(nodeType);
    return !!def && def.maxChildren > 0;
  }
}

/** 进程级默认单例(应用启动先加载内置节点表)。 */
export const defaultRegistry = new NodeRegistry();
