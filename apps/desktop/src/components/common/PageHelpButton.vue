<script setup lang="ts">
/**
 * 页面级"?" 帮助按钮 —— 顶栏右侧小圆按钮,点开一个大弹框展示帮助内容(通过 default slot 传)。
 * 目的:所有页面头部的描述性文字不再占版面,统一入帮助弹框,视觉更企业级。
 */
import { ref } from "vue";
import ModalDialog from "./ModalDialog.vue";

defineProps<{ title: string; width?: number }>();
const open = ref(false);
</script>

<template>
  <button class="help-btn" title="页面帮助" @click="open = true">
    <span class="help-mark">?</span>
    <span class="help-label">帮助</span>
  </button>
  <ModalDialog
    :open="open"
    :title="title"
    :width="width ?? 640"
    ok-label="知道了"
    @ok="open = false"
    @cancel="open = false"
  >
    <div class="page-help-body">
      <slot />
    </div>
  </ModalDialog>
</template>

<style scoped>
.help-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 8px;
  border-radius: 14px;
  background: transparent;
  border: 1px solid var(--border-default, var(--line-soft));
  color: var(--text-secondary, var(--muted));
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.help-btn:hover {
  background: var(--accent-soft, rgba(94,179,255,0.10));
  border-color: var(--accent, #5eb3ff);
  color: var(--accent, #5eb3ff);
}
.help-mark {
  display: inline-grid;
  place-items: center;
  width: 16px; height: 16px;
  border-radius: 50%;
  border: 1px solid currentColor;
  font-size: 10.5px; font-weight: 700;
  line-height: 1;
}
.help-label { letter-spacing: 0.02em; }

/* Slot 内容默认排版:企业级富文档 */
.page-help-body :deep(h3) {
  margin: 14px 0 8px; font-size: 13px; color: var(--text-primary, var(--fg));
  letter-spacing: 0.01em;
}
.page-help-body :deep(h3:first-child) { margin-top: 0; }
.page-help-body :deep(p) { margin: 6px 0; font-size: 12.5px; line-height: 1.7; color: var(--text-secondary, var(--muted)); }
.page-help-body :deep(ul), .page-help-body :deep(ol) { margin: 6px 0; padding-left: 22px; font-size: 12.5px; line-height: 1.8; color: var(--text-secondary, var(--muted)); }
.page-help-body :deep(li) { margin: 3px 0; }
.page-help-body :deep(li > strong), .page-help-body :deep(p > strong) { color: var(--text-primary, var(--fg)); font-weight: 600; }
.page-help-body :deep(code) {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 11.5px; padding: 1px 6px;
  background: var(--surface-3, rgba(122,156,193,0.14));
  border-radius: 4px;
}
.page-help-body :deep(.help-sec) {
  padding: 12px 14px; margin-bottom: 10px;
  background: var(--surface-2, rgba(255,255,255,0.02));
  border: 1px solid var(--border-subtle, var(--line-soft));
  border-radius: 8px;
}
.page-help-body :deep(.help-sec:last-child) { margin-bottom: 0; }
.page-help-body :deep(.help-note) {
  padding: 10px 12px; margin: 8px 0;
  background: var(--warn-soft, rgba(245,182,92,0.10));
  border-left: 3px solid var(--warn, #f5b65c);
  border-radius: 6px;
  font-size: 12px; color: var(--text-secondary, var(--muted));
  line-height: 1.7;
}
.page-help-body :deep(pre.help-tree) {
  margin: 6px 0; padding: 10px 12px;
  background: rgba(0,0,0,0.24);
  border: 1px solid var(--border-subtle, var(--line-soft));
  border-radius: 6px;
  font-family: var(--mono, ui-monospace, "SF Mono", Consolas, monospace);
  font-size: 11.5px; line-height: 1.55;
  color: var(--text-primary, var(--fg));
  white-space: pre; overflow-x: auto;
}
.page-help-body :deep(ol > li > strong),
.page-help-body :deep(ul > li > strong) { color: var(--text-primary, var(--fg)); }
</style>
