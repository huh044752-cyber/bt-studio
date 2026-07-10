<script setup lang="ts">
/**
 * Card —— 全站统一卡片容器。
 *
 * 目的:5 页面里 4 种自造卡片底色(rgba(20,28,40,0.4) / --surface-2 /
 *      rgba(255,255,255,0.018) / rgba(94,179,255,0.06)),此处收敛。
 *
 * variant:
 *   elevated (默认) —— --surface-2 底 + border-default 边 + shadow-1
 *   outlined —— 无底,只描边
 *   subtle —— --surface-3 轻底,无边(嵌在 elevated 里的子卡)
 *
 * 用法:
 *   <Card title="全局黑板" subtitle="跨树共享">
 *     <template #actions><button class="btn tiny">新建</button></template>
 *     <ul>…</ul>
 *   </Card>
 */
defineProps<{
  title?: string;
  subtitle?: string;
  variant?: "elevated" | "outlined" | "subtle";
  /** 让 body 出现内滚动条(用于抽屉/固定高度容器) */
  scrollBody?: boolean;
}>();
</script>

<template>
  <section class="card" :class="`v-${variant ?? 'elevated'}`">
    <header v-if="title || $slots.actions" class="card-head">
      <div class="card-title-wrap">
        <strong v-if="title" class="card-title">{{ title }}</strong>
        <span v-if="subtitle" class="card-sub muted-2">{{ subtitle }}</span>
      </div>
      <div v-if="$slots.actions" class="card-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="card-body" :class="{ scroll: scrollBody }">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: var(--radius-lg);
}
.v-elevated {
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-1);
}
.v-outlined {
  background: transparent;
  border: 1px solid var(--border-default);
}
.v-subtle {
  background: var(--surface-3);
  border: 1px solid transparent;
}
.card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}
.card-title-wrap {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.card-title {
  font-size: 12.5px;
  color: var(--text-primary);
  letter-spacing: 0.01em;
}
.card-sub { font-size: 11px; }
.card-actions {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
}
.card-body {
  padding: var(--space-3);
  flex: 1;
  min-height: 0;
}
.card-body.scroll { overflow: auto; }
</style>
