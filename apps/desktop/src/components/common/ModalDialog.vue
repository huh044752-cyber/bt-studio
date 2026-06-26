<script setup lang="ts">
/** 通用模态弹窗。用于"新建/配置"等创建流程,替代内联"先输入名称"。 */
defineProps<{ open: boolean; title: string; okLabel?: string; okDisabled?: boolean; width?: number }>();
const emit = defineEmits<{ (e: "ok"): void; (e: "cancel"): void }>();
</script>

<template>
  <div v-if="open" class="modal-mask" @click.self="emit('cancel')">
    <div class="modal panel" :style="{ width: (width ?? 460) + 'px' }">
      <div class="modal-head">
        <strong>{{ title }}</strong>
        <button class="btn tiny" @click="emit('cancel')">✕</button>
      </div>
      <div class="modal-body scroll">
        <slot />
      </div>
      <div class="modal-foot">
        <button class="btn" @click="emit('cancel')">取消</button>
        <button class="btn primary" :disabled="okDisabled" @click="emit('ok')">{{ okLabel ?? "确定" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(3, 8, 14, 0.6);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  z-index: 1000;
}
.modal {
  max-width: 92vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  padding: 0;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.modal-body {
  padding: 14px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--line-soft);
}
</style>
