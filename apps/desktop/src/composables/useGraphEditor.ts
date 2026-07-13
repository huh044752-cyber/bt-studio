/**
 * X6 画布生命周期 + 事件绑定(文档 §5.14 / 6.4.0)。
 * 所有结构变更都转成 Graph Command(经 workspace store),不直接改 store。
 *
 * 关键(修复"拖拽复制节点"):sync() 采用增量 diff(对比 tree 与画布现有 cell,
 * 新增/删除/更新属性),不再 clearCells() 全量重建;选择态变化只更新 cell 属性,不重建。
 */
import { shallowRef } from "vue";
import type { Graph as X6Graph } from "@antv/x6";
import { defaultRegistry, type DesignTree } from "@btstudio/bt-core";
import type { useWorkspaceStore } from "@/stores/workspace";
import { describeNode } from "@/utils/nodeInfo";

const COLOR: Record<string, string> = {
  accent: "#4c8dff",
  "accent-2": "#d29922",
  ok: "#3fb950",
  warn: "#d29922",
  err: "#f85149",
  muted: "#7d8590",
};

/** 右键菜单需要的页面级动作。DesignPage 通过 setMenuActions 注入。 */
export interface EditorMenuActions {
  copy: () => void;
  paste: () => void;
  duplicate: (nodeId: string) => void;
  validate: () => void;
  hasClipboard: () => boolean;
}

const nodeCellId = (id: string) => `ncell_${id}`;
const edgeCellId = (id: string) => `ecell_${id}`;
// FSM 转移目标的合成"Goto"虚线边(非结构边,源自 transitionTarget 引用)。
const gotoCellId = (srcNodeId: string) => `goto_${srcNodeId}`;
const TRANSITION_TYPES = new Set(["ConditionTransition", "StateTransition", "Transition"]);

/** 查一个节点的父(结构边),没有 → null。 */
function findParentOf(tree: DesignTree, childId: string): string | null {
  for (const e of Object.values(tree.edges)) {
    if (e.targetNodeId === childId) return e.sourceNodeId;
  }
  return null;
}

export function useGraphEditor(ws: ReturnType<typeof useWorkspaceStore>) {
  const graphRef = shallowRef<X6Graph | null>(null);
  // 程序化变更窗口:期间忽略 X6 派发的结构事件,避免回环触发命令。
  let syncing = false;
  const beginProgrammatic = () => {
    syncing = true;
  };
  const endProgrammatic = () => {
    // 异步解锁,吸收 X6 异步派发的事件。
    queueMicrotask(() => {
      syncing = false;
    });
  };

  // 渐变缓存:key=`from|to` → X6 gradient id。
  const gradCache = new Map<string, string>();
  function ensureGradient(from: string, to: string): string | null {
    const graph = graphRef.value as unknown as {
      defineGradient?: (o: unknown) => string;
    } | null;
    if (!graph?.defineGradient) return null;
    const key = `${from}|${to}`;
    let id = gradCache.get(key);
    if (!id) {
      id = graph.defineGradient({
        type: "linearGradient",
        attrs: { x1: "0%", y1: "0%", x2: "0%", y2: "100%" },
        stops: [
          { offset: "0%", color: from },
          { offset: "100%", color: to },
        ],
      });
      gradCache.set(key, id);
    }
    return id;
  }

  function nodeStroke(node: { nodeType: string; restricted?: boolean }): string {
    if (node.restricted) return COLOR.err!;
    const def = defaultRegistry.get(node.nodeType);
    return def?.color ?? COLOR[def?.colorToken ?? "accent"] ?? COLOR.accent!;
  }

  function bodyAttrs(node: { nodeId: string; nodeType: string; restricted?: boolean }) {
    const isError = ws.issues.some((i) => i.nodeId === node.nodeId && i.level === "error");
    const selected = ws.selectedNodeId === node.nodeId;
    const def = defaultRegistry.get(node.nodeType);
    let fill = "#16233488";
    if (def?.gradient && !node.restricted) {
      const gid = ensureGradient(def.gradient[0], def.gradient[1]);
      if (gid) fill = `url(#${gid})`;
    }
    return {
      fill,
      stroke: isError ? COLOR.err : selected ? "#ffffff" : nodeStroke(node),
      strokeWidth: isError || selected ? 2.5 : 1.6,
      rx: 9,
      ry: 9,
    };
  }

  function shapeOf(nodeType: string): { shape: string; extra: Record<string, unknown> } {
    const def = defaultRegistry.get(nodeType);
    if (def?.shape === "ellipse") return { shape: "ellipse", extra: {} };
    if (def?.shape === "polygon") {
      // 菱形(diamond):四个相对顶点
      return { shape: "polygon", extra: { refPoints: "0,0.5 0.5,0 1,0.5 0.5,1" } };
    }
    return { shape: "rect", extra: {} };
  }

  // --- 悬停提示(DOM 浮层)---
  let tipEl: HTMLDivElement | null = null;
  function ensureTip(): HTMLDivElement {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "x6-node-tooltip";
      Object.assign(tipEl.style, {
        position: "fixed",
        zIndex: "9999",
        maxWidth: "320px",
        padding: "10px 12px",
        borderRadius: "8px",
        background: "#1a1f27",
        border: "1px solid rgba(148,163,184,0.20)",
        color: "#e6edf3",
        font: "12px/1.55 -apple-system, 'Segoe UI', system-ui, sans-serif",
        boxShadow: "0 12px 32px rgba(0,0,0,0.42)",
        pointerEvents: "none",
        whiteSpace: "normal",
        display: "none",
      } as CSSStyleDeclaration);
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function tooltipHtml(nodeId: string): string {
    const tree = ws.currentTree;
    const n = tree?.nodes[nodeId];
    if (!n) return "";
    // 统一数据源:与属性面板共用 describeNode(行为树 / 状态机一致)。
    const info = describeNode(n, tree, ws.functionCatalog);
    const rows: string[] = [];
    rows.push(`<div style="font-weight:600;color:#fff">${escapeHtml(info.typeName)} · ${escapeHtml(info.name)}</div>`);
    if (info.typeDesc) rows.push(`<div style="color:#9fb3c8;margin-top:3px">${escapeHtml(info.typeDesc)}</div>`);
    if (info.className) rows.push(`<div style="margin-top:4px">类:<b>${escapeHtml(info.className)}</b></div>`);
    if (info.method) {
      rows.push(`<div>方法:<b>${escapeHtml(info.method)}</b>${info.methodDesc ? ` — ${escapeHtml(info.methodDesc)}` : ""}</div>`);
    }
    if (info.params.length) {
      const ps = info.params
        .map((p) => `<div style="color:#9fb3c8">· ${escapeHtml(p.name)} <span style="color:#6f8598">${escapeHtml(p.type)}</span>${p.dir === "output" ? " (出)" : ""}${p.required ? ' <span style="color:#f06d6d">*</span>' : ""}</div>`)
        .join("");
      rows.push(`<div style="margin-top:4px">参数:${ps}</div>`);
    }
    if (info.judgment) rows.push(`<div style="margin-top:4px">判断:<b style="color:#ffd479">${escapeHtml(info.judgment)}</b></div>`);
    if (info.targetState) rows.push(`<div style="margin-top:4px">→ 目标状态:<b>${escapeHtml(info.targetState)}</b></div>`);
    if (info.endState) rows.push(`<div style="margin-top:4px;color:#47d6a4">结束态</div>`);
    if (info.comment) rows.push(`<div style="color:#9fb3c8;margin-top:4px">注释:${escapeHtml(info.comment)}</div>`);
    return rows.join("");
  }
  function showTooltip(html: string, x: number, y: number): void {
    const el = ensureTip();
    el.innerHTML = html;
    el.style.display = "block";
    moveTooltip(x, y);
  }
  function moveTooltip(x: number, y: number): void {
    if (!tipEl || tipEl.style.display === "none") return;
    const pad = 14;
    let left = x + pad;
    let top = y + pad;
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    if (left + w > window.innerWidth) left = x - w - pad;
    if (top + h > window.innerHeight) top = y - h - pad;
    tipEl.style.left = `${Math.max(4, left)}px`;
    tipEl.style.top = `${Math.max(4, top)}px`;
  }
  function hideTooltip(): void {
    if (tipEl) tipEl.style.display = "none";
  }

  // --- 右键菜单(DOM 浮层)---
  //
  // 菜单分两种上下文:
  //   1. 节点右键 `showNodeMenu(nodeId, x, y)` —— 对特定节点的动作(复制/克隆/删/断线/居中…)
  //   2. 空白右键 `showBlankMenu(x, y)`         —— 画布级动作(粘贴/撤销/重做/适配/布局/校验)
  // 菜单依赖外部动作(比如 copy 需要读画布视口中心),但 useGraphEditor 不知道 DesignPage 里
  // 的复制/粘贴/校验实现。为了避免耦合上层,通过 `setMenuActions()` 注入回调 —— DesignPage
  // 在 onMounted 后把 copy/paste/duplicate/validate 塞进来。菜单在 show 时按当前 actions 组建条目。
  let menuEl: HTMLDivElement | null = null;
  let actions: EditorMenuActions | null = null;
  function setMenuActions(a: EditorMenuActions): void {
    actions = a;
  }

  function ensureMenu(): HTMLDivElement {
    if (!menuEl) {
      menuEl = document.createElement("div");
      menuEl.className = "x6-node-menu";
      Object.assign(menuEl.style, {
        position: "fixed",
        zIndex: "10000",
        minWidth: "180px",
        padding: "4px",
        borderRadius: "8px",
        background: "#1a1f27",
        border: "1px solid rgba(148,163,184,0.20)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.42)",
        font: "12.5px/1.4 -apple-system, 'Segoe UI', system-ui, sans-serif",
        display: "none",
      } as CSSStyleDeclaration);
      document.body.appendChild(menuEl);
    }
    return menuEl;
  }
  function hideMenu(): void {
    if (menuEl) menuEl.style.display = "none";
  }
  function menuItem(
    label: string,
    onClick: () => void,
    opts: { danger?: boolean; disabled?: boolean; hint?: string } = {},
  ): HTMLDivElement {
    const it = document.createElement("div");
    // hint(如快捷键)灰色右侧对齐 —— 用 flex 布局
    const left = document.createElement("span");
    left.textContent = label;
    it.appendChild(left);
    if (opts.hint) {
      const right = document.createElement("span");
      right.textContent = opts.hint;
      Object.assign(right.style, {
        marginLeft: "auto",
        color: "#6f8598",
        fontSize: "11px",
        letterSpacing: "0.3px",
      } as CSSStyleDeclaration);
      it.appendChild(right);
    }
    Object.assign(it.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "6px 10px",
      borderRadius: "6px",
      cursor: opts.disabled ? "not-allowed" : "pointer",
      color: opts.disabled ? "#4a5568" : opts.danger ? "#ff8a8a" : "#dfe9f5",
      whiteSpace: "nowrap",
      opacity: opts.disabled ? "0.55" : "1",
    } as CSSStyleDeclaration);
    if (!opts.disabled) {
      it.addEventListener("mouseenter", () => (it.style.background = "rgba(76,141,255,0.12)"));
      it.addEventListener("mouseleave", () => (it.style.background = "transparent"));
      it.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        hideMenu();
        onClick();
      });
    }
    return it;
  }
  /** 分隔线 —— 语义分组。 */
  function menuSep(): HTMLDivElement {
    const s = document.createElement("div");
    Object.assign(s.style, {
      height: "1px",
      margin: "4px 6px",
      background: "rgba(148,163,184,0.14)",
    } as CSSStyleDeclaration);
    return s;
  }
  /**
   * 定位菜单到 (x,y),做视口边界纠正。传入前先 display=block + 归零,才能拿到真实宽高。
   */
  function positionMenu(el: HTMLDivElement, x: number, y: number): void {
    el.style.display = "block";
    el.style.left = "0px";
    el.style.top = "0px";
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
  }

  /**
   * "删单节点 · 保留子" —— 把子节点提升到该节点的父下,再删该节点。
   * 常见场景:临时插了个 Sequence 后想抽掉,让原来那批子直接挂原父。
   * 失败降级:若父容量不足(接不下所有子),不动手,提示用户手动整理再试。
   * Root 不允许(Root 是入口,提子等于让原 Root 消失)。
   */
  function deleteNodeKeepChildren(nodeId: string): void {
    const tree = ws.currentTree;
    const n = tree?.nodes[nodeId];
    if (!tree || !n) return;
    if (n.nodeType === "Root") {
      console.warn("[design] Root 不支持保留子的删除,用整树删除代替");
      return;
    }
    const parentId = findParentOf(tree, nodeId);
    if (!parentId) {
      console.warn("[design] 该节点没有父,无法'保留子'删除;请用整树删除");
      return;
    }
    const parent = tree.nodes[parentId];
    if (!parent) return;
    const children = [...n.childOrder];
    // 预检:父可用容量 = maxChildren - 现有子(减 1,因为该节点本身会被从父下摘掉)
    const def = defaultRegistry.get(parent.nodeType);
    const capacity = (def?.maxChildren ?? 64) - (parent.childOrder.length - 1);
    if (children.length > capacity) {
      console.warn(`[design] 父 ${parent.nodeType} 容量不足(需 ${children.length},剩 ${capacity})`);
      return;
    }
    // 组批命令:先把每个子从旧父(=该节点)断开、接到新父;再断该节点自己;最后删。
    // 用命令队列一次提交(store.runBatch),画布只 sync 一次。
    const cmds: import("@btstudio/bt-core").GraphCommand[] = [];
    for (const cid of children) {
      cmds.push({ kind: "DisconnectNodes", parentNodeId: nodeId, childNodeId: cid });
      cmds.push({ kind: "ConnectNodes", parentNodeId: parentId, childNodeId: cid });
    }
    cmds.push({ kind: "DisconnectNodes", parentNodeId: parentId, childNodeId: nodeId });
    cmds.push({ kind: "DeleteNode", nodeId });
    ws.runBatch(cmds, parentId);
  }

  /** 把画布视口居中到某节点 —— 长树导航常用。 */
  function centerOnNode(nodeId: string): void {
    const g = graphRef.value;
    if (!g) return;
    const cell = g.getCellById(nodeCellId(nodeId));
    if (cell) {
      // X6 有 centerCell,兼容不同版本用 as any 兜底
      (g as unknown as { centerCell: (c: unknown) => void }).centerCell?.(cell);
    }
  }

  function showNodeMenu(nodeId: string, x: number, y: number): void {
    const tree = ws.currentTree;
    const n = tree?.nodes[nodeId];
    if (!n) return;
    const el = ensureMenu();
    el.innerHTML = "";
    const isRoot = n.nodeType === "Root";
    const parentId = tree ? findParentOf(tree, nodeId) : null;

    // ── 编辑组:复制 / 克隆 / 粘贴(粘贴不接父,和顶栏同语义)
    el.appendChild(menuItem("📋 复制", () => actions?.copy(), { hint: "Ctrl+C" }));
    el.appendChild(menuItem("⎘ 复制并粘贴一份", () => actions?.duplicate(nodeId), { hint: "Ctrl+D", disabled: isRoot }));
    el.appendChild(menuItem("📌 粘贴", () => actions?.paste(), { hint: "Ctrl+V", disabled: !actions?.hasClipboard() }));
    el.appendChild(menuSep());

    // ── 结构组:断父连线 / 删单节点保留子 / 删整个子树
    if (parentId) {
      el.appendChild(menuItem("✂ 断开父连线", () => {
        ws.run({ kind: "DisconnectNodes", parentNodeId: parentId, childNodeId: nodeId });
      }));
    }
    if (!isRoot && parentId && n.childOrder.length > 0) {
      // 只有"非 Root + 有父 + 有子"才需要这个动作,否则退化为普通删除,不必展示
      el.appendChild(menuItem("↑ 删除节点 · 保留子节点", () => deleteNodeKeepChildren(nodeId), {
        hint: `${n.childOrder.length} 子提升`,
      }));
    }
    // Root 由命令层的 canExecute 拒绝删除,菜单里就不展示避免困惑
    if (!isRoot) {
      el.appendChild(menuItem("🗑 删除节点(含子树)", () => {
        ws.run({ kind: "DeleteNode", nodeId });
        if (ws.selectedNodeId === nodeId) ws.selectedNodeId = "";
      }, { danger: true, hint: "Delete" }));
    }
    el.appendChild(menuSep());

    // ── 视图组:居中到该节点 / 校验
    el.appendChild(menuItem("⊙ 居中显示", () => centerOnNode(nodeId)));
    el.appendChild(menuItem("✓ 校验此树", () => actions?.validate()));

    positionMenu(el, x, y);
  }

  /** 画布空白右键 —— 无节点上下文,展示全局动作。 */
  function showBlankMenu(x: number, y: number): void {
    const el = ensureMenu();
    el.innerHTML = "";
    const bus = ws.currentBus;
    // 编辑组:粘贴(常用),撤销/重做
    el.appendChild(menuItem("📌 粘贴", () => actions?.paste(), { hint: "Ctrl+V", disabled: !actions?.hasClipboard() }));
    el.appendChild(menuItem("↶ 撤销", () => ws.undo(), { hint: "Ctrl+Z", disabled: !bus?.canUndo() }));
    el.appendChild(menuItem("↷ 重做", () => ws.redo(), { hint: "Ctrl+Y", disabled: !bus?.canRedo() }));
    el.appendChild(menuSep());
    // 视图组:适配画布 / 重置缩放 / 自动布局
    el.appendChild(menuItem("⤢ 适配画布", () => fit()));
    el.appendChild(menuItem("↺ 重置缩放", () => resetZoom(), { hint: "1:1" }));
    el.appendChild(menuItem("⇅ 自动布局", () => ws.layout()));
    el.appendChild(menuSep());
    // 校验
    el.appendChild(menuItem("✓ 校验", () => actions?.validate()));
    positionMenu(el, x, y);
  }

  async function init(container: HTMLElement): Promise<void> {
    const { Graph } = await import("@antv/x6");
    const graph = new Graph({
      container,
      autoResize: true,
      async: false, // 同步渲染:避免异步渲染在初始 0 宽容器下不刷新导致节点不显示
      background: { color: "transparent" },
      panning: { enabled: true, eventTypes: ["leftMouseDown"] },
      // 鼠标滚轮直接缩放(无需按 Ctrl);围绕指针缩放,体验对齐主流图编辑器。
      mousewheel: { enabled: true, factor: 1.1, minScale: 0.3, maxScale: 2.5, zoomAtMousePosition: true },
      grid: { visible: true, type: "dot", size: 20, args: { color: "rgba(148,163,184,0.14)", thickness: 1 } },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        allowNode: false,
        allowMulti: false,
        snap: { radius: 24 },
        validateConnection: ({ sourceCell, targetCell }) => {
          const parentId = (sourceCell?.getData() as { nodeId?: string })?.nodeId;
          const childId = (targetCell?.getData() as { nodeId?: string })?.nodeId;
          if (!parentId || !childId) return false;
          // FSM:从转移节点拖到 State → 设置 transitionTarget(引用),允许。
          const tree = ws.currentTree;
          const src = tree?.nodes[parentId];
          const tgt = tree?.nodes[childId];
          if (src && tgt && TRANSITION_TYPES.has(src.nodeType) && tgt.nodeType === "State") {
            return true;
          }
          return (
            ws.currentBus?.canExecute({ kind: "ConnectNodes", parentNodeId: parentId, childNodeId: childId }).ok ??
            false
          );
        },
      },
    });
    graphRef.value = graph;

    graph.on("node:click", ({ node }) => {
      const id = (node.getData() as { nodeId?: string })?.nodeId;
      if (id) ws.selectedNodeId = id;
      hideMenu();
    });

    // 右键节点 → 节点上下文菜单(编辑/结构/视图三段)。行为树 / 状态机通用。
    graph.on("node:contextmenu", ({ node, e }) => {
      const id = (node.getData() as { nodeId?: string })?.nodeId;
      if (!id) return;
      ws.selectedNodeId = id;
      hideTooltip();
      const ev = e as unknown as MouseEvent;
      ev.preventDefault();
      showNodeMenu(id, ev.clientX, ev.clientY);
    });
    // 右键空白 → 画布级动作(粘贴/撤销重做/适配/布局/校验)。
    graph.on("blank:contextmenu", ({ e }) => {
      hideTooltip();
      const ev = e as unknown as MouseEvent;
      ev.preventDefault();
      showBlankMenu(ev.clientX, ev.clientY);
    });
    // 左键空白 = 清选 + 关菜单;右键的关菜单在下次左键或 blank:mousedown 走(见下)。
    graph.on("blank:click", () => { hideMenu(); ws.selectedNodeId = ""; });
    // blank:mousedown 也关菜单,但不清 selection(用户可能 shift+左键切选未来扩展)。
    graph.on("blank:mousedown", () => hideMenu());
    graph.on("scale", () => hideMenu());
    graph.on("translate", () => hideMenu());
    // 阻止画布容器的浏览器原生右键菜单(X6 自己派发 blank:contextmenu / node:contextmenu)。
    container.addEventListener("contextmenu", (ev) => ev.preventDefault());

    // 悬停提示:显示节点描述(类型说明 + 名称 + 绑定函数/目标)。行为树与状态机通用。
    graph.on("node:mouseenter", ({ node, e }) => {
      const id = (node.getData() as { nodeId?: string })?.nodeId;
      const html = id ? tooltipHtml(id) : "";
      const ev = e as unknown as MouseEvent;
      if (html) showTooltip(html, ev.clientX, ev.clientY);
    });
    graph.on("node:mousemove", ({ e }) => {
      const ev = e as unknown as MouseEvent;
      moveTooltip(ev.clientX, ev.clientY);
    });
    graph.on("node:mouseleave", () => hideTooltip());

    graph.on("node:moved", ({ node }) => {
      if (syncing) return;
      const id = (node.getData() as { nodeId?: string })?.nodeId;
      const pos = node.getPosition();
      if (id) ws.run({ kind: "MoveNode", nodeId: id, x: pos.x, y: pos.y });
    });

    graph.on("edge:connected", ({ edge, isNew }) => {
      if (syncing || !isNew) return;
      const parentId = (edge.getSourceCell()?.getData() as { nodeId?: string })?.nodeId;
      const childId = (edge.getTargetCell()?.getData() as { nodeId?: string })?.nodeId;
      // 移除 X6 用户交互产生的临时边,统一由命令重建(单一真相源)。
      beginProgrammatic();
      graph.removeEdge(edge.id);
      endProgrammatic();
      if (!parentId || !childId) return;
      // FSM:转移节点 → State 设为引用(transitionTarget),不创建结构边。
      const tree = ws.currentTree;
      const src = tree?.nodes[parentId];
      const tgt = tree?.nodes[childId];
      if (src && tgt && TRANSITION_TYPES.has(src.nodeType) && tgt.nodeType === "State") {
        ws.run({ kind: "UpdateNodeProperty", nodeId: parentId, patch: { transitionTarget: childId } });
        return;
      }
      ws.run({ kind: "ConnectNodes", parentNodeId: parentId, childNodeId: childId });
    });
  }

  /** 增量同步:不清空画布,逐 cell diff。 */
  function sync(tree: DesignTree | undefined): void {
    const graph = graphRef.value;
    if (!graph) return;
    beginProgrammatic();
    // 注意:X6 graph.batchUpdate 形参是 (name, execute),单函数会被当成 name 而不执行,
    // 这里用一个具名函数承载早返回逻辑,并在 try 中调用以捕获错误。
    const syncBody = (): void => {
      if (!tree) {
        graph.clearCells();
        return;
      }
      const layouts = new Map(tree.editorMeta.nodeLayouts.map((l) => [l.nodeId, l]));
      const wantNodeIds = new Set(Object.keys(tree.nodes));
      const wantEdgeIds = new Set(Object.keys(tree.edges));
      // 期望的 goto 边:源转移节点有有效 transitionTarget(目标 State 仍存在)。
      const wantGoto = new Map<string, string>(); // srcNodeId -> targetNodeId
      for (const n of Object.values(tree.nodes)) {
        if (TRANSITION_TYPES.has(n.nodeType) && n.transitionTarget && tree.nodes[n.transitionTarget]) {
          wantGoto.set(n.nodeId, n.transitionTarget);
        }
      }

      // 删除多余 cell
      for (const cell of graph.getCells()) {
        const data = cell.getData() as { nodeId?: string; edgeId?: string; goto?: string } | undefined;
        if (cell.isNode() && (!data?.nodeId || !wantNodeIds.has(data.nodeId))) graph.removeCell(cell);
        else if (cell.isEdge() && data?.goto !== undefined) {
          // goto 边:源不存在 / 目标已变 → 删除重建
          if (!wantGoto.has(data.goto) || wantGoto.get(data.goto) !== (data as { target?: string }).target) {
            graph.removeCell(cell);
          }
        } else if (cell.isEdge() && (!data?.edgeId || !wantEdgeIds.has(data.edgeId))) graph.removeCell(cell);
      }

      // 新增/更新节点
      for (const node of Object.values(tree.nodes)) {
        const def = defaultRegistry.get(node.nodeType);
        const l = layouts.get(node.nodeId) ?? {
          x: 200,
          y: 200,
          width: 168,
          height: 56,
        };
        const cellId = nodeCellId(node.nodeId);
        const existing = graph.getCellById(cellId);
        // 节点 label 拼上类名/函数,改函数后画布即时反映。
        const cls = node.targetSelector?.modelClass;
        const fn = node.functionRef;
        const sub = fn ? (cls ? `${cls}.${fn}` : fn) : "";
        const label = sub
          ? `${def?.displayName ?? node.nodeType}\n${node.name}\n${sub}`
          : `${def?.displayName ?? node.nodeType}\n${node.name}`;
        if (existing && existing.isNode()) {
          const pos = existing.getPosition();
          if (pos.x !== l.x || pos.y !== l.y) existing.position(l.x, l.y);
          existing.setAttrByPath("body", bodyAttrs(node));
          existing.setAttrByPath("label/text", label);
        } else {
          const stroke = nodeStroke(node);
          const { shape, extra } = shapeOf(node.nodeType);
          graph.addNode({
            id: cellId,
            x: l.x,
            y: l.y,
            width: l.width ?? 168,
            height: l.height ?? 56,
            data: { nodeId: node.nodeId },
            shape,
            attrs: {
              body: { ...bodyAttrs(node), ...extra },
              label: {
                text: label,
                fill: "#ffffff",
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 15,
              },
            },
            ports: {
              groups: {
                top: {
                  position: "top",
                  attrs: { circle: { r: 4, fill: stroke, magnet: true } },
                },
                bottom: {
                  position: "bottom",
                  attrs: { circle: { r: 4, fill: stroke, magnet: true } },
                },
              },
              // 通用端口逻辑(行为树 / 状态机统一):按端口"容量"(maxCount)决定是否有端口,
              // 而非默认数量。叶子(Action/Condition/End…)maxCount=0 → 无出端口;
              // Root maxCount(in)=0 → 无入端口;组合/状态/转移按各自容量挂载。
              items: [
                ...(def && def.inputPort.maxCount > 0
                  ? [{ id: `${node.nodeId}_in`, group: "top" }]
                  : []),
                ...(def && def.outputPort.maxCount > 0
                  ? [{ id: `${node.nodeId}_out`, group: "bottom" }]
                  : []),
              ],
            },
          });
        }
      }

      // 新增缺失边(边属性稳定,无需更新)
      for (const edge of Object.values(tree.edges)) {
        if (graph.getCellById(edgeCellId(edge.edgeId))) continue;
        graph.addEdge({
          id: edgeCellId(edge.edgeId),
          data: { edgeId: edge.edgeId },
          source: { cell: nodeCellId(edge.sourceNodeId), port: `${edge.sourceNodeId}_out` },
          target: { cell: nodeCellId(edge.targetNodeId), port: `${edge.targetNodeId}_in` },
          attrs: { line: { stroke: "#5b7790", strokeWidth: 1.4, targetMarker: { name: "block", size: 6 } } },
          router: { name: "manhattan" },
          connector: { name: "rounded" },
        });
      }

      // FSM: 渲染转移目标的 Goto 虚线边(transitionTarget 引用)。
      for (const [srcId, tgtId] of wantGoto) {
        const cellId = gotoCellId(srcId);
        if (graph.getCellById(cellId)) continue;
        graph.addEdge({
          id: cellId,
          data: { goto: srcId, target: tgtId },
          source: { cell: nodeCellId(srcId), port: `${srcId}_out` },
          target: { cell: nodeCellId(tgtId), port: `${tgtId}_in` },
          attrs: {
            line: {
              stroke: "#f5b65c",
              strokeWidth: 1.6,
              strokeDasharray: "5 3",
              targetMarker: { name: "block", size: 7 },
            },
          },
          router: { name: "manhattan" },
          connector: { name: "rounded" },
          zIndex: -1,
        });
      }
    };
    syncBody();
    endProgrammatic();
  }

  /** 仅更新选中/错误高亮,不重建画布(选择态变化用)。 */
  function highlight(tree: DesignTree | undefined): void {
    const graph = graphRef.value;
    if (!graph || !tree) return;
    beginProgrammatic();
    for (const node of Object.values(tree.nodes)) {
      const cell = graph.getCellById(nodeCellId(node.nodeId));
      if (cell && cell.isNode()) cell.setAttrByPath("body", bodyAttrs(node));
    }
    endProgrammatic();
  }

  /** 相对缩放(在当前比例上 +delta),并夹在 [0.3, 2.5]。 */
  function zoomBy(delta: number): void {
    const g = graphRef.value;
    if (!g) return;
    const next = Math.min(2.5, Math.max(0.3, g.zoom() + delta));
    g.zoomTo(next);
  }
  function resetZoom(): void {
    graphRef.value?.zoomTo(1);
  }
  function fit(): void {
    graphRef.value?.zoomToFit({ padding: 40, minScale: 0.3, maxScale: 1.4 });
  }
  /**
   * 当前画布视口中心对应的画布局部坐标(local coordinate)。
   * 用于"粘贴到画布中心"—— 不受缩放 / 平移影响,始终落在当前可见区中间。
   * 找不到画布时返回 null(初始化中),调用方应兜底为 (200,200)。
   */
  function viewportCenterLocal(): { x: number; y: number } | null {
    const g = graphRef.value;
    if (!g) return null;
    const el = (g as unknown as { container: HTMLElement }).container;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const p = g.clientToLocal({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return { x: p.x, y: p.y };
  }
  function dispose(): void {
    graphRef.value?.dispose();
    graphRef.value = null;
    if (tipEl) {
      tipEl.remove();
      tipEl = null;
    }
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  return {
    graphRef,
    init,
    sync,
    highlight,
    zoomBy,
    resetZoom,
    fit,
    viewportCenterLocal,
    centerOnNode,
    setMenuActions,
    dispose,
  };
}
