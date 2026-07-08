<script setup lang="ts">
import { ref, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import ActionButton from "@/components/common/ActionButton.vue";
import ModalDialog from "@/components/common/ModalDialog.vue";
import Splitter from "@/components/common/Splitter.vue";
import { downloadText, readTextFile } from "@/services/tauri";
import { functionOwnerClass, newFunctionId, newEnumId, prefixedId } from "@btstudio/bt-core";

const ws = useWorkspaceStore();
const c = useConsoleStore();
// 新建类型弹窗
const createOpen = ref(false);
const createType = ref<"class" | "enum">("class");
const createName = ref("");
const createDesc = ref("");
function openCreate(t: "class" | "enum") { createType.value = t; createName.value = ""; createDesc.value = ""; createOpen.value = true; }
function confirmCreate() {
  const name = createName.value.trim();
  const desc = createDesc.value.trim();
  if (!name) { c.warning("import", "名称为空"); return; }
  if (createType.value === "class") {
    if (ws.classes.find((x) => x.className === name)) { c.warning("import", "类名重名"); return; }
    ws.classes.push({ classId: prefixedId("class"), className: name, displayName: name, category: "user", hostModule: "", source: "user", description: desc || undefined });
    c.success("import", `新建用户类 ${name}`);
  } else {
    if (ws.enums.find((x) => x.name === name)) { c.warning("import", "枚举名重名"); return; }
    ws.enums.push({ enumId: newEnumId(), name, displayType: "enum", malType: "CYBER_MARGTYPE_NAME", items: [{ runtimeValue: "Item1", displayName: "Item1" }] });
    c.success("import", `新建枚举 ${name}`);
  }
  createOpen.value = false;
  ws.bump();
}
function addMethod(className: string) {
  ws.functionCatalog.functions.push({
    functionId: newFunctionId(),
    name: "NewMethod",
    displayName: "新方法",
    category: "action",
    bindingTarget: `${className}.NewMethod`,
    ownerClass: className,
    returnType: "CyberDFMPFRC",
    intendedCmd: "NEWMETHOD",
    params: [],
  });
  ws.bump();
}
function addMember(className: string, classId: string) {
  ws.members.push({
    memberId: prefixedId("member"),
    ownerClassId: classId,
    memberName: "newMember",
    valueType: "CyberIntegerType",
    accessMode: "readwrite",
    bindingPath: `Self.${className}::newMember`,
    static: false,
    displayType: "int",
  });
  ws.bump();
}
function addEnumItem(enumId: string) {
  const e = ws.enums.find((x) => x.enumId === enumId);
  if (e) { e.items.push({ runtimeValue: `Item${e.items.length + 1}`, displayName: `Item${e.items.length + 1}` }); ws.bump(); }
}
/** 删除类(连同其成员/方法一并清理)。 */
function removeClass(classId: string, className: string) {
  ws.classes = ws.classes.filter((x) => x.classId !== classId);
  ws.members = ws.members.filter((m) => m.ownerClassId !== classId);
  ws.functionCatalog.functions = ws.functionCatalog.functions.filter((f) => functionOwnerClass(f) !== className);
  ws.bump();
  c.info("import", `已删除类 ${className}`);
}
function removeMethod(functionId: string) {
  ws.functionCatalog.functions = ws.functionCatalog.functions.filter((f) => f.functionId !== functionId);
  ws.bump();
}
function removeMember(memberId: string) {
  ws.members = ws.members.filter((m) => m.memberId !== memberId);
  ws.bump();
}
function removeEnum(enumId: string) {
  ws.enums = ws.enums.filter((x) => x.enumId !== enumId);
  ws.bump();
}
function removeEnumItem(enumId: string, idx: number) {
  const e = ws.enums.find((x) => x.enumId === enumId);
  if (e) { e.items.splice(idx, 1); ws.bump(); }
}
const CAT_LABEL: Record<string, string> = { action: "动作", condition: "条件", condition_transform: "条件变换" };

const SAMPLE = `<?xml version='1.0' encoding='utf-8'?>
<meta>
  <types>
    <enumtype Type="WeaponState" DisplayName="武器状态">
      <enum NativeValue="Idle" Value="Idle" DisplayName="待机" />
      <enum NativeValue="Fire" Value="Fire" DisplayName="开火" />
    </enumtype>
  </types>
  <agents>
    <agent classfullname="CyberAirFighter" base="behaviac::Agent" DisplayName="战机">
      <Member Name="speed" Class="CyberAirFighter" Type="float" Static="false" Public="true" />
      <Member Name="g_round" Class="CyberAirFighter" Type="int" Static="true" Public="true" />
      <Method Name="Engage" DisplayName="进入交战" Class="CyberAirFighter" ReturnType="behaviac::EBTStatus">
        <Param Name="TARGET" Type="string" DisplayName="目标" />
        <Param Name="RESULT" Type="int" IsRef="true" DisplayName="结果" />
      </Method>
      <Method Name="InRange" DisplayName="在射程内" Class="CyberAirFighter" ReturnType="bool">
        <Param Name="RANGE" Type="float" DisplayName="距离" />
      </Method>
    </agent>
  </agents>
  <instances />
</meta>`;

const xmlText = ref(SAMPLE);
const xmlVisible = ref(false); // meta.xml 面板默认隐藏,聚焦类型编辑

/** 从当前类型空间生成 meta.xml(同步:类型空间 → XML)。 */
function syncXmlFromTypeSpace() {
  if (ws.classes.length > 0 || ws.enums.length > 0) xmlText.value = ws.exportMetaXml();
}
function toggleXml() {
  xmlVisible.value = !xmlVisible.value;
  if (xmlVisible.value) syncXmlFromTypeSpace(); // 打开时即与类型空间同步
}

async function importXml() {
  const f = await readTextFile();
  if (f) {
    xmlText.value = f.content;
    xmlVisible.value = true;
    ws.applyMetaXml(f.content); // 导入即同步到类型空间
    c.info("import", `已导入并同步 ${f.name}`);
  }
}
function applyToCatalog() {
  ws.applyMetaXml(xmlText.value); // XML → 类型空间
}
function exportMeta() {
  downloadText("catalog.meta.xml", ws.exportMetaXml(), "application/xml");
  c.success("export", "导出 meta.xml");
}

/** 可选 Cyber 运行类型(成员/参数)。 */
const CYBER_TYPES = ["CyberIntegerType", "CyberRealType", "CyberBOOL", "CyberStringType", "CyberNameType", "CyberVectorType", "CyberPositionType", "CyberCoordinateType", "CyberOrientationType", "CyberJulianType"];
/** 类方法返回值固定为 CyberDFMPFRC(FOSim 引擎模型决策/条件函数统一返回值)。 */
const FIXED_RETURN = "CyberDFMPFRC";
/** Cyber 运行类型 → displayType(给参数补 displayType,便于黑板按类型过滤)。 */
function cyberToDisplay(fz: string): string {
  const s = fz.toLowerCase();
  if (s.includes("bool")) return "bool";
  if (s.includes("real")) return "float";
  if (s.includes("int")) return "int";
  if (s.includes("vector")) return "vector";
  if (s.includes("position")) return "position";
  if (s.includes("coordinate")) return "coordinate";
  return "string";
}
/** 类别变化只影响节点过滤,返回值始终 CyberDFMPFRC。 */
function onMethodCategory(m: { returnType: string }) {
  m.returnType = FIXED_RETURN;
}
/** 给方法添加参数。 */
function addParam(m: { params: unknown[] }) {
  (m.params as Array<Record<string, unknown>>).push({
    paramId: prefixedId("param"),
    name: "param" + (m.params.length + 1),
    direction: "input",
    displayType: "int",
    malType: "CYBER_MARGTYPE_INTEGER",
    valueFormat: "literal",
    required: true,
    originalType: "CyberIntegerType",
  });
  ws.bump();
}
function removeParam(m: { params: unknown[] }, idx: number) {
  (m.params as unknown[]).splice(idx, 1);
  ws.bump();
}
function onParamType(p: Record<string, unknown>, fz: string) {
  p.originalType = fz;
  p.displayType = cyberToDisplay(fz);
  ws.bump();
}

const agents = computed(() => {
  void ws.rev;
  return ws.classes.map((cls) => ({
    cls,
    members: ws.members.filter((m) => m.ownerClassId === cls.classId),
    methods: ws.functionCatalog.functions.filter((f) => functionOwnerClass(f) === cls.className),
  }));
});

// 中心可缩放 + 折叠类卡片
const zoom = ref(1);
function zoomBy(d: number) { zoom.value = Math.min(1.6, Math.max(0.6, +(zoom.value + d).toFixed(2))); }
const collapsed = ref<Set<string>>(new Set());
function toggleCollapse(id: string) {
  if (collapsed.value.has(id)) collapsed.value.delete(id);
  else collapsed.value.add(id);
  collapsed.value = new Set(collapsed.value);
}
function collapseAll(v: boolean) {
  collapsed.value = v ? new Set([...agents.value.map((a) => a.cls.classId), ...ws.enums.map((e) => e.enumId)]) : new Set();
}
</script>

<template>
  <div class="page">
    <div class="page-bar panel row">
      <strong>类型空间 · Agent / 方法 / 成员 / 枚举</strong>
      <span class="muted-2">{{ ws.classes.length }} 类 · {{ ws.functionCatalog.functions.length }} 函数 · {{ ws.enums.length }} 枚举</span>
      <span class="spacer" />
      <button class="btn tiny" @click="toggleXml">{{ xmlVisible ? "▾ 隐藏 meta.xml" : "▸ 显示 meta.xml" }}</button>
      <ActionButton label="导入 meta.xml" @run="importXml" />
      <ActionButton label="导出 meta.xml" :primary="true" @run="exportMeta" />
    </div>
    <div class="hint-banner panel">
      <span class="tag info">类型</span>
      <strong>类型编辑</strong>(类=Agent、方法=函数、成员=变量声明、枚举)。来源:① 右栏"新建类/枚举"并行内编辑;
      ② 从<strong>「工作空间 → 模型类型抽取」</strong>勾选真实模型的类抽取过来;③ 导入 <code>meta.xml</code>。
      运行期变量请到「黑板中心」;<strong>C++ 代码生成在「工作空间」</strong>。
    </div>
    <div class="grid" :class="{ single: !xmlVisible }">
      <div v-if="xmlVisible" class="panel scroll">
        <div class="ptitle row">
          <span>meta.xml(与类型空间同步)</span><span class="spacer" />
          <button class="btn tiny" @click="syncXmlFromTypeSpace" title="用当前类型空间重新生成 XML">↻ 从类型空间生成</button>
          <button class="btn tiny primary" @click="applyToCatalog" title="把 XML 解析并同步到类型空间">应用到类型空间</button>
        </div>
        <textarea v-model="xmlText" class="xml mono" spellcheck="false" />
      </div>
      <Splitter v-if="xmlVisible" />
      <div class="panel scroll types">
        <div class="create-bar row">
          <button class="btn tiny primary" @click="openCreate('class')">＋ 新建类 (Agent)</button>
          <button class="btn tiny" @click="openCreate('enum')">＋ 新建枚举</button>
          <span class="spacer" />
          <button class="btn tiny" title="全部折叠" @click="collapseAll(true)">全部折叠</button>
          <button class="btn tiny" title="全部展开" @click="collapseAll(false)">全部展开</button>
          <span class="zoomgrp">
            <button class="btn tiny" title="缩小" @click="zoomBy(-0.1)">－</button>
            <span class="zlbl">{{ Math.round(zoom * 100) }}%</span>
            <button class="btn tiny" title="放大" @click="zoomBy(0.1)">＋</button>
            <button class="btn tiny" title="重置" @click="zoom = 1">1:1</button>
          </span>
        </div>
        <div v-if="agents.length === 0 && ws.enums.length === 0" class="muted-2 empty">新建类/枚举,或导入 meta.xml。</div>
        <div class="zoomwrap" :style="{ fontSize: zoom + 'em' }">
        <!-- 类(Agent)卡片 -->
        <section v-for="a in agents" :key="a.cls.classId" class="card cls" :class="{ collapsed: collapsed.has(a.cls.classId) }">
          <header class="card-head">
            <span class="caret" @click="toggleCollapse(a.cls.classId)">{{ collapsed.has(a.cls.classId) ? "▸" : "▾" }}</span>
            <span class="ico">▧</span>
            <input class="input tiny inl name-in" v-model="a.cls.displayName" placeholder="显示名" />
            <code class="cls-name">{{ a.cls.className }}</code>
            <input class="input tiny inl desc-in" v-model="a.cls.description" placeholder="备注:类用途,鼠标悬停节点时显示" />
            <span class="src-tag" :class="a.cls.source === 'user' ? 'user' : 'model'">{{ a.cls.source === "user" ? "用户" : "模型" }}</span>
            <!-- baseClass 曾展示为"模型 : CyberCognitionImpl",但生成代码统一继承 CyberDecisionAgentBase,该标签会误导用户。已移除。 -->
            <span class="spacer" />
            <span class="counts"><b>{{ a.methods.length }}</b> 方法 · <b>{{ a.members.length }}</b> 成员</span>
            <button class="btn tiny" @click="addMethod(a.cls.className)">＋方法</button>
            <button class="btn tiny" @click="addMember(a.cls.className, a.cls.classId)">＋成员</button>
            <button class="btn tiny danger ic" title="删除类(连同方法/成员)" @click="removeClass(a.cls.classId, a.cls.className)">🗑</button>
          </header>
          <div v-if="!collapsed.has(a.cls.classId)" class="card-body">
            <!-- 方法 -->
            <div class="sub-head"><span class="dot m" />方法(决策/条件函数)<span class="muted-2 sh-hint">返回值统一 CyberDFMPFRC</span></div>
            <div v-if="a.methods.length === 0" class="muted-2 sub-empty">暂无方法,点「＋方法」。</div>
            <div v-for="m in a.methods" :key="m.functionId" class="method">
              <div class="m-top">
                <span class="cat-badge" :class="m.category">{{ CAT_LABEL[m.category] ?? m.category }}</span>
                <input class="input tiny nm" v-model="m.name" placeholder="方法名 (英文)" />
                <select class="select tiny" v-model="m.category" @change="onMethodCategory(m)" title="类别">
                  <option value="action">动作 action</option>
                  <option value="condition">条件 condition</option>
                  <option value="condition_transform">条件变换</option>
                </select>
                <span class="ret-badge" title="类方法返回值固定为 CyberDFMPFRC">CyberDFMPFRC</span>
                <span class="spacer" />
                <button class="btn tiny" @click="addParam(m)">＋参数</button>
                <button class="btn tiny danger ic" title="删除方法" @click="removeMethod(m.functionId)">🗑</button>
              </div>
              <input class="input tiny desc" v-model="m.description" placeholder="方法说明(描述,鼠标悬停节点时显示)" />
              <div v-if="m.params.length" class="param-head">
                <span style="width:108px">参数名</span><span style="width:88px">中文名</span><span style="width:120px">Cyber 类型</span><span style="width:76px">方向</span>
              </div>
              <div v-for="(p, pi) in m.params" :key="p.paramId" class="param-row">
                <input class="input tiny" style="width:108px" v-model="p.name" placeholder="参数名" />
                <input class="input tiny" style="width:88px" v-model="p.displayName" placeholder="中文名" />
                <select class="select tiny" style="width:120px" :value="p.originalType ?? 'CyberIntegerType'" @change="onParamType(p, ($event.target as HTMLSelectElement).value)">
                  <option v-for="t in CYBER_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
                <select class="select tiny" style="width:76px" v-model="p.direction" title="方向" :class="p.direction === 'output' ? 'dir-out' : 'dir-in'">
                  <option value="input">输入</option>
                  <option value="output">输出</option>
                </select>
                <button class="btn tiny danger ic" @click="removeParam(m, pi)">✕</button>
              </div>
            </div>
            <!-- 成员 -->
            <div class="sub-head"><span class="dot v" />成员(变量声明 · Cyber 类型)</div>
            <div v-if="a.members.length === 0" class="muted-2 sub-empty">暂无成员,点「＋成员」。</div>
            <div v-for="m in a.members" :key="m.memberId" class="member-row">
              <input class="input tiny nm" v-model="m.memberName" placeholder="成员名" />
              <select class="select tiny" style="width:130px" v-model="m.valueType">
                <option v-for="t in CYBER_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <label class="chk"><input type="checkbox" v-model="m.static" /> 全局 static</label>
              <span class="spacer" />
              <button class="btn tiny danger ic" title="删除成员" @click="removeMember(m.memberId)">✕</button>
            </div>
          </div>
        </section>

        <!-- 枚举卡片 -->
        <div v-if="ws.enums.length" class="grp enum-grp">枚举类型</div>
        <section v-for="e in ws.enums" :key="e.enumId" class="card enum" :class="{ collapsed: collapsed.has(e.enumId) }">
          <header class="card-head">
            <span class="caret" @click="toggleCollapse(e.enumId)">{{ collapsed.has(e.enumId) ? "▸" : "▾" }}</span>
            <span class="ico">▦</span>
            <input class="input tiny inl name-in" v-model="e.name" placeholder="枚举名" />
            <span class="spacer" />
            <span class="counts"><b>{{ e.items.length }}</b> 项</span>
            <button class="btn tiny" @click="addEnumItem(e.enumId)">＋项</button>
            <button class="btn tiny danger ic" title="删除枚举" @click="removeEnum(e.enumId)">🗑</button>
          </header>
          <div v-if="!collapsed.has(e.enumId)" class="card-body">
            <div class="param-head"><span style="width:160px">运行值 (NativeValue)</span><span>显示名</span></div>
            <div v-for="(it, idx) in e.items" :key="idx" class="member-row">
              <input class="input tiny" style="width:160px" v-model="it.runtimeValue" placeholder="Idle" />
              <input class="input tiny" style="flex:1" v-model="it.displayName" placeholder="待机" />
              <button class="btn tiny danger ic" @click="removeEnumItem(e.enumId, idx)">✕</button>
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>

    <ModalDialog
      :open="createOpen"
      :title="createType === 'class' ? '新建类 (Agent)' : '新建枚举'"
      ok-label="创建"
      @ok="confirmCreate"
      @cancel="createOpen = false"
    >
      <label class="dlg-fld">
        <span>{{ createType === "class" ? "类名 (className)" : "枚举名" }}</span>
        <input class="input" v-model="createName" :placeholder="createType === 'class' ? 'MyAgent' : 'MyEnum'" @keyup.enter="confirmCreate" />
      </label>
      <label v-if="createType === 'class'" class="dlg-fld">
        <span>备注(description)</span>
        <input class="input" v-model="createDesc" placeholder="类用途说明,鼠标悬停节点时显示" @keyup.enter="confirmCreate" />
      </label>
      <div class="muted-2" style="font-size: 11px">
        {{ createType === "class" ? "用户新建类(source=user)将生成完整可编译 C++(继承 BT::Agent)。" : "枚举创建后可在右栏添加枚举项。" }}
      </div>
    </ModalDialog>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 10px; height: 100%; }
.page-bar { padding: 8px 12px; gap: 8px; }
.grid { display: flex; gap: 4px; flex: 1; min-height: 0; }
.grid > .panel { flex: 1 1 0; min-width: 0; }
.grid > .panel:first-child { flex: 0 0 46%; }
.grid.single > .panel:first-child { flex: 1 1 0; }
.panel { padding: 10px; }
.ptitle { font-size: 11px; color: var(--accent); margin-bottom: 8px; }
.xml { width: 100%; height: calc(100% - 26px); resize: none; font-size: 11.5px; }
.empty { padding: 14px; }
.hint-banner { padding: 8px 12px; font-size: 12px; line-height: 1.6; color: var(--muted); }
.hint-banner code { background: rgba(122,156,193,0.14); padding: 0 4px; border-radius: 4px; }
.create-bar { gap: 6px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
.zoomgrp { display: inline-flex; align-items: center; gap: 4px; }
.zlbl { font-size: 11px; color: var(--muted-2); min-width: 36px; text-align: center; }
.caret { cursor: pointer; width: 14px; display: inline-block; color: var(--muted); user-select: none; }
/* .input.tiny/.select.tiny 高度/字号统一由 theme.css 提供(30px/12px)。 */
.input.tiny.inl { width: 130px; display: inline-block; }
.chk { font-size: 11px; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.dlg-fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dlg-fld > span { color: var(--muted); }
.grp { font-size: 10.5px; color: var(--muted-2); text-transform: uppercase; letter-spacing: 0.6px; margin: 14px 2px 6px; }

/* —— 类型卡片 —— */
.card {
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  margin-bottom: 12px;
  background: rgba(20, 28, 40, 0.4);
  overflow: hidden;
}
.card.cls { border-left: 3px solid var(--accent); }
.card.enum { border-left: 3px solid var(--accent-2, #f5b65c); }
.card.collapsed { background: transparent; }
.card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  background: linear-gradient(180deg, rgba(94, 179, 255, 0.10), rgba(94, 179, 255, 0.02));
  border-bottom: 1px solid var(--line-soft);
}
.card.enum .card-head { background: linear-gradient(180deg, rgba(245, 182, 92, 0.10), rgba(245, 182, 92, 0.02)); }
.card.collapsed .card-head { border-bottom: none; }
.card-head .ico { color: var(--accent); font-size: 13px; }
.card.enum .card-head .ico { color: var(--accent-2, #f5b65c); }
.name-in { width: 116px; font-weight: 600; }
.desc-in { flex: 1 1 auto; min-width: 120px; max-width: 380px; font-style: italic; }
.cls-name { font-size: 11px; color: var(--muted); background: rgba(122, 156, 193, 0.12); padding: 1px 6px; border-radius: 5px; }
.src-tag { font-size: 9.5px; padding: 1px 6px; border-radius: 999px; }
.src-tag.user { background: rgba(71, 214, 164, 0.16); color: var(--ok, #47d6a4); }
.src-tag.model { background: rgba(94, 179, 255, 0.16); color: var(--accent); }
.base { font-size: 10.5px; }
.counts { font-size: 10.5px; color: var(--muted-2); }
.counts b { color: var(--text, #dfe9f5); }
.btn.tiny.ic { padding: 2px 6px; }
.card-body { padding: 8px 12px 10px; }

.sub-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 10.5px; color: var(--muted-2);
  text-transform: uppercase; letter-spacing: 0.5px;
  margin: 10px 0 6px;
}
.sub-head:first-child { margin-top: 2px; }
.sub-head .sh-hint { text-transform: none; letter-spacing: 0; margin-left: 4px; opacity: 0.8; }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot.m { background: var(--accent); }
.dot.v { background: var(--accent-2, #f5b65c); }
.sub-empty { padding: 4px 0 6px; font-size: 11px; }

.method {
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  padding: 7px 8px;
  margin-bottom: 7px;
  background: rgba(255, 255, 255, 0.012);
}
.m-top { display: flex; align-items: center; gap: 7px; }
.m-top .nm { width: 150px; }
.cat-badge { font-size: 9.5px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.cat-badge.action { background: rgba(94, 179, 255, 0.18); color: var(--accent); }
.cat-badge.condition { background: rgba(245, 182, 92, 0.18); color: var(--accent-2, #f5b65c); }
.cat-badge.condition_transform { background: rgba(180, 142, 255, 0.18); color: #c0a6ff; }
.ret-badge { font-size: 9.5px; padding: 1px 6px; border-radius: 5px; background: rgba(71, 214, 164, 0.14); color: var(--ok, #47d6a4); white-space: nowrap; }
.input.tiny.desc { width: 100%; margin: 6px 0 4px; opacity: 0.9; }
.param-head { display: flex; gap: 6px; font-size: 9.5px; color: var(--muted-2); margin: 4px 0 2px 2px; }
.param-row { display: flex; gap: 6px; align-items: center; margin: 3px 0 0; }
.dir-out { color: var(--accent-2, #f5b65c); }
.dir-in { color: var(--muted); }

.member-row { display: flex; gap: 8px; align-items: center; font-size: 12px; padding: 3px 0; }
.member-row .nm { width: 150px; }
.enum-grp { margin-top: 18px; }
</style>
