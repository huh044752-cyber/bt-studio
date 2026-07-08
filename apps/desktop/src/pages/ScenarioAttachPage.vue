<script setup lang="ts">
/**
 * 场景挂接(组装视图)—— Unit 中心:
 *   一个 Unit 可挂多棵行为树 / 状态机(1对N)。选实体后中间"组装台"显示已选组件与类,
 *   右侧行为树/状态机货架勾选任意多棵一次性批量校验 → 批量写回 .sdata + 各自的 .bt/.sm。
 * 界面:三列 + 每段独立 <details>/<summary> 折叠;想定条目可单个删除。
 */
import { computed, nextTick, ref } from "vue";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import { useScenarioAttachStore, type ScenarioRef } from "@/stores/scenarioAttach";
import ActionButton from "@/components/common/ActionButton.vue";
import Splitter from "@/components/common/Splitter.vue";
import { scanScenarios, readPathText, writeScenarioFile, readTextFile, writeArtifact } from "@/services/tauri";
import {
  parseScenarioUnits,
  attachOldScenario,
  attachOldScenarioStateMachine,
  validateTreeForUnit,
  type ScenarioUnit,
  type AttachPolicy,
} from "@btstudio/bt-core";

const ws = useWorkspaceStore();
const c = useConsoleStore();
const sa = useScenarioAttachStore();
// 从 store 里"拆" reactive 引用出来在模板/逻辑里像原来的 ref 一样用,
// 组件卸载时 store 依然保留状态(pinia 全局),再次进入本页 setup 重跑 → 数据仍在。
const { scenarios, selScenario, sdataXml, units, selUnit, policy, backupPath, result, assemblyMap } = storeToRefs(sa);

const selectedTrees = computed(() => {
  if (!selUnit.value) return [] as typeof ws.trees;
  const ids = assemblyMap.value[selUnit.value.objectHandle];
  if (!ids || ids.length === 0) return [];
  return ws.trees.filter((t) => ids.includes(t.treeId));
});

const perTreeValidation = computed(() => {
  void ws.rev;
  if (!selUnit.value) return [] as { treeId: string; treeName: string; errorCount: number; issues: unknown[] }[];
  const u = selUnit.value;
  return selectedTrees.value.map((t) => {
    const v = validateTreeForUnit(t, u, ws.functionCatalog.functions);
    return { treeId: t.treeId, treeName: t.displayName, errorCount: v.errorCount, issues: v.issues };
  });
});
const totalErrors = computed(() => perTreeValidation.value.reduce((n, v) => n + v.errorCount, 0));
const canAttach = computed(
  () => !!selScenario.value && !!selUnit.value && selectedTrees.value.length > 0 && totalErrors.value === 0,
);

const pageRoot = ref<HTMLElement | null>(null);

async function scan() {
  const root = ws.modelRoot;
  if (!root) { c.warning("publish", "工作空间未配置模型目录,请到「工作空间 → 工作空间配置」设置"); }
  let list = root ? await scanScenarios(root) : null;
  if (!list) {
    const f = await readTextFile();
    if (f) {
      const one: ScenarioRef = { name: f.name.replace(/\.sdata$/, ""), sdataPath: f.name };
      sa.scenarios = [one];
      pickScenario(one, f.content);
      return;
    }
    list = [];
  }
  sa.scenarios = list;
  c.success("publish", `扫描到 ${list.length} 个想定`);
}

async function pickScenario(s: ScenarioRef, contentOverride?: string) {
  const content = contentOverride ?? (await readPathText(s.sdataPath)) ?? "";
  const parsed = parseScenarioUnits(content);
  sa.resetOnPickScenario(s, content, parsed);
  c.info("publish", `场景 ${s.name}:${parsed.length} 个实体`);
}

/** 从扫描列表移除一个想定;若正是当前选中,一并清空右侧的实体与组装状态。 */
function removeScenario(s: ScenarioRef) {
  sa.removeScenario(s);
  c.info("publish", `已移除想定 ${s.name}`);
}

function pickUnit(u: ScenarioUnit) { sa.selUnit = u; }
function toggleTreeOnUnit(u: ScenarioUnit, treeId: string) { sa.toggleTreeOnUnit(u, treeId); }
function isTreeOnUnit(u: ScenarioUnit, treeId: string) { return sa.isTreeOnUnit(u, treeId); }

function associateComponentsForTree(tree: (typeof ws.trees)[number], u: ScenarioUnit): number {
  const compByClass = new Map(u.components.map((x) => [x.className, x.componentId]));
  let n = 0;
  for (const node of Object.values(tree.nodes)) {
    const cls = node.targetSelector?.modelClass;
    if (cls && compByClass.has(cls)) {
      node.targetSelector = { ...(node.targetSelector ?? {}), componentId: compByClass.get(cls) };
      n++;
    }
  }
  return n;
}

async function attach() {
  if (!selScenario.value || !selUnit.value) throw new Error("未选场景/实体");
  if (selectedTrees.value.length === 0) throw new Error("未勾选任何行为树/状态机");
  if (totalErrors.value > 0) throw new Error(`校验未通过:实体组件缺少对应类/方法 ${totalErrors.value} 项`);
  const u = selUnit.value;
  let currentSdata = sdataXml.value;
  const written: { name: string; kind: "bt" | "sm"; path: string }[] = [];
  let gbbOutPath = "";
  const conflicts: string[] = [];

  for (const t of selectedTrees.value) {
    const isFsm = (t.projectKind ?? "behavior_tree") === "state_machine";
    ws.switchTree(t.treeId);
    const bound = associateComponentsForTree(t, u);
    if (bound > 0) ws.bump();
    let xml: string;
    let globalBb = "";
    if (isFsm) {
      const r = ws.exportFsmCurrent();
      if (!r.ok || !r.xml) throw new Error(`${t.displayName} 状态机导出失败: ${r.error}`);
      xml = r.xml;
    } else {
      const res = ws.exportCurrent();
      if (!res.ok || !res.artifacts) throw new Error(`${t.displayName} 导出失败: ${res.error}`);
      xml = res.artifacts.xml;
      globalBb = res.artifacts.globalBlackboardsXml ?? "";
    }
    const ext = isFsm ? "sm" : "bt";
    const subdir = isFsm ? "StateMachine" : "BehaviacTree";
    const filePath = ws.modelRoot
      ? `${ws.modelRoot.replace(/[\\/]+$/, "")}/ModelDatabase/${subdir}/${t.treeName}.${ext}`
      : `${t.treeName}.${ext}`;
    const w = await writeArtifact(filePath, xml);
    written.push({ name: t.treeName, kind: isFsm ? "sm" : "bt", path: w.path });
    if (globalBb && globalBb.includes("<Blackboard ")) {
      const gPath = ws.modelRoot
        ? `${ws.modelRoot.replace(/[\\/]+$/, "")}/ModelDatabase/global_black_boards.xml`
        : "global_black_boards.xml";
      const g = await writeArtifact(gPath, globalBb);
      gbbOutPath = g.path;
    }
    const attachFn = isFsm ? attachOldScenarioStateMachine : attachOldScenario;
    const out = attachFn(currentSdata, u.name, t.treeName, policy.value);
    if (!out.ok) throw new Error(`${t.treeName}: ${out.message}`);
    if (out.conflict) conflicts.push(t.treeName);
    currentSdata = out.xml!;
  }

  const w = await writeScenarioFile(selScenario.value.sdataPath, currentSdata, policy.value !== "overwrite");
  sa.backupPath = w.backupPath ?? "";
  sa.sdataXml = currentSdata;
  sa.result = {
    success: w.ok,
    scenario: selScenario.value.name,
    unit: u.name,
    trees: written,
    conflicts: conflicts.length ? conflicts : undefined,
    sdataPath: w.path,
    backupPath: backupPath.value || "(overwrite 无备份)",
    globalBlackboards: gbbOutPath || "(无全局黑板)",
    rollbackApplied: false,
    message: `组装完成:${u.name} 挂载 ${written.length} 棵(BT/FSM)${conflicts.length ? ` · ${conflicts.length} 冲突已替换` : ""}` + (w.viaDownload ? "(浏览器下载)" : ""),
  };
  c.success("publish", `组装完成:${u.name} × ${written.length} 棵行为树/状态机`);
  // 结果出来后自动滚到结果区
  await nextTick();
  const el = pageRoot.value?.querySelector<HTMLElement>("[data-anchor='result']");
  el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function rollback() {
  if (!backupPath.value || !selScenario.value) throw new Error("无备份");
  const bak = await readPathText(backupPath.value);
  if (bak) {
    await writeScenarioFile(selScenario.value.sdataPath, bak, false);
    sa.result = { ...(sa.result ?? {}), rollbackApplied: true };
    c.warning("publish", `已回滚 ${backupPath.value}`);
  } else {
    c.warning("publish", "浏览器模式无法读取备份,请手动恢复");
  }
}

/** 每棵校验分组默认展开 —— 用户点开外层"批量校验"就是要看细节,再折叠一层反而让人看不到内容。
 *  用户点了 summary 收起后 foldedTrees[treeId]=true,后续再点开保留其偏好(state 在 store,跨页保留)。 */
function initTreeFoldOpen(treeId: string, _errorCount: number): boolean {
  return sa.foldedTrees[treeId] === undefined ? true : !sa.foldedTrees[treeId];
}
function onTreeFoldToggle(treeId: string, ev: Event) {
  sa.foldedTrees[treeId] = !(ev.target as HTMLDetailsElement).open;
}
</script>

<template>
  <div class="page" ref="pageRoot">
    <div class="page-bar panel row">
      <strong>场景挂接 · 组装</strong>
      <span class="muted-2">选实体 → 勾选多棵行为树/状态机 → 批量校验 → 一次写回</span>
      <span class="spacer" />
      <ActionButton label="扫描想定" @run="scan" />
      <select class="select narrow" :value="policy" @change="policy = ($event.target as HTMLSelectElement).value as AttachPolicy" title="同名 ADD 命令的处理">
        <option value="reject">已存在则拒绝</option>
        <option value="overwrite">直接覆盖</option>
        <option value="backup_then_overwrite">备份后覆盖</option>
      </select>
      <ActionButton label="批量写回" :primary="true" :disabled="!canAttach" confirm="将写回想定与所选行为树/状态机,确认?" @run="attach" />
      <ActionButton label="回滚" danger :disabled="!backupPath" @run="rollback" />
    </div>

    <div class="grid">
      <!-- 列 1:想定 / 实体 -->
      <div class="panel col c1">
        <details class="fold" open>
          <summary class="fold-t">
            <span class="chev">▾</span>
            <span class="tt">① 想定</span>
            <span class="badge" v-if="scenarios.length">{{ scenarios.length }}</span>
          </summary>
          <div class="fold-b">
            <div class="list">
              <div v-for="s in scenarios" :key="s.sdataPath" class="item" :class="{ active: s === selScenario }" @click="pickScenario(s)">
                <span class="s-name ellipsis" :title="s.sdataPath">{{ s.name }}</span>
                <button class="btn tiny danger x-btn"
                  @click.stop="removeScenario(s)"
                  :title="`从列表移除 ${s.name}`">✕</button>
              </div>
              <div v-if="scenarios.length === 0" class="muted-2 empty">点「扫描想定」</div>
            </div>
          </div>
        </details>

        <details class="fold" open>
          <summary class="fold-t">
            <span class="chev">▾</span>
            <span class="tt">② 实体</span>
            <span class="badge" v-if="units.length">{{ units.length }}</span>
            <span class="muted-3 nowrap">点卡片进入组装</span>
          </summary>
          <div class="fold-b">
            <div class="list units">
              <div v-for="u in units" :key="u.objectHandle" class="unit-item" :class="{ active: u === selUnit }" @click="pickUnit(u)">
                <div class="ui-row">
                  <span class="u-name">{{ u.name }}</span>
                  <span class="tag" v-if="assemblyMap[u.objectHandle]?.length">{{ assemblyMap[u.objectHandle]?.length }} 挂</span>
                </div>
                <div class="ui-meta muted-2">#{{ u.objectHandle }} · {{ u.typeOfUnit }} · {{ u.components.length }} 组件</div>
              </div>
              <div v-if="units.length === 0" class="muted-2 empty">选想定后显示实体</div>
            </div>
          </div>
        </details>
      </div>

      <Splitter />

      <!-- 列 2:组装台 -->
      <div class="panel col assembly">
        <div v-if="!selUnit" class="muted-2 empty pad">③ 组装台 · 从左栏选实体开始组装</div>

        <details v-else class="fold" open>
          <summary class="fold-t">
            <span class="chev">▾</span>
            <span class="uc-ico">▧</span>
            <span class="tt">③ {{ selUnit.name }}</span>
            <span class="muted-3 nowrap">#{{ selUnit.objectHandle }} · {{ selUnit.typeOfUnit }}</span>
            <span class="spacer" />
            <span class="tag" :class="assemblyMap[selUnit.objectHandle]?.length ? 'info' : ''">
              已挂载 {{ assemblyMap[selUnit.objectHandle]?.length ?? 0 }}
            </span>
          </summary>
          <div class="fold-b unit-card">
            <!-- 组件 -->
            <details class="fold" open>
            <summary class="fold-t">
              <span class="chev">▾</span>
              <span class="tt">组件 (Components)</span>
              <span class="badge">{{ selUnit.components.length }}</span>
              <span class="muted-3 nowrap">className → componentId</span>
            </summary>
            <div class="fold-b">
              <div v-if="selUnit.components.length === 0" class="muted-2 empty">该实体无组件</div>
              <div v-else class="comp-scroll">
                <table class="tbl comp-tbl">
                  <tr v-for="(comp, i) in selUnit.components" :key="i">
                    <td class="mono">{{ comp.className }}</td>
                    <td class="muted-2 mono cid" :title="comp.componentId">{{ comp.componentId }}</td>
                  </tr>
                </table>
              </div>
            </div>
          </details>

          <!-- 已挂载 -->
          <details class="fold" open>
            <summary class="fold-t">
              <span class="chev">▾</span>
              <span class="tt">已挂载 (Assembly)</span>
              <span class="badge">{{ selectedTrees.length }}</span>
            </summary>
            <div class="fold-b">
              <div v-if="selectedTrees.length === 0" class="muted-2 empty">右栏勾选后显示</div>
              <div v-else class="assem-list">
                <div v-for="t in selectedTrees" :key="t.treeId" class="assem-item">
                  <span class="tag" :class="(t.projectKind ?? 'behavior_tree') === 'state_machine' ? 'warning' : 'info'">
                    {{ (t.projectKind ?? 'behavior_tree') === 'state_machine' ? 'FSM' : 'BT' }}
                  </span>
                  <span class="ellipsis">{{ t.displayName }}</span>
                  <span class="spacer" />
                  <button class="btn tiny danger" @click="toggleTreeOnUnit(selUnit, t.treeId)" title="移除">✕</button>
                </div>
              </div>
            </div>
          </details>

          <!-- 校验 -->
          <details class="fold" open>
            <summary class="fold-t">
              <span class="chev">▾</span>
              <span class="tt">批量校验</span>
              <span class="tag" :class="totalErrors ? 'error' : 'success'" v-if="perTreeValidation.length">
                {{ totalErrors ? totalErrors + " 错误" : "全部通过" }}
              </span>
            </summary>
            <div class="fold-b">
              <div v-if="perTreeValidation.length === 0" class="muted-2 empty">选实体 + 勾选树后校验</div>
              <div v-else class="vlist">
                <details v-for="pv in perTreeValidation" :key="pv.treeId" class="fold sub"
                  :open="initTreeFoldOpen(pv.treeId, pv.errorCount)"
                  @toggle="onTreeFoldToggle(pv.treeId, $event)">
                  <summary class="fold-t sub">
                    <span class="chev">▾</span>
                    <span class="tag" :class="pv.errorCount ? 'error' : 'success'">{{ pv.errorCount ? pv.errorCount + " 错" : "✓" }}</span>
                    <strong class="ellipsis">{{ pv.treeName }}</strong>
                    <span class="muted-2 nowrap">{{ pv.issues.length }} 条</span>
                  </summary>
                  <div class="fold-b">
                    <div v-for="(iss, i) in pv.issues" :key="i" class="vrow" :class="(iss as any).level">
                      <span class="tag" :class="(iss as any).level === 'ok' ? 'success' : 'error'">{{ (iss as any).level === 'ok' ? '✓' : '✕' }}</span>
                      <span class="vnode ellipsis">{{ (iss as any).nodeName }}</span>
                      <span class="mono muted-2 ellipsis">{{ (iss as any).className }}::{{ (iss as any).functionRef }}</span>
                      <span class="vreason ellipsis" :title="(iss as any).reason">{{ (iss as any).reason }}</span>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </details>
          </div>
        </details>
      </div>

      <Splitter />

      <!-- 列 3:货架 + 结果 -->
      <div class="panel col">
        <details class="fold" open>
          <summary class="fold-t">
            <span class="chev">▾</span>
            <span class="tt">④ 行为树 / 状态机 货架</span>
            <span class="badge" v-if="ws.trees.length">{{ ws.trees.length }}</span>
            <span class="muted-3 nowrap">勾选挂到当前实体</span>
          </summary>
          <div class="fold-b">
            <div v-if="!selUnit" class="muted-2 empty">先选实体</div>
            <div v-else class="shelf">
              <label v-for="t in ws.trees" :key="t.treeId" class="shelf-item" :class="{ on: isTreeOnUnit(selUnit, t.treeId) }">
                <input type="checkbox" :checked="isTreeOnUnit(selUnit, t.treeId)" @change="toggleTreeOnUnit(selUnit, t.treeId)" />
                <span class="tag" :class="(t.projectKind ?? 'behavior_tree') === 'state_machine' ? 'warning' : 'info'">
                  {{ (t.projectKind ?? 'behavior_tree') === 'state_machine' ? 'FSM' : 'BT' }}
                </span>
                <span class="ellipsis">{{ t.displayName }}</span>
                <span class="muted-2 mono cnt">{{ Object.keys(t.nodes).length }} 节点</span>
              </label>
              <div v-if="ws.trees.length === 0" class="muted-2 empty">工作空间无行为树/状态机</div>
            </div>
          </div>
        </details>

        <details class="fold" open data-anchor="result">
          <summary class="fold-t">
            <span class="chev">▾</span>
            <span class="tt">挂接结果</span>
            <span class="tag success" v-if="result">已完成</span>
          </summary>
          <div class="fold-b">
            <pre v-if="result" class="mono res">{{ JSON.stringify(result, null, 2) }}</pre>
            <div v-else class="muted-2 empty">写回后显示</div>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 10px; height: 100%; }
.page-bar { padding: 8px 12px; gap: 7px; flex-wrap: wrap; align-items: center; }
.narrow { width: 168px; }

.grid { display: flex; gap: 4px; flex: 1; min-height: 0; min-width: 0; }
.grid > .panel { flex: 1 1 0; min-width: 0; overflow: auto; }
.grid > .panel.c1 { flex: 0 0 260px; }
/* 中列(组装台):列本身不滚,让内部 .fold-b.unit-card 承担独立滚动 —— 避免"整列一起滚"看不到深处的批量校验。 */
.grid > .panel.assembly { flex: 1.4 1 0; overflow: hidden; display: flex; flex-direction: column; }
.panel.assembly > .empty.pad { flex: 0 0 auto; }
.panel.assembly > .fold { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.panel.assembly > .fold > .fold-t { flex: 0 0 auto; }
.panel.assembly > .fold > .fold-b.unit-card { flex: 1; min-height: 0; overflow-y: auto; }
.panel { padding: 10px; }
.col { display: flex; flex-direction: column; gap: 8px; }

/* --- 通用折叠段(<details>)统一样式 --- */
.fold { border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-2); overflow: hidden; }
.fold + .fold { margin-top: 0; }
.fold[open] { background: var(--surface-2); }
/* 折叠段内容体默认不限高:外层 .panel 已是 overflow:auto,让整列一次滚动到底 ——
 * 修上一版每段独立 55vh 造成"组件表撑满,已挂载 / 批量校验被压到看不到"。
 * 需要局部限高的长列表(组件表)在各自选择器里单独兜底。 */
.fold[open] > .fold-b { overflow: visible; }
.fold-t {
  list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; font-size: 12px; color: var(--text-secondary);
  border-radius: 8px; transition: background 0.15s;
}
.fold-t::-webkit-details-marker { display: none; }
.fold-t:hover { background: var(--surface-3); }
.fold[open] > .fold-t { border-bottom: 1px solid var(--border-subtle); border-radius: 8px 8px 0 0; }
.fold-t .chev { display: inline-block; width: 12px; font-size: 10px; color: var(--text-tertiary); transition: transform 0.15s; }
.fold:not([open]) > .fold-t .chev { transform: rotate(-90deg); }
.fold-t .tt { font-weight: 600; color: var(--text-primary); }
.fold-t .badge { padding: 1px 6px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600; }
.fold-b { padding: 8px 10px; }

/* 嵌套(子级折叠)略缩:视觉层次分明 */
.fold.sub { border-color: transparent; background: transparent; }
.fold.sub[open] { background: rgba(76,141,255,0.03); }
.fold.sub > .fold-t.sub { padding: 5px 8px; font-size: 11.5px; }
.fold.sub > .fold-t.sub:hover { background: var(--surface-3); }
.fold.sub[open] > .fold-t.sub { border-bottom-color: rgba(76,141,255,0.08); }
.fold.sub > .fold-b { padding: 4px 8px 6px 24px; }

/* --- 列表(想定/实体) --- */
.list { max-height: 340px; overflow: auto; padding: 2px; }
.item {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 6px 5px 8px; border-radius: 6px; cursor: pointer; font-size: 12.5px; color: var(--text-primary);
}
.item:hover { background: var(--surface-3); }
.item.active { background: var(--accent-soft); color: var(--accent); font-weight: 500; }
.item .s-name { flex: 1; min-width: 0; }
.item .x-btn { padding: 0 6px; line-height: 20px; font-size: 11px; flex: 0 0 auto; }

.list.units { max-height: 360px; }
.unit-item { padding: 6px 8px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; margin-bottom: 3px; }
.unit-item:hover { background: var(--surface-3); }
.unit-item.active { background: var(--accent-soft); border-color: var(--accent-border); }
.ui-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; }
.ui-meta { font-size: 11px; margin-top: 2px; }
.u-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* --- 组装台内容布局 --- */
.unit-card { display: flex; flex-direction: column; gap: 8px; padding: 0; }
.uc-ico { font-size: 14px; color: var(--accent); flex: 0 0 auto; }

/* 组件表滚动容器:限制其最大高度,避免"组件多"时压掉后面的模块。
 * 未来若还想更紧凑,可把 max-height 调低;想全展开,加 :hover 或双击展开逻辑。 */
.comp-scroll { max-height: 240px; overflow: auto; border-radius: 4px; }

/* 组件表 —— UUID 完整展示,不再切成 "1…";列宽固定 40%/60% 保证 className 左对齐、UUID 右侧可换行。 */
.tbl { width: 100%; border-collapse: collapse; table-layout: fixed; }
.tbl td { padding: 5px 6px; border-bottom: 1px solid var(--border-subtle); font-size: 12px; vertical-align: middle; }
.tbl tr:last-child td { border-bottom: none; }
.comp-tbl td:first-child { width: 40%; }
.comp-tbl td.cid {
  text-align: right; word-break: break-all; line-height: 1.4;
  font-size: 11.5px; letter-spacing: 0;
}

/* 已挂载 */
.assem-list { display: flex; flex-direction: column; gap: 4px; }
.assem-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; background: var(--surface-3); border-radius: 6px; font-size: 12.5px;
}

/* 校验 */
.vlist { display: flex; flex-direction: column; gap: 2px; }
.vrow {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; padding: 3px 4px; border-radius: 4px;
}
.vrow.error { background: var(--err-soft); }
.vrow.ok { color: var(--text-secondary); }
.vnode { min-width: 96px; font-weight: 500; }
.vreason { color: var(--text-tertiary); margin-left: auto; max-width: 42%; }

/* 货架 */
.shelf { display: flex; flex-direction: column; gap: 4px; }
.shelf-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12.5px;
  border: 1px solid transparent;
}
.shelf-item:hover { background: var(--surface-3); }
.shelf-item.on { background: var(--accent-soft); border-color: var(--accent-border); }
.shelf-item .cnt { margin-left: auto; font-size: 11px; }

/* 结果 */
.res { margin: 0; white-space: pre-wrap; font-size: 11.5px; background: var(--surface-3); padding: 8px; border-radius: 6px; max-height: 320px; overflow: auto; }

/* 工具 */
.spacer { flex: 1; }
.empty { padding: 10px; }
.empty.pad { padding: 14px 10px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nowrap { white-space: nowrap; }
.muted-3 { color: var(--text-tertiary); font-weight: normal; font-size: 11px; }
</style>
