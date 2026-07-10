<script setup lang="ts">
import { ref, computed } from "vue";
import { defaultRegistry, validateConnectionRule } from "@btstudio/bt-core";
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

/** 当前拖拽/双击的目标父节点(选中优先,否则 Root)。 */
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

/** 某类型能否作为 targetParent 的新子(容量 + 类型规则)。用于视觉预判。 */
function acceptable(childType: string): { ok: boolean; reason?: string } {
  const p = targetParent.value;
  if (!p) return { ok: false, reason: "没有父节点(先选一个节点)" };
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

function onDragStart(e: DragEvent, nodeType: string) {
  // 始终允许拖:onDrop 里会智能选父(选中→后代→Root)。这里只透传类型。
  e.dataTransfer?.setData("application/x-node-type", nodeType);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
}

/** 悬停提示:逻辑描述 + 端口描述 + 当前是否可挂到选中父。 */
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
  const acc = acceptable(d.nodeType);
  lines.push(acc.ok ? `✓ 可挂到:${targetParentLabel.value}` : `✗ 不能挂到 ${targetParentLabel.value} — ${acc.reason}`);
  return lines.join("\n");
}

function addToSelected(nodeType: string) {
  // 双击也走"智能选父":选中不接受 → 找有容量的可组合后代 → 再回落到 Root。
  const t = ws.currentTree;
  if (!t) return;
  const seed = ws.selectedNodeId || t.rootNodeId;
  const parent = findAcceptableParent(seed, nodeType);
  if (!parent) return;
  const res = ws.run({ kind: "AddNode", nodeType, parentNodeId: parent });
  if (res?.ok && res.createdNodeId) ws.selectedNodeId = res.createdNodeId;
}

/**
 * 从 seed 出发,找第一个能收 childType 的父节点。
 *  1) seed 自身可收 → 用 seed
 *  2) 沿 childOrder 深度优先 → 第一个可收的可组合后代
 *  3) 回落 Root
 * 都不行 → null(整棵树都没地方挂)。
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
    <div class="parent-hint muted-2" :title="'新节点会挂到:' + targetParentLabel">
      挂载父:<b class="fg">{{ targetParentLabel }}</b>
    </div>
    <div class="scroll cats">
      <div v-for="[cat, defs] in categories" :key="cat" class="cat">
        <div class="cat-title muted-2">{{ cat }}</div>
        <div
          v-for="d in defs"
          :key="d.nodeType"
          class="node-item"
          :class="{ soft: !acceptable(d.nodeType).ok }"
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
    <div class="hint muted-2">
      拖到画布 / 双击 都会自动挂到"选中→后代→Root"里第一个有容量的父。淡色 = 当前选中不接受,会自动向下找合适位置。
    </div>
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
.node-item.blocked {
  opacity: 0.42;
  cursor: not-allowed;
}
.node-item.blocked:hover {
  background: transparent;
  border-color: transparent;
}
.node-item.soft { opacity: 0.62; }
.node-item.soft:hover { opacity: 0.9; }
.parent-hint {
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--surface-3, rgba(122,156,193,0.08));
  border: 1px solid var(--line-soft);
  margin: 4px 0 2px;
}
.parent-hint .fg { color: var(--fg); font-weight: 600; }
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
