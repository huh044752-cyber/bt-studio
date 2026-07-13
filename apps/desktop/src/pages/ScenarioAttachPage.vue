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
import PageBar from "@/components/common/PageBar.vue";
import ModalDialog from "@/components/common/ModalDialog.vue";
import Splitter from "@/components/common/Splitter.vue";
import { scanScenarios, readPathText, writeScenarioFile, readTextFile, writeArtifact } from "@/services/tauri";
import {
  parseScenarioUnits,
  parseExistingBindings,
  attachOldScenario,
  attachOldScenarioStateMachine,
  validateTreeForUnit,
  type ScenarioUnit,
} from "@btstudio/bt-core";
import type { UnitAssemblyDiff, WrittenTree } from "@/stores/scenarioAttach";

const ws = useWorkspaceStore();
const c = useConsoleStore();
const sa = useScenarioAttachStore();
// 从 store 里"拆" reactive 引用出来在模板/逻辑里像原来的 ref 一样用,
// 组件卸载时 store 依然保留状态(pinia 全局),再次进入本页 setup 重跑 → 数据仍在。
const { scenarios, selScenario, sdataXml, units, selUnit, result, assemblyMap } = storeToRefs(sa);

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

// 想定/实体的模糊过滤词(局部 UI 状态,不入 store —— 关掉页面不需要保留)。
const scenarioFilter = ref("");
const unitFilter = ref("");

/** 想定过滤:按 name / sdataPath 子串,大小写不敏感。 */
const filteredScenarios = computed(() => {
  const q = scenarioFilter.value.trim().toLowerCase();
  if (!q) return scenarios.value;
  return scenarios.value.filter((s) =>
    s.name.toLowerCase().includes(q) || (s.sdataPath ?? "").toLowerCase().includes(q),
  );
});

/** 实体过滤:name / typeOfUnit / objectHandle / 组件 className 任一命中即保留。 */
const filteredUnits = computed(() => {
  const q = unitFilter.value.trim().toLowerCase();
  if (!q) return units.value;
  return units.value.filter((u) => {
    if (u.name.toLowerCase().includes(q)) return true;
    if ((u.typeOfUnit ?? "").toLowerCase().includes(q)) return true;
    if (String(u.objectHandle).toLowerCase().includes(q)) return true;
    return u.components.some((c2) => c2.className.toLowerCase().includes(q));
  });
});

async function scan() {
  const root = ws.modelRoot;
  if (!root) {
    // 没配 modelRoot:让用户手动选一份 .sdata 直接进入组装台。
    const f = await readTextFile([{ name: "想定", extensions: ["sdata", "xml"] }]);
    if (f) {
      const one: ScenarioRef = { name: f.name.replace(/\.sdata$/, ""), sdataPath: f.path ?? f.name };
      sa.scenarios = [one];
      pickScenario(one, f.content);
    } else {
      c.warning("publish", "工作空间未配置模型目录,请到「工作空间 → 工作空间配置」设置");
    }
    return;
  }
  const list = await scanScenarios(root);
  sa.scenarios = list;
  c.success("publish", `扫描到 ${list.length} 个想定`);
}

async function pickScenario(s: ScenarioRef, contentOverride?: string) {
  const content = contentOverride ?? (await readPathText(s.sdataPath)) ?? "";
  const parsed = parseScenarioUnits(content);
  const baseline = parseExistingBindings(content);
  sa.resetOnPickScenario(s, content, parsed, baseline);
  c.info("publish", `场景 ${s.name}:${parsed.length} 个实体 · baseline 抽出 ${baseline.reduce((n, b) => n + b.bt.length + b.fsm.length, 0)} 条已挂命令`);
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

/**
 * 计算当前勾选 vs .sdata baseline 的差异。以【所有】曾出现在 baseline 或当前勾选的实体为行,
 * 给出每个实体的 BT/FSM add/remove/keep 三列。UI 走 git-style 红绿 chip 渲染。
 * 逻辑固定为 overwrite —— 一律覆盖同名 ADD 命令,所以"新增/移除/保留"是唯一分类。
 */
function computeDiff(): UnitAssemblyDiff[] {
  const rows: UnitAssemblyDiff[] = [];
  const unitList = units.value;
  for (const u of unitList) {
    const b = sa.baselineForUnit(u.name);
    const cur = assemblyMap.value[u.objectHandle] ?? [];
    const curBt: string[] = [];
    const curFsm: string[] = [];
    for (const id of cur) {
      const t = ws.trees.find((x) => x.treeId === id);
      if (!t) continue;
      const isFsm = (t.projectKind ?? "behavior_tree") === "state_machine";
      (isFsm ? curFsm : curBt).push(t.treeName);
    }
    const btAdd = curBt.filter((n) => !b.bt.includes(n));
    const btRm  = b.bt.filter((n) => !curBt.includes(n));
    const btKeep = curBt.filter((n) => b.bt.includes(n));
    const fsmAdd = curFsm.filter((n) => !b.fsm.includes(n));
    const fsmRm  = b.fsm.filter((n) => !curFsm.includes(n));
    const fsmKeep = curFsm.filter((n) => b.fsm.includes(n));
    const changed = btAdd.length + btRm.length + fsmAdd.length + fsmRm.length > 0;
    if (changed || btKeep.length + fsmKeep.length > 0) {
      rows.push({
        unitName: u.name,
        bt: { add: btAdd, remove: btRm, keep: btKeep },
        fsm: { add: fsmAdd, remove: fsmRm, keep: fsmKeep },
        changed,
      });
    }
  }
  return rows;
}

/** overlay 状态:null=收起,非 null=展示 diff,等待用户 "确认覆盖" 或 "取消"。 */
const pendingDiff = ref<UnitAssemblyDiff[] | null>(null);

function beginAttach() {
  if (!selScenario.value || !selUnit.value) { c.warning("publish", "未选场景/实体"); return; }
  if (selectedTrees.value.length === 0) { c.warning("publish", "未勾选任何行为树/状态机"); return; }
  if (totalErrors.value > 0) { c.warning("publish", `校验未通过:${totalErrors.value} 项`); return; }
  pendingDiff.value = computeDiff();
}
function cancelAttach() { pendingDiff.value = null; }

async function confirmAttach() {
  if (!selScenario.value || !selUnit.value) return;
  // Tauri-only:此处进来的一定是桌面 exe(App.vue 启动时已阻断非 Tauri 环境)。
  const u = selUnit.value;
  let currentSdata = sdataXml.value;
  const writtenTrees: WrittenTree[] = [];
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
    writtenTrees.push({ kind: isFsm ? "FSM" : "BT", name: t.treeName, absolutePath: w.path });
    if (globalBb && globalBb.includes("<Blackboard ")) {
      const gPath = ws.modelRoot
        ? `${ws.modelRoot.replace(/[\\/]+$/, "")}/ModelDatabase/global_black_boards.xml`
        : "global_black_boards.xml";
      const g = await writeArtifact(gPath, globalBb);
      gbbOutPath = g.path;
    }
    const attachFn = isFsm ? attachOldScenarioStateMachine : attachOldScenario;
    // 永远 overwrite —— 已挂同名树的实体,直接被新版替换
    const out = attachFn(currentSdata, u.name, t.treeName, "overwrite");
    if (!out.ok) throw new Error(`${t.treeName}: ${out.message}`);
    if (out.conflict) conflicts.push(t.treeName);
    currentSdata = out.xml!;
  }

  const w = await writeScenarioFile(selScenario.value.sdataPath, currentSdata, false);
  sa.sdataXml = currentSdata;
  // 覆盖成功后,把新 baseline 重扫一次让下一轮 diff 干净
  sa.baseline = parseExistingBindings(currentSdata);
  sa.result = {
    scenario: selScenario.value.name,
    unit: u.name,
    scenarioPath: w.path,
    globalBlackboardPath: gbbOutPath || undefined,
    writtenTrees,
    conflicts,
    message: `组装完成:${u.name} 覆盖 ${writtenTrees.length} 棵${conflicts.length ? ` · 替换 ${conflicts.length} 条同名` : ""}`,
  };
  pendingDiff.value = null;
  c.success("publish", `覆盖完成:${u.name} × ${writtenTrees.length} 棵`);
  await nextTick();
  const el = pageRoot.value?.querySelector<HTMLElement>("[data-anchor='result']");
  el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function copyPath(p: string) {
  try {
    await navigator.clipboard.writeText(p);
    c.info("publish", `已复制:${p}`);
  } catch {
    c.warning("publish", "剪贴板不可用");
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

// 组装台 Tab 状态:默认落在 "已挂载"(主工作面)。切换实体不重置 —— 用户习惯的 tab 会保留。
type AsmTab = "assembled" | "components" | "validation";
const activeTab = ref<AsmTab>("assembled");
// 单棵树对应的校验结果(卡片里内嵌迷你摘要用)
function validationForTree(treeId: string) {
  return perTreeValidation.value.find((v) => v.treeId === treeId);
}
</script>

<template>
  <div class="page" ref="pageRoot">
    <PageBar title="场景挂接" dot="brand" help-title="场景挂接 · 使用帮助">
      <template #actions>
        <ActionButton label="扫描想定" @run="scan" />
        <ActionButton label="预览差异并覆盖" :primary="true" :disabled="!canAttach" @run="beginAttach" />
      </template>
      <template #help>
        <section class="help-sec">
          <h3>这个页面是做什么的?</h3>
          <p>把已设计好的行为树 / 状态机<strong>挂到想定里的具体实体上</strong>。写回时会覆写实体的 <code>.sdata</code> 挂接命令,并把 <code>.bt</code> / <code>.sm</code> 落到 <code>ModelDatabase</code> 目录。</p>
        </section>
        <section class="help-sec">
          <h3>工作流</h3>
          <ol>
            <li>「扫描想定」找到 <code>ScenarioSource</code> 下所有 <code>.sdata</code></li>
            <li>选想定 → 选实体(左栏)</li>
            <li>勾选要挂的行为树/状态机(中栏)</li>
            <li>每棵树自动<strong>按实体组件集校验</strong>(右栏),类/函数在实体组件里查不到就报错</li>
            <li>「预览差异并覆盖」—— 弹窗展示与已挂载版本的 diff → 确认覆写</li>
          </ol>
        </section>
        <section class="help-sec">
          <h3>覆盖式挂接策略</h3>
          <p>同名 <code>ADD Behaviac / ADD StateMachine</code> 命令<strong>一律替换</strong>——不追加、不合并。写盘前会展示 git-diff 风格的对比,确认后原子写入(带 <code>.bak</code> 备份)。</p>
        </section>
        <div class="help-note">
          校验是<strong>硬闸门</strong>:任一节点的类/函数不在实体组件里就无法写回。这确保运行时不会因绑定失效而 crash。
        </div>
      </template>
    </PageBar>

    <div class="grid">
      <!-- 列 1:想定 / 实体 -->
      <div class="panel col c1">
        <details class="fold" open>
          <summary class="fold-t">
            <span class="chev">▾</span>
            <span class="tt">① 想定</span>
            <span class="badge" v-if="scenarios.length">
              {{ scenarioFilter ? `${filteredScenarios.length} / ${scenarios.length}` : scenarios.length }}
            </span>
          </summary>
          <div class="fold-b">
            <div v-if="scenarios.length" class="filter-row">
              <input
                class="input tiny filter-in"
                v-model="scenarioFilter"
                placeholder="搜索想定名 / 路径…"
              />
              <button v-if="scenarioFilter" class="btn tiny x-btn" title="清除" @click="scenarioFilter = ''">✕</button>
            </div>
            <div class="list">
              <div v-for="s in filteredScenarios" :key="s.sdataPath" class="item" :class="{ active: s === selScenario }" @click="pickScenario(s)">
                <span class="s-name ellipsis" :title="s.sdataPath">{{ s.name }}</span>
                <button class="btn tiny danger x-btn"
                  @click.stop="removeScenario(s)"
                  :title="`从列表移除 ${s.name}`">✕</button>
              </div>
              <div v-if="scenarios.length === 0" class="muted-2 empty">点「扫描想定」</div>
              <div v-else-if="filteredScenarios.length === 0" class="muted-2 empty">无匹配「{{ scenarioFilter }}」</div>
            </div>
          </div>
        </details>

        <details class="fold" open>
          <summary class="fold-t">
            <span class="chev">▾</span>
            <span class="tt">② 实体</span>
            <span class="badge" v-if="units.length">
              {{ unitFilter ? `${filteredUnits.length} / ${units.length}` : units.length }}
            </span>
            <span class="muted-3 nowrap">点卡片进入组装</span>
          </summary>
          <div class="fold-b">
            <div v-if="units.length" class="filter-row">
              <input
                class="input tiny filter-in"
                v-model="unitFilter"
                placeholder="搜索实体名 / 类型 / 句柄 / 组件类…"
              />
              <button v-if="unitFilter" class="btn tiny x-btn" title="清除" @click="unitFilter = ''">✕</button>
            </div>
            <div class="list units">
              <div v-for="u in filteredUnits" :key="u.objectHandle" class="unit-item" :class="{ active: u === selUnit }" @click="pickUnit(u)">
                <div class="ui-row">
                  <span class="u-name">{{ u.name }}</span>
                  <span class="tag" v-if="assemblyMap[u.objectHandle]?.length">{{ assemblyMap[u.objectHandle]?.length }} 挂</span>
                </div>
                <div class="ui-meta muted-2">#{{ u.objectHandle }} · {{ u.typeOfUnit }} · {{ u.components.length }} 组件</div>
              </div>
              <div v-if="units.length === 0" class="muted-2 empty">选想定后显示实体</div>
              <div v-else-if="filteredUnits.length === 0" class="muted-2 empty">无匹配「{{ unitFilter }}」</div>
            </div>
          </div>
        </details>
      </div>

      <Splitter />

      <!-- 列 2:组装台(重设计:实体头 + Tab 分段 + 单区大内容) -->
      <div class="panel col assembly">
        <div v-if="!selUnit" class="muted-2 empty pad">③ 组装台 · 从左栏选实体开始组装</div>

        <template v-else>
          <!-- 实体头:一直可见,展示实体身份 + 全局校验状态 -->
          <div class="asm-head">
            <span class="uc-ico">▧</span>
            <div class="asm-head-main">
              <div class="asm-head-row1">
                <strong class="asm-title">③ {{ selUnit.name }}</strong>
                <span class="muted-3 mono nowrap">#{{ selUnit.objectHandle }}</span>
                <span class="muted-2 nowrap">· {{ selUnit.typeOfUnit }}</span>
              </div>
              <div class="asm-head-row2 muted-3">
                {{ selUnit.components.length }} 组件 · 已挂 {{ assemblyMap[selUnit.objectHandle]?.length ?? 0 }} 棵
              </div>
            </div>
            <span class="spacer" />
            <span v-if="perTreeValidation.length" class="tag" :class="totalErrors ? 'error' : 'success'">
              {{ totalErrors ? totalErrors + " 错误" : "校验通过" }}
            </span>
          </div>

          <!-- Tab 分段 -->
          <div class="asm-tabs">
            <button class="asm-tab" :class="{active: activeTab === 'assembled'}" @click="activeTab = 'assembled'">
              已挂载 <span class="tab-cnt">{{ selectedTrees.length }}</span>
            </button>
            <button class="asm-tab" :class="{active: activeTab === 'components'}" @click="activeTab = 'components'">
              组件 <span class="tab-cnt">{{ selUnit.components.length }}</span>
            </button>
            <button class="asm-tab" :class="{active: activeTab === 'validation'}" @click="activeTab = 'validation'">
              校验 <span class="tab-cnt" :class="totalErrors ? 'err' : (perTreeValidation.length ? 'ok' : '')">
                {{ totalErrors ? totalErrors + ' 错' : (perTreeValidation.length ? '✓' : '—') }}
              </span>
            </button>
          </div>

          <!-- Tab 内容:占满剩余高度,内部滚动 -->
          <div class="asm-body">
            <!-- 已挂载:卡片网格,每张卡内嵌该树的迷你校验摘要 -->
            <div v-if="activeTab === 'assembled'" class="asm-content">
              <div v-if="selectedTrees.length === 0" class="muted-2 empty pad-lg">
                <div class="empty-ico">▧</div>
                <div>从右栏勾选行为树/状态机挂到该实体</div>
              </div>
              <div v-else class="assem-grid">
                <div v-for="t in selectedTrees" :key="t.treeId" class="assem-card">
                  <div class="assem-card-head">
                    <span class="tag" :class="(t.projectKind ?? 'behavior_tree') === 'state_machine' ? 'warning' : 'info'">
                      {{ (t.projectKind ?? 'behavior_tree') === 'state_machine' ? 'FSM' : 'BT' }}
                    </span>
                    <strong class="assem-card-name ellipsis">{{ t.displayName }}</strong>
                    <span class="muted-3 mono nowrap">{{ Object.keys(t.nodes).length }} 节点</span>
                    <span class="spacer" />
                    <button class="btn tiny danger ic" @click="toggleTreeOnUnit(selUnit, t.treeId)" title="从此实体移除">✕</button>
                  </div>
                  <div v-if="validationForTree(t.treeId)" class="assem-card-body">
                    <template v-if="validationForTree(t.treeId)!.errorCount === 0">
                      <div class="v-ok">
                        <span class="tag success">✓</span>
                        <span>校验通过 · {{ validationForTree(t.treeId)!.issues.length }} 项检查</span>
                        <span class="spacer" />
                        <button class="btn tiny link" @click="activeTab = 'validation'">查看详情 ›</button>
                      </div>
                    </template>
                    <template v-else>
                      <div class="v-err-head">
                        <span class="tag error">{{ validationForTree(t.treeId)!.errorCount }} 错误</span>
                        <span class="muted-2">共 {{ validationForTree(t.treeId)!.issues.length }} 项检查</span>
                        <span class="spacer" />
                        <button class="btn tiny link" @click="activeTab = 'validation'">查看全部 ›</button>
                      </div>
                      <div class="v-err-list">
                        <div v-for="(iss, i) in (validationForTree(t.treeId)!.issues as any[]).filter(x => x.level !== 'ok').slice(0, 3)"
                             :key="i" class="vrow error">
                          <span class="tag error">✕</span>
                          <span class="vnode ellipsis">{{ iss.nodeName }}</span>
                          <span class="vreason ellipsis" :title="iss.reason">{{ iss.reason }}</span>
                        </div>
                        <div v-if="(validationForTree(t.treeId)!.issues as any[]).filter(x => x.level !== 'ok').length > 3"
                             class="muted-3 more">
                          … 还有 {{ (validationForTree(t.treeId)!.issues as any[]).filter(x => x.level !== 'ok').length - 3 }} 条
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- 组件:整表 -->
            <div v-else-if="activeTab === 'components'" class="asm-content">
              <div v-if="selUnit.components.length === 0" class="muted-2 empty pad-lg">该实体无组件</div>
              <table v-else class="tbl comp-tbl">
                <thead class="comp-thead">
                  <tr><th>类名 (className)</th><th>组件 ID (componentId)</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(comp, i) in selUnit.components" :key="i">
                    <td class="mono">{{ comp.className }}</td>
                    <td class="muted-2 mono cid" :title="comp.componentId">{{ comp.componentId }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 校验:按树分组的详细问题 -->
            <div v-else-if="activeTab === 'validation'" class="asm-content">
              <div v-if="perTreeValidation.length === 0" class="muted-2 empty pad-lg">选实体 + 勾选树后自动校验</div>
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
          </div>
        </template>
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

        <details class="fold" open v-if="pendingDiff !== null" data-anchor="diff">
          <summary class="fold-t">
            <span class="chev">▾</span>
            <span class="tt">覆盖预览 · 挂接差异</span>
            <span class="tag warn">待确认</span>
          </summary>
          <div class="fold-b">
            <div class="diff-hint muted-2">
              点击顶部「预览差异并覆盖」后此处展开;为避免长表格挤走「挂接结果」,
              差异对比同时在中央弹窗里独立打开(内滚 + 明确的 <b>确认/取消</b>)。
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
            <div v-if="!result" class="muted-2 empty">写回后显示</div>
            <div v-else class="res-card">
              <div class="res-msg">{{ result.message }}</div>
              <div class="res-group">
                <div class="res-lbl">写入的 BT XML ({{ result.writtenTrees.filter((t) => t.kind === 'BT').length }})</div>
                <div v-for="t in result.writtenTrees.filter((x) => x.kind === 'BT')" :key="'b'+t.name" class="res-row">
                  <span class="res-badge bt">BT</span>
                  <span class="res-name">{{ t.name }}.bt</span>
                  <span class="res-arrow">→</span>
                  <code class="res-path" :title="t.absolutePath">{{ t.absolutePath }}</code>
                  <button class="btn tiny" @click="copyPath(t.absolutePath)" title="复制路径">⧉</button>
                </div>
              </div>
              <div class="res-group" v-if="result.writtenTrees.some((x) => x.kind === 'FSM')">
                <div class="res-lbl">写入的 FSM XML ({{ result.writtenTrees.filter((t) => t.kind === 'FSM').length }})</div>
                <div v-for="t in result.writtenTrees.filter((x) => x.kind === 'FSM')" :key="'f'+t.name" class="res-row">
                  <span class="res-badge fsm">FSM</span>
                  <span class="res-name">{{ t.name }}.sm</span>
                  <span class="res-arrow">→</span>
                  <code class="res-path" :title="t.absolutePath">{{ t.absolutePath }}</code>
                  <button class="btn tiny" @click="copyPath(t.absolutePath)" title="复制路径">⧉</button>
                </div>
              </div>
              <div class="res-group">
                <div class="res-lbl">写回的 .sdata</div>
                <div class="res-row">
                  <span class="res-badge sdata">SD</span>
                  <span class="res-name">{{ result.scenario }}</span>
                  <span class="res-arrow">→</span>
                  <code class="res-path" :title="result.scenarioPath">{{ result.scenarioPath }}</code>
                  <button class="btn tiny" @click="copyPath(result.scenarioPath)" title="复制路径">⧉</button>
                </div>
              </div>
              <div class="res-group" v-if="result.globalBlackboardPath">
                <div class="res-lbl">全局黑板</div>
                <div class="res-row">
                  <span class="res-badge gbb">GB</span>
                  <span class="res-name">global_black_boards.xml</span>
                  <span class="res-arrow">→</span>
                  <code class="res-path" :title="result.globalBlackboardPath">{{ result.globalBlackboardPath }}</code>
                  <button class="btn tiny" @click="copyPath(result.globalBlackboardPath!)" title="复制路径">⧉</button>
                </div>
              </div>
              <div class="res-group" v-if="result.conflicts.length">
                <div class="res-lbl">替换的同名条目 ({{ result.conflicts.length }})</div>
                <div class="res-chips">
                  <span v-for="n in result.conflicts" :key="n" class="d-chip rm">{{ n }}</span>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>

    <!-- 覆盖预览:模态弹窗。内部滚动 + 明确的确认/取消,保证「挂接结果」在右列不会被撑走。 -->
    <ModalDialog
      :open="pendingDiff !== null"
      title="覆盖预览 · 挂接差异"
      ok-label="确认覆盖"
      :width="780"
      @cancel="cancelAttach"
      @ok="confirmAttach"
    >
      <div class="diff-modal-hd muted-2">baseline(.sdata) → 覆盖后(勾选)</div>
      <div v-if="!pendingDiff || pendingDiff.length === 0" class="muted-2 empty">没有变化 —— 勾选和 baseline 一致</div>
      <table v-else class="diff-tbl">
        <thead>
          <tr>
            <th style="width:22%">实体</th>
            <th style="width:39%">BT 变化</th>
            <th style="width:39%">FSM 变化</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingDiff" :key="row.unitName" :class="{ nc: !row.changed }">
            <td class="u-name">{{ row.unitName }}<span v-if="!row.changed" class="mini-tag">未变</span></td>
            <td class="d-cell">
              <span v-for="n in row.bt.add"    :key="'a'+n" class="d-chip add">+ {{ n }}</span>
              <span v-for="n in row.bt.remove" :key="'r'+n" class="d-chip rm">− {{ n }}</span>
              <span v-for="n in row.bt.keep"   :key="'k'+n" class="d-chip keep">= {{ n }}</span>
              <span v-if="!row.bt.add.length && !row.bt.remove.length && !row.bt.keep.length" class="muted-2 mini">—</span>
            </td>
            <td class="d-cell">
              <span v-for="n in row.fsm.add"    :key="'fa'+n" class="d-chip add">+ {{ n }}</span>
              <span v-for="n in row.fsm.remove" :key="'fr'+n" class="d-chip rm">− {{ n }}</span>
              <span v-for="n in row.fsm.keep"   :key="'fk'+n" class="d-chip keep">= {{ n }}</span>
              <span v-if="!row.fsm.add.length && !row.fsm.remove.length && !row.fsm.keep.length" class="muted-2 mini">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </ModalDialog>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 10px; height: 100%; }
.page-bar { padding: 8px 12px; gap: 7px; flex-wrap: wrap; align-items: center; }
.narrow { width: 168px; }

.grid { display: flex; gap: 4px; flex: 1; min-height: 0; min-width: 0; }
.grid > .panel { flex: 1 1 0; min-width: 0; overflow: auto; }
.grid > .panel.c1 { flex: 0 0 260px; }
/* 中列(组装台):列本身不滚,由 head/tabs/body 三段拆分;body 内独立滚动。 */
.grid > .panel.assembly { flex: 1.4 1 0; overflow: hidden; display: flex; flex-direction: column; padding: 0; }
.panel.assembly > .empty.pad { flex: 0 0 auto; padding: 20px; }

/* 组装台:实体头 —— 固定高度,不参与滚动 */
.asm-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-2);
  flex: 0 0 auto;
}
.asm-head .uc-ico { font-size: 18px; color: var(--accent); flex: 0 0 auto; }
.asm-head-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.asm-head-row1 { display: flex; align-items: baseline; gap: 8px; flex-wrap: nowrap; min-width: 0; }
.asm-head-row1 > * { flex-shrink: 0; white-space: nowrap; }
.asm-head-row1 .asm-title { overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.asm-title { font-size: 14px; color: var(--text-primary); font-weight: 600; }
.asm-head-row2 { font-size: 11px; }

/* Tab 分段 —— 也是固定 */
.asm-tabs {
  display: flex; padding: 0 10px; gap: 2px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-1);
  flex: 0 0 auto;
}
.asm-tab {
  padding: 9px 14px; font-size: 12px;
  background: transparent; border: none; color: var(--text-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  display: inline-flex; align-items: center; gap: 6px;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}
.asm-tab:hover { color: var(--text-primary); background: var(--surface-3); }
.asm-tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
.tab-cnt {
  padding: 1px 7px; border-radius: 9px; background: var(--surface-3);
  font-size: 10.5px; font-weight: 600; color: var(--text-secondary);
  min-width: 20px; text-align: center;
}
.tab-cnt.err { background: var(--err-soft); color: var(--err, #e05656); }
.tab-cnt.ok { background: rgba(76,175,80,0.14); color: #6dc36d; }
.asm-tab.active .tab-cnt { background: var(--accent-soft); color: var(--accent); }

/* Tab 主体:占满剩余,内部 asm-content 独立滚动 */
.asm-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.asm-content { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; }
.pad-lg { padding: 40px 20px; text-align: center; }
.empty-ico { font-size: 32px; color: var(--text-tertiary); margin-bottom: 10px; opacity: 0.5; }

/* 已挂载:卡片网格 */
.assem-grid { display: flex; flex-direction: column; gap: 10px; }
.assem-card {
  border: 1px solid var(--border-subtle); border-radius: 8px;
  background: var(--surface-2); overflow: hidden;
  transition: border-color 0.15s;
}
.assem-card:hover { border-color: var(--accent-border); }
.assem-card-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px 8px 12px;
  background: var(--surface-3);
  border-bottom: 1px solid var(--border-subtle);
}
.assem-card-name { color: var(--text-primary); font-size: 12.5px; min-width: 0; }
.assem-card-body { padding: 8px 12px 10px; font-size: 12px; }
.v-ok, .v-err-head { display: flex; align-items: center; gap: 8px; }
.v-err-head { margin-bottom: 6px; }
.v-err-list { display: flex; flex-direction: column; gap: 3px; padding-left: 4px; }
.more { font-size: 11px; padding: 2px 4px; }
.btn.link { background: transparent; color: var(--accent); border: none; padding: 2px 4px; font-size: 11px; cursor: pointer; }
.btn.link:hover { text-decoration: underline; }

/* 组件表 表头:sticky,长列表滚动时表头不跑丢 */
.comp-thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--surface-2); color: var(--text-secondary);
  font-weight: 600; font-size: 11px; text-align: left;
  padding: 6px 8px; border-bottom: 1px solid var(--border-subtle);
}
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
.fold-t .tt { font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.fold-t .muted-3 { white-space: nowrap; flex: 0 0 auto; }
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
.filter-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 2px 6px;
}
.filter-in { flex: 1; min-width: 0; font-size: 11.5px; }
.filter-row .x-btn { padding: 0 6px; line-height: 20px; font-size: 11px; flex: 0 0 auto; }
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
.ui-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; flex-wrap: nowrap; min-width: 0; }
.ui-row > .tag { flex-shrink: 0; }
.ui-meta { font-size: 11px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.u-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* --- 组装台内容布局 --- */
/* unit-card 是三段(组件/已挂载/批量校验)的父容器,自身不滚,让内部每段独立滚。 */
.unit-card { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; overflow: hidden; min-height: 0; }
.uc-ico { font-size: 14px; color: var(--accent); flex: 0 0 auto; }

/* 三段(fold)在 unit-card 内平分剩余高度:
 * flex:1 1 0 让每段拿到 1/3 剩余高度;min-height:0 是让 flex 子容器允许收缩到 overflow 生效的关键。
 * 折叠(未 open)时不吃高度。 */
.unit-card > .fold { display: flex; flex-direction: column; min-height: 0; }
.unit-card > .fold[open] { flex: 1 1 0; }
.unit-card > .fold:not([open]) { flex: 0 0 auto; }
.unit-card > .fold > .fold-t { flex: 0 0 auto; }
/* 每段的 body 独立滚动:overflow:auto + min-height:0 允许收缩,内容超过就出滚动条。 */
.unit-card > .fold[open] > .fold-b { flex: 1 1 auto; min-height: 0; overflow-y: auto; }

/* 组件表滚动容器:去掉 max-height —— 现在外层 fold-b 已经承担滚动,组件表铺满即可。 */
.comp-scroll { border-radius: 4px; }

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
  flex-wrap: nowrap; min-width: 0;
}
.vrow > .tag { flex-shrink: 0; }
.vrow.error { background: var(--err-soft); }
.vrow.ok { color: var(--text-secondary); }
.vnode {
  min-width: 0; max-width: 40%; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 0 auto;
}
.vreason {
  color: var(--text-tertiary); margin-left: auto; max-width: 42%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto;
}

/* 货架 —— 树多了自己内滚,决不把下方「挂接结果」推出视口 */
.shelf {
  display: flex; flex-direction: column; gap: 4px;
  max-height: 260px; overflow-y: auto;
  padding-right: 2px;
}
.shelf-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12.5px;
  border: 1px solid transparent;
  flex-wrap: nowrap; min-width: 0;
}
.shelf-item > .tag { flex-shrink: 0; }
.shelf-item .cnt { margin-left: auto; font-size: 11px; flex-shrink: 0; white-space: nowrap; }
.shelf-item:hover { background: var(--surface-3); }
.shelf-item.on { background: var(--accent-soft); border-color: var(--accent-border); }

/* 覆盖式挂接:工具栏文案标签 */
.policy-hint { font-size: 11.5px; color: var(--text-secondary); padding: 3px 8px; border-radius: 10px; background: var(--surface-3); }

/* --- 右列(货架 + 覆盖预览提示 + 挂接结果):关键是外层 panel 承担纵向滚动,
 *    内部各 fold 展开时正常撑高,滚不动就出滚动条 —— 不再让"结果"被顶到视口外看不见。 */
.grid > .panel:not(.c1):not(.assembly) {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
  min-height: 0;
}
.diff-hint {
  font-size: 12px;
  line-height: 1.55;
  padding: 4px 2px 2px;
}

/* --- 覆盖预览模态:内容延用原样式,加个小顶提示 --- */
.diff-modal-hd {
  padding: 2px 0 8px;
  font-size: 12px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 8px;
}

/* 差异覆盖预览 */
.diff-hd { padding: 4px 0 8px; }
.diff-body { padding: 4px 0; }
.diff-tbl { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.diff-tbl th { text-align: left; padding: 6px 8px; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border-subtle); font-size: 11.5px; background: var(--surface-2); }
.diff-tbl td { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
.diff-tbl tr.nc td { opacity: 0.55; }
.u-name { font-weight: 600; color: var(--text-primary); }
.mini-tag { margin-left: 6px; font-size: 10px; color: var(--text-tertiary); font-weight: normal; }
.d-cell { line-height: 1.9; }
.d-chip {
  display: inline-block; padding: 2px 8px; margin: 1px 3px 1px 0; border-radius: 10px;
  font-size: 11px; font-family: ui-monospace, "SF Mono", Consolas, monospace;
  border: 1px solid transparent;
}
.d-chip.add  { background: rgba(76,175,80,0.13); color: #6dc36d; border-color: rgba(76,175,80,0.3); }
.d-chip.rm   { background: var(--err-soft, rgba(224,86,86,0.13)); color: var(--err, #e05656); border-color: rgba(224,86,86,0.3); text-decoration: line-through; }
.d-chip.keep { background: var(--surface-3); color: var(--text-secondary); }
.mini { font-size: 11px; }

/* 结果:结构化路径卡 */
.res-card { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }
.res-msg { font-size: 12.5px; color: var(--text-primary); font-weight: 600; padding: 4px 0; }
.res-group { display: flex; flex-direction: column; gap: 4px; }
.res-lbl { font-size: 11px; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.02em; }
.res-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; background: var(--surface-3); border-radius: 6px; font-size: 12px;
}
.res-badge {
  font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
  min-width: 30px; text-align: center; flex: 0 0 auto;
}
.res-badge.bt { background: var(--accent-soft); color: var(--accent); }
.res-badge.fsm { background: rgba(155,89,182,0.15); color: #b47dd8; }
.res-badge.sdata { background: rgba(255,152,0,0.15); color: #d29244; }
.res-badge.gbb { background: rgba(96,166,236,0.15); color: #60a6ec; }
.res-name {
  font-weight: 600; color: var(--text-primary);
  flex: 0 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 40%;
}
.res-arrow { color: var(--text-tertiary); flex: 0 0 auto; }
.res-path {
  flex: 1; min-width: 0;
  font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 6px; background: var(--surface-2); border-radius: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.res-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }

/* 工具 */
.spacer { flex: 1; }
.empty { padding: 10px; }
.empty.pad { padding: 14px 10px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nowrap { white-space: nowrap; }
.muted-3 { color: var(--text-tertiary); font-weight: normal; font-size: 11px; }
</style>
