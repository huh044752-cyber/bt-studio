/**
 * X6 v3.1.7 官方 Dnd 插件封装 —— 替代原 HTML5 draggable/dataTransfer 方案。
 *
 * 为什么弃 HTML5:X6 的 SVG 子层 + 页面 absolute 抽屉叠加会让浏览器
 * dragover 事件流不稳定,光标常显示禁用 ⊘;并且 HTML5 drag ghost 无法
 * 对齐 X6 网格/缩放,视觉与画布脱节。
 *
 * X6 Dnd 从 palette 元素的 mousedown 触发 dnd.start(),使用独立的
 * "拖动图"承载 ghost 节点,视觉与目标画布 1:1 对齐。落点(drop)时
 * 我们把创建动作**转发给命令层** ws.run({kind:"AddNode",...}),
 * 保持"单一真相源":真节点由 useGraphEditor.sync() 依据 ws state 增量渲染,
 * X6 Dnd 加入的临时 dummy 节点会被 sync() 的清理 diff 自动移除。
 */
import { shallowRef } from "vue";
import { Dnd, type Graph } from "@antv/x6";
import { defaultRegistry } from "@btstudio/bt-core";
import type { useWorkspaceStore } from "@/stores/workspace";
import type { useConsoleStore } from "@/stores/console";

const COLOR: Record<string, string> = {
  accent: "#4c8dff",
  "accent-2": "#d29922",
  ok: "#3fb950",
  warn: "#d29922",
  err: "#f85149",
  muted: "#7d8590",
};

/** 从注册表读节点色,决定 ghost 描边。 */
function strokeOf(nodeType: string): string {
  const def = defaultRegistry.get(nodeType);
  return def?.color ?? COLOR[def?.colorToken ?? "accent"] ?? COLOR.accent!;
}

/** 造 palette 拖起时的"影子"节点(样式贴近正式画布节点)。 */
function makeGhostNode(nodeType: string) {
  const def = defaultRegistry.get(nodeType);
  const label = def?.displayName ?? nodeType;
  return {
    shape: "rect",
    width: 168,
    height: 56,
    attrs: {
      body: {
        fill: "#16233488",
        stroke: strokeOf(nodeType),
        strokeWidth: 1.6,
        rx: 9,
        ry: 9,
      },
      label: {
        text: `${label}\n(拖到画布)`,
        fill: "#ffffff",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 15,
      },
    },
    data: { dndNodeType: nodeType, dndPlaceholder: true },
  };
}

export function useNodeDnd(
  graphRef: ReturnType<typeof shallowRef<Graph | null>>,
  ws: ReturnType<typeof useWorkspaceStore>,
  con: ReturnType<typeof useConsoleStore>,
) {
  const dndRef = shallowRef<Dnd | null>(null);

  /** 首次拖起时才实例化(此时 Graph 一定已就绪)。 */
  function ensure(): Dnd | null {
    if (dndRef.value) return dndRef.value;
    const g = graphRef.value;
    if (!g) return null;
    const d = new Dnd({
      target: g,
      scaled: false,
      // 放到画布时的最终节点:落孤儿节点,由用户在画布上手动拖端口连线。
      // 不再自动挂父/自动选中 —— 用户明确要求"我自己拖线连"。
      getDropNode: (dragging) => {
        const nodeType = (dragging.getData() as { dndNodeType?: string })?.dndNodeType;
        const pos = dragging.getPosition();
        if (!nodeType) return dragging.clone();
        const t = ws.currentTree;
        if (!t) {
          con.warning("canvas", "当前没有树,先在左侧新建一棵");
          return dragging.clone();
        }
        // parentNodeId 传 undefined → 命令层不 connect,只创建独立节点。
        const res = ws.run({ kind: "AddNode", nodeType, x: pos.x, y: pos.y });
        if (!res?.ok) {
          con.warning("canvas", `创建 ${nodeType} 失败:${res?.reason ?? "未知"}`);
          return dragging.clone();
        }
        // X6 会把 dummy 加到目标画布,下一帧 useGraphEditor.sync() 依 tree.nodes
        // diff 清掉它(dummy 的 data 里没有 nodeId)。
        return dragging.clone();
      },
      // ghost 由 makeGhostNode 提供,这里直接透传源节点。
      getDragNode: (source) => source.clone(),
    });
    dndRef.value = d;
    return d;
  }

  /** palette mousedown → 直接接管为 X6 dnd。evt 必须是原生 MouseEvent。 */
  function startFrom(nodeType: string, evt: MouseEvent): void {
    const d = ensure();
    if (!d) return;
    const g = graphRef.value!;
    const ghost = g.createNode(makeGhostNode(nodeType));
    d.start(ghost, evt);
  }

  function dispose(): void {
    dndRef.value?.dispose();
    dndRef.value = null;
  }

  return { startFrom, dispose };
}
