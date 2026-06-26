<script setup lang="ts">
/**
 * 场景挂接(外挂)—— 工作空间驱动:
 *  扫描(工作空间模型目录下的)想定 → 选场景 → 选实体(Unit) → 选工作空间内行为树
 *  → 校验(实体组件是否含该树各节点的类/方法) → 关联(回填 componentId) → 写回 .sdata + .bt → 回滚
 */
import { ref, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import ActionButton from "@/components/common/ActionButton.vue";
import Splitter from "@/components/common/Splitter.vue";
import { scanScenarios, readPathText, writeScenarioFile, readTextFile, writeArtifact } from "@/services/tauri";
import {
  parseScenarioUnits,
  attachTreeToScenario,
  validateTreeForUnit,
  type ScenarioUnit,
  type AttachPolicy,
} from "@btstudio/bt-core";

const ws = useWorkspaceStore();
const c = useConsoleStore();

interface ScenarioRef { name: string; sdataPath: string }
const scenarios = ref<ScenarioRef[]>([]);
const selScenario = ref<ScenarioRef | null>(null);
const sdataXml = ref("");
const units = ref<ScenarioUnit[]>([]);
const selUnit = ref<ScenarioUnit | null>(null);
const policy = ref<AttachPolicy>("backup_then_overwrite");
const backupPath = ref("");
const result = ref<Record<string, unknown> | null>(null);

const tree = computed(() => ws.currentTree);

/** 校验:实体组件是否含所选树各节点的类/方法。 */
const validation = computed(() => {
  void ws.rev;
  if (!selUnit.value || !tree.value) return null;
  return validateTreeForUnit(tree.value, selUnit.value, ws.functionCatalog.functions);
});
const canAttach = computed(
  () => !!selScenario.value && !!selUnit.value && !!tree.value && (validation.value?.errorCount ?? 1) === 0,
);

async function scan() {
  const root = ws.modelRoot;
  if (!root) { c.warning("publish", "工作空间未配置模型目录,请到「工作空间 → 工作空间配置」设置模型目录"); }
  let list = root ? await scanScenarios(root) : null;
  if (!list) {
    const f = await readTextFile();
    if (f) { scenarios.value = [{ name: f.name.replace(/\.sdata$/, ""), sdataPath: f.name }]; pickScenario(scenarios.value[0]!, f.content); return; }
    list = [];
  }
  scenarios.value = list;
  c.success("publish", `扫描到 ${list.length} 个想定`);
}

async function pickScenario(s: ScenarioRef, contentOverride?: string) {
  selScenario.value = s;
  const content = contentOverride ?? (await readPathText(s.sdataPath)) ?? "";
  sdataXml.value = content;
  units.value = parseScenarioUnits(content);
  selUnit.value = null;
  c.info("publish", `场景 ${s.name}:${units.value.length} 个实体`);
}

/** 关联:把树中每个节点的 className 解析到该实体对应组件的 componentId。 */
function associateComponents(): number {
  const t = tree.value!;
  const compByClass = new Map(selUnit.value!.components.map((x) => [x.className, x.componentId]));
  let n = 0;
  for (const node of Object.values(t.nodes)) {
    const cls = node.targetSelector?.modelClass;
    if (cls && compByClass.has(cls)) {
      node.targetSelector = { ...(node.targetSelector ?? {}), componentId: compByClass.get(cls) };
      n++;
    }
  }
  if (n > 0) ws.bump();
  return n;
}

async function attach() {
  if (!selScenario.value || !selUnit.value || !tree.value) throw new Error("未选场景/实体/树");
  if ((validation.value?.errorCount ?? 1) > 0) throw new Error("校验未通过:实体组件缺少对应类/方法");
  const bound = associateComponents();
  c.info("publish", `关联组件:${bound} 个节点回填 componentId`);
  // 行为树 / 状态机分别导出(状态机走真实引擎嵌套 FSM XML)。
  const isFsm = (tree.value.projectKind ?? "behavior_tree") === "state_machine";
  let xml: string;
  if (isFsm) {
    const r = ws.exportFsmCurrent();
    if (!r.ok || !r.xml) throw new Error(r.error || "状态机导出失败");
    xml = r.xml;
  } else {
    const res = ws.exportCurrent();
    if (!res.ok || !res.artifacts) throw new Error(res.error || "导出失败");
    xml = res.artifacts.xml;
  }
  const out = attachTreeToScenario(sdataXml.value, {
    instanceName: tree.value.treeName,
    belongUnit: selUnit.value.objectHandle,
    btTemplateId: tree.value.templateId ?? `${isFsm ? "fsm" : "bt"}-${tree.value.treeId.slice(-8)}`,
    modelId: selUnit.value.modelId ?? "",
    treeXml: xml,
    policy: policy.value,
  });
  if (!out.ok) { c.warning("publish", out.message); throw new Error(out.message); }
  const w = await writeScenarioFile(selScenario.value.sdataPath, out.xml!, policy.value !== "overwrite");
  backupPath.value = w.backupPath ?? "";
  const btOut = await writeArtifact(`${tree.value.treeName}.${isFsm ? "fsm" : "bt"}.xml`, xml);
  sdataXml.value = out.xml!;
  result.value = {
    success: w.ok, scenario: selScenario.value.name, unit: selUnit.value.name, belongUnit: selUnit.value.objectHandle,
    tree: tree.value.treeName, conflict: out.conflict, sdataPath: w.path,
    backupPath: backupPath.value || "(overwrite 无备份)", btTemplate: btOut.path, rollbackApplied: false,
    message: out.message + (w.viaDownload ? "(浏览器下载)" : ""),
  };
  c.success("publish", `挂接完成:${tree.value.treeName} → ${selUnit.value.name}`);
}

async function rollback() {
  if (!backupPath.value || !selScenario.value) throw new Error("无备份");
  const bak = await readPathText(backupPath.value);
  if (bak) { await writeScenarioFile(selScenario.value.sdataPath, bak, false); result.value = { ...(result.value ?? {}), rollbackApplied: true }; c.warning("publish", `已回滚 ${backupPath.value}`); }
  else c.warning("publish", "浏览器模式无法读取备份,请手动恢复");
}
</script>

<template>
  <div class="page">
    <div class="page-bar panel row">
      <strong>场景挂接(外挂)</strong>
      <span class="muted-2">工作空间行为树 → 想定实体;校验组件含函数后写回 .sdata + .bt</span>
      <span class="spacer" />
      <ActionButton label="扫描想定" @run="scan" />
      <select class="select narrow" :value="policy" @change="policy = ($event.target as HTMLSelectElement).value as AttachPolicy" title="覆盖策略">
        <option value="reject">reject</option>
        <option value="overwrite">overwrite</option>
        <option value="backup_then_overwrite">backup_then_overwrite</option>
      </select>
      <ActionButton label="确认写回 (.sdata+.bt)" :primary="true" :disabled="!canAttach" confirm="将写回想定与模板,确认?" @run="attach" />
      <ActionButton label="回滚" danger :disabled="!backupPath" @run="rollback" />
    </div>

    <div class="grid">
      <!-- 列1:想定 + 实体 -->
      <div class="panel col sel scroll c1">
        <div class="ptitle">① 想定(来自模型目录)</div>
        <div class="list">
          <div v-for="s in scenarios" :key="s.sdataPath" class="item" :class="{ active: s === selScenario }" @click="pickScenario(s)">{{ s.name }}</div>
          <div v-if="scenarios.length === 0" class="muted-2 empty">点「扫描想定」(需工作空间已配模型目录)</div>
        </div>
        <div class="ptitle">② 实体 (Unit)</div>
        <div class="list">
          <div v-for="u in units" :key="u.objectHandle" class="item" :class="{ active: u === selUnit }" @click="selUnit = u">
            <span>{{ u.name }}</span><span class="muted-2"> #{{ u.objectHandle }} · {{ u.typeOfUnit }}</span>
          </div>
          <div v-if="units.length === 0" class="muted-2 empty">选想定后显示实体</div>
        </div>
      </div>

      <Splitter />
      <!-- 列2:行为树 + 实体组件 -->
      <div class="panel col scroll">
        <div class="ptitle">③ 工作空间行为树 / 状态机(关联到该实体)</div>
        <div class="list short">
          <div v-for="t in ws.trees" :key="t.treeId"
            class="item" :class="{ active: t.treeId === ws.currentTreeId }" @click="ws.switchTree(t.treeId)">
            <span class="tag" :class="(t.projectKind ?? 'behavior_tree') === 'state_machine' ? 'warning' : 'info'">
              {{ (t.projectKind ?? 'behavior_tree') === 'state_machine' ? '状态机' : '行为树' }}
            </span>
            {{ t.displayName }} <span class="muted-2">({{ Object.keys(t.nodes).length }} 节点)</span>
          </div>
        </div>
        <div class="ptitle">实体组件(className → componentId)</div>
        <table v-if="selUnit" class="tbl">
          <tr v-for="(comp, i) in selUnit.components" :key="i"><td>{{ comp.className }}</td><td class="mono muted-2">{{ comp.componentId.slice(0, 18) }}…</td></tr>
        </table>
        <div v-else class="muted-2 empty">选实体后显示组件</div>
      </div>

      <Splitter />
      <!-- 列3:校验 + 结果 -->
      <div class="panel col scroll">
        <div class="ptitle">④ 关联校验(组件是否含该函数)
          <span v-if="validation" class="tag" :class="validation.errorCount ? 'error' : 'success'">{{ validation.errorCount ? `${validation.errorCount} 错误` : '全部通过' }}</span>
        </div>
        <div v-if="!validation" class="muted-2 empty">选实体 + 行为树后校验</div>
        <div v-else class="vlist">
          <div v-for="(iss, i) in validation.issues" :key="i" class="vrow" :class="iss.level">
            <span class="tag" :class="iss.level === 'ok' ? 'success' : 'error'">{{ iss.level === 'ok' ? '✓' : '✕' }}</span>
            <span class="vnode">{{ iss.nodeName }}</span>
            <span class="mono muted-2">{{ iss.className }}::{{ iss.functionRef }}</span>
            <span class="vreason">{{ iss.reason }}</span>
          </div>
        </div>
        <div class="ptitle">挂接结果</div>
        <pre v-if="result" class="mono res">{{ JSON.stringify(result, null, 2) }}</pre>
        <div v-else class="muted-2 empty">写回后显示(含 backupPath / rollbackApplied)</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 10px; height: 100%; }
.page-bar { padding: 8px 12px; gap: 7px; flex-wrap: wrap; }
.narrow { width: 168px; }
.grid { display: flex; gap: 4px; flex: 1; min-height: 0; min-width: 0; }
.grid > .panel { flex: 1 1 0; min-width: 0; }
.grid > .panel.c1 { flex: 0 0 280px; }
.panel { padding: 10px; }
.col { display: flex; flex-direction: column; gap: 4px; }
.ptitle { font-size: 11px; color: var(--accent); margin: 6px 0 4px; display: flex; align-items: center; gap: 6px; }
.list { overflow: auto; border: 1px solid var(--line-soft); border-radius: 7px; padding: 4px; min-height: 70px; }
.list.short { max-height: 120px; }
.item { padding: 5px 7px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
.item:hover { background: rgba(94,179,255,0.07); }
.item.active { background: rgba(94,179,255,0.14); }
.empty { padding: 10px; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl td { padding: 3px 6px; border-bottom: 1px solid var(--line-soft); font-size: 12px; }
.vlist { display: flex; flex-direction: column; gap: 3px; }
.vrow { display: flex; align-items: center; gap: 7px; font-size: 12px; padding: 3px 4px; border-radius: 5px; }
.vrow.error { background: rgba(240,109,109,0.08); }
.vnode { min-width: 80px; }
.vreason { color: var(--muted); margin-left: auto; }
.res { margin: 0; white-space: pre-wrap; font-size: 11.5px; }
</style>
