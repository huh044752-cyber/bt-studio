<script setup lang="ts">
import { ref, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
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
/** 某全局黑板被哪些行为树链接(显示链接关系)。 */
function linkedTreesOf(bbId: string): string[] {
  void ws.rev;
  return ws.trees.filter((t) => t.linkedGlobalBlackboardIds.includes(bbId)).map((t) => t.displayName);
}
const displayTypes: DisplayType[] = ["bool", "int", "float", "string", "name", "coordinate", "position", "vector", "unitId", "entityId"];
/** 把 displayType 显示为 FZ 引擎类型(下拉与表头都用 FZ 习惯类型,而非裸 int/float)。 */
function fzLabel(dt: DisplayType): string {
  try {
    return malToXmlType(resolveMalType(dt));
  } catch {
    return dt;
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
  current.value.variables.push({
    variableId: newVariableId(),
    name: sanitizeVariableKey("new_var"),
    scope: current.value.scope === "global" ? "global" : "tree",
    displayType: "float",
    malType: "FZ_MARGTYPE_REAL",
    valueFormat: "literal",
    defaultValue: "0",
  });
  ws.bump();
}

function onTypeChange(varId: string, raw: string) {
  const v = current.value?.variables.find((x) => x.variableId === varId);
  if (!v) return;
  if (raw.startsWith("enum:")) {
    const enumName = raw.slice(5);
    const e = ws.enums.find((x) => x.name === enumName);
    v.displayType = "enum";
    v.enumRef = enumName;
    v.malType = e?.malType ?? "FZ_MARGTYPE_NAME";
  } else {
    v.displayType = raw as DisplayType;
    v.enumRef = undefined;
    v.malType = resolveMalType(raw as DisplayType);
  }
}

function checkValue(value: string | undefined, malType?: string): string {
  if (!malType) return "缺 malType";
  const r = validateMalValueConversion(value, malType as never);
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
    <div class="page-bar panel row">
      <strong>黑板中心 · 运行期变量</strong>
      <span class="spacer" />
      <input v-model="newBbName" class="input narrow" placeholder="新建全局黑板名…" />
      <button class="btn tiny primary" @click="createGlobal">新建全局黑板</button>
    </div>
    <div class="hint-banner panel">
      <span class="tag info">黑板</span>
      这里创建<strong>运行期变量</strong>(全局黑板 = 跨树共享 / 本地黑板 = 单树私有,对应 behaviac 的静态成员 / Par)。
      变量的<strong>类型</strong>引用「类型空间」里的枚举/结构体,<strong>类/Agent/方法/枚举/结构体的声明请到「类型空间 (Agent/类型)」页创建</strong>。
      区别:此处=数据实例;类型空间=类型声明(等价 C++ 类成员/方法)。
    </div>
    <div class="grid">
      <div class="panel list scroll">
        <div class="grp">全局黑板(跨树共享)</div>
        <div
          v-for="b in blackboards"
          :key="b.blackboardId"
          class="bb-item"
          :class="{ active: b.blackboardId === selectedBb }"
          @click="selectedBb = b.blackboardId"
        >
          <div class="bb-row">
            <span class="tag info">全局</span>
            <span class="nm">{{ b.name }}</span>
            <span class="muted-2">{{ b.variables.length }} 变量</span>
            <button
              class="btn tiny"
              :class="{ primary: linkedToCurrentTree.includes(b.blackboardId) }"
              :disabled="!ws.currentTree"
              :title="ws.currentTree ? '链接/解除到当前树' : '先在设计页选一棵树'"
              @click.stop="toggleLink(b.blackboardId)"
            >
              {{ linkedToCurrentTree.includes(b.blackboardId) ? "已链接当前树" : "链接当前树" }}
            </button>
          </div>
          <div class="links">
            <span class="muted-2">被链接:</span>
            <template v-if="linkedTreesOf(b.blackboardId).length">
              <span v-for="(tn, i) in linkedTreesOf(b.blackboardId)" :key="i" class="chip">{{ tn }}</span>
            </template>
            <span v-else class="muted-2">(无)</span>
          </div>
        </div>
        <div v-if="blackboards.length === 0" class="muted-2 empty">暂无全局黑板,上方新建。</div>

        <div class="grp">本地黑板(单树私有)</div>
        <div
          v-for="x in localBoards"
          :key="x.board.blackboardId"
          class="bb-item"
          :class="{ active: x.board.blackboardId === selectedBb }"
          @click="selectedBb = x.board.blackboardId"
        >
          <div class="bb-row">
            <span class="tag">本地</span>
            <span class="nm">{{ x.board.name }}</span>
            <span class="muted-2">{{ x.board.variables.length }} 变量</span>
            <span class="chip owner">归属:{{ x.tree.displayName }}</span>
          </div>
        </div>
        <div v-if="localBoards.length === 0" class="muted-2 empty">暂无树/本地黑板。</div>
      </div>
      <div class="panel detail scroll">
        <div v-if="!current" class="muted-2 empty">选择左侧黑板(全局/本地)查看与编辑变量</div>
        <div v-else>
          <div class="row">
            <span class="tag" :class="current.scope === 'global' ? 'info' : ''">{{ current.scope === "global" ? "全局" : "本地" }}</span>
            <strong>{{ current.name }}</strong><span class="spacer" /><button class="btn tiny" @click="addVar">新建变量</button>
          </div>
          <table class="tbl">
            <thead>
              <tr><th>变量名</th><th>类型 (FZ)</th><th>malType</th><th>默认值</th><th>校验</th></tr>
            </thead>
            <tbody>
              <tr v-for="v in current.variables" :key="v.variableId">
                <td><input class="input tiny" v-model="v.name" /></td>
                <td>
                  <select class="select tiny" :value="v.enumRef ? 'enum:' + v.enumRef : v.displayType" @change="onTypeChange(v.variableId, ($event.target as HTMLSelectElement).value)">
                    <optgroup label="基础类型 (FZ)">
                      <option v-for="dt in displayTypes" :key="dt" :value="dt">{{ fzLabel(dt) }}</option>
                    </optgroup>
                    <optgroup v-if="ws.enums.length" label="枚举(来自类型空间)">
                      <option v-for="e in ws.enums" :key="e.enumId" :value="'enum:' + e.name">enum:{{ e.name }}</option>
                    </optgroup>
                  </select>
                </td>
                <td class="tag info">{{ v.malType }}</td>
                <td><input class="input tiny" v-model="v.defaultValue" /></td>
                <td :class="checkValue(v.defaultValue, v.malType) === '✓' ? 'ok' : 'err'">{{ checkValue(v.defaultValue, v.malType) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 10px; height: 100%; }
.page-bar { padding: 8px 12px; gap: 8px; }
.hint-banner { padding: 8px 12px; font-size: 12px; line-height: 1.6; color: var(--muted); }
.narrow { width: 200px; }
.grid { display: grid; grid-template-columns: 300px 1fr; gap: 10px; flex: 1; min-height: 0; }
.list, .detail { padding: 8px; }
.grp { font-size: 10.5px; color: var(--muted-2); text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 4px 4px; }
.bb-item { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
.bb-item:hover { background: rgba(94,179,255,0.06); }
.bb-item.active { background: rgba(94,179,255,0.13); border-color: rgba(94,179,255,0.3); }
.bb-row { display: flex; align-items: center; gap: 8px; }
.links { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 11px; padding-left: 2px; }
.chip { background: rgba(122,156,193,0.16); border-radius: 5px; padding: 1px 6px; font-size: 10.5px; }
.chip.owner { background: rgba(245,182,92,0.16); color: var(--accent-2); }
.nm { flex: 1; font-weight: 600; }
.empty { padding: 16px; }
.tbl { width: 100%; border-collapse: collapse; margin-top: 8px; }
.tbl th { text-align: left; font-size: 10.5px; color: var(--muted-2); padding: 4px 6px; }
.tbl td { padding: 3px 6px; border-bottom: 1px solid var(--line-soft); }
.input.tiny, .select.tiny { height: 24px; font-size: 11px; }
.ok { color: var(--ok); }
.err { color: var(--err); }
</style>
