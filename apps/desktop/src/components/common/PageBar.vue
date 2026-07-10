<script setup lang="ts">
/**
 * PageBar —— 页面顶栏统一容器。
 *
 * 目的:5 个业务页面顶栏此前各写各的(5 种 padding + 5 种 gap + 3 种首元素范式),
 *      这里收敛成一份:标题 + 副标题 + 可选彩点 + 右侧操作槽 + 帮助按钮。
 *
 * 用法:
 *   <PageBar title="类型空间" subtitle="12 个类 · 4 个枚举" help-title="类型空间 · 使用帮助">
 *     <template #actions>
 *       <ActionButton label="保存" @run="save" />
 *     </template>
 *     <template #help>
 *       <section class="help-sec">...</section>
 *     </template>
 *   </PageBar>
 */
import PageHelpButton from "./PageHelpButton.vue";

defineProps<{
  title: string;
  subtitle?: string;
  /** 品牌彩点(默认走 accent)。可传 "brand" / "warn" / "ok" / "err" 等语义色。 */
  dot?: "brand" | "ok" | "warn" | "err" | "accent-2";
  /** 有值 → 挂帮助按钮,弹窗标题即此 prop。 */
  helpTitle?: string;
  /** 帮助弹窗宽度(默认由 PageHelpButton 决定,通常 640)。 */
  helpWidth?: number;
}>();
</script>

<template>
  <header class="page-bar panel">
    <div class="pb-lead">
      <span v-if="dot" class="pb-dot" :class="`dot-${dot}`" />
      <div class="pb-title-wrap">
        <strong class="pb-title">{{ title }}</strong>
        <span v-if="subtitle" class="pb-sub muted-2">{{ subtitle }}</span>
      </div>
    </div>
    <div class="pb-actions">
      <slot name="actions" />
    </div>
    <PageHelpButton v-if="helpTitle" :title="helpTitle" :width="helpWidth">
      <slot name="help" />
    </PageHelpButton>
  </header>
</template>

<style scoped>
.page-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  flex-wrap: wrap;
}
.pb-lead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.pb-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}
.pb-dot.dot-brand { background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
.pb-dot.dot-ok { background: var(--ok); }
.pb-dot.dot-warn { background: var(--warn); }
.pb-dot.dot-err { background: var(--err); }
.pb-dot.dot-accent-2 { background: var(--accent-2); }
.pb-title-wrap {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.pb-title {
  font-size: 13.5px;
  color: var(--text-primary);
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.pb-sub {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pb-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
  flex-wrap: wrap;
}
</style>
