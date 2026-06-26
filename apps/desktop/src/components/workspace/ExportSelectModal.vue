<script setup lang="ts">
/**
 * 导出选择对话框:列出所有行为树/状态机,允许用户勾选要包含到本次导出的项。
 * 复用于「保存 XML」「生成 C++ 工程」两条路径(都把 selected ids 透传给 store)。
 * 默认全选;支持快捷「全选 / 反选 / 仅 BT / 仅 FSM」。
 */
import { ref, computed, watch } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import ModalDialog from "@/components/common/ModalDialog.vue";

const props = defineProps<{ open: boolean; title?: string; okLabel?: string }>();
const emit = defineEmits<{ (e: "ok", treeIds: string[]): void; (e: "cancel"): void }>();

const ws = useWorkspaceStore();
const selected = ref<Set<string>>(new Set());

watch(
  () => props.open,
  (v) => {
    // 每次打开都重置为「全选」(用户最常见意图)。
    if (v) selected.value = new Set(ws.trees.map((t) => t.treeId));
  },
);

const bts = computed(() => ws.trees.filter((t) => (t.projectKind ?? "behavior_tree") !== "state_machine"));
const fsms = computed(() => ws.trees.filter((t) => (t.projectKind ?? "behavior_tree") === "state_machine"));

const allChecked = computed(() => ws.trees.length > 0 && selected.value.size === ws.trees.length);
const noneChecked = computed(() => selected.value.size === 0);

function toggle(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function selectAll(): void {
  selected.value = new Set(ws.trees.map((t) => t.treeId));
}
function selectNone(): void {
  selected.value = new Set();
}
function selectInvert(): void {
  const all = ws.trees.map((t) => t.treeId);
  selected.value = new Set(all.filter((id) => !selected.value.has(id)));
}
function selectOnly(kind: "bt" | "fsm"): void {
  const list = kind === "bt" ? bts.value : fsms.value;
  selected.value = new Set(list.map((t) => t.treeId));
}

function confirm(): void {
  emit("ok", [...selected.value]);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="title ?? '选择要导出的行为树与状态机'"
    :ok-label="okLabel ?? '确定导出'"
    :ok-disabled="noneChecked"
    :width="560"
    @ok="confirm"
    @cancel="emit('cancel')"
  >
    <div class="bar">
      <span class="bar-info">
        已选 <strong>{{ selected.size }}</strong> / {{ ws.trees.length }}
        <span v-if="noneChecked" class="warn">至少选择一项</span>
      </span>
      <span class="spacer" />
      <button class="btn tiny" :disabled="allChecked" @click="selectAll">全选</button>
      <button class="btn tiny" @click="selectInvert">反选</button>
      <button class="btn tiny" :disabled="noneChecked" @click="selectNone">清空</button>
    </div>

    <section v-if="bts.length" class="grp">
      <header class="grp-head">
        <span class="kind bt">行为树</span>
        <span class="grp-meta">{{ bts.length }} 棵</span>
        <span class="spacer" />
        <button class="link" @click="selectOnly('bt')">仅选行为树</button>
      </header>
      <ul class="list">
        <li v-for="t in bts" :key="t.treeId" :class="{ on: selected.has(t.treeId) }">
          <label>
            <input type="checkbox" :checked="selected.has(t.treeId)" @change="toggle(t.treeId)" />
            <span class="name">{{ t.displayName || t.treeName }}</span>
            <span class="meta">{{ Object.keys(t.nodes).length }} 节点</span>
          </label>
        </li>
      </ul>
    </section>

    <section v-if="fsms.length" class="grp">
      <header class="grp-head">
        <span class="kind fsm">状态机</span>
        <span class="grp-meta">{{ fsms.length }} 个</span>
        <span class="spacer" />
        <button class="link" @click="selectOnly('fsm')">仅选状态机</button>
      </header>
      <ul class="list">
        <li v-for="t in fsms" :key="t.treeId" :class="{ on: selected.has(t.treeId) }">
          <label>
            <input type="checkbox" :checked="selected.has(t.treeId)" @change="toggle(t.treeId)" />
            <span class="name">{{ t.displayName || t.treeName }}</span>
            <span class="meta">{{ Object.keys(t.nodes).length }} 节点</span>
          </label>
        </li>
      </ul>
    </section>

    <div v-if="!ws.trees.length" class="empty">当前工作空间无任何行为树或状态机。</div>
  </ModalDialog>
</template>

<style scoped>
.bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 4px 8px; border-bottom: 1px dashed var(--line-soft);
  margin-bottom: 8px; font-size: 11.5px;
}
.bar-info { color: var(--muted); }
.bar-info strong { color: var(--accent); }
.bar-info .warn { color: var(--err); margin-left: 8px; }
.spacer { flex: 1; }

.grp { margin-bottom: 10px; }
.grp-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 6px; font-size: 11.5px;
}
.grp-meta { color: var(--muted-2); font-size: 11px; }
.kind {
  font-size: 10.5px; padding: 1px 7px; border-radius: 8px;
}
.kind.bt { color: var(--accent); background: rgba(94,179,255,0.12); border: 1px solid rgba(94,179,255,0.28); }
.kind.fsm { color: var(--warn, #f5b65c); background: rgba(245,182,92,0.12); border: 1px solid rgba(245,182,92,0.28); }
.link {
  background: transparent; border: none; color: var(--accent);
  font-size: 11px; cursor: pointer; padding: 2px 4px; border-radius: 4px;
}
.link:hover { background: rgba(94,179,255,0.1); }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.list li {
  border-radius: 5px;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.015);
  transition: background 0.1s, border-color 0.1s;
}
.list li:hover { background: rgba(94,179,255,0.05); }
.list li.on { background: rgba(94,179,255,0.08); border-color: rgba(94,179,255,0.22); }
.list li label {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer; font-size: 12px;
}
.list .name { flex: 1; color: var(--text); }
.list .meta { color: var(--muted-2); font-size: 11px; }

.empty {
  padding: 24px 8px; text-align: center; color: var(--muted-2); font-size: 12px;
}
</style>
