<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { navRoutes } from "./router";
import { useWorkspaceStore } from "./stores/workspace";
import { useConsoleStore } from "./stores/console";
import ConsolePanel from "./components/console/ConsolePanel.vue";
import { isTauri } from "./services/tauri";

const route = useRoute();
const ws = useWorkspaceStore();
const c = useConsoleStore();

onMounted(() => {
  // 不再自动 seed:刷新后默认空状态(无树/无类型),由用户主动「新建/打开/加载示例」。
  // 最近工作空间列表已在 store 初始化时从 localStorage 还原。
  c.info("workspace", `BT Studio 启动(${isTauri() ? "Tauri" : "浏览器预览"}模式) · 最近工作空间 ${ws.recentWorkspaces.length} 个`);
});

// 控制台高度拖拽(向上拖增大)。
let startY = 0;
let startH = 0;
function onConsoleResizeMove(e: PointerEvent) {
  c.setHeight(startH + (startY - e.clientY));
}
function endConsoleResize() {
  window.removeEventListener("pointermove", onConsoleResizeMove);
  window.removeEventListener("pointerup", endConsoleResize);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}
function startConsoleResize(e: PointerEvent) {
  startY = e.clientY;
  startH = c.height;
  window.addEventListener("pointermove", onConsoleResizeMove);
  window.addEventListener("pointerup", endConsoleResize);
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
}

const groups = computed(() => {
  const map = new Map<string, typeof navRoutes>();
  for (const r of navRoutes) {
    const g = (r.meta as { group: string }).group;
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(r);
  }
  return [...map.entries()];
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo">BT</span>
        <div>
          <div class="brand-title">BT Studio</div>
          <div class="brand-sub muted-2">行为树设计平台</div>
        </div>
      </div>
      <div class="mode-pill" :class="ws.mode">
        模式:{{ ws.mode === "standalone" ? "Standalone" : "Linked FOSim" }}
      </div>
      <nav class="nav scroll">
        <div v-for="[g, rs] in groups" :key="g" class="nav-group">
          <div class="nav-group-title muted-2">{{ g }}</div>
          <RouterLink
            v-for="r in rs"
            :key="r.path"
            :to="r.path"
            class="nav-item"
            :class="{ active: route.path === r.path }"
          >
            {{ (r.meta as any).title }}
          </RouterLink>
        </div>
      </nav>
      <div class="sidebar-foot muted-2">
        <div>树:{{ ws.trees.length }}</div>
        <div :class="{ err: ws.errorCount > 0 }">Error:{{ ws.errorCount }} · Warn:{{ ws.warningCount }}</div>
      </div>
    </aside>

    <main class="main">
      <div class="page-area">
        <RouterView />
      </div>
      <div class="console-area" :style="{ height: (c.collapsed ? 36 : c.height) + 'px' }">
        <div v-if="!c.collapsed" class="console-resizer" title="拖拽调整控制台高度" @pointerdown="startConsoleResize" />
        <ConsolePanel />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 210px 1fr;
  grid-template-rows: minmax(0, 1fr); /* 行高锁定到视口,子项可收缩 → 内部滚动而非整体溢出 */
  height: 100%;
  overflow: hidden;
}
.sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line-soft);
  background: linear-gradient(180deg, rgba(10, 18, 28, 0.96), rgba(6, 12, 20, 0.96));
  padding: 12px 10px;
  gap: 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--accent), #2c6da3);
  font-weight: 800;
  color: #04121f;
}
.brand-title {
  font-weight: 700;
  font-size: 15px;
}
.brand-sub {
  font-size: 11px;
}
.mode-pill {
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 7px;
  border: 1px solid var(--line-soft);
  text-align: center;
}
.mode-pill.linked_fosim {
  color: var(--accent-2);
  border-color: rgba(245, 182, 92, 0.4);
}
.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.nav-group-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 2px 4px 4px;
}
.nav-item {
  display: block;
  padding: 6px 10px;
  border-radius: 7px;
  color: var(--muted);
  font-size: 12.5px;
  margin-bottom: 2px;
}
.nav-item:hover {
  background: rgba(94, 179, 255, 0.07);
  color: var(--text);
}
.nav-item.active {
  background: rgba(94, 179, 255, 0.14);
  color: #fff;
  border: 1px solid rgba(94, 179, 255, 0.3);
}
.sidebar-foot {
  font-size: 11px;
  border-top: 1px solid var(--line-soft);
  padding-top: 8px;
}
.sidebar-foot .err {
  color: var(--err);
}
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0; /* grid 子项允许收缩,避免被内容撑高 */
  height: 100%;
  overflow: hidden;
}
.page-area {
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 12px;
  overflow: hidden; /* 页面本身不滚动;由各页内部的 .scroll 区域滚动 */
}
.console-area {
  position: relative;
  flex: none; /* 固定在底部,始终可见,不被页面内容挤走 */
  padding: 0 12px 12px;
  min-height: 36px;
}
.console-resizer {
  position: absolute;
  top: -3px;
  left: 12px;
  right: 12px;
  height: 7px;
  cursor: row-resize;
  z-index: 5;
}
.console-resizer:hover {
  background: rgba(94, 179, 255, 0.3);
  border-radius: 3px;
}
</style>
