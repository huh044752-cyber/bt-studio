<script setup lang="ts">
/**
 * Tag —— 全站统一标签/胶囊。
 *
 * 目的:5 页面里散落 10+ 种 .tag/.chip/.badge/.pill/.mini-tag/.d-chip/
 *      .res-badge/.status/.kind/.mode-pill,padding/字号/配色都不同。
 *      这里收敛为一个组件 + 5 种语义 variant + 3 种 size。
 *
 * 用法:
 *   <Tag variant="ok" size="sm">已链接</Tag>
 *   <Tag variant="err" mono>{{ nodeId }}</Tag>
 */
defineProps<{
  /** 语义色:neutral(默认灰) / accent(蓝) / ok(绿) / warn(黄) / err(红) / info(浅蓝) / accent-2(琥珀) */
  variant?: "neutral" | "accent" | "ok" | "warn" | "err" | "info" | "accent-2";
  /** 尺寸:xs(超小) / sm(小,默认) / md(中) */
  size?: "xs" | "sm" | "md";
  /** 等宽字体(展示 ID / 类型名等) */
  mono?: boolean;
  /** 圆角胶囊(默认微圆角) */
  pill?: boolean;
}>();
</script>

<template>
  <span
    class="tag"
    :class="[
      `tag-${variant ?? 'neutral'}`,
      `size-${size ?? 'sm'}`,
      { mono, pill },
    ]"
  >
    <slot />
  </span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--surface-3);
  color: var(--text-secondary);
  line-height: 1;
  white-space: nowrap;
  letter-spacing: 0.02em;
  font-weight: 500;
}
.tag.pill { border-radius: 999px; }
.tag.mono {
  font-family: var(--mono);
  letter-spacing: 0;
}
.size-xs { padding: 1px 6px; font-size: 10px; }
.size-sm { padding: 2px 8px; font-size: 11px; }
.size-md { padding: 3px 10px; font-size: 12px; }

/* variants —— 边框+底色+文字均走 token,禁止硬编码 */
.tag-neutral { /* 默认 */ }
.tag-accent {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent);
}
.tag-ok {
  background: var(--ok-soft);
  border-color: color-mix(in srgb, var(--ok) 32%, transparent);
  color: var(--ok);
}
.tag-warn {
  background: var(--warn-soft);
  border-color: color-mix(in srgb, var(--warn) 32%, transparent);
  color: var(--warn);
}
.tag-err {
  background: var(--err-soft);
  border-color: color-mix(in srgb, var(--err) 32%, transparent);
  color: var(--err);
}
.tag-info {
  background: color-mix(in srgb, var(--info) 12%, transparent);
  border-color: color-mix(in srgb, var(--info) 30%, transparent);
  color: var(--info);
}
.tag-accent-2 {
  background: color-mix(in srgb, var(--accent-2) 12%, transparent);
  border-color: color-mix(in srgb, var(--accent-2) 30%, transparent);
  color: var(--accent-2);
}
</style>
