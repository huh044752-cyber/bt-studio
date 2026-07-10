<script setup lang="ts">
/**
 * 节点面板 —— palette。
 *
 * 拖拽已从 HTML5 draggable 换成 X6 v3.1.7 官方 Dnd:
 *  - 每项 mousedown → emit("pick", nodeType, evt) → 父页调 useNodeDnd.startFrom
 *  - 好处:ghost 与画布 1:1 对齐 + 光标不再显示禁用 ⊘
 *  - 双击继续保留 addToSelected(不经画布,直接命令层追加到智能选父)
 */
import { computed, ref } from "vue";
import { defaultRegistry, findAcceptableParent, validateConnectionRule } from "@btstudio/bt-core";
import { useWorkspaceStore } from "@/stores/workspace";

const emit = defineEmits<{ (e: "pick", nodeType: string, evt: MouseEvent): void }>();

const ws = useWorkspaceStore();
const search = ref("");

const publishable = computed(() => {
  void ws.rev;
  const kind = ws.currentTree?.projectKind ?? "behavior_tree";
  return defaultRegistry
    .listForParadigm(kind)
    .filter((d) => d.nodeType !== "Root")
    .filter((d) => !search.value || d.displayName.includes(search.value) || d.nodeType.toLowerCase().includes(search.value.toLowerCase()));
});

const restricted = computed(() => defaultRegistry.listRestricted());

/** 当前"建议挂载父"—— 用于视觉提示(soft)与 tooltip;实际落父由 useNodeDnd 智能选。 */
const targetParent = computed(() => {
  void ws.rev;
  const t = ws.currentTree;
  if (!t) return null;
  const id = ws.selectedNodeId || t.rootNodeId;
  return t.nodes[id] ?? null;
});
const targetParentLabel = computed(() => {
  const p = targetParent.value;
  if (!p) return "(无当前树)";
  const def = defaultRegistry.get(p.nodeType);
  return `${def?.displayName ?? p.nodeType} · ${p.name}`;
});

/** 是否可直接挂当前选中(不经智能选父)。仅用于视觉 `.soft`。 */
function directOk(childType: string): { ok: boolean; reason?: string } {
  const p = targetParent.value;
  if (!p) return { ok: false, reason: "先在左侧新建/选一棵树" };
  const def = defaultRegistry.get(p.nodeType);
  if (!def || def.maxChildren <= 0) return { ok: false, reason: `${p.nodeType} 是叶子,不能挂子` };
  if (p.childOrder.length >= def.maxChildren) {
    return { ok: false, reason: `${def.displayName} 子已满(${def.maxChildren})` };
  }
  const kind = ws.currentTree?.projectKind ?? "behavior_tree";
  const r = validateConnectionRule(p.nodeType, childType, kind);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true };
}

function tipFor(d: ReturnType<typeof defaultRegistry.get>): string {
  if (!d) return "";
  const lines: string[] = [`${d.displayName}(${d.nodeType})`];
  if (d.description) lines.push(`逻辑:${d.description}`);
  const inMax = d.inputPort.maxCount;
  const outMax = d.outputPort.maxCount;
  const portIn = inMax === 0 ? "无" : inMax === 1 ? "1" : `≤${inMax}`;
  const portOut = outMax === 0 ? "无" : outMax === 1 ? "1" : `≤${outMax}`;
  lines.push(`端口:输入=${portIn} · 输出=${portOut}`);
  const childInfo =
    d.maxChildren === 0 ? "叶子(无子节点)" : `子节点 ${d.minChildren}~${d.maxChildren}`;
  lines.push(`结构:${childInfo}`);
  const acc = directOk(d.nodeType);
  lines.push(acc.ok ? `✓ 可直接挂:${targetParentLabel.value}` : `~ ${targetParentLabel.value} 不直接接受(${acc.reason}) → 拖动/双击时自动向下找容量`);
  return lines.join("\n");
}

/** mousedown:交给父页启动 X6 Dnd。左键才响应,避免右键/中键误触。 */
function onPick(evt: MouseEvent, nodeType: string): void {
  if (evt.button !== 0) return;
  emit("pick", nodeType, evt);
}

/** 双击:走命令层,不经画布 dnd。 */
function addToSelected(nodeType: string) {
  const t = ws.currentTree;
  if (!t) return;
  const seed = ws.selectedNodeId || t.rootNodeId;
  const parent = findAcceptableParent(t, seed, nodeType);
  if (!parent) return;
  const res = ws.run({ kind: "AddNode", nodeType, parentNodeId: parent });
  if (res?.ok && res.createdNodeId) ws.selectedNodeId = res.createdNodeId;
}

const categories = computed(() => {
  const map = new Map<string, typeof publishable.value>();
  for (const d of publishable.value) {
    if (!map.has(d.category)) map.set(d.category, []);
    map.get(d.category)!.push(d);
  }
  return [...map.entries()];
});
</script>

<template>
  <div class="palette col">
    <input v-model="search" class="input" placeholder="搜索节点类型…" />
    <div class="parent-hint muted-2" :title="'新节点智能选父的种子:' + targetParentLabel">
      种子父:<b class="fg">{{ targetParentLabel }}</b>
    </div>
    <div class="scroll cats">
      <div v-for="[cat, defs] in categories" :key="cat" class="cat">
        <div class="cat-title muted-2">{{ cat }}</div>
        <div
          v-for="d in defs"
          :key="d.nodeType"
          class="node-item"
          :class="{ soft: !directOk(d.nodeType).ok }"
          :title="tipFor(d)"
          @mousedown="onPick($event, d.nodeType)"
          @dblclick="addToSelected(d.nodeType)"
        >
          <span class="dot" :class="d.colorToken" />
          <span class="nm">{{ d.displayName }}</span>
          <span class="kind mono muted-2">{{ d.nodeType }}</span>
        </div>
      </div>
      <div v-if="restricted.length" class="cat">
        <div class="cat-title muted-2">受限(不可发布)</div>
        <div v-for="d in restricted" :key="d.nodeType" class="node-item restricted" :title="'受限:仅查看/删除/替换'">
          <span class="dot muted" />
          <span class="nm">{{ d.displayName }}</span>
        </div>
      </div>
    </div>
    <div class="hint muted-2">
      按住拖到画布,或双击加到"种子父"。淡色 = 种子父不直接接受,拖/双击时会自动向下找有容量的父。
    </div>
  </div>
</template>

<style scoped>
.palette { height: 100%; }
.cats { flex: 1; }
.cat { margin-bottom: 8px; }
.cat-title {
  font-size: 10px;
  text-transform: uppercase;
  margin: 6px 2px 3px;
}
.node-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: 7px;
  cursor: grab;
  border: 1px solid transparent;
  user-select: none;
}
.node-item:active { cursor: grabbing; }
.node-item:hover {
  background: rgba(94, 179, 255, 0.07);
  border-color: var(--border-subtle, var(--line-soft));
}
.node-item.restricted {
  opacity: 0.55;
  cursor: not-allowed;
}
.node-item.soft { opacity: 0.62; }
.node-item.soft:hover { opacity: 0.9; }
.parent-hint {
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--surface-3);
  border: 1px solid var(--border-subtle, var(--line-soft));
  margin: 4px 0 2px;
}
.parent-hint .fg { color: var(--text-primary, var(--fg)); font-weight: 600; }
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}
.dot.accent-2 { background: var(--accent-2); }
.dot.ok { background: var(--ok); }
.dot.warn { background: var(--warn); }
.dot.err { background: var(--err); }
.dot.muted { background: var(--text-tertiary, var(--muted-2)); }
.nm { flex: 1; font-size: 12.5px; }
.kind { font-size: 10px; }
.hint { font-size: 10.5px; padding: 4px 2px; }
</style>
