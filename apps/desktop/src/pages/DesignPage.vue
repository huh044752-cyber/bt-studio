<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import { useGraphEditor } from "@/composables/useGraphEditor";
import { useNodeDnd } from "@/composables/useNodeDnd";
import NodePalette from "@/components/palette/NodePalette.vue";
import PropertiesPanel from "@/components/properties/PropertiesPanel.vue";
import ProblemsPanel from "@/components/problems/ProblemsPanel.vue";
import ActionButton from "@/components/common/ActionButton.vue";
import ModalDialog from "@/components/common/ModalDialog.vue";
import PageHelpButton from "@/components/common/PageHelpButton.vue";
import Tag from "@/components/common/Tag.vue";
import { writeArtifact, pickDirectory } from "@/services/tauri";

const ws = useWorkspaceStore();
const c = useConsoleStore();
const editor = useGraphEditor(ws);
const dnd = useNodeDnd(editor.graphRef, ws, c);
const canvasEl = ref<HTMLElement | null>(null);
// 剪贴板移入 store(跨页/跨树持久),修复"新建树后粘贴显示剪贴板为空"。

/**
 * 单树 BT/FSM XML 导出目录 —— 与 C++ 工程目录彻底解耦。
 * 优先级:ws.exportXmlDir → 弹原生"选择目录"对话框(选完记入 exportXmlDir)。
 * 之前误复用 exportCodeDir(C++ 工程根),会把 .bt/.fsm.xml 落到工程根根目录,
 * 与代码骨架混在一起,且和"工作空间→配置→XML 导出目录"字段语义脱节。
 * 不再兜底 modelRoot:模型目录只用于类型抽取,不应作为导出物写入目标。
 */
async function resolveXmlExportDir(): Promise<string | null> {
  if (ws.exportXmlDir) return ws.exportXmlDir;
  const picked = await pickDirectory("");
  if (!picked) {
    c.warning("export", "未选择 XML 导出目录,已取消。请在「工作空间 → 配置」里设置「BT/FSM XML 导出目录」以便下次直接落盘。");
    return null;
  }
  ws.exportXmlDir = picked;
  c.info("export", `已记住 XML 导出目录:${picked}(下次导出直接写入)`);
  return picked;
}

async function exportXml() {
  const t = ws.currentTree;
  if (!t) throw new Error("无当前树");
  const dir = await resolveXmlExportDir();
  if (!dir) return;
  const base = dir.replace(/[\\/]+$/, "");
  if (ws.isStateMachine) {
    const r = ws.exportFsmCurrent();
    if (!r.ok || !r.xml) throw new Error(r.error);
    const out = await writeArtifact(`${base}/${t.treeName}.fsm.xml`, r.xml);
    c.success("export", `导出状态机 → ${out.path}`);
    return;
  }
  const res = ws.exportCurrent();
  if (!res.ok || !res.artifacts) throw new Error(res.error);
  const out = await writeArtifact(`${base}/${t.treeName}.bt.xml`, res.artifacts.xml);
  c.success("export", `导出行为树 → ${out.path}`);
}

onMounted(async () => {
  if (canvasEl.value) {
    await editor.init(canvasEl.value);
    editor.sync(ws.currentTree);
    nextTick(() => editor.fit());
  }
  // 右键菜单需要"复制/粘贴/克隆/校验"这些页面级动作,通过 setMenuActions 注入
  // (useGraphEditor 不应直接依赖 DesignPage 里的函数)。
  editor.setMenuActions({
    copy: () => copy(),
    paste: () => paste(),
    duplicate: (id: string) => duplicate(id),
    validate: () => runValidate(),
    hasClipboard: () => !!ws.clipboard,
  });
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  dnd.dispose();
  editor.dispose();
});

// 结构变化(切树 / 命令后 rev 变化)→ 增量同步画布
watch(
  () => [ws.currentTreeId, ws.rev],
  () => editor.sync(ws.currentTree),
);
// 仅选中态变化 → 只更新高亮,不重建画布
watch(
  () => ws.selectedNodeId,
  () => editor.highlight(ws.currentTree),
);

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
  // e.repeat = OS 自动重复(按住不放)。粘贴/复制/删除是"一按一动作",
  // 不拦下 repeat 就会一次按键触发几十次 paste,画布被灌满副本。
  if (e.repeat) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === "z") { e.preventDefault(); ws.undo(); }
  else if (ctrl && e.key === "y") { e.preventDefault(); ws.redo(); }
  else if (e.key === "Delete") { e.preventDefault(); del(); }
  // Ctrl+C/V:必须 preventDefault,否则浏览器同时派发原生 copy/paste 事件,
  // 加上下面画布容器上的 paste-target-focus,一次按键在 keydown + paste 两条通道各触发一次。
  else if (ctrl && e.key === "c") { e.preventDefault(); copy(); }
  else if (ctrl && e.key === "v") { e.preventDefault(); paste(); }
  // Ctrl+D = Duplicate:克隆选中节点及其子树到旁边。浏览器默认 Ctrl+D 是"加书签",必须拦下。
  else if (ctrl && e.key === "d") {
    e.preventDefault();
    if (ws.selectedNodeId) duplicate(ws.selectedNodeId);
  }
}

function del() {
  if (ws.selectedNodeId) {
    ws.run({ kind: "DeleteNode", nodeId: ws.selectedNodeId });
    ws.selectedNodeId = "";
  }
}
/**
 * 剪贴板数据结构(2026-07 重构):扁平列表 + 父子索引,不再嵌套递归。
 * - `nodes[i]`:第 i 个节点的属性快照 + 相对复制原点的偏移
 * - `parents[i]`:第 i 个节点的父节点索引(0-based),`-1` 表示子树顶点(不接父)
 * 保证遍历一次即可、递归零层、拷贝零深度污染。
 */
interface ClipNodeSnap {
  nodeType: string;
  name: string;
  /** 属性快照:已剔除 nodeId / childOrder / transitionTarget / parentId */
  init: Record<string, unknown>;
  offX: number;
  offY: number;
}
interface ClipData {
  nodes: ClipNodeSnap[];
  parents: number[];
  /** 顶点在源树上的类型(用于粘贴时校验规则失败时给出友好提示) */
  topType: string;
  topName: string;
}

/** 读取节点在画布上的原坐标(nodeLayouts 是画布真相源,create 时被 X6 事件写回)。 */
function layoutOf(nodeId: string): { x: number; y: number } {
  const t = ws.currentTree;
  const l = t?.editorMeta.nodeLayouts.find((x) => x.nodeId === nodeId);
  return { x: l?.x ?? 200, y: l?.y ?? 200 };
}

/**
 * 收集子树成扁平表 —— BFS + 显式队列,不用递归。
 * 返回顺序保证:父节点索引 < 子节点索引(用于粘贴时"先父后子"顺序创建 + connect)。
 *
 * **关键防御:seen 集合**。BT 树在设计上是严格树(每节点最多一父),但下列情况会产生 DAG 或环:
 *   - 导入的 XML 数据脏,同一 childId 出现在同一 childOrder 的多个位置
 *   - 某历史 UpdateNodeProperty 直接改了 childOrder 绕过 GraphCommandBus.connect 的去重
 *   - 曾经因为并发 command / undo 快照恢复导致 childOrder 双写
 * 如果没有 seen,同一 nodeId 会被展开 N 次,`clip.nodes` 里就有 N 份快照,
 * paste 时每份都 bus.execute(AddNode),画布就"粘出很多个"—— 正是本次要修的根因。
 *
 * seen 兜住这层,重复的边被忽略;真正数据脏在校验阶段会由用户看到警告,但复制粘贴不再放大。
 */
function collectFlat(rootId: string, origin: { x: number; y: number }): ClipData | null {
  const t = ws.currentTree;
  const rootNode = t?.nodes[rootId];
  if (!t || !rootNode) return null;
  const nodes: ClipNodeSnap[] = [];
  const parents: number[] = [];
  const seen = new Set<string>(); // 已收进 nodes 的 nodeId,防止重复展开
  const queue: { id: string; parentIdx: number }[] = [{ id: rootId, parentIdx: -1 }];
  while (queue.length) {
    const { id, parentIdx } = queue.shift()!;
    if (seen.has(id)) continue; // 已收过 → 无论是 dup 边还是环,跳过第二次访问
    const n = t.nodes[id];
    if (!n) continue;
    seen.add(id);
    // 深拷贝属性,剔除运行时字段 —— nodeId / childOrder / transitionTarget / parentId 全清
    const { nodeId: _i, childOrder: _c, transitionTarget: _t, parentId: _p, ...rest } = n as unknown as Record<string, unknown>;
    const p = layoutOf(id);
    const idx = nodes.length;
    nodes.push({
      nodeType: String(n.nodeType),
      name: String(n.name ?? ""),
      init: JSON.parse(JSON.stringify(rest)),
      offX: p.x - origin.x,
      offY: p.y - origin.y,
    });
    parents.push(parentIdx);
    // 按 childOrder 顺序推入子节点,其父在 nodes 中的索引就是刚 push 的 idx。
    // childOrder 内部若有 dup,由 seen 在下一轮兜住;这里不预先去重,保留调试可见性。
    for (const cid of n.childOrder ?? []) queue.push({ id: cid, parentIdx: idx });
  }
  return { nodes, parents, topType: String(rootNode.nodeType), topName: String(rootNode.name ?? "") };
}

function copy() {
  const n = ws.selectedNode;
  if (!n) { c.warning("canvas", "未选中节点"); return; }
  // 选中 Root:等价于"把整棵树打包成子树" —— Root 本身是唯一入口,不再复制,
  // 但把 Root 的唯一子作为快照顶点(带其子树),粘贴出来即"整棵树内容的一个可复用副本"。
  let topId = n.nodeId;
  if (n.nodeType === "Root") {
    const child = n.childOrder?.[0];
    if (!child) { c.warning("canvas", "Root 下还没有子节点,没有可复制的内容"); return; }
    topId = child;
  }
  const origin = layoutOf(topId);
  const clip = collectFlat(topId, origin);
  if (!clip) { c.warning("canvas", "复制失败:顶点节点不存在"); return; }
  ws.clipboard = clip;
  const label = n.nodeType === "Root"
    ? `整树「${ws.currentTree?.treeName ?? ""}」→ 子树(顶点 ${clip.topName})`
    : `子树「${n.name}」`;
  c.info("canvas", `复制${label} 共 ${clip.nodes.length} 节点(粘贴时落在画布中心,不自动接父)`);
}

/**
 * 粘贴 —— **单次 batch 提交**(2026-07 重构):
 *   - 先把 clip.nodes 全部走 AddNode(顺序=DFS 展开顺序,父在子前),
 *     每个 AddNode 结果的 createdNodeId 记到 newIds[i]。
 *   - 再遍历 parents 数组,凡是 parentIdx>=0 的追加一条 ConnectNodes 命令。
 *   - 最后调 ws.runBatch(cmds, anchorSelectedNodeId = 顶点 newId) —— **只 bump 一次,画布只 sync 一次**。
 *   - 校验完全不动:issues 保持"未校验"态,由用户手动点顶栏"校验"按钮触发。
 *
 * 之所以重写:递归 pasteSubtree 每层各调 ws.run,每次都 bump/sync,深子树用户会感觉"节点在爆",
 * 加上 selectedNodeId 每层被覆盖,X6 highlight 反复跑,主观错觉是"粘了很多节点"。
 * 新版一次提交,画布一次刷新,选中最终锚定顶点,不再有中间态。
 */
/**
 * 底层粘贴 —— 把当前 clipboard(ClipData)按锚点 center 铺开到画布,返回顶点新 id 或空串。
 * 单次 batch 提交(画布只 sync 一次)。不接父到画布已有节点 —— 顶点外部连接由用户手动完成。
 */
function pasteInto(center: { x: number; y: number }): string {
  const clip = ws.clipboard as ClipData | null;
  if (!clip?.nodes?.length) return "";
  const bus = ws.currentBus;
  if (!bus) return "";
  const newIds: string[] = [];
  for (const snap of clip.nodes) {
    const x = center.x + snap.offX;
    const y = center.y + snap.offY;
    const res = bus.execute({ kind: "AddNode", nodeType: snap.nodeType, name: snap.name, x, y, init: snap.init });
    if (!res.ok || !res.createdNodeId) {
      c.warning("canvas", `节点 ${snap.name} (${snap.nodeType}) 创建失败:${res.reason ?? "未知"}`);
      newIds.push("");
      continue;
    }
    newIds.push(res.createdNodeId);
  }
  let connectFailures = 0;
  for (let i = 0; i < clip.parents.length; i++) {
    const parentIdx = clip.parents[i]!;
    if (parentIdx < 0) continue;
    const parentId = newIds[parentIdx];
    const childId = newIds[i];
    if (!parentId || !childId) continue;
    const res = bus.execute({ kind: "ConnectNodes", parentNodeId: parentId, childNodeId: childId });
    if (!res.ok) {
      connectFailures++;
      c.warning("canvas", `子树内部连线失败(${clip.nodes[parentIdx]?.name} → ${clip.nodes[i]?.name}):${res.reason ?? "未知"}`);
    }
  }
  const topNewId = newIds[0] ?? "";
  ws.runBatch([], topNewId || undefined); // 单次 bump 触发 X6 sync + 选中顶点
  const created = newIds.filter(Boolean).length;
  if (created === 0) c.warning("canvas", "粘贴失败:所有节点被拒绝");
  else {
    const suffix = connectFailures > 0 ? `,${connectFailures} 条内部连线失败` : "";
    c.success("canvas", `粘贴 ${created}/${clip.nodes.length} 节点${suffix} · 未接父,请手动拖端口连线`);
  }
  return topNewId;
}

/** Ctrl+V / 顶栏"粘贴" / 空白右键"粘贴" —— 落在当前画布视口正中央。 */
function paste() {
  if (!ws.clipboard) { c.warning("canvas", "剪贴板为空,先 Ctrl+C 复制"); return; }
  if (!ws.currentTree) { c.warning("canvas", "当前没有树"); return; }
  const center = editor.viewportCenterLocal() ?? { x: 200, y: 200 };
  pasteInto(center);
}

/**
 * Ctrl+D / 节点右键"复制并粘贴一份" —— 克隆一份到该节点右下方(小偏移 40/40)。
 * 相比 copy + paste 两步的好处:粘出的顶点在原顶点旁边而非画布视口中心,视觉连续,
 * 常用于"再来一个同样的分支"或"批量堆同类子树"。剪贴板会被覆盖为该节点子树的快照。
 */
function duplicate(nodeId: string) {
  const t = ws.currentTree;
  const n = t?.nodes[nodeId];
  if (!t || !n) return;
  if (n.nodeType === "Root") { c.warning("canvas", "Root 不能作为克隆源"); return; }
  const origin = layoutOf(nodeId);
  const clip = collectFlat(nodeId, origin);
  if (!clip) return;
  ws.clipboard = clip;
  // 落到原顶点右下 40/40 处 —— 一个网格单位 + 少许错位,避免完全重叠
  pasteInto({ x: origin.x + 40, y: origin.y + 40 });
}

/** 手动校验:顶栏"校验" / 节点/空白右键"校验" —— 刷新问题面板 + 画布错误高亮。 */
function runValidate() {
  const t = ws.currentTree;
  if (!t) { c.warning("canvas", "当前没有树"); return; }
  const list = ws.validate();
  const errors = list.filter((i) => i.level === "error").length;
  const warns = list.filter((i) => i.level === "warning").length;
  if (errors === 0 && warns === 0) c.success("canvas", `校验通过「${t.treeName}」`);
  else c.info("canvas", `校验完成「${t.treeName}」 · ${errors} 错误 / ${warns} 警告`);
}

// palette 拖起时:走 X6 v3.1.7 官方 Dnd。所有 HTML5 drag/drop 相关已删。
function onPaletteStart(nodeType: string, evt: MouseEvent): void {
  dnd.startFrom(nodeType, evt);
}

// 新建工程弹窗(行为树 / 状态机)
const createOpen = ref(false);
const createKind = ref<"behavior_tree" | "state_machine">("behavior_tree");
const createName = ref("");
const createError = ref("");
function openCreate(kind: "behavior_tree" | "state_machine") {
  createKind.value = kind;
  createName.value = "";
  createError.value = "";
  createOpen.value = true;
}
/** 输入变化即清红字,让用户改完能立刻看到"错误已解除"。 */
watch(createName, () => { createError.value = ""; });
/** 生成同 kind 下不重复的默认名(fsm_1 / fsm_2 或 tree_1 / tree_2 …)。 */
function nextDefaultName(kind: "behavior_tree" | "state_machine"): string {
  const prefix = kind === "state_machine" ? "fsm_" : "tree_";
  const used = new Set(ws.trees.map((t) => t.treeName));
  for (let i = 1; i < 9999; i++) {
    const cand = `${prefix}${i}`;
    if (!used.has(cand)) return cand;
  }
  return `${prefix}${ws.trees.length + 1}`;
}
function confirmCreate() {
  const raw = createName.value.trim();
  const name = raw || nextDefaultName(createKind.value);
  // 名称必须全局唯一(BT/FSM 混合命名空间):同名无法从 XML 索引 / 挂接 sdata 时区分。
  // 弹窗内红字提示 + 保留输入,不再仅打控制台(用户看不到)。
  if (ws.trees.some((t) => t.treeName === name)) {
    createError.value = `名称「${name}」已存在,请换一个(BT/FSM 共用命名空间)`;
    c.warning("workspace", createError.value);
    return;
  }
  ws.newTree(name, createKind.value);
  createOpen.value = false;
}

const selectedIds = ref<Set<string>>(new Set());
function toggleSel(id: string) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id);
  else selectedIds.value.add(id);
  selectedIds.value = new Set(selectedIds.value);
}
function batchDelete() {
  ws.deleteTrees([...selectedIds.value]);
  selectedIds.value = new Set();
}
const canExport = computed(() => ws.canExport);

/** 按 kind(BT/FSM)分组的树列表 —— 左抽屉树列表使用。 */
const treeGroups = computed(() => {
  void ws.rev;
  const bt = ws.trees.filter((t) => (t.projectKind ?? "behavior_tree") !== "state_machine");
  const fsm = ws.trees.filter((t) => t.projectKind === "state_machine");
  return [
    { key: "bt", label: "行为树", items: bt },
    { key: "fsm", label: "状态机", items: fsm },
  ] as const;
});

// 面板:抽屉式隐藏(覆盖在画布上,不挤压中间画布)+ 可拖拽改宽。
const leftOpen = ref(true);
const rightOpen = ref(true);
const problemsOpen = ref(true);
const leftW = ref(260);
const rightW = ref(300);
/** 左抽屉三段各自高度(项目树 / 节点库 / 黑板速览) —— 中间段 auto:1fr,首尾段像素固定,可上下拖 */
const treeSecH = ref(220);
const bbSecH = ref(200);
/** 底部问题条高度(上下拖) */
const problemsH = ref(160);
/** BT/FSM 分类折叠 —— 每个 group.key 独立;默认展开 */
const groupCollapsed = ref<Set<string>>(new Set());
function toggleGroup(key: string) {
  if (groupCollapsed.value.has(key)) groupCollapsed.value.delete(key);
  else groupCollapsed.value.add(key);
  groupCollapsed.value = new Set(groupCollapsed.value);
}
/** 黑板速览折叠(整个 section 收起) */
const bbSecCollapsed = ref(false);

type ResizeKind = "left" | "right" | "tree-sec" | "bb-sec" | "problems";
let resizeKind: ResizeKind | null = null;
let startCoord = 0;
let startVal = 0;
function onResizeMove(e: PointerEvent) {
  if (!resizeKind) return;
  if (resizeKind === "left" || resizeKind === "right") {
    const dx = e.clientX - startCoord;
    const raw = resizeKind === "left" ? startVal + dx : startVal - dx;
    const w = Math.min(560, Math.max(200, raw));
    if (resizeKind === "left") leftW.value = w;
    else rightW.value = w;
    return;
  }
  // 纵向拖:向下增高
  const dy = e.clientY - startCoord;
  if (resizeKind === "tree-sec") treeSecH.value = Math.min(600, Math.max(100, startVal + dy));
  else if (resizeKind === "bb-sec") bbSecH.value = Math.min(600, Math.max(80, startVal - dy));
  else if (resizeKind === "problems") problemsH.value = Math.min(600, Math.max(80, startVal - dy));
}
function endResize() {
  resizeKind = null;
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", endResize);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}
function startResize(kind: ResizeKind, e: PointerEvent) {
  resizeKind = kind;
  const horiz = kind === "left" || kind === "right";
  startCoord = horiz ? e.clientX : e.clientY;
  startVal =
    kind === "left" ? leftW.value :
    kind === "right" ? rightW.value :
    kind === "tree-sec" ? treeSecH.value :
    kind === "bb-sec" ? bbSecH.value :
    problemsH.value;
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", endResize);
  document.body.style.cursor = horiz ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
}
const currentKind = computed(() => (ws.currentTree?.projectKind === "state_machine" ? "状态机" : "行为树"));

// —— 黑板速览:当前树可见的黑板(本地 + 已链接的全局)+ 可链接的其他全局 —— //
const bbLocal = computed(() => {
  void ws.rev;
  const t = ws.currentTree;
  if (!t) return null;
  return ws.localBlackboards[t.treeId] ?? null;
});
const bbLinked = computed(() => {
  void ws.rev;
  const t = ws.currentTree;
  if (!t) return [];
  return ws.globalBlackboards.filter((b) => t.linkedGlobalBlackboardIds.includes(b.blackboardId));
});
const bbAvailable = computed(() => {
  void ws.rev;
  const t = ws.currentTree;
  if (!t) return ws.globalBlackboards;
  return ws.globalBlackboards.filter((b) => !t.linkedGlobalBlackboardIds.includes(b.blackboardId));
});
function toggleLinkGlobal(bbId: string) {
  const t = ws.currentTree;
  if (!t) return;
  const idx = t.linkedGlobalBlackboardIds.indexOf(bbId);
  if (idx >= 0) { t.linkedGlobalBlackboardIds.splice(idx, 1); c.info("workspace", "解除链接全局黑板"); }
  else { t.linkedGlobalBlackboardIds.push(bbId); c.info("workspace", "已链接全局黑板到当前树"); }
  ws.bump();
}
</script>

<template>
  <div class="design">
    <!-- 顶部工具条(全宽,抽屉不遮挡) -->
    <div class="toolbar panel row">
      <button class="btn tiny" :class="{ on: leftOpen }" title="项目/节点库(抽屉)" @click="leftOpen = !leftOpen">☰ 项目</button>
      <span class="sep" />
      <button class="btn tiny" :disabled="!ws.currentBus?.canUndo()" title="撤销 Ctrl+Z" @click="ws.undo()">↶ 撤销</button>
      <button class="btn tiny" :disabled="!ws.currentBus?.canRedo()" title="重做 Ctrl+Y" @click="ws.redo()">↷ 重做</button>
      <span class="sep" />
      <button class="btn tiny" title="复制选中节点及其子树;若选中 Root 则把整棵树打包为可粘贴子树(顶点=Root 的唯一子)  快捷键 Ctrl+C" @click="copy">复制</button>
      <button class="btn tiny" title="粘贴到画布视口中心,不自动接父,连线人工完成  快捷键 Ctrl+V" @click="paste">粘贴</button>
      <button class="btn tiny danger" title="删除选中节点及其子树  快捷键 Delete" @click="del">删除</button>
      <span class="sep" />
      <!-- 缩放三键(＋/－/1:1)已下沉到画布空白右键菜单;鼠标滚轮直接缩放足够高频。
           顶栏只保留"适配画布"和"自动布局"这类整树级动作。 -->
      <button class="btn tiny" title="全树自动布局(空白右键也可)" @click="ws.layout()">自动布局</button>
      <button class="btn tiny" title="缩放整棵树到画布可见范围(空白右键也可)" @click="editor.fit()">适配画布</button>
      <span class="sep" />
      <button class="btn tiny" title="校验当前树:结构、绑定、必填参数等 —— 结果落到下方问题面板;导出前会自动跑一次严格版" @click="runValidate">✓ 校验</button>
      <ActionButton label="导出XML" :disabled="!canExport" @run="exportXml" />
      <Tag variant="info" size="sm">{{ currentKind }}</Tag>
      <!-- 校验后才显示阻断数;未校验态显示中性提示,避免误导 -->
      <Tag v-if="ws.issues.length > 0" :variant="ws.errorCount === 0 ? 'ok' : 'err'" size="sm">
        {{ ws.errorCount === 0 ? `✓ 无错误 · ${ws.warningCount} 警告` : `✗ ${ws.errorCount} 错误 · ${ws.warningCount} 警告` }}
      </Tag>
      <Tag v-else variant="neutral" size="sm">未校验</Tag>
      <span class="spacer" />
      <button class="btn tiny" :title="problemsOpen ? '隐藏问题区' : '显示问题区'" @click="problemsOpen = !problemsOpen">
        {{ problemsOpen ? "▾问题" : "▸问题" }}
      </button>
      <button class="btn tiny" :class="{ on: rightOpen }" title="属性/绑定(抽屉)" @click="rightOpen = !rightOpen">属性 ☰</button>
      <PageHelpButton title="设计页 · 使用帮助">
        <section class="help-sec">
          <h3>这个页面是做什么的?</h3>
          <p>可视化编辑<strong>行为树 / 状态机</strong>。左抽屉选/建工程,画布拖节点连线,右抽屉编辑节点属性 + 绑定。</p>
        </section>
        <section class="help-sec">
          <h3>三大抽屉</h3>
          <ul>
            <li><strong>左抽屉:</strong>项目树(新建/切换 BT/FSM)、节点库(拖到画布)</li>
            <li><strong>画布:</strong>拖节点、连线、框选、多选、复制粘贴</li>
            <li><strong>右抽屉:</strong>属性 / 绑定(Action/Condition/State 选类 → 选方法 → 绑参数)</li>
          </ul>
        </section>
        <section class="help-sec">
          <h3>快捷键</h3>
          <ul>
            <li><code>Ctrl+Z</code> / <code>Ctrl+Y</code> — 撤销 / 重做</li>
            <li><code>Ctrl+C</code> / <code>Ctrl+V</code> — 复制 / 粘贴</li>
            <li><code>Ctrl+D</code> — 克隆选中节点及其子树到旁边</li>
            <li><code>Delete</code> — 删除选中(含子树)</li>
            <li>鼠标滚轮 — 缩放(围绕光标),中键拖拽平移</li>
          </ul>
        </section>
        <section class="help-sec">
          <h3>右键菜单(高频动作都在这里)</h3>
          <p><strong>节点右键:</strong>复制 · 克隆一份 · 粘贴 · 断父连线 · <b>删单节点保留子</b>(把子提升到该节点的父下)· 删整个子树 · 居中显示 · 校验</p>
          <p><strong>空白右键:</strong>粘贴 · 撤销 / 重做 · 适配画布 · 重置缩放 · 自动布局 · 校验</p>
        </section>
        <section class="help-sec">
          <h3>校验(手动触发)</h3>
          <p>顶栏 <b>✓ 校验</b> 按钮:主动跑当前树的完整校验(结构 + 绑定 + 参数),结果落到下方"问题"面板 + 画布错节点变红。</p>
          <p>拖节点 / 粘贴 / 连线 / 改属性 <b>不再自动校验</b> —— 中间态不会红字轰炸,由你决定何时"看一眼"。</p>
          <p>点 <b>导出XML</b> 时会<b>自动按严格标准跑一次校验</b>:平时被降级为"警告"的孤儿节点 / 未绑函数 / 必填未填 会全部升为"错误"阻断导出;失败时问题面板会显示"再补哪几处才能导出"。</p>
        </section>
        <section class="help-sec">
          <h3>拖拽 / 复制 / 粘贴 —— 具体怎么用</h3>
          <ul>
            <li>
              <strong>从节点库拖入画布:</strong>左抽屉"节点库"中<b>按住鼠标不放</b>拖到画布,
              <b>松手时鼠标所在位置</b>就是节点落点(会吸附到网格)。松手后先"孤立"落下,再拖端口连线接父即可。
              光标显示禁用 ⊘ 通常意味着节点还没落到画布容器内 —— 拖到画布可视区域后松手。
            </li>
            <li>
              <strong>复制:</strong>在画布上<b>点选一个节点</b>,点顶部"复制"或按 <code>Ctrl+C</code>。
              选中节点<b>及其所有子孙</b>会连同内部布局一起进入剪贴板。剪贴板<b>跨树跨页</b>持久(切树后仍在)。
              <b>特殊:选中 Root 复制</b> = 把<b>整棵树</b>打包为可粘贴子树(顶点 = Root 的唯一子);
              粘到目标树后按下面"粘贴"操作接父即可,常用于"把这棵树接到另一棵树的某个位置"。
            </li>
            <li>
              <strong>删除:</strong>选中节点后 <code>Delete</code> 或右键"删除节点"。
              <b>Root 不可删除</b>(一棵树的唯一入口,用左抽屉整树删除来重建)。
            </li>
            <li>
              <strong>粘贴:</strong>按 <code>Ctrl+V</code> 或点"粘贴"。<b>一次操作 = 一次批处理提交</b>(所有节点单帧生成,画布只刷新一次,不会看到"节点在爆")。
              粘出来的子树:
              <b>整体落在当前画布视口正中央</b>(子孙节点相对根的位形保持不变);
              <b>不会自动接到任何已有节点上</b>(包括你当前选中的);
              <b>子树内部的父子连接会自动复原</b>(不用重连内部)。
              接父到原图的这一步<b>由你手动</b>:拖端口拉线到目标父节点即可。粘贴完成后<b>选中态自动落到顶点</b>,方便你立刻接线。
            </li>
          </ul>
        </section>
        <section class="help-sec">
          <h3>节点连接规则速查(行为树)</h3>
          <ul>
            <li><strong>Root · 根</strong> — 0 入 / 1 出,<b>恰好 1 子</b>。BT:任意结构子;FSM:只能连 State。</li>
            <li><strong>Sequence · 顺序 / Selector · 选择</strong> — 组合,1~64 子,遇失败/成功即短路。</li>
            <li><strong>Parallel · 并行</strong> — 组合,<b>2~64 子</b>,按成功/失败阈值汇总。</li>
            <li><strong>And · 与 / Or · 或</strong> — 组合,<b>子只能是 Condition / ConditionTransform</b>,其他被拒。</li>
            <li><strong>IfElse · 条件分支</strong> — <b>恰好 3 子</b>(条件、真、假)。</li>
            <li><strong>SelectMonitor · 选择监测</strong> — 组合,<b>子只能是 MonitorBranch</b>。</li>
            <li><strong>MonitorBranch · 监测分支</strong> — <b>恰好 2 子</b>,<b>父必须是 SelectMonitor</b>。子不能是 SelectMonitor(避免环)。</li>
            <li><strong>Decorator 装饰器</strong>(循环 / 反相 / 恒成功 / 恒失败 / 成功直到 / 失败直到)— 1 入 1 出,<b>恰好 1 子</b>。</li>
            <li><strong>Action · 动作 / Condition · 条件 / Wait · 等待 / SubTree · 子树</strong> — 叶子,<b>0 子</b>,不可再挂。</li>
          </ul>
        </section>
        <section class="help-sec">
          <h3>节点连接规则速查(状态机)</h3>
          <ul>
            <li><strong>Root</strong> — <b>只能连 State</b>(且只 1 个入口 State)。</li>
            <li><strong>State · 状态</strong> — 子<b>只能是 ConditionTransition / StateTransition / Transition</b>。</li>
            <li><strong>ConditionTransition / StateTransition / Transition · 跳转</strong> — 是叶子,不接结构子;<b>目标 State 走属性面板"目标状态"引用</b>,画布上显示为橙色虚线 Goto 边。</li>
          </ul>
        </section>
        <div class="help-note">
          拖拽会<b>智能选父</b>:选中节点自身收不下 → 深度优先在其子树找有容量的可组合节点 → 兜底 Root。找不到才提示。<br />
          校验分 Error / Warning / Info,<strong>有 Error 时禁止导出 / 挂接</strong>。问题区(顶栏"▾问题")展示逐条错误 + 定位。
        </div>
      </PageHelpButton>
    </div>

    <!-- 画布区(抽屉覆盖其上,切换不挤压画布) -->
    <div class="body">
      <!-- 中间画布(X6 Dnd 走独立事件通道,不再需要 HTML5 drop 层) -->
      <div class="center col">
        <div ref="canvasEl" class="canvas panel" />
        <template v-if="problemsOpen">
          <div class="h-resizer" title="上下拖:问题区高度" @pointerdown="startResize('problems', $event)" />
          <div class="problems-strip panel" :style="{ height: problemsH + 'px' }">
            <ProblemsPanel />
          </div>
        </template>
      </div>

      <!-- 左抽屉:三段纵向 —— 项目树(固定高)+ 节点库(自适应)+ 黑板速览(固定高),中间分隔条上下拖 -->
      <div class="drawer left panel" :class="{ open: leftOpen }" :style="{ width: leftW + 'px' }">
        <!-- ① 项目树 -->
        <div class="left-sec proj-sec" :style="{ height: treeSecH + 'px' }">
          <div class="sec-head">
            <strong>项目树</strong>
            <span class="spacer" />
            <button class="btn tiny" title="刷新" @click="ws.bump()">↻</button>
            <button class="btn tiny" title="收起抽屉" @click="leftOpen = false">✕</button>
          </div>
          <div class="row new-tree">
            <button class="btn tiny primary" @click="openCreate('behavior_tree')" title="新建行为树">+ 行为树</button>
            <button class="btn tiny" @click="openCreate('state_machine')" title="新建状态机">+ 状态机</button>
          </div>
          <div class="tree-list scroll">
            <template v-for="g in treeGroups" :key="g.key">
              <div class="tree-group-head" :class="{ collapsed: groupCollapsed.has(g.key) }" @click="toggleGroup(g.key)">
                <span class="caret">{{ groupCollapsed.has(g.key) ? "▸" : "▾" }}</span>
                <span class="grp-label">{{ g.label }}</span>
                <span class="tree-group-count">{{ g.items.length }}</span>
              </div>
              <template v-if="!groupCollapsed.has(g.key)">
                <div v-if="g.items.length === 0" class="tree-empty muted-2">(暂无)</div>
                <div
                  v-for="t in g.items"
                  :key="t.treeId"
                  class="tree-item"
                  :class="{ active: t.treeId === ws.currentTreeId }"
                >
                  <input type="checkbox" :checked="selectedIds.has(t.treeId)" @change="toggleSel(t.treeId)" />
                  <span class="tname" :title="t.treeName" @click="ws.switchTree(t.treeId)">{{ t.displayName || t.treeName }}</span>
                  <span class="tcount muted-2">{{ Object.keys(t.nodes).length }}</span>
                </div>
              </template>
            </template>
          </div>
          <div class="row">
            <button class="btn tiny danger" :disabled="selectedIds.size === 0" @click="batchDelete">
              批量删除 ({{ selectedIds.size }})
            </button>
          </div>
        </div>

        <!-- 分隔条:项目树 ↕ 节点库 -->
        <div class="v-resizer" title="上下拖:项目树高度" @pointerdown="startResize('tree-sec', $event)" />

        <!-- ② 节点库(占中间剩余高度) -->
        <div class="left-sec palette-sec">
          <div class="sec-head"><strong>节点库</strong></div>
          <NodePalette @pick="onPaletteStart" />
        </div>

        <!-- 分隔条:节点库 ↕ 黑板速览 -->
        <div v-if="!bbSecCollapsed" class="v-resizer" title="上下拖:黑板速览高度" @pointerdown="startResize('bb-sec', $event)" />

        <!-- ③ 黑板速览(可折叠) -->
        <div class="left-sec bb-sec" :style="bbSecCollapsed ? {} : { height: bbSecH + 'px' }">
          <div class="sec-head bb-head" @click="bbSecCollapsed = !bbSecCollapsed">
            <span class="caret">{{ bbSecCollapsed ? "▸" : "▾" }}</span>
            <strong>黑板速览</strong>
            <span class="muted-2 nowrap">
              {{ bbLocal ? bbLocal.variables.length : 0 }} 本地 · {{ bbLinked.length }} 全局
            </span>
            <span class="spacer" />
            <router-link to="/variables" class="btn tiny" title="打开黑板中心(全量 CRUD)" @click.stop>▸</router-link>
          </div>
          <div v-if="!bbSecCollapsed" class="bb-body scroll">
            <div v-if="!ws.currentTree" class="muted-2 empty">先选/建一棵树</div>
            <template v-else>
              <!-- 本地板 -->
              <div v-if="bbLocal" class="bb-card local">
                <div class="bb-row">
                  <Tag variant="neutral" size="xs">本地</Tag>
                  <span class="bb-name ellipsis" :title="bbLocal.name">{{ bbLocal.name }}</span>
                  <span class="bb-cnt nowrap muted-2">{{ bbLocal.variables.length }} 变量</span>
                </div>
                <div v-if="bbLocal.variables.length" class="bb-vars">
                  <span v-for="v in bbLocal.variables.slice(0, 6)" :key="v.variableId" class="bb-var mono" :title="`${v.name} · ${v.malType}`">
                    {{ v.name }}
                  </span>
                  <span v-if="bbLocal.variables.length > 6" class="muted-3">+{{ bbLocal.variables.length - 6 }}</span>
                </div>
                <div v-else class="muted-3 mini">本地板暂无变量(去黑板中心添加)</div>
              </div>

              <!-- 已链接全局 -->
              <div v-if="bbLinked.length" class="bb-grp muted-2">已链接全局</div>
              <div v-for="b in bbLinked" :key="b.blackboardId" class="bb-card linked">
                <div class="bb-row">
                  <Tag variant="accent" size="xs">全局</Tag>
                  <span class="bb-name ellipsis" :title="b.name">{{ b.name }}</span>
                  <span class="bb-cnt nowrap muted-2">{{ b.variables.length }}</span>
                  <button class="btn tiny bb-x" title="解除链接" @click="toggleLinkGlobal(b.blackboardId)">✕</button>
                </div>
              </div>

              <!-- 可链接全局 -->
              <div v-if="bbAvailable.length" class="bb-grp muted-2">可链接全局</div>
              <div v-for="b in bbAvailable" :key="b.blackboardId" class="bb-card avail">
                <div class="bb-row">
                  <Tag variant="neutral" size="xs">全局</Tag>
                  <span class="bb-name ellipsis" :title="b.name">{{ b.name }}</span>
                  <span class="bb-cnt nowrap muted-2">{{ b.variables.length }}</span>
                  <button class="btn tiny primary bb-plus" title="链接到当前树" @click="toggleLinkGlobal(b.blackboardId)">＋</button>
                </div>
              </div>

              <div v-if="!bbLinked.length && !bbAvailable.length && !bbLocal" class="muted-2 empty">无黑板</div>
            </template>
          </div>
        </div>

        <div class="drawer-resizer right" title="拖拽改宽" @pointerdown="startResize('left', $event)" />
      </div>
      <button v-show="!leftOpen" class="edge-tab tl" title="展开项目/节点库" @click="leftOpen = true">▶ 项目 / 节点库</button>

      <!-- 右抽屉 -->
      <div class="drawer right panel" :class="{ open: rightOpen }" :style="{ width: rightW + 'px' }">
        <div class="drawer-resizer left" title="拖拽改宽" @pointerdown="startResize('right', $event)" />
        <div class="sec-head">
          <strong>属性 / 绑定</strong><span class="spacer" />
          <button class="btn tiny" title="收起抽屉" @click="rightOpen = false">✕</button>
        </div>
        <PropertiesPanel />
      </div>
      <button v-show="!rightOpen" class="edge-tab tr" title="展开属性/绑定" @click="rightOpen = true">◀ 属性 / 绑定</button>
    </div>

    <ModalDialog
      :open="createOpen"
      :title="createKind === 'state_machine' ? '新建状态机' : '新建行为树'"
      ok-label="创建"
      @ok="confirmCreate"
      @cancel="createOpen = false"
    >
      <label class="dlg-fld">
        <span>名称</span>
        <input
          class="input"
          :class="{ 'input-err': !!createError }"
          v-model="createName"
          :placeholder="createKind === 'state_machine' ? 'fsm_1' : 'tree_1'"
          @keyup.enter="confirmCreate"
        />
      </label>
      <div v-if="createError" class="dlg-err">⚠ {{ createError }}</div>
      <div class="muted-2" style="font-size: 11px">类型:{{ createKind === "state_machine" ? "状态机(State/转移)" : "行为树(BT 节点)" }}</div>
    </ModalDialog>
  </div>
</template>

<style scoped>
.dlg-fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dlg-fld > span { color: var(--muted); }
.dlg-err {
  font-size: 12px;
  color: var(--err);
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--err) 40%, transparent);
  background: color-mix(in srgb, var(--err) 12%, transparent);
  border-radius: var(--radius-md);
  margin-top: 4px;
}
.input-err { border-color: var(--err) !important; }
.design {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  overflow: hidden;
}
.body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
/* 抽屉:绝对覆盖在画布之上,开合不挤压中间画布 */
.drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  transition: transform 0.22s ease;
  overflow: visible;
}
.drawer.left {
  left: 0;
  transform: translateX(calc(-100% - 12px));
}
.drawer.left.open {
  transform: translateX(0);
}
.drawer.right {
  right: 0;
  transform: translateX(calc(100% + 12px));
}
.drawer.right.open {
  transform: translateX(0);
}
.drawer-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: col-resize;
  z-index: 21;
}
.drawer-resizer.right { right: -3px; }
.drawer-resizer.left { left: -3px; }
.drawer-resizer:hover { background: var(--accent-soft); }
/* 收起后边缘的展开标签 */
.edge-tab {
  position: absolute;
  top: 12px;
  z-index: 15;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  font-size: 11px;
  padding: 10px 5px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease;
}
.edge-tab:hover { color: var(--accent); border-color: var(--accent-border); background: var(--surface-3); }
.edge-tab.tl { left: 0; }
.edge-tab.tr { right: 0; }
.btn.tiny.on { color: var(--accent); border-color: var(--accent-border); background: var(--accent-soft); }
.left-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.proj-sec {
  flex: 0 0 auto;      /* 项目树:像素固定,可上下拖 */
}
.palette-sec {
  flex: 1 1 0;          /* 节点库:自适应剩余空间 */
  min-height: 80px;
}
.bb-sec {
  flex: 0 0 auto;      /* 黑板速览:像素固定,可上下拖 */
}

/* 纵向分隔条(左抽屉三段之间) */
.v-resizer {
  height: 6px;
  margin: 0 -8px;
  flex: 0 0 auto;
  cursor: row-resize;
  background: transparent;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
  transition: background 0.12s;
}
.v-resizer:hover { background: var(--accent-soft); }

/* 横向分隔条(画布 ↕ 问题区) */
.h-resizer {
  height: 6px;
  cursor: row-resize;
  background: transparent;
  border-radius: 3px;
  transition: background 0.12s;
  flex: 0 0 auto;
}
.h-resizer:hover { background: var(--accent-soft); }

.sec-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 2px 0;
}
.new-tree {
  gap: 5px;
}
.tree-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.tree-group-head {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: var(--space-2) 2px 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  user-select: none;
}
.tree-group-head:hover { background: var(--surface-3); color: var(--text-primary); }
.tree-group-head .caret { color: var(--text-tertiary); width: 10px; }
.tree-group-head.collapsed { opacity: 0.7; }
.grp-label { flex: 0 0 auto; font-weight: 600; }
.tree-group-count {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--surface-3);
  color: var(--text-tertiary);
}
.tree-empty {
  font-size: 11px;
  padding: 2px 6px;
  font-style: italic;
}
.tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 5px;
  border-radius: 6px;
  font-size: 12.5px;
}
.tree-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.tree-item:hover:not(.active) {
  background: var(--surface-3);
}
.tname {
  flex: 1;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tcount {
  font-size: 10.5px;
}

/* —— 黑板速览 —— */
.bb-head {
  cursor: pointer;
  padding: 4px 2px;
  user-select: none;
}
.bb-head:hover { color: var(--text-primary); }
.bb-head .caret { color: var(--text-tertiary); width: 10px; }
.bb-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;
}
.bb-grp {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 6px 2px 2px;
}
.bb-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-3);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.bb-card.linked { border-left: 2px solid var(--accent); }
.bb-card.local { border-left: 2px solid var(--text-secondary); }
.bb-card.avail { opacity: 0.85; }
.bb-card:hover { background: var(--surface-4); opacity: 1; }
.bb-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.bb-name {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  font-size: 12px;
}
.bb-cnt { font-size: 10.5px; }
.bb-x, .bb-plus { padding: 0 6px; min-height: 20px; font-size: 10.5px; flex: 0 0 auto; }
.bb-vars {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  font-size: 10.5px;
}
.bb-var {
  padding: 1px 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  color: var(--text-secondary);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mini { font-size: 10.5px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nowrap { white-space: nowrap; }
.muted-3 { color: var(--text-tertiary); font-size: 10.5px; }
.empty { padding: 6px 4px; font-size: 11px; }

.center {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.toolbar {
  padding: 6px 8px;
  gap: 5px;
  flex-wrap: wrap;
}
.sep {
  width: 1px;
  height: 18px;
  background: var(--line-soft);
  margin: 0 3px;
}
.canvas {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.problems-strip {
  flex: 0 0 auto;
  min-height: 80px;
  overflow: hidden;
}
.palette-sec :deep(.palette) {
  height: 100%;
}
</style>
