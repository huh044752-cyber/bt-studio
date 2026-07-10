<script setup lang="ts">
import { onMounted, computed, ref } from "vue";
import { useRoute } from "vue-router";
import { navRoutes } from "./router";
import { useWorkspaceStore } from "./stores/workspace";
import { useConsoleStore } from "./stores/console";
import ConsolePanel from "./components/console/ConsolePanel.vue";
import { isTauri } from "./services/tauri";

const route = useRoute();
const ws = useWorkspaceStore();
const c = useConsoleStore();

// Tauri-only:非 Tauri 环境 (浏览器直连 vite / 用户看到 localhost 页) 阻断进入设计器,
// 避免用户误以为浏览器也是"完整应用"。App.vue 是主入口,一处拦所有页面。
const isDesktop = ref(isTauri());
const currentUrl = typeof window !== "undefined" ? window.location.href : "";

onMounted(() => {
  // 不再自动 seed:刷新后默认空状态(无树/无类型),由用户主动「新建/打开/加载示例」。
  c.info("workspace", `BT Studio 启动(${isDesktop.value ? "Tauri 桌面" : "浏览器(不支持)"}模式) · 最近工作空间 ${ws.recentWorkspaces.length} 个`);
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
  <div v-if="!isDesktop" class="browser-block">
    <div class="bb-card">
      <div class="bb-logo">BT</div>
      <h1>BT Studio 需在桌面版打开</h1>
      <p>本应用采用 Tauri-only 架构,浏览器沙箱无法访问 modelRoot 目录进行 .bt/.sm 写盘。</p>
      <ul>
        <li>请从 <code>bt-studio.exe</code> 启动 (推荐)</li>
        <li>或用 <code>pnpm --filter @btstudio/desktop tauri dev</code> 从源码开发</li>
      </ul>
      <p class="muted-2">当前 URL: {{ currentUrl }}</p>
    </div>
  </div>
  <div v-else class="app-shell">
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
.browser-block {
  display: grid;
  place-items: center;
  height: 100%;
  background: var(--surface-1);
  padding: 40px;
}
.bb-card {
  max-width: 560px;
  padding: 32px 36px;
  background: var(--surface-2);
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-1);
}
.bb-logo {
  width: 44px; height: 44px;
  display: grid; place-items: center;
  background: var(--accent); color: #fff;
  font-weight: 700; border-radius: 10px;
  margin-bottom: 20px;
}
.bb-card h1 { font-size: 18px; margin: 0 0 12px; color: var(--text-primary); }
.bb-card p { font-size: 13px; line-height: 1.6; color: var(--text-secondary); margin: 8px 0; }
.bb-card ul { padding-left: 20px; font-size: 13px; color: var(--text-secondary); line-height: 1.8; }
.bb-card code { font-family: ui-monospace, "SF Mono", Consolas, monospace; padding: 1px 6px; background: var(--surface-3); border-radius: 4px; font-size: 12px; }

.app-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  overflow: hidden;
  background: var(--surface-1);
}
.sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-1);
  padding: 14px 10px 10px;
  gap: 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px 2px;
}
.logo {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--accent);
  font-weight: 700;
  font-size: 12px;
  color: #fff;
  letter-spacing: 0.5px;
  box-shadow: var(--shadow-1);
}
.brand-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  letter-spacing: 0.1px;
}
.brand-sub {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 1px;
}
.mode-pill {
  font-size: 11px;
  padding: 4px 9px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-secondary);
  text-align: center;
  font-weight: 500;
}
.mode-pill.linked_fosim {
  color: var(--warn);
  border-color: rgba(210, 153, 34, 0.35);
  background: var(--warn-soft);
}
.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 2px;
}
.nav-group-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  margin: 2px 6px 4px;
  color: var(--text-tertiary);
  font-weight: 600;
}
.nav-item {
  display: block;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 12.5px;
  margin-bottom: 1px;
  transition: background 0.1s ease, color 0.1s ease;
  border: 1px solid transparent;
}
.nav-item:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.sidebar-foot {
  font-size: 11px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 10px;
  color: var(--text-tertiary);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sidebar-foot .err {
  color: var(--err);
}
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--surface-1);
}
.page-area {
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 12px;
  overflow: hidden;
}
.console-area {
  position: relative;
  flex: none;
  padding: 0 12px 12px;
  min-height: 36px;
}
.console-resizer {
  position: absolute;
  top: -3px;
  left: 12px;
  right: 12px;
  height: 6px;
  cursor: row-resize;
  z-index: 5;
  border-radius: 3px;
}
.console-resizer:hover {
  background: var(--accent-soft);
}
</style>
