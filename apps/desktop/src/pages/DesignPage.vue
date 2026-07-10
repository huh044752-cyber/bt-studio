<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import { useGraphEditor } from "@/composables/useGraphEditor";
import NodePalette from "@/components/palette/NodePalette.vue";
import PropertiesPanel from "@/components/properties/PropertiesPanel.vue";
import ProblemsPanel from "@/components/problems/ProblemsPanel.vue";
import ActionButton from "@/components/common/ActionButton.vue";
import ModalDialog from "@/components/common/ModalDialog.vue";
import PageHelpButton from "@/components/common/PageHelpButton.vue";
import { writeArtifact } from "@/services/tauri";
import { defaultRegistry, validateConnectionRule } from "@btstudio/bt-core";

const ws = useWorkspaceStore();
const c = useConsoleStore();
const editor = useGraphEditor(ws);
const canvasEl = ref<HTMLElement | null>(null);
// 剪贴板移入 store(跨页/跨树持久),修复"新建树后粘贴显示剪贴板为空"。

async function exportXml() {
  const t = ws.currentTree;
  if (!t) throw new Error("无当前树");
  if (ws.isStateMachine) {
    const r = ws.exportFsmCurrent();
    if (!r.ok || !r.xml) throw new Error(r.error);
    const out = await writeArtifact(`${t.treeName}.fsm.xml`, r.xml);
    c.success("export", `导出状态机 → ${out.path}`);
    return;
  }
  const res = ws.exportCurrent();
  if (!res.ok || !res.artifacts) throw new Error(res.error);
  const out = await writeArtifact(`${t.treeName}.bt.xml`, res.artifacts.xml);
  c.success("export", `导出行为树 → ${out.path}`);
}

onMounted(async () => {
  if (canvasEl.value) {
    await editor.init(canvasEl.value);
    editor.sync(ws.currentTree);
    nextTick(() => editor.fit());
  }
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
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
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === "z") { e.preventDefault(); ws.undo(); }
  else if (ctrl && e.key === "y") { e.preventDefault(); ws.redo(); }
  else if (e.key === "Delete") { e.preventDefault(); del(); }
  else if (ctrl && e.key === "c") { copy(); }
  else if (ctrl && e.key === "v") { paste(); }
}

function del() {
  if (ws.selectedNodeId && ws.selectedNodeId !== ws.currentTree?.rootNodeId) {
    ws.run({ kind: "DeleteNode", nodeId: ws.selectedNodeId });
  }
}
interface ClipNode { nodeType: string; name: string; init: Record<string, unknown>; children: ClipNode[] }

/** 递归快照子树:节点属性(去 id/childOrder)+ 子节点。 */
function snapshotSubtree(nodeId: string): ClipNode | null {
  const t = ws.currentTree;
  const n = t?.nodes[nodeId];
  if (!t || !n) return null;
  // 去 id/childOrder/transitionTarget(目标 State 在新树不存在,引用会悬挂)。
  const { nodeId: _i, childOrder: _c, transitionTarget: _t, ...rest } = n as unknown as Record<string, unknown>;
  return {
    nodeType: String(n.nodeType),
    name: String(n.name ?? ""),
    init: JSON.parse(JSON.stringify(rest)),
    children: (n.childOrder ?? []).map((c2) => snapshotSubtree(c2)).filter((x): x is ClipNode => !!x),
  };
}

function copy() {
  const n = ws.selectedNode;
  if (!n) { c.warning("canvas", "未选中节点"); return; }
  if (n.nodeType === "Root") { c.warning("canvas", "根节点不可复制"); return; }
  ws.clipboard = snapshotSubtree(n.nodeId);
  const count = countClip(ws.clipboard as ClipNode);
  c.info("canvas", `复制子树「${n.name}」(${n.nodeType},共 ${count} 节点)`);
}

function countClip(c2: ClipNode): number {
  return 1 + (c2.children?.reduce((s, x) => s + countClip(x), 0) ?? 0);
}

/** 递归粘贴子树:返回新建的节点数。 */
function pasteSubtree(clip: ClipNode, parentNodeId: string | undefined): number {
  const res = ws.run({ kind: "AddNode", nodeType: clip.nodeType, name: clip.name, parentNodeId, init: clip.init });
  if (!res?.ok || !res.createdNodeId) return 0;
  let n = 1;
  for (const child of clip.children ?? []) n += pasteSubtree(child, res.createdNodeId);
  return n;
}

function paste() {
  if (!ws.clipboard) { c.warning("canvas", "剪贴板为空"); return; }
  const clip = ws.clipboard as ClipNode;
  const parent = ws.selectedNodeId || ws.currentTree?.rootNodeId;
  const n = pasteSubtree(clip, parent);
  if (n > 0) c.success("canvas", `粘贴子树「${clip.name}」共 ${n} 节点 → 父 ${parent ?? "(根)"}`);
  else c.warning("canvas", "粘贴失败(检查父节点是否允许该子节点)");
}

const canvasDragOver = ref(false);
function onDragOverCanvas(e: DragEvent) {
  e.preventDefault();
  canvasDragOver.value = true;
}
function onDragLeaveCanvas() { canvasDragOver.value = false; }

/**
 * 智能选父:从 seed 出发,自身可收 → seed;否则深度优先在其子树里找;
 * 再回落 Root。用于"用户选了个叶子(Action),拖了 Sequence 也能落"这种场景。
 */
function findAcceptableParent(seedId: string, childType: string): string | null {
  const t = ws.currentTree;
  if (!t) return null;
  const kind = t.projectKind ?? "behavior_tree";
  const canTake = (pid: string): boolean => {
    const p = t.nodes[pid];
    if (!p) return false;
    const def = defaultRegistry.get(p.nodeType);
    if (!def || def.maxChildren <= 0) return false;
    if (p.childOrder.length >= def.maxChildren) return false;
    return validateConnectionRule(p.nodeType, childType, kind).ok;
  };
  if (canTake(seedId)) return seedId;
  const seen = new Set<string>();
  const stack = [seedId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id !== seedId && canTake(id)) return id;
    const n = t.nodes[id];
    if (n) for (const c of n.childOrder) stack.push(c);
  }
  if (t.rootNodeId !== seedId && canTake(t.rootNodeId)) return t.rootNodeId;
  return null;
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  canvasDragOver.value = false;
  const nodeType = e.dataTransfer?.getData("application/x-node-type");
  if (!nodeType) return;
  const graph = editor.graphRef.value;
  const p = graph ? graph.clientToLocal(e.clientX, e.clientY) : { x: 240, y: 240 };
  const t = ws.currentTree;
  if (!t) { c.warning("canvas", "当前没有树,先在左侧新建一棵"); return; }
  const seed = ws.selectedNodeId || t.rootNodeId;
  const parent = findAcceptableParent(seed, nodeType);
  if (!parent) {
    c.warning("canvas", `没有能收 ${nodeType} 的父节点(容量已满或类型规则不合)`);
    return;
  }
  const res = ws.run({ kind: "AddNode", nodeType, parentNodeId: parent, x: p.x, y: p.y });
  if (!res?.ok) { c.warning("canvas", `创建 ${nodeType} 失败:${res?.reason ?? "未知"}`); return; }
  // 自动选中新节点 → 下一次拖会自然向下级联,不再"选中 Root 后所有子容量满就没法拖"。
  if (res.createdNodeId) ws.selectedNodeId = res.createdNodeId;
}

// 新建工程弹窗(行为树 / 状态机)
const createOpen = ref(false);
const createKind = ref<"behavior_tree" | "state_machine">("behavior_tree");
const createName = ref("");
function openCreate(kind: "behavior_tree" | "state_machine") {
  createKind.value = kind;
  createName.value = "";
  createOpen.value = true;
}
function confirmCreate() {
  const fallback = createKind.value === "state_machine" ? `fsm_${ws.trees.length + 1}` : `tree_${ws.trees.length + 1}`;
  ws.newTree(createName.value.trim() || fallback, createKind.value);
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

// 面板:抽屉式隐藏(覆盖在画布上,不挤压中间画布)+ 可拖拽改宽。
const leftOpen = ref(true);
const rightOpen = ref(true);
const problemsOpen = ref(true);
const leftW = ref(240);
const rightW = ref(300);

let resizeSide: "left" | "right" | null = null;
let startX = 0;
let startW = 0;
function onResizeMove(e: PointerEvent) {
  if (!resizeSide) return;
  const dx = e.clientX - startX;
  const raw = resizeSide === "left" ? startW + dx : startW - dx;
  const w = Math.min(560, Math.max(180, raw));
  if (resizeSide === "left") leftW.value = w;
  else rightW.value = w;
}
function endResize() {
  resizeSide = null;
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", endResize);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}
function startResize(side: "left" | "right", e: PointerEvent) {
  resizeSide = side;
  startX = e.clientX;
  startW = side === "left" ? leftW.value : rightW.value;
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", endResize);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
}
const currentKind = computed(() => (ws.currentTree?.projectKind === "state_machine" ? "状态机" : "行为树"));
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
      <button class="btn tiny" @click="copy">复制</button>
      <button class="btn tiny" @click="paste">粘贴</button>
      <button class="btn tiny danger" @click="del">删除</button>
      <span class="sep" />
      <button class="btn tiny" @click="ws.layout()">自动布局</button>
      <button class="btn tiny" @click="editor.fit()">适配画布</button>
      <button class="btn tiny" @click="editor.zoomBy(0.15)" title="放大">＋</button>
      <button class="btn tiny" @click="editor.zoomBy(-0.15)" title="缩小">－</button>
      <button class="btn tiny" @click="editor.resetZoom()" title="100%">1:1</button>
      <span class="sep" />
      <ActionButton label="导出XML" :disabled="!canExport" @run="exportXml" />
      <span class="tag info">{{ currentKind }}</span>
      <span class="tag" :class="canExport ? 'success' : 'error'">
        {{ canExport ? "可导出" : `阻断 ${ws.errorCount}` }}
      </span>
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
            <li><code>Delete</code> — 删除选中</li>
            <li><code>+</code> / <code>-</code> — 放大 / 缩小</li>
          </ul>
        </section>
        <div class="help-note">
          校验分 Error / Warning / Info,<strong>有 Error 时禁止导出 / 挂接</strong>。问题区(顶栏"▾问题")展示逐条错误 + 定位。
        </div>
      </PageHelpButton>
    </div>

    <!-- 画布区(抽屉覆盖其上,切换不挤压画布) -->
    <div class="body">
      <!-- 中间画布 -->
      <div class="center col">
        <div
          ref="canvasEl"
          class="canvas panel"
          :class="{ 'drop-hot': canvasDragOver }"
          @drop="onDrop"
          @dragover="onDragOverCanvas"
          @dragleave="onDragLeaveCanvas"
        />
        <div v-if="problemsOpen" class="problems-strip panel">
          <ProblemsPanel />
        </div>
      </div>

      <!-- 左抽屉 -->
      <div class="drawer left panel" :class="{ open: leftOpen }" :style="{ width: leftW + 'px' }">
        <div class="left-sec">
          <div class="sec-head">
            <strong>项目树</strong>
            <span class="spacer" />
            <button class="btn tiny" title="刷新" @click="ws.bump()">刷新</button>
            <button class="btn tiny" title="收起抽屉" @click="leftOpen = false">✕</button>
          </div>
          <div class="row new-tree">
            <button class="btn tiny primary" @click="openCreate('behavior_tree')" title="新建行为树">+ 行为树</button>
            <button class="btn tiny" @click="openCreate('state_machine')" title="新建状态机">+ 状态机</button>
          </div>
          <div class="tree-list scroll">
            <div
              v-for="t in ws.trees"
              :key="t.treeId"
              class="tree-item"
              :class="{ active: t.treeId === ws.currentTreeId }"
            >
              <input type="checkbox" :checked="selectedIds.has(t.treeId)" @change="toggleSel(t.treeId)" />
              <span class="tname" @click="ws.switchTree(t.treeId)">{{ t.displayName }}</span>
              <span class="tcount muted-2">{{ Object.keys(t.nodes).length }}</span>
            </div>
          </div>
          <div class="row">
            <button class="btn tiny danger" :disabled="selectedIds.size === 0" @click="batchDelete">
              批量删除 ({{ selectedIds.size }})
            </button>
          </div>
        </div>
        <div class="left-sec palette-sec">
          <div class="sec-head"><strong>节点库</strong></div>
          <NodePalette />
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
        <input class="input" v-model="createName" :placeholder="createKind === 'state_machine' ? 'fsm_1' : 'tree_1'" @keyup.enter="confirmCreate" />
      </label>
      <div class="muted-2" style="font-size: 11px">类型:{{ createKind === "state_machine" ? "状态机(State/转移)" : "行为树(BT 节点)" }}</div>
    </ModalDialog>
  </div>
</template>

<style scoped>
.dlg-fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dlg-fld > span { color: var(--muted); }
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
.palette-sec {
  flex: 1;
  min-height: 0;
}
.sec-head {
  display: flex;
  align-items: center;
  font-size: 12px;
  padding: 2px 0;
}
.new-tree {
  gap: 5px;
}
.tree-list {
  max-height: 160px;
  min-height: 60px;
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
}
.tcount {
  font-size: 10.5px;
}
.center {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-width: 0;
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
  transition: outline-color 0.15s ease, background 0.15s ease;
  outline: 2px dashed transparent;
  outline-offset: -6px;
}
.canvas.drop-hot {
  outline-color: var(--accent, #5eb3ff);
  background: var(--accent-soft, rgba(94, 179, 255, 0.06));
}
.problems-strip {
  height: 150px;
}
.palette-sec :deep(.palette) {
  height: 100%;
}
</style>
