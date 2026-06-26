<script setup lang="ts">
import { ref, computed } from "vue";
import { defaultRegistry } from "@btstudio/bt-core";
import { useWorkspaceStore } from "@/stores/workspace";

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

const showRoot = computed(() => {
  void ws.rev;
  const kind = ws.currentTree?.projectKind ?? "behavior_tree";
  return kind === "state_machine" ? defaultRegistry.get("Root") : null;
});
const restricted = computed(() => defaultRegistry.listRestricted());

function onDragStart(e: DragEvent, nodeType: string) {
  e.dataTransfer?.setData("application/x-node-type", nodeType);
}

/** 悬停提示:逻辑描述 + 端口描述(行为树 / 状态机统一,鼠标悬停显示)。 */
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
  return lines.join("\n");
}

function addToSelected(nodeType: string) {
  const sel = ws.selectedNodeId || ws.currentTree?.rootNodeId;
  ws.run({ kind: "AddNode", nodeType, parentNodeId: sel });
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
          draggable="true"
          :title="tipFor(d)"
          @dragstart="onDragStart($event, d.nodeType)"
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
    <div class="hint muted-2">拖拽到画布创建,或双击加到选中节点下</div>
  </div>
</template>

<style scoped>
.palette {
  height: 100%;
}
.cats {
  flex: 1;
}
.cat {
  margin-bottom: 8px;
}
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
}
.node-item:hover {
  background: rgba(94, 179, 255, 0.07);
  border-color: var(--line-soft);
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
.dot.muted { background: var(--muted-2); }
.nm {
  flex: 1;
  font-size: 12.5px;
}
.kind {
  font-size: 10px;
}
.hint {
  font-size: 10.5px;
  padding: 4px 2px;
}
</style>
