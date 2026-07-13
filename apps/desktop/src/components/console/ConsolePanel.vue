<script setup lang="ts">
import { computed } from "vue";
import { useConsoleStore } from "@/stores/console";
import { useWorkspaceStore } from "@/stores/workspace";
import { saveTextFile } from "@/services/tauri";
import { useRouter } from "vue-router";
import type { LogLevel } from "@btstudio/bt-core";

const c = useConsoleStore();
const ws = useWorkspaceStore();
const router = useRouter();

const levels: { key: "all" | LogLevel; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "info", label: "信息" },
  { key: "success", label: "成功" },
  { key: "warning", label: "告警" },
  { key: "error", label: "错误" },
];

const items = computed(() => c.filtered);

function jump(logId: string) {
  const log = c.logs.find((l) => l.logId === logId);
  c.markOneRead(logId); // 点击即标记该条已读,未读计数减一
  if (log?.relatedNodeId) {
    ws.selectedNodeId = log.relatedNodeId;
    router.push("/design");
  } else if (log?.relatedAssetId) {
    if (ws.trees.find((t) => t.treeId === log.relatedAssetId)) {
      ws.switchTree(log.relatedAssetId);
      router.push("/design");
    }
  }
}
</script>

<template>
  <div class="console panel">
    <div class="console-bar">
      <button class="btn tiny collapse" :title="c.collapsed ? '展开控制台' : '隐藏控制台'" @click="c.toggleCollapsed()">
        {{ c.collapsed ? "▴" : "▾" }}
      </button>
      <strong class="title">控制台</strong>
      <span v-if="c.collapsed && c.totalUnread > 0" class="badge">{{ c.totalUnread }}</span>
      <button
        v-for="lv in levels"
        :key="lv.key"
        class="btn tiny"
        :class="{ primary: c.filter === lv.key }"
        @click="lv.key === 'all' ? (c.filter = 'all') : (c.filter = lv.key, c.markLevelRead(lv.key as LogLevel))"
      >
        {{ lv.label }}
        <span v-if="lv.key !== 'all' && c.unreadByLevel(lv.key as LogLevel) > 0" class="badge">
          {{ c.unreadByLevel(lv.key as LogLevel) }}
        </span>
      </button>
      <span class="spacer" />
      <button class="btn tiny" @click="c.markRead()">标为已读</button>
      <button class="btn tiny" @click="saveTextFile('bt-studio-console.log', c.exportText(), { filters: [{ name: '日志', extensions: ['log', 'txt'] }] })">导出日志</button>
      <button class="btn tiny danger" @click="c.clear()">清空</button>
    </div>
    <div v-show="!c.collapsed" class="console-body scroll">
      <div v-if="items.length === 0" class="muted-2 empty">暂无日志</div>
      <div
        v-for="l in items"
        :key="l.logId"
        class="log-line"
        :class="[l.level, { unread: !l.read, jumpable: l.relatedNodeId || l.relatedAssetId }]"
        @click="jump(l.logId)"
      >
        <span class="ts mono">{{ l.timestamp.slice(11, 19) }}</span>
        <span class="tag" :class="l.level">{{ l.level }}</span>
        <span class="cat muted-2">{{ l.category }}</span>
        <span class="msg">{{ l.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.console {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 10px;
}
.console-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--line-soft);
  flex-wrap: wrap;
}
.console-bar > * { flex-shrink: 0; }
.console-bar .btn { white-space: nowrap; }
.title {
  font-size: 12px;
  margin-right: 6px;
}
.badge {
  background: var(--err);
  color: #fff;
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
  margin-left: 3px;
}
.console-body {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
}
.empty {
  padding: 12px;
}
.log-line {
  display: flex;
  gap: 8px;
  padding: 2px 4px;
  border-radius: 5px;
  align-items: center;
  flex-wrap: nowrap;
  min-width: 0;
}
.log-line > .ts,
.log-line > .tag,
.log-line > .cat { flex-shrink: 0; white-space: nowrap; }
.log-line.jumpable {
  cursor: pointer;
}
.log-line.jumpable:hover {
  background: rgba(94, 179, 255, 0.08);
}
.log-line.unread {
  font-weight: 600;
}
.ts {
  color: var(--muted-2);
  font-size: 11px;
}
.cat {
  font-size: 11px;
  min-width: 64px;
  flex: 0 0 auto;
}
.msg {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
