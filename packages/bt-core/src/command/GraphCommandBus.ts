/**
 * Graph Command Bus(文档 §10.3.2)。
 * Execute / Undo / Redo / CanExecute / PreviewImpact / GetDirtyState / GetAffectedNodes。
 *
 * 实现策略:每次 execute 前对 tree 做结构化快照入 undo 栈,保证撤销重做绝对正确。
 */
import type { DesignTree, DesignNode } from "../types/editor.js";
import type { NodeRegistry } from "../registry/NodeRegistry.js";
import { defaultRegistry } from "../registry/NodeRegistry.js";
import { createNode, createEdge } from "../model/factory.js";
import { nowIso } from "../model/ids.js";
import { validateConnectionRule } from "../registry/connectionRules.js";
import type { GraphCommand, CommandResult } from "./commands.js";

/**
 * 深拷贝设计树用于撤销/重做快照。
 * 不能用 structuredClone:tree 在 Pinia 中是 Vue 响应式 Proxy,structuredClone 会抛
 * DataCloneError("could not be cloned")。tree 是纯可序列化数据,用 JSON 往返即可。
 */
function cloneTree(tree: DesignTree): DesignTree {
  return JSON.parse(JSON.stringify(tree)) as DesignTree;
}

export class GraphCommandBus {
  private tree: DesignTree;
  private readonly registry: NodeRegistry;
  private undoStack: DesignTree[] = [];
  private redoStack: DesignTree[] = [];
  private dirty = false;

  constructor(tree: DesignTree, registry: NodeRegistry = defaultRegistry) {
    this.tree = tree;
    this.registry = registry;
  }

  getTree(): DesignTree {
    return this.tree;
  }

  getDirtyState(): boolean {
    return this.dirty;
  }

  markSaved(): void {
    this.dirty = false;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // --- 查询辅助 ---

  private parentOf(nodeId: string): string | undefined {
    for (const e of Object.values(this.tree.edges)) {
      if (e.targetNodeId === nodeId) return e.sourceNodeId;
    }
    return undefined;
  }

  private childrenOf(nodeId: string): string[] {
    const node = this.tree.nodes[nodeId];
    return node ? [...node.childOrder] : [];
  }

  private findEdgeId(parentId: string, childId: string): string | undefined {
    for (const e of Object.values(this.tree.edges)) {
      if (e.sourceNodeId === parentId && e.targetNodeId === childId) return e.edgeId;
    }
    return undefined;
  }

  /** child 是否为 parent 的祖先(用于循环检测)。 */
  private isAncestor(maybeAncestor: string, nodeId: string): boolean {
    let cur = this.parentOf(nodeId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === maybeAncestor) return true;
      seen.add(cur);
      cur = this.parentOf(cur);
    }
    return false;
  }

  getAffectedNodes(cmd: GraphCommand): string[] {
    switch (cmd.kind) {
      case "AddNode":
        return cmd.parentNodeId ? [cmd.parentNodeId] : [];
      case "DeleteNode":
        return [cmd.nodeId, ...this.childrenOf(cmd.nodeId)];
      case "ConnectNodes":
      case "DisconnectNodes":
        return [cmd.parentNodeId, cmd.childNodeId];
      case "ReorderChildren":
        return [cmd.parentNodeId];
      default:
        return [(cmd as { nodeId?: string }).nodeId ?? ""].filter(Boolean);
    }
  }

  /** 前置校验(precheck)。返回不可执行原因。 */
  canExecute(cmd: GraphCommand): CommandResult {
    const fail = (reason: string): CommandResult => ({
      ok: false,
      reason,
      affectedNodeIds: this.getAffectedNodes(cmd),
    });
    switch (cmd.kind) {
      case "AddNode": {
        if (!this.registry.isPublishable(cmd.nodeType)) {
          return fail(`节点类型 ${cmd.nodeType} 不可发布(受限/不支持),不能创建`);
        }
        if (cmd.nodeType === "Root" && this.tree.rootNodeId) {
          return fail("已存在 Root,不能再添加 Root");
        }
        if (cmd.parentNodeId) {
          const c = this.canExecute({
            kind: "ConnectNodes",
            parentNodeId: cmd.parentNodeId,
            childNodeId: "__pending__",
          });
          // __pending__ 不存在,这里只检查父节点容量
          const parent = this.tree.nodes[cmd.parentNodeId];
          if (!parent) return fail("父节点不存在");
          if (!this.registry.canHaveChildren(parent.nodeType)) {
            return fail(`${parent.nodeType} 不能作为父节点连接子节点`);
          }
          void c;
        }
        return { ok: true, affectedNodeIds: this.getAffectedNodes(cmd) };
      }
      case "DeleteNode": {
        const node = this.tree.nodes[cmd.nodeId];
        if (!node) return fail("节点不存在");
        // 允许删除 Root(应用侧的清理:rootNodeId 会被 apply 里清空)。
        return { ok: true, affectedNodeIds: this.getAffectedNodes(cmd) };
      }
      case "ConnectNodes": {
        const parent = this.tree.nodes[cmd.parentNodeId];
        const child = this.tree.nodes[cmd.childNodeId];
        if (!parent) return fail("父节点不存在");
        if (cmd.childNodeId !== "__pending__" && !child) return fail("子节点不存在");
        if (cmd.parentNodeId === cmd.childNodeId) return fail("不能连接自身");
        if (!this.registry.canHaveChildren(parent.nodeType)) {
          return fail(`${parent.nodeType} 不能作为父节点连接子节点`);
        }
        const def = this.registry.require(parent.nodeType);
        if (parent.childOrder.length >= def.maxChildren) {
          return fail(`${parent.nodeType} 子节点已达上限 ${def.maxChildren}`);
        }
        if (cmd.childNodeId !== "__pending__") {
          if (this.parentOf(cmd.childNodeId)) {
            return fail("子节点输入端口已被占用(已有父节点)");
          }
          if (
            cmd.childNodeId === cmd.parentNodeId ||
            this.isAncestor(cmd.childNodeId, cmd.parentNodeId)
          ) {
            return fail("连接会形成循环");
          }
          // 按节点类型的连接规则(And/Or 只接条件、State 只接跳转、监测分支等)
          const rule = validateConnectionRule(
            parent.nodeType,
            child!.nodeType,
            this.tree.projectKind ?? "behavior_tree",
            this.registry,
          );
          if (!rule.ok) return fail(rule.reason ?? "连接不符合节点类型规则");
        }
        return { ok: true, affectedNodeIds: this.getAffectedNodes(cmd) };
      }
      case "DisconnectNodes": {
        if (!this.findEdgeId(cmd.parentNodeId, cmd.childNodeId)) return fail("连线不存在");
        return { ok: true, affectedNodeIds: this.getAffectedNodes(cmd) };
      }
      default: {
        const nodeId = (cmd as { nodeId?: string }).nodeId;
        if (nodeId && !this.tree.nodes[nodeId]) return fail("节点不存在");
        return { ok: true, affectedNodeIds: this.getAffectedNodes(cmd) };
      }
    }
  }

  previewImpact(cmd: GraphCommand): string[] {
    return this.getAffectedNodes(cmd);
  }

  execute(cmd: GraphCommand): CommandResult {
    const pre = this.canExecute(cmd);
    if (!pre.ok) return pre;

    const snapshot = cloneTree(this.tree);
    let result: CommandResult = { ok: true, affectedNodeIds: this.getAffectedNodes(cmd) };

    try {
      result = this.apply(cmd) ?? result;
    } catch (err) {
      this.tree = snapshot; // 回滚
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        affectedNodeIds: this.getAffectedNodes(cmd),
      };
    }

    this.undoStack.push(snapshot);
    this.redoStack = [];
    this.dirty = true;
    this.tree.updatedAt = nowIso();
    return result;
  }

  private apply(cmd: GraphCommand): CommandResult | undefined {
    switch (cmd.kind) {
      case "AddNode": {
        const node = createNode(cmd.nodeType, cmd.name ?? this.registry.require(cmd.nodeType).displayName, {
          x: cmd.x,
          y: cmd.y,
        } as Partial<DesignNode>);
        // 注入注册表字段默认值(防止拖拽即报校验错误:Parallel 阈值、loopCount 等)。
        if (!cmd.init) {
          const def = this.registry.get(cmd.nodeType);
          const n = node as unknown as Record<string, unknown>;
          for (const p of def?.properties ?? []) {
            if (p.default !== undefined && n[p.propName] === undefined) n[p.propName] = p.default;
          }
        }
        // 复制粘贴:合并属性快照(保留新生成的 nodeId / childOrder / 布局)。
        if (cmd.init) {
          const { nodeId: _i, childOrder: _c, parentId: _p, ...rest } = cmd.init as Record<string, unknown>;
          Object.assign(node, rest);
        }
        this.tree.nodes[node.nodeId] = node;
        this.tree.editorMeta.nodeLayouts.push({
          nodeId: node.nodeId,
          x: cmd.x ?? 200,
          y: cmd.y ?? 200,
          width: 160,
          height: 54,
        });
        if (cmd.nodeType === "Root") this.tree.rootNodeId = node.nodeId;
        if (cmd.parentNodeId) {
          this.connect(cmd.parentNodeId, node.nodeId);
        }
        return { ok: true, affectedNodeIds: [node.nodeId], createdNodeId: node.nodeId };
      }
      case "DeleteNode": {
        this.deleteSubtree(cmd.nodeId);
        return { ok: true, affectedNodeIds: [cmd.nodeId] };
      }
      case "MoveNode": {
        const layout = this.tree.editorMeta.nodeLayouts.find((l) => l.nodeId === cmd.nodeId);
        if (layout) {
          layout.x = cmd.x;
          layout.y = cmd.y;
        }
        return { ok: true, affectedNodeIds: [cmd.nodeId] };
      }
      case "ConnectNodes": {
        this.connect(cmd.parentNodeId, cmd.childNodeId, cmd.order);
        return { ok: true, affectedNodeIds: [cmd.parentNodeId, cmd.childNodeId] };
      }
      case "DisconnectNodes": {
        this.disconnect(cmd.parentNodeId, cmd.childNodeId);
        return { ok: true, affectedNodeIds: [cmd.parentNodeId, cmd.childNodeId] };
      }
      case "ReorderChildren": {
        const parent = this.tree.nodes[cmd.parentNodeId];
        if (parent) parent.childOrder = [...cmd.childOrder];
        return { ok: true, affectedNodeIds: [cmd.parentNodeId] };
      }
      case "UpdateNodeProperty": {
        const node = this.tree.nodes[cmd.nodeId];
        if (node) Object.assign(node, cmd.patch);
        return { ok: true, affectedNodeIds: [cmd.nodeId] };
      }
      case "BindFunction": {
        const node = this.tree.nodes[cmd.nodeId];
        if (node) {
          node.functionRef = cmd.functionRef;
          if (cmd.inputBindings) node.inputBindings = cmd.inputBindings;
          if (cmd.outputBindings) node.outputBindings = cmd.outputBindings;
        }
        return { ok: true, affectedNodeIds: [cmd.nodeId] };
      }
      case "BindVariable": {
        const node = this.tree.nodes[cmd.nodeId];
        if (node) {
          if (cmd.direction === "input") {
            node.inputBindings = [
              ...node.inputBindings.filter((b) => b.name !== (cmd.binding as { name: string }).name),
              cmd.binding as never,
            ];
          } else {
            node.outputBindings = [
              ...node.outputBindings.filter((b) => b.name !== (cmd.binding as { name: string }).name),
              cmd.binding as never,
            ];
          }
        }
        return { ok: true, affectedNodeIds: [cmd.nodeId] };
      }
      case "SetSubtreeRef": {
        const node = this.tree.nodes[cmd.nodeId];
        if (node) node.subtreeRef = cmd.subtreeRef;
        return { ok: true, affectedNodeIds: [cmd.nodeId] };
      }
    }
  }

  private connect(parentId: string, childId: string, order?: number): void {
    const parent = this.tree.nodes[parentId];
    if (!parent) return;
    const ord = order ?? parent.childOrder.length;
    const edge = createEdge(parentId, childId, ord);
    this.tree.edges[edge.edgeId] = edge;
    if (!parent.childOrder.includes(childId)) {
      parent.childOrder.splice(ord, 0, childId);
    }
  }

  private disconnect(parentId: string, childId: string): void {
    const edgeId = this.findEdgeId(parentId, childId);
    if (edgeId) delete this.tree.edges[edgeId];
    const parent = this.tree.nodes[parentId];
    if (parent) parent.childOrder = parent.childOrder.filter((c) => c !== childId);
  }

  private deleteSubtree(nodeId: string): void {
    // 先断开与父的连接
    const parentId = this.parentOf(nodeId);
    if (parentId) this.disconnect(parentId, nodeId);
    // 递归删除子树
    const stack = [nodeId];
    const toDelete = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (toDelete.has(id)) continue;
      toDelete.add(id);
      for (const c of this.childrenOf(id)) stack.push(c);
    }
    for (const id of toDelete) {
      // 删除关联边
      for (const e of Object.values(this.tree.edges)) {
        if (e.sourceNodeId === id || e.targetNodeId === id) delete this.tree.edges[e.edgeId];
      }
      delete this.tree.nodes[id];
      this.tree.editorMeta.nodeLayouts = this.tree.editorMeta.nodeLayouts.filter(
        (l) => l.nodeId !== id,
      );
      // 删的是 Root → 清 rootNodeId,树进入"无根"状态(用户可再拖新 Root/Sequence)。
      if (this.tree.rootNodeId === id) this.tree.rootNodeId = "";
    }
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneTree(this.tree));
    this.tree = prev;
    this.dirty = true;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneTree(this.tree));
    this.tree = next;
    this.dirty = true;
    return true;
  }
}
