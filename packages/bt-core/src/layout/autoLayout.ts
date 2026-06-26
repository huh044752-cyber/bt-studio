/**
 * 层级自动布局(文档 §12.4)。从 Root 计算层级,只更新 EditorMeta,不影响运行 XML 语义。
 */
import type { DesignTree, NodeLayout } from "../types/editor.js";

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  hGap?: number;
  vGap?: number;
  startX?: number;
  startY?: number;
}

const TRANSITION_TYPES = new Set(["ConditionTransition", "StateTransition", "Transition"]);

/**
 * 状态机图布局(对齐 behaviac/vue2):Root 指向【初始状态】;其余状态平级,经 transitionTarget(Goto)到达。
 *
 * 布局策略(避免"所有状态挤在一条竖线上"):
 *  - 沿 transitionTarget 引用做 BFS 分层,每一层 = 一【列】(从左到右流动),同层多个状态在该列内纵向铺开。
 *  - 转移节点(菱形)不再单纯吊在源状态下方,而是放在【源状态 → 目标状态】连线的中点,
 *    使其落在两状态之间,形成经典状态图观感;同源多转移横向扇形错开。
 *  - 回连 / 自环转移(目标层 <= 源层)落到状态行【下方的回流泳道】,避免压住中间状态。
 */
function autoLayoutFsm(tree: DesignTree, nodeWidth: number, nodeHeight: number): NodeLayout[] {
  const startX = 120;
  const startY = 96;
  const colGap = 320; // 层(列)间距:留足空间容纳列间的转移菱形
  const rowGap = 168; // 同层状态纵向间距
  const transW = 152;
  const transH = 52;
  const layouts: NodeLayout[] = [];
  const isState = (id: string): boolean => tree.nodes[id]?.nodeType === "State";
  const transOf = (id: string): string[] =>
    (tree.nodes[id]?.childOrder ?? []).filter((c) => TRANSITION_TYPES.has(tree.nodes[c]?.nodeType ?? ""));

  const states = Object.values(tree.nodes).filter((n) => n.nodeType === "State");
  const root = tree.nodes[tree.rootNodeId];
  // 入口状态:Root 的首个 State 子节点,否则第一个 State。
  let entry: string | undefined = root?.childOrder.find(isState);
  if (!entry && states[0]) entry = states[0].nodeId;

  // BFS 分层(沿 transitionTarget 引用)
  const layer = new Map<string, number>();
  const queue: string[] = [];
  if (entry) {
    layer.set(entry, 0);
    queue.push(entry);
  }
  while (queue.length) {
    const s = queue.shift()!;
    for (const t of transOf(s)) {
      const tgt = tree.nodes[t]?.transitionTarget;
      if (tgt && isState(tgt) && !layer.has(tgt)) {
        layer.set(tgt, (layer.get(s) ?? 0) + 1);
        queue.push(tgt);
      }
    }
  }
  // 未被引用到达的状态:追加到末层
  let maxLayer = 0;
  layer.forEach((v) => (maxLayer = Math.max(maxLayer, v)));
  for (const s of states) if (!layer.has(s.nodeId)) layer.set(s.nodeId, ++maxLayer);

  // 按层分组
  const byLayer = new Map<number, string[]>();
  for (const [id, l] of layer) {
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(id);
  }

  // ① 放置状态:层 = 列(横向流动),同层纵向铺开;记录每个状态中心点。
  const center = new Map<string, { cx: number; cy: number }>();
  let statesBottom = startY + nodeHeight;
  for (const [l, ids] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, i) => {
      const x = startX + l * colGap;
      const y = startY + i * rowGap;
      layouts.push({ nodeId: id, x, y, width: nodeWidth, height: nodeHeight });
      center.set(id, { cx: x + nodeWidth / 2, cy: y + nodeHeight / 2 });
      statesBottom = Math.max(statesBottom, y + nodeHeight);
    });
  }

  // ② Root 置于入口状态正上方(无入口则左上角)。
  if (root) {
    const ec = entry ? center.get(entry) : undefined;
    layouts.push({
      nodeId: root.nodeId,
      x: ec ? ec.cx - nodeWidth / 2 : startX,
      y: startY - rowGap * 0.62,
      width: nodeWidth,
      height: nodeHeight,
    });
  }

  // ③ 放置转移菱形:前向转移落在【源→目标】中点;回连/自环走下方回流泳道。
  const laneY = statesBottom + 64; // 回流泳道基准 y
  let laneSlot = 0;
  const fanAt = new Map<string, number>(); // 防重叠:同一落点扇形错开
  for (const s of states) {
    const sc = center.get(s.nodeId);
    const sLayer = layer.get(s.nodeId) ?? 0;
    transOf(s.nodeId).forEach((t) => {
      const tgtId = tree.nodes[t]?.transitionTarget;
      const tc = tgtId ? center.get(tgtId) : undefined;
      const tLayer = tgtId ? layer.get(tgtId) ?? 0 : sLayer + 1;
      let x: number;
      let y: number;
      if (sc && tc && tLayer > sLayer) {
        // 前向:落在两状态中点
        x = (sc.cx + tc.cx) / 2 - transW / 2;
        y = (sc.cy + tc.cy) / 2 - transH / 2;
      } else if (sc) {
        // 回连 / 自环 / 无目标:进入下方回流泳道
        const baseCx = tc ? (sc.cx + tc.cx) / 2 : sc.cx;
        x = baseCx - transW / 2;
        y = laneY + (laneSlot % 2) * (transH + 18);
        laneSlot++;
      } else {
        x = startX;
        y = laneY;
      }
      // 同落点扇形错开
      const key = `${Math.round(x / 24)}_${Math.round(y / 24)}`;
      const k = fanAt.get(key) ?? 0;
      fanAt.set(key, k + 1);
      layouts.push({ nodeId: t, x: x + k * 34, y: y + k * 14, width: transW, height: transH });
    });
  }

  // 兜底:仍未分配位置的节点(异常)给默认行,避免堆叠在 (200,200)
  const placed = new Set(layouts.map((l) => l.nodeId));
  let idx = 0;
  for (const id of Object.keys(tree.nodes)) {
    if (placed.has(id)) continue;
    layouts.push({ nodeId: id, x: startX + idx * 204, y: laneY + 2 * rowGap, width: nodeWidth, height: nodeHeight });
    idx++;
  }

  tree.editorMeta.nodeLayouts = layouts;
  return layouts;
}

export function autoLayout(tree: DesignTree, opts: LayoutOptions = {}): NodeLayout[] {
  const nodeWidth = opts.nodeWidth ?? 168;
  const nodeHeight = opts.nodeHeight ?? 56;
  const hGap = opts.hGap ?? 36;
  const vGap = opts.vGap ?? 72;
  const startX = opts.startX ?? 40;
  const startY = opts.startY ?? 40;

  // 状态机走图布局(Root→入口状态,转移引用分层)。
  if ((tree.projectKind ?? "behavior_tree") === "state_machine") {
    return autoLayoutFsm(tree, nodeWidth, nodeHeight);
  }

  if (!tree.rootNodeId) return tree.editorMeta.nodeLayouts;

  // 若 root node 不存在,给所有节点分配默认位置避免堆叠(200,200)。
  const root = tree.nodes[tree.rootNodeId];
  if (!root) {
    const layouts: NodeLayout[] = [];
    let idx = 0;
    for (const id of Object.keys(tree.nodes)) {
      layouts.push({ nodeId: id, x: 40 + idx * 204, y: 112, width: nodeWidth, height: nodeHeight });
      idx++;
    }
    tree.editorMeta.nodeLayouts = layouts;
    return layouts;
  }

  // 计算每个子树宽度(叶子=1单元),后序遍历分配 x。
  const widthCache = new Map<string, number>();
  const subtreeWidth = (id: string): number => {
    if (widthCache.has(id)) return widthCache.get(id)!;
    const node = tree.nodes[id];
    const children = node?.childOrder ?? [];
    if (children.length === 0) {
      widthCache.set(id, 1);
      return 1;
    }
    const w = children.reduce((s, c) => s + subtreeWidth(c), 0);
    widthCache.set(id, w);
    return w;
  };

  const layouts: NodeLayout[] = [];
  const unit = nodeWidth + hGap;

  const place = (id: string, depth: number, leftUnit: number): void => {
    const node = tree.nodes[id];
    if (!node) return;
    const w = subtreeWidth(id);
    const centerUnit = leftUnit + w / 2;
    const x = startX + centerUnit * unit - nodeWidth / 2;
    const y = startY + depth * (nodeHeight + vGap);
    layouts.push({ nodeId: id, x, y, width: nodeWidth, height: nodeHeight });
    let cursor = leftUnit;
    for (const c of node.childOrder) {
      place(c, depth + 1, cursor);
      cursor += subtreeWidth(c);
    }
  };

  place(tree.rootNodeId, 0, 0);
  tree.editorMeta.nodeLayouts = layouts;
  return layouts;
}
