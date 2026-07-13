<script setup lang="ts">
import { ref, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import PageBar from "@/components/common/PageBar.vue";
import Card from "@/components/common/Card.vue";
import Tag from "@/components/common/Tag.vue";
import {
  createBlackboard,
  resolveMalType,
  malToXmlType,
  validateMalValueConversion,
  sanitizeVariableKey,
  newVariableId,
  type DisplayType,
  type Blackboard,
  type DesignTree,
} from "@btstudio/bt-core";

const ws = useWorkspaceStore();
const c = useConsoleStore();
const selectedBb = ref<string>("");
const newBbName = ref("");

const blackboards = computed(() => ws.globalBlackboards);
/** 本地黑板:每棵树各一块(scope=tree),归属该树。 */
const localBoards = computed<{ tree: DesignTree; board: Blackboard }[]>(() => {
  void ws.rev;
  const out: { tree: DesignTree; board: Blackboard }[] = [];
  for (const t of ws.trees) {
    const board = ws.localBlackboards[t.treeId];
    if (board) out.push({ tree: t, board });
  }
  return out;
});
/** 当前选中黑板(可能是全局或本地)。 */
const current = computed(
  () =>
    blackboards.value.find((b) => b.blackboardId === selectedBb.value) ??
    localBoards.value.find((x) => x.board.blackboardId === selectedBb.value)?.board,
);
/** 归属信息(仅本地板):找到对应的树名。 */
const currentOwnerTree = computed(() => {
  if (!current.value || current.value.scope === "global") return "";
  return localBoards.value.find((x) => x.board.blackboardId === current.value?.blackboardId)?.tree.displayName ?? "";
});
/** 某全局黑板被哪些行为树链接(显示链接关系)。 */
function linkedTreesOf(bbId: string): string[] {
  void ws.rev;
  return ws.trees.filter((t) => t.linkedGlobalBlackboardIds.includes(bbId)).map((t) => t.displayName);
}
const displayTypes: DisplayType[] = ["bool", "int", "float", "string", "name", "coordinate", "position", "vector", "unitId", "entityId"];
/** 把 displayType 显示为 Cyber 引擎类型(下拉与表头都用 Cyber 习惯类型,而非裸 int/float)。 */
function cyberLabel(dt: DisplayType): string {
  try {
    return malToXmlType(resolveMalType(dt));
  } catch {
    return dt;
  }
}

/**
 * 新变量的默认值按 displayType 兜底,对齐老引擎 .bt 里 <Variable value="..."> 的类型习惯:
 *  bool → "false"、int/unitId/entityId → "0"、float → "0.000000"、
 *  coord/position/vector → "0.000000,0.000000"、string/name → ""、enum → 该枚举首项(或 "")。
 */
function defaultForDisplayType(dt: DisplayType, enumRef?: string): string {
  if (enumRef) {
    const e = ws.enums.find((x) => x.name === enumRef);
    return e?.items?.[0]?.runtimeValue ?? "";
  }
  switch (dt) {
    case "bool": return "false";
    case "int": case "unitId": case "entityId": return "0";
    case "float": return "0.000000";
    case "coordinate": case "position": case "vector": return "0.000000,0.000000";
    case "string": case "name": default: return "";
  }
}

function createGlobal() {
  const name = newBbName.value.trim();
  if (!name || blackboards.value.find((b) => b.name === name)) {
    c.warning("workspace", "黑板名为空或重名");
    return;
  }
  const bb = createBlackboard(name, "global");
  ws.globalBlackboards.push(bb);
  selectedBb.value = bb.blackboardId;
  newBbName.value = "";
  c.success("workspace", `新建全局黑板 ${name}`);
}

function addVar() {
  if (!current.value) return;
  const dt: DisplayType = "float";
  current.value.variables.push({
    variableId: newVariableId(),
    name: sanitizeVariableKey("new_var"),
    scope: current.value.scope === "global" ? "global" : "tree",
    displayType: dt,
    malType: resolveMalType(dt),
    valueFormat: "literal",
    defaultValue: defaultForDisplayType(dt),
  });
  ws.bump();
}

function removeVar(varId: string) {
  if (!current.value) return;
  const idx = current.value.variables.findIndex((v) => v.variableId === varId);
  if (idx >= 0) {
    current.value.variables.splice(idx, 1);
    ws.bump();
  }
}

function onTypeChange(varId: string, raw: string) {
  const v = current.value?.variables.find((x) => x.variableId === varId);
  if (!v) return;
  const prev = v.defaultValue;
  let dt: DisplayType;
  let enumRef: string | undefined;
  if (raw.startsWith("enum:")) {
    enumRef = raw.slice(5);
    const e = ws.enums.find((x) => x.name === enumRef);
    dt = "enum" as DisplayType;
    v.displayType = "enum";
    v.enumRef = enumRef;
    v.malType = e?.malType ?? "CYBER_MARGTYPE_NAME";
  } else {
    dt = raw as DisplayType;
    v.displayType = dt;
    v.enumRef = undefined;
    v.malType = resolveMalType(dt);
  }
  const stillOk = prev !== undefined && prev !== "" &&
    validateMalValueConversion(prev, v.malType as never).ok;
  if (!stillOk) v.defaultValue = defaultForDisplayType(dt, enumRef);
}

function checkValue(value: string | undefined, v: { malType?: string; displayType: DisplayType; enumRef?: string }): string {
  const effectiveMal = v.malType ?? (v.enumRef ? "CYBER_MARGTYPE_NAME" : resolveMalType(v.displayType));
  if (!effectiveMal || effectiveMal === "CYBER_MARGTYPE_INVALID") return "类型未解析";
  const r = validateMalValueConversion(value, effectiveMal as never);
  return r.ok ? "✓" : r.message ?? "✗";
}

const linkedToCurrentTree = computed(() => ws.currentTree?.linkedGlobalBlackboardIds ?? []);
function toggleLink(bbId: string) {
  const t = ws.currentTree;
  if (!t) return;
  const idx = t.linkedGlobalBlackboardIds.indexOf(bbId);
  if (idx >= 0) { t.linkedGlobalBlackboardIds.splice(idx, 1); c.info("workspace", "解除链接"); }
  else { t.linkedGlobalBlackboardIds.push(bbId); c.info("workspace", "链接到当前树"); }
  ws.bump();
  ws.validate();
}
</script>

<template>
  <div class="page">
    <PageBar title="黑板中心" :subtitle="`${blackboards.length} 全局 · ${localBoards.length} 本地`" dot="brand" help-title="黑板中心 · 使用帮助">
      <template #actions>
        <input v-model="newBbName" class="input tiny narrow" placeholder="新建全局黑板名…" @keydown.enter="createGlobal" />
        <button class="btn tiny primary" @click="createGlobal">＋ 新建全局黑板</button>
      </template>
      <template #help>
        <section class="help-sec">
          <h3>这个页面是做什么的?</h3>
          <p>创建<strong>运行期变量</strong>—— 行为树/状态机运行时读写的数据。对应 behaviac 的静态成员 / Par。</p>
        </section>
        <section class="help-sec">
          <h3>两种黑板</h3>
          <ul>
            <li><strong>全局黑板</strong>(跨树共享)—— 所有链接了它的树都能读写</li>
            <li><strong>本地黑板</strong>(单树私有)—— 每棵树自动带一块,归属清晰</li>
          </ul>
        </section>
        <section class="help-sec">
          <h3>与「类型空间」的分工</h3>
          <ul>
            <li>本页 = 变量<strong>实例</strong>(有名字 + 类型 + 默认值)</li>
            <li>类型空间 = <strong>类型声明</strong>(类/方法/枚举/结构体)</li>
          </ul>
          <p>本页新建变量时的"类型"下拉,枚举项都是从类型空间读取的;要新增枚举请先去类型空间。</p>
        </section>
      </template>
    </PageBar>

    <div class="grid">
      <!-- 左列:黑板列表 -->
      <div class="col left">
        <Card :title="`全局黑板`" :subtitle="`${blackboards.length} 块 · 跨树共享`" scroll-body class="col-card">
          <div v-if="blackboards.length === 0" class="empty">
            <div class="empty-ico">◇</div>
            <div class="empty-t">暂无全局黑板</div>
            <div class="empty-hint">顶部输入名称后点「新建全局黑板」</div>
          </div>
          <div v-else class="bb-list">
            <div
              v-for="b in blackboards"
              :key="b.blackboardId"
              class="bb-item"
              :class="{ active: b.blackboardId === selectedBb }"
              @click="selectedBb = b.blackboardId"
            >
              <div class="bb-head">
                <Tag variant="accent" size="xs">全局</Tag>
                <span class="bb-name ellipsis">{{ b.name }}</span>
                <span class="bb-count nowrap">{{ b.variables.length }} 变量</span>
              </div>
              <div class="bb-meta">
                <span class="meta-lbl">被链接:</span>
                <template v-if="linkedTreesOf(b.blackboardId).length">
                  <Tag v-for="(tn, i) in linkedTreesOf(b.blackboardId)" :key="i" variant="neutral" size="xs">{{ tn }}</Tag>
                </template>
                <span v-else class="muted-3">(无)</span>
              </div>
              <div class="bb-actions">
                <button
                  class="btn tiny"
                  :class="{ primary: linkedToCurrentTree.includes(b.blackboardId) }"
                  :disabled="!ws.currentTree"
                  :title="ws.currentTree ? '链接/解除到当前树' : '先在设计页选一棵树'"
                  @click.stop="toggleLink(b.blackboardId)"
                >
                  {{ linkedToCurrentTree.includes(b.blackboardId) ? "✓ 已链接当前树" : "＋ 链接到当前树" }}
                </button>
              </div>
            </div>
          </div>
        </Card>

        <Card :title="`本地黑板`" :subtitle="`${localBoards.length} 块 · 单树私有`" scroll-body class="col-card">
          <div v-if="localBoards.length === 0" class="empty">
            <div class="empty-ico">◈</div>
            <div class="empty-t">暂无树/本地黑板</div>
            <div class="empty-hint">新建行为树后自动生成本地板</div>
          </div>
          <div v-else class="bb-list">
            <div
              v-for="x in localBoards"
              :key="x.board.blackboardId"
              class="bb-item"
              :class="{ active: x.board.blackboardId === selectedBb }"
              @click="selectedBb = x.board.blackboardId"
            >
              <div class="bb-head">
                <Tag variant="neutral" size="xs">本地</Tag>
                <span class="bb-name ellipsis">{{ x.board.name }}</span>
                <span class="bb-count nowrap">{{ x.board.variables.length }} 变量</span>
              </div>
              <div class="bb-meta">
                <span class="meta-lbl">归属:</span>
                <Tag variant="accent-2" size="xs">{{ x.tree.displayName }}</Tag>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <!-- 右列:变量表 -->
      <Card
        :title="current ? current.name : '变量表'"
        :subtitle="current ? (current.scope === 'global' ? '全局黑板' : `本地黑板 · 归属 ${currentOwnerTree}`) : '选择左侧黑板开始编辑'"
        scroll-body
        class="detail-card"
      >
        <template v-if="current" #actions>
          <Tag :variant="current.scope === 'global' ? 'accent' : 'neutral'" size="sm">
            {{ current.scope === "global" ? "全局" : "本地" }}
          </Tag>
          <span class="muted-3 nowrap">{{ current.variables.length }} 变量</span>
          <button class="btn tiny primary" @click="addVar">＋ 新建变量</button>
        </template>

        <div v-if="!current" class="empty">
          <div class="empty-ico">▨</div>
          <div class="empty-t">未选中任何黑板</div>
          <div class="empty-hint">从左侧列表点选一个全局或本地黑板</div>
        </div>

        <div v-else-if="current.variables.length === 0" class="empty">
          <div class="empty-ico">＋</div>
          <div class="empty-t">该黑板暂无变量</div>
          <div class="empty-hint">点击右上「新建变量」增加</div>
        </div>

        <table v-else class="var-tbl">
          <thead>
            <tr>
              <th class="col-name">变量名</th>
              <th class="col-type">类型 (Cyber)</th>
              <th class="col-mal">malType</th>
              <th class="col-val">默认值</th>
              <th class="col-chk">校验</th>
              <th class="col-op"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in current.variables" :key="v.variableId">
              <td><input class="input tiny" v-model="v.name" /></td>
              <td>
                <select class="select tiny" :value="v.enumRef ? 'enum:' + v.enumRef : v.displayType" @change="onTypeChange(v.variableId, ($event.target as HTMLSelectElement).value)">
                  <optgroup label="基础类型 (Cyber)">
                    <option v-for="dt in displayTypes" :key="dt" :value="dt">{{ cyberLabel(dt) }}</option>
                  </optgroup>
                  <optgroup v-if="ws.enums.length" label="枚举(来自类型空间)">
                    <option v-for="e in ws.enums" :key="e.enumId" :value="'enum:' + e.name">enum:{{ e.name }}</option>
                  </optgroup>
                </select>
              </td>
              <td><span class="mono mal-cell">{{ v.malType || resolveMalType(v.displayType) }}</span></td>
              <td><input class="input tiny" v-model="v.defaultValue" /></td>
              <td>
                <Tag :variant="checkValue(v.defaultValue, v) === '✓' ? 'ok' : 'err'" size="xs">
                  {{ checkValue(v.defaultValue, v) }}
                </Tag>
              </td>
              <td>
                <button class="btn tiny danger" @click="removeVar(v.variableId)" title="删除变量">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
}
.narrow { width: 220px; }

.grid {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: var(--space-3);
  flex: 1;
  min-height: 0;
}

/* 左列 —— 两个 Card(全局 / 本地)平分高度,各自独立滚动 */
.col.left {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  min-width: 0;
}
.col-card {
  flex: 1 1 0;
  min-height: 0;
}
.detail-card {
  min-height: 0;
}

/* 黑板列表条 —— 每条为独立卡片,内容 nowrap + 省略号,决不竖排 */
.bb-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.bb-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--surface-3);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
  min-width: 0;
}
.bb-item:hover {
  background: var(--surface-4);
  border-color: var(--border-strong);
}
.bb-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  box-shadow: 0 0 0 1px var(--accent-border);
}

.bb-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.bb-name {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  color: var(--text-primary);
  font-size: 13px;
}
.bb-count {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 11px;
}

.bb-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  min-width: 0;
}
.meta-lbl {
  color: var(--text-tertiary);
  flex: 0 0 auto;
}

.bb-actions {
  display: flex;
  gap: var(--space-2);
}

/* Empty 状态 */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-5) var(--space-3);
  gap: 6px;
  color: var(--text-tertiary);
}
.empty-ico {
  font-size: 28px;
  color: var(--text-disabled);
}
.empty-t {
  color: var(--text-secondary);
  font-weight: 600;
}
.empty-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
}

/* 变量表 —— 表头 sticky,列宽克制 */
.var-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.var-tbl th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-2);
  text-align: left;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  border-bottom: 1px solid var(--border-subtle);
}
.var-tbl td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}
.var-tbl tr:hover td {
  background: var(--surface-3);
}
.col-name { width: 22%; }
.col-type { width: 22%; }
.col-mal { width: 22%; }
.col-val { width: 20%; }
.col-chk { width: 10%; }
.col-op { width: 44px; }

.mal-cell {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 2px 6px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.nowrap { white-space: nowrap; }
.muted-3 { color: var(--text-tertiary); font-size: 11px; }
</style>
