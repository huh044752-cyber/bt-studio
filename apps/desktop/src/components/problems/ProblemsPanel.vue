<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import type { IssueLevel } from "@btstudio/bt-core";

const ws = useWorkspaceStore();
const onlyLevel = ref<"" | IssueLevel>("");
const scope = ref<"current" | "all">("current");

// 切到"全部树"时即时全量校验;命令变更也刷新。
watch(
  () => [scope.value, ws.rev],
  () => { if (scope.value === "all") ws.validateAll(); },
  { immediate: true },
);

interface Row { level: IssueLevel; source: string; message: string; nodeId?: string; nodeType?: string; treeName?: string; treeId?: string }
const sourceList = computed<Row[]>(() => (scope.value === "all" ? ws.allIssues : ws.issues));
const items = computed(() => (onlyLevel.value ? sourceList.value.filter((i) => i.level === onlyLevel.value) : sourceList.value));
const errCount = computed(() => (scope.value === "all" ? ws.allErrorCount : ws.errorCount));
const warnCount = computed(() => (scope.value === "all" ? ws.allWarningCount : ws.warningCount));

function jump(row: Row) {
  if (scope.value === "all" && row.treeId && row.treeId !== ws.currentTreeId) ws.switchTree(row.treeId);
  if (row.nodeId) ws.selectedNodeId = row.nodeId;
}
</script>

<template>
  <div class="problems">
    <div class="bar">
      <strong class="title">问题</strong>
      <button class="btn tiny" :class="{ primary: scope === 'current' }" title="仅当前树" @click="scope = 'current'">当前树</button>
      <button class="btn tiny" :class="{ primary: scope === 'all' }" title="全部树全面校验" @click="scope = 'all'">全部树</button>
      <span class="sep" />
      <button class="btn tiny" :class="{ primary: onlyLevel === '' }" @click="onlyLevel = ''">全部</button>
      <button class="btn tiny" :class="{ primary: onlyLevel === 'error' }" @click="onlyLevel = 'error'">
        仅错误 ({{ errCount }})
      </button>
      <button class="btn tiny" :class="{ primary: onlyLevel === 'warning' }" @click="onlyLevel = 'warning'">
        仅告警 ({{ warnCount }})
      </button>
    </div>
    <div class="list scroll">
      <div v-if="items.length === 0" class="muted-2 empty">无问题 ✓</div>
      <div
        v-for="(i, idx) in items"
        :key="idx"
        class="prob-line"
        :class="{ jumpable: i.nodeId }"
        @click="jump(i)"
      >
        <span class="tag" :class="i.level">{{ i.level }}</span>
        <span v-if="scope === 'all' && i.treeName" class="tree-tag">{{ i.treeName }}</span>
        <span class="src muted-2">{{ i.source }}</span>
        <span class="msg">{{ i.message }}</span>
        <span v-if="i.nodeType" class="muted-2 nt">{{ i.nodeType }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.problems {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.bar {
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 5px 6px;
  border-bottom: 1px solid var(--line-soft);
}
.title {
  font-size: 12px;
  margin-right: 4px;
}
.sep {
  width: 1px;
  height: 14px;
  background: var(--line-soft);
  margin: 0 2px;
}
.tree-tag {
  font-size: 10px;
  background: rgba(94, 179, 255, 0.14);
  color: var(--accent);
  border-radius: 4px;
  padding: 0 5px;
}
.list {
  flex: 1;
  padding: 4px 6px;
}
.empty {
  padding: 10px;
}
.prob-line {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 4px;
  border-radius: 5px;
  font-size: 12px;
}
.prob-line.jumpable {
  cursor: pointer;
}
.prob-line.jumpable:hover {
  background: rgba(94, 179, 255, 0.07);
}
.src {
  font-size: 10.5px;
  min-width: 70px;
}
.msg {
  flex: 1;
}
.nt {
  font-size: 10.5px;
}
</style>
