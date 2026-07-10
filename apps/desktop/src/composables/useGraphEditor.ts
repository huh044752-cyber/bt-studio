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
  let menuEl: HTMLDivElement | null = null;
  function ensureMenu(): HTMLDivElement {
    if (!menuEl) {
      menuEl = document.createElement("div");
      menuEl.className = "x6-node-menu";
      Object.assign(menuEl.style, {
        position: "fixed",
        zIndex: "10000",
        minWidth: "140px",
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
  function menuItem(label: string, danger: boolean, onClick: () => void): HTMLDivElement {
    const it = document.createElement("div");
    it.textContent = label;
    Object.assign(it.style, {
      padding: "6px 10px",
      borderRadius: "6px",
      cursor: "pointer",
      color: danger ? "#ff8a8a" : "#dfe9f5",
      whiteSpace: "nowrap",
    } as CSSStyleDeclaration);
    it.addEventListener("mouseenter", () => (it.style.background = "rgba(76,141,255,0.12)"));
    it.addEventListener("mouseleave", () => (it.style.background = "transparent"));
    it.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      hideMenu();
      onClick();
    });
    return it;
  }
  function showNodeMenu(nodeId: string, x: number, y: number): void {
    const tree = ws.currentTree;
    const n = tree?.nodes[nodeId];
    if (!n) return;
    const el = ensureMenu();
    el.innerHTML = "";
    // 断开与父的连线(如果有父)—— 断开后节点变孤儿,不删除节点本身。
    const parentId = tree ? findParentOf(tree, nodeId) : null;
    if (parentId) {
      el.appendChild(
        menuItem("✂ 断开父连线", false, () => {
          ws.run({ kind: "DisconnectNodes", parentNodeId: parentId, childNodeId: nodeId });
        }),
      );
    }
    // 删除节点(任何节点都可删,包括 Root;删 Root 时 tree.rootNodeId 会被清空)。
    el.appendChild(
      menuItem("🗑 删除节点", true, () => {
        ws.run({ kind: "DeleteNode", nodeId });
        if (ws.selectedNodeId === nodeId) ws.selectedNodeId = "";
      }),
    );
    el.style.display = "block";
    // 视口边界纠正
    el.style.left = "0px";
    el.style.top = "0px";
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
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

    // 右键节点 → 上下文菜单(删除等)。行为树 / 状态机通用。
    graph.on("node:contextmenu", ({ node, e }) => {
      const id = (node.getData() as { nodeId?: string })?.nodeId;
      if (!id) return;
      ws.selectedNodeId = id;
      hideTooltip();
      const ev = e as unknown as MouseEvent;
      ev.preventDefault();
      showNodeMenu(id, ev.clientX, ev.clientY);
    });
    // 点击空白 / 平移 / 缩放时关闭菜单。空白点击同时清选,让新节点自然挂到 Root。
    graph.on("blank:click", () => { hideMenu(); ws.selectedNodeId = ""; });
    graph.on("blank:mousedown", () => hideMenu());
    graph.on("scale", () => hideMenu());
    graph.on("translate", () => hideMenu());
    // 阻止画布容器的浏览器原生右键菜单。
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

  return { graphRef, init, sync, highlight, zoomBy, resetZoom, fit, dispose };
}
