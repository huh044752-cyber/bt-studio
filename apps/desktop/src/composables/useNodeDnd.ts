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
 * X6 Dnd 加入的临时 dummy 节点会被 validateNode 返回 false 拦下不落画布。
 *
 * 坐标处理关键:X6 Dnd 内部 drop 流程(x6/src/plugin/dnd/index.ts:463-483)
 *   1. getDropNode(dragging) —— 此时 dragging 位置仍是 draggingGraph 幽灵坐标
 *   2. droppingNode.position(clientToLocal(mouse), snapToGrid) —— 目标画布坐标
 *   3. validateNode(droppingNode, ...) —— 这里读 getPosition() 才是真正的落点
 * 所以创建节点必须在 validateNode 里发出,不能在 getDropNode 里发(那里的
 * dragging.getPosition() 是拖动图坐标系,与目标画布不同,节点会落在错误的位置)。
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
      // getDropNode:此时坐标还没结算,只透传克隆 —— **不要**在这里发 AddNode。
      getDropNode: (dragging) => dragging.clone(),
      // ghost:直接透传源节点,视觉贴近画布节点。
      getDragNode: (source) => source.clone(),
      // validateNode:X6 已经把 droppingNode 摆到目标画布坐标(clientToLocal + snapToGrid),
      // 这里 getPosition() 拿到的就是**鼠标松开时对应的画布坐标**,发 AddNode 就落对位置。
      // 返回 false → X6 不把 dummy 节点加入目标画布(真节点由 sync 从 ws state 渲染)。
      validateNode: (droppingNode) => {
        const nodeType = (droppingNode.getData() as { dndNodeType?: string })?.dndNodeType;
        if (!nodeType) return false;
        if (!ws.currentTree) {
          con.warning("canvas", "当前没有树,先在左侧新建一棵");
          return false;
        }
        const pos = droppingNode.getPosition();
        const res = ws.run({ kind: "AddNode", nodeType, x: pos.x, y: pos.y });
        if (!res?.ok) {
          con.warning("canvas", `创建 ${nodeType} 失败:${res?.reason ?? "未知"}`);
        }
        return false;
      },
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
