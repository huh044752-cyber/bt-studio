<script setup lang="ts">
/**
 * 节点面板 —— palette。
 *
 * 拖拽走 X6 v3.1.7 Dnd:mousedown → emit('pick') → 父页调 useNodeDnd.startFrom。
 * 落到画布 = 独立孤儿节点(不自动挂父),用户在画布上拖端口手动连线。
 * 双击 = 同样落孤儿(不再"智能选父"),行为一致。
 */
import { computed, ref } from "vue";
import { defaultRegistry } from "@btstudio/bt-core";
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
  lines.push("拖到画布落节点(不自动连线,请在画布上拖端口连接)");
  return lines.join("\n");
}

/** mousedown:交给父页启动 X6 Dnd。左键才响应。 */
function onPick(evt: MouseEvent, nodeType: string): void {
  if (evt.button !== 0) return;
  emit("pick", nodeType, evt);
}

/** 双击 = 直接在画布空白处落一个孤儿节点(不自动挂父)。 */
function addOrphan(nodeType: string) {
  const t = ws.currentTree;
  if (!t) return;
  const res = ws.run({ kind: "AddNode", nodeType });
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
    <div class="scroll cats">
      <div v-for="[cat, defs] in categories" :key="cat" class="cat">
        <div class="cat-title muted-2">{{ cat }}</div>
        <div
          v-for="d in defs"
          :key="d.nodeType"
          class="node-item"
          :title="tipFor(d)"
          @mousedown="onPick($event, d.nodeType)"
          @dblclick="addOrphan(d.nodeType)"
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
      按住拖到画布 / 双击 都落<b>孤儿节点</b>,不自动挂父。在画布上从节点端口拖出连线到目标节点端口来连接。
    </div>
  </div>
</template>

<style scoped>
.palette { height: 100%; }
.cats { flex: 1; }
.cat { margin-bottom: var(--space-2); }
.cat-title {
  font-size: 10px;
  text-transform: uppercase;
  margin: var(--space-2) 2px var(--space-1);
}
.node-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: var(--radius-md);
  cursor: grab;
  border: 1px solid transparent;
  user-select: none;
}
.node-item:active { cursor: grabbing; }
.node-item:hover {
  background: var(--surface-3);
  border-color: var(--border-subtle);
}
.node-item.restricted {
  opacity: 0.55;
  cursor: not-allowed;
}
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
.dot.muted { background: var(--text-tertiary); }
.nm { flex: 1; font-size: 12.5px; }
.kind { font-size: 10px; }
.hint { font-size: 10.5px; padding: 4px 2px; }
</style>
