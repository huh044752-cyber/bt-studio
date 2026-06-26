<script setup lang="ts">
/**
 * 统一按钮状态机(文档 §18.10):idle/precheck/confirming/running/success/failed。
 * 危险操作支持二次确认。处理中防重复点击,成功/失败短暂回显后回到 idle。
 */
import { ref } from "vue";

const props = defineProps<{
  label: string;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  confirm?: string; // 非空则点击先二次确认
  title?: string;
}>();

const emit = defineEmits<{ (e: "run"): void | Promise<void> }>();

type State = "idle" | "confirming" | "running" | "success" | "failed";
const state = ref<State>("idle");

async function onClick() {
  if (props.disabled || state.value === "running") return;
  if (props.confirm && state.value !== "confirming") {
    state.value = "confirming";
    return;
  }
  state.value = "running";
  try {
    await emit("run");
    state.value = "success";
  } catch {
    state.value = "failed";
  } finally {
    setTimeout(() => (state.value = "idle"), 900);
  }
}

function cancel() {
  state.value = "idle";
}
</script>

<template>
  <span class="action-btn-wrap">
    <button
      v-if="state !== 'confirming'"
      class="btn"
      :class="{ primary, danger, running: state === 'running', success: state === 'success', failed: state === 'failed' }"
      :disabled="disabled"
      :title="title || label"
      @click="onClick"
    >
      <span v-if="state === 'running'">⏳</span>
      <span v-else-if="state === 'success'">✓</span>
      <span v-else-if="state === 'failed'">✕</span>
      {{ label }}
    </button>
    <span v-else class="confirm-inline">
      <span class="muted">{{ confirm }}</span>
      <button class="btn tiny danger" @click="onClick">确认</button>
      <button class="btn tiny" @click="cancel">取消</button>
    </span>
  </span>
</template>

<style scoped>
.action-btn-wrap {
  display: inline-flex;
}
.confirm-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border: 1px solid rgba(240, 109, 109, 0.4);
  border-radius: 8px;
  background: rgba(240, 109, 109, 0.08);
  font-size: 11px;
}
</style>
