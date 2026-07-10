<script setup lang="ts">
/**
 * 模型类型抽取面板(并入「工作空间」):
 *  扫描工作空间模型目录(单一来源)→ 勾选类/查看方法与说明 → 抽取进类型空间(解耦,只取需要)。
 */
import { ref, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import ActionButton from "@/components/common/ActionButton.vue";
import { readModelCmpFiles } from "@/services/tauri";
import { functionOwnerClass, type FunctionDescriptor } from "@btstudio/bt-core";

const ws = useWorkspaceStore();
const c = useConsoleStore();

const selected = ref<Set<string>>(new Set());
const search = ref("");
const expanded = ref<Set<string>>(new Set());

const rawClasses = computed(() => {
  void ws.rev;
  const q = search.value.trim().toLowerCase();
  return ws.modelRawClasses.filter(
    (cl) => !q || cl.className.toLowerCase().includes(q) || (cl.displayName || "").toLowerCase().includes(q),
  );
});
function methodsOf(className: string): FunctionDescriptor[] {
  return ws.modelRawFunctions.filter((f) => functionOwnerClass(f) === className);
}
function paramSig(m: FunctionDescriptor): string {
  return m.params.map((p) => `${p.name}:${p.originalType ?? p.malType}`).join(", ");
}
function inTypeSpace(className: string) {
  return ws.classes.some((c2) => c2.className === className);
}

async function scanModel() {
  if (!ws.modelRoot) {
    c.warning("import", "工作空间未配置模型目录,请先在上方「工作空间配置」设置模型目录");
    return;
  }
  const res = await readModelCmpFiles(ws.modelRoot);
  if (res.contents.length === 0) { c.warning("import", `目录无 .cmp:${res.root}`); return; }
  // 老引擎分支:优先配对解析 .cmp + .mui(.mui 提供类元数据;.cmp 提供函数签名)
  if (res.muiFiles && res.muiFiles.length > 0) {
    ws.parseModelDirPaired(res.root, res.files, res.muiFiles);
  } else {
    ws.parseModelDir(res.root, res.contents);
  }
  selected.value = new Set();
}
function toggle(name: string) {
  if (selected.value.has(name)) selected.value.delete(name);
  else selected.value.add(name);
  selected.value = new Set(selected.value);
}
function toggleExpand(name: string) {
  if (expanded.value.has(name)) expanded.value.delete(name);
  else expanded.value.add(name);
  expanded.value = new Set(expanded.value);
}
function selectAll() { selected.value = new Set(rawClasses.value.map((c2) => c2.className)); }
function clearSel() { selected.value = new Set(); }
function extract() {
  if (selected.value.size === 0) { c.warning("import", "未勾选任何类"); return; }
  ws.extractToTypeSpace([...selected.value]);
}
</script>

<template>
  <div class="extract col">
    <div class="bar row">
      <input v-model="search" class="input narrow" placeholder="搜索类…" />
      <button class="btn tiny" :disabled="!ws.modelRoot" title="重新扫描模型目录" @click="scanModel">↻ 重新扫描</button>
      <button class="btn tiny" @click="selectAll">全选</button>
      <button class="btn tiny" @click="clearSel">清空</button>
      <span class="spacer" />
      <span class="tag info">原始 {{ ws.modelRawClasses.length }}</span>
      <span class="tag success">已选 {{ selected.size }}</span>
      <ActionButton label="抽取选中到类型空间" :disabled="selected.size === 0" @run="extract" />
    </div>
    <div class="hint">
      <span v-if="ws.modelRoot" class="mono muted-2">模型目录(工作空间配置时已自动扫描): {{ ws.modelRoot }}</span>
      <span v-else class="muted-2">工作空间未配置模型目录 → 上方「工作空间配置」设置(配置即自动扫描)</span>
    </div>

    <div class="list scroll">
      <div v-if="rawClasses.length === 0" class="muted-2 empty">
        在「工作空间配置」设置模型目录后会自动扫描;在此勾选要抽取的类(可展开查看方法与说明)。
      </div>
      <div v-for="cl in rawClasses" :key="cl.className" class="cls">
        <div class="cls-head">
          <input type="checkbox" :checked="selected.has(cl.className)" @change="toggle(cl.className)" />
          <span class="caret" @click="toggleExpand(cl.className)">{{ expanded.has(cl.className) ? "▾" : "▸" }}</span>
          <span class="cn" @click="toggleExpand(cl.className)">{{ cl.displayName || cl.className }}</span>
          <span class="mono muted-2">{{ cl.className }}</span>
          <span class="tag muted">{{ cl.category }}</span>
          <span v-if="cl.description" class="desc muted-2" :title="cl.description">{{ cl.description }}</span>
          <span class="spacer" />
          <span class="muted-2">{{ methodsOf(cl.className).length }} 方法</span>
          <span v-if="inTypeSpace(cl.className)" class="tag success">已在类型空间</span>
        </div>
        <div v-if="expanded.has(cl.className)" class="methods">
          <div v-for="m in methodsOf(cl.className)" :key="m.functionId" class="m">
            <div class="m-head">
              <span class="tag" :class="m.category === 'condition' ? 'success' : 'info'">{{ m.category }}</span>
              <span class="mn">{{ m.displayName || m.name }}</span>
              <span class="muted-2 mono">{{ m.name }}({{ paramSig(m) }})</span>
              <span v-if="m.description" class="desc muted-2">— {{ m.description }}</span>
            </div>
            <div v-for="p in m.params" :key="p.paramId" class="p">
              <span class="mono">{{ p.name }}</span>
              <span class="tag muted">{{ p.originalType ?? p.malType }}</span>
              <span v-if="p.displayName" class="muted-2">{{ p.displayName }}</span>
              <span v-if="p.description" class="muted-2">· {{ p.description }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.extract { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.col { min-height: 0; }
.bar { gap: 7px; flex-wrap: wrap; }
.narrow { width: 150px; }
.hint { font-size: 11px; }
.list { flex: 1; min-height: 0; border: 1px solid var(--line-soft); border-radius: 8px; padding: 6px; }
.empty { padding: 16px; }
.cls { border-bottom: 1px solid var(--line-soft); padding: 4px 0; }
.cls-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.caret { cursor: pointer; width: 14px; color: var(--muted); }
.cn { cursor: pointer; font-weight: 600; }
.desc { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.methods { margin: 4px 0 4px 30px; }
.m { padding: 3px 0; }
.m-head { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.mn { min-width: 120px; }
.p { display: flex; align-items: center; gap: 6px; font-size: 11px; margin: 1px 0 1px 22px; }
.tag.muted { color: var(--muted-2); }
</style>
