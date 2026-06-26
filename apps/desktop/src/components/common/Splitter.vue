<script setup lang="ts">
/**
 * 通用竖向分隔条:拖拽以调整【前一个兄弟元素】的宽度(用于 flex 行内的两个面板互相拖拉)。
 * 用法:<div class="panel a"/> <Splitter/> <div class="panel b"/>,父容器 display:flex。
 */
const props = withDefaults(defineProps<{ min?: number; max?: number }>(), { min: 160, max: 900 });

let startX = 0;
let startW = 0;
let target: HTMLElement | null = null;

function onMove(e: PointerEvent) {
  if (!target) return;
  const w = Math.min(props.max, Math.max(props.min, startW + (e.clientX - startX)));
  target.style.flex = `0 0 ${w}px`;
  target.style.width = `${w}px`;
}
function onUp() {
  target = null;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}
function onDown(e: PointerEvent) {
  const el = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
  if (!el) return;
  target = el;
  startX = e.clientX;
  startW = el.getBoundingClientRect().width;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
}
</script>

<template>
  <div class="splitter" title="拖拽调整宽度" @pointerdown="onDown"><span class="grip" /></div>
</template>

<style scoped>
.splitter {
  flex: 0 0 8px;
  align-self: stretch;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
}
.grip {
  width: 2px;
  height: 36px;
  border-radius: 2px;
  background: var(--line-soft);
}
.splitter:hover .grip {
  background: var(--accent);
}
</style>
