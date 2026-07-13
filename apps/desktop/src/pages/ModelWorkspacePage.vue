<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import ActionButton from "@/components/common/ActionButton.vue";
import ModalDialog from "@/components/common/ModalDialog.vue";
import PageBar from "@/components/common/PageBar.vue";
import Splitter from "@/components/common/Splitter.vue";
import Tag from "@/components/common/Tag.vue";
import { saveTextFile, readTextFile } from "@/services/tauri";
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
/** DOM 就绪后:找到 el、平滑滚入视野居中,并聚焦第一个 input(便于立即改名)。 */
async function scrollFocusById(id: string) {
  await nextTick();
  const el = document.getElementById(id) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = el.querySelector("input.input") as HTMLInputElement | null;
  if (input) { input.focus(); input.select(); }
  el.classList.add("just-added");
  window.setTimeout(() => el.classList.remove("just-added"), 1500);
}
function uniqueName(usedNames: Set<string>, base: string): string {
  if (!usedNames.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const cand = `${base}${i}`;
    if (!usedNames.has(cand)) return cand;
  }
  return `${base}${Date.now()}`;
}

function addMethod(className: string, classId: string) {
  const functionId = newFunctionId();
  const used = new Set(
    ws.functionCatalog.functions
      .filter((f) => functionOwnerClass(f) === className)
      .map((f) => f.name),
  );
  const name = uniqueName(used, "NewMethod");
  const displayName = name === "NewMethod" ? "新方法" : `新方法${name.slice("NewMethod".length)}`;
  ws.functionCatalog.functions.push({
    functionId,
    name,
    displayName,
    category: "action",
    bindingTarget: `${className}.${name}`,
    ownerClass: className,
    returnType: "CyberDFMPFRC",
    intendedCmd: name.toUpperCase(),
    params: [],
  });
  ws.bump();
  if (collapsed.value.has(classId)) toggleCollapse(classId);
  // 新方法默认展开以便立刻编辑
  methodCollapsed.value.delete(functionId);
  scrollFocusById(`method-${functionId}`);
}
function addMember(className: string, classId: string) {
  const memberId = prefixedId("member");
  const used = new Set(ws.members.filter((m) => m.ownerClassId === classId).map((m) => m.memberName));
  const memberName = uniqueName(used, "newMember");
  ws.members.push({
    memberId,
    ownerClassId: classId,
    memberName,
    valueType: "CyberIntegerType",
    accessMode: "readwrite",
    bindingPath: `Self.${className}::${memberName}`,
    static: false,
    displayType: "int",
  });
  ws.bump();
  if (collapsed.value.has(classId)) toggleCollapse(classId);
  scrollFocusById(`member-${memberId}`);
}
function addEnumItem(enumId: string) {
  const e = ws.enums.find((x) => x.enumId === enumId);
  if (e) { e.items.push({ runtimeValue: `Item${e.items.length + 1}`, displayName: `Item${e.items.length + 1}` }); ws.bump(); }
}
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
      <Method Name="Engage" DisplayName="进入交战" Class="CyberAirFighter" ReturnType="behaviac::EBTStatus">
        <Param Name="TARGET" Type="string" DisplayName="目标" />
      </Method>
    </agent>
  </agents>
  <instances />
</meta>`;

const xmlText = ref(SAMPLE);
const xmlVisible = ref(false);

function syncXmlFromTypeSpace() {
  if (ws.classes.length > 0 || ws.enums.length > 0) xmlText.value = ws.exportMetaXml();
}
function toggleXml() {
  xmlVisible.value = !xmlVisible.value;
  if (xmlVisible.value) syncXmlFromTypeSpace();
}

async function importXml() {
  const f = await readTextFile();
  if (f) {
    xmlText.value = f.content;
    xmlVisible.value = true;
    ws.applyMetaXml(f.content);
    c.info("import", `已导入并同步 ${f.name}`);
  }
}
function applyToCatalog() {
  ws.applyMetaXml(xmlText.value);
}
async function exportMeta() {
  const r = await saveTextFile("catalog.meta.xml", ws.exportMetaXml(), {
    filters: [{ name: "meta XML", extensions: ["xml"] }],
  });
  if (r) c.success("export", `导出 meta.xml → ${r.path}`);
}

const CYBER_TYPES = ["CyberIntegerType", "CyberRealType", "CyberBOOL", "CyberStringType", "CyberNameType", "CyberVectorType", "CyberPositionType", "CyberCoordinateType", "CyberOrientationType", "CyberJulianType"];
const FIXED_RETURN = "CyberDFMPFRC";
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
function onMethodCategory(m: { returnType: string }) {
  m.returnType = FIXED_RETURN;
}
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

// —— 搜索 —— //
const search = ref("");
const searchLc = computed(() => search.value.trim().toLowerCase());

function classHit(cls: { className: string; displayName?: string; description?: string }): boolean {
  const q = searchLc.value;
  if (!q) return true;
  return (
    cls.className.toLowerCase().includes(q) ||
    (cls.displayName ?? "").toLowerCase().includes(q) ||
    (cls.description ?? "").toLowerCase().includes(q)
  );
}
function methodHit(m: { name: string; displayName?: string; description?: string }): boolean {
  const q = searchLc.value;
  if (!q) return true;
  return (
    m.name.toLowerCase().includes(q) ||
    (m.displayName ?? "").toLowerCase().includes(q) ||
    (m.description ?? "").toLowerCase().includes(q)
  );
}
function memberHit(m: { memberName: string }): boolean {
  const q = searchLc.value;
  if (!q) return true;
  return m.memberName.toLowerCase().includes(q);
}
function enumHit(e: { name: string; items: { runtimeValue: string; displayName: string }[] }): boolean {
  const q = searchLc.value;
  if (!q) return true;
  return e.name.toLowerCase().includes(q) || e.items.some((it) => it.runtimeValue.toLowerCase().includes(q) || it.displayName.toLowerCase().includes(q));
}

const agents = computed(() => {
  void ws.rev;
  return ws.classes.map((cls) => ({
    cls,
    members: ws.members.filter((m) => m.ownerClassId === cls.classId),
    methods: ws.functionCatalog.functions.filter((f) => functionOwnerClass(f) === cls.className),
  }));
});

/**
 * 搜索时:
 *   - 类头命中 → 保留全类
 *   - 类头未命中 → 只在类内保留命中的方法/成员;若都没命中 → 隐藏整个类
 */
const filteredAgents = computed(() => {
  const q = searchLc.value;
  if (!q) return agents.value;
  return agents.value
    .map((a) => {
      if (classHit(a.cls)) return a;
      const methods = a.methods.filter(methodHit);
      const members = a.members.filter(memberHit);
      if (methods.length === 0 && members.length === 0) return null;
      return { cls: a.cls, methods, members };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
});
const filteredEnums = computed(() => {
  const q = searchLc.value;
  void ws.rev;
  if (!q) return ws.enums;
  return ws.enums.filter(enumHit);
});

// 类/枚举折叠
const collapsed = ref<Set<string>>(new Set());
function toggleCollapse(id: string) {
  if (collapsed.value.has(id)) collapsed.value.delete(id);
  else collapsed.value.add(id);
  collapsed.value = new Set(collapsed.value);
}
function collapseAll(v: boolean) {
  collapsed.value = v ? new Set([...agents.value.map((a) => a.cls.classId), ...ws.enums.map((e) => e.enumId)]) : new Set();
}

// 方法级折叠(默认收起,只显示头行;点开才见参数)
const methodCollapsed = ref<Set<string>>(new Set());
function toggleMethod(functionId: string) {
  if (methodCollapsed.value.has(functionId)) methodCollapsed.value.delete(functionId);
  else methodCollapsed.value.add(functionId);
  methodCollapsed.value = new Set(methodCollapsed.value);
}
function expandAllMethods() { methodCollapsed.value = new Set(); }
function collapseAllMethods() {
  methodCollapsed.value = new Set(ws.functionCatalog.functions.map((f) => f.functionId));
}
</script>

<template>
  <div class="page">
    <PageBar
      title="类型空间"
      :subtitle="`${ws.classes.length} 类 · ${ws.functionCatalog.functions.length} 函数 · ${ws.enums.length} 枚举`"
      dot="brand"
      help-title="类型空间 · 使用帮助"
    >
      <template #actions>
        <button class="btn tiny" @click="toggleXml">{{ xmlVisible ? "▾ 隐藏 meta.xml" : "▸ 显示 meta.xml" }}</button>
        <ActionButton label="导入 meta.xml" @run="importXml" />
        <ActionButton label="导出 meta.xml" :primary="true" @run="exportMeta" />
      </template>
      <template #help>
        <section class="help-sec">
          <h3>头行怎么读</h3>
          <p><code>className</code>(英文,标识)= 类身份;<strong>显示名</strong>(中文,可改)= 面板/节点上给人看;<strong>描述</strong>(副行,可改)= 悬停节点时展示的说明。</p>
        </section>
        <section class="help-sec">
          <h3>三条数据来源</h3>
          <ol>
            <li>顶部「＋新建类 / ＋新建枚举」,行内直接编辑</li>
            <li>「工作空间 → 模型类型抽取」勾选真实 <code>.cmp</code> 类,一键抽取</li>
            <li>「导入 meta.xml」加载 behaviac 风格类型清单</li>
          </ol>
        </section>
        <section class="help-sec">
          <h3>折叠 / 搜索</h3>
          <ul>
            <li>类级折叠:头行 <code>▾/▸</code>;方法级折叠:方法行 <code>▾/▸</code></li>
            <li>顶部全部折叠/展开控制两级;方法级另有独立按钮</li>
            <li>搜索:匹配 className / 显示名 / 描述 / 方法名 / 成员名 / 枚举项</li>
          </ul>
        </section>
      </template>
    </PageBar>

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

      <div class="panel types">
        <!-- 工具条:新建 + 搜索 + 折叠控制 -->
        <div class="toolbar">
          <button class="btn tiny primary" @click="openCreate('class')">＋ 新建类 (Agent)</button>
          <button class="btn tiny" @click="openCreate('enum')">＋ 新建枚举</button>
          <div class="search-wrap">
            <span class="s-ico">⌕</span>
            <input class="input tiny search" v-model="search"
              placeholder="搜索:className / 中文名 / 描述 / 方法名 / 成员 / 枚举项…" />
            <button v-if="search" class="btn tiny s-x" @click="search = ''" title="清除">✕</button>
          </div>
          <span class="spacer" />
          <div class="btn-grp" title="类级折叠">
            <button class="btn tiny" @click="collapseAll(false)">展开类</button>
            <button class="btn tiny" @click="collapseAll(true)">折叠类</button>
          </div>
          <div class="btn-grp" title="方法级折叠">
            <button class="btn tiny" @click="expandAllMethods">展开方法</button>
            <button class="btn tiny" @click="collapseAllMethods">折叠方法</button>
          </div>
        </div>

        <div class="typewrap scroll">
          <div v-if="agents.length === 0 && ws.enums.length === 0" class="empty-big">
            <div class="empty-ico">◇</div>
            <div class="empty-t">类型空间为空</div>
            <div class="empty-hint">点上方「新建类 / 新建枚举」,或从工作空间抽取模型 .cmp</div>
          </div>
          <div v-else-if="filteredAgents.length === 0 && filteredEnums.length === 0" class="empty-big">
            <div class="empty-ico">⌕</div>
            <div class="empty-t">无匹配「{{ search }}」</div>
            <div class="empty-hint">清空搜索或换关键字</div>
          </div>

          <!-- 类(Agent)卡片 -->
          <section v-for="a in filteredAgents" :key="a.cls.classId" class="card cls" :class="{ collapsed: collapsed.has(a.cls.classId) }">
            <header class="card-head">
              <button class="caret-btn" @click="toggleCollapse(a.cls.classId)">
                {{ collapsed.has(a.cls.classId) ? "▸" : "▾" }}
              </button>
              <span class="ico">▧</span>
              <!-- 主 ID:className(英文,唯一,不可编辑;编辑要开 meta.xml 或删旧建新) -->
              <code class="cls-name-primary">{{ a.cls.className }}</code>
              <!-- 显示名:中文,可编辑,PropertiesPanel 里的下拉标签用它 -->
              <div class="name-input-wrap">
                <span class="input-lbl">显示名</span>
                <input class="input tiny name-in" v-model="a.cls.displayName" placeholder="显示名(中文)" />
              </div>
              <Tag :variant="a.cls.source === 'user' ? 'ok' : 'accent'" size="xs">
                {{ a.cls.source === "user" ? "用户" : "模型" }}
              </Tag>
              <span class="spacer" />
              <span class="counts nowrap">
                <b>{{ a.methods.length }}</b> 方法 · <b>{{ a.members.length }}</b> 成员
              </span>
              <button class="btn tiny" @click="addMethod(a.cls.className, a.cls.classId)">＋方法</button>
              <button class="btn tiny" @click="addMember(a.cls.className, a.cls.classId)">＋成员</button>
              <button class="btn tiny danger ic" title="删除类(连同方法/成员)" @click="removeClass(a.cls.classId, a.cls.className)">🗑</button>
            </header>

            <!-- 副行:类描述(全宽,斜体,dimmed);折叠时不占空间 -->
            <div v-if="!collapsed.has(a.cls.classId)" class="card-subhead">
              <span class="input-lbl">描述</span>
              <input class="input tiny desc-in" v-model="a.cls.description"
                placeholder="类用途,鼠标悬停节点时显示(可选)" />
            </div>

            <div v-if="!collapsed.has(a.cls.classId)" class="card-body">
              <!-- 方法 -->
              <div class="sub-head">
                <span class="dot m" />方法(决策/条件函数)
                <span class="muted-2 sh-hint">返回值统一 CyberDFMPFRC</span>
              </div>
              <div v-if="a.methods.length === 0" class="muted-2 sub-empty">暂无方法,点「＋方法」。</div>
              <div v-for="m in a.methods" :key="m.functionId" class="method"
                :class="{ 'm-collapsed': methodCollapsed.has(m.functionId) }" :id="`method-${m.functionId}`">
                <div class="m-top">
                  <button class="caret-btn small" @click="toggleMethod(m.functionId)"
                    :title="methodCollapsed.has(m.functionId) ? '展开参数' : '收起参数'">
                    {{ methodCollapsed.has(m.functionId) ? "▸" : "▾" }}
                  </button>
                  <Tag :variant="m.category === 'action' ? 'accent' : (m.category === 'condition' ? 'warn' : 'info')" size="xs">
                    {{ CAT_LABEL[m.category] ?? m.category }}
                  </Tag>
                  <code class="m-name-primary">{{ m.name }}</code>
                  <input class="input tiny m-nm" v-model="m.name" placeholder="方法名 (英文)" />
                  <input class="input tiny m-disp" v-model="m.displayName" placeholder="中文名" />
                  <select class="select tiny m-cat" v-model="m.category" @change="onMethodCategory(m)" title="类别">
                    <option value="action">动作</option>
                    <option value="condition">条件</option>
                    <option value="condition_transform">条件变换</option>
                  </select>
                  <Tag variant="ok" size="xs" mono>CyberDFMPFRC</Tag>
                  <span class="param-cnt nowrap muted-3">{{ m.params.length }} 参</span>
                  <span class="spacer" />
                  <button class="btn tiny" @click="addParam(m)">＋参</button>
                  <button class="btn tiny danger ic" title="删除方法" @click="removeMethod(m.functionId)">🗑</button>
                </div>

                <div v-if="!methodCollapsed.has(m.functionId)" class="m-body">
                  <input class="input tiny desc" v-model="m.description"
                    placeholder="方法说明(悬停节点时显示,可选)" />
                  <div v-if="m.params.length" class="param-head">
                    <span style="width:120px">参数名</span>
                    <span style="width:96px">中文名</span>
                    <span style="width:140px">Cyber 类型</span>
                    <span style="width:76px">方向</span>
                  </div>
                  <div v-for="(p, pi) in m.params" :key="p.paramId" class="param-row">
                    <input class="input tiny" style="width:120px" v-model="p.name" placeholder="参数名" />
                    <input class="input tiny" style="width:96px" v-model="p.displayName" placeholder="中文名" />
                    <select class="select tiny" style="width:140px" :value="p.originalType ?? 'CyberIntegerType'"
                      @change="onParamType(p, ($event.target as HTMLSelectElement).value)">
                      <option v-for="t in CYBER_TYPES" :key="t" :value="t">{{ t }}</option>
                    </select>
                    <select class="select tiny" style="width:76px" v-model="p.direction" title="方向"
                      :class="p.direction === 'output' ? 'dir-out' : 'dir-in'">
                      <option value="input">输入</option>
                      <option value="output">输出</option>
                    </select>
                    <span class="spacer" />
                    <button class="btn tiny danger ic" @click="removeParam(m, pi)">✕</button>
                  </div>
                </div>
              </div>

              <!-- 成员 -->
              <div class="sub-head"><span class="dot v" />成员(变量声明 · Cyber 类型)</div>
              <div v-if="a.members.length === 0" class="muted-2 sub-empty">暂无成员,点「＋成员」。</div>
              <div v-for="m in a.members" :key="m.memberId" class="member-row" :id="`member-${m.memberId}`">
                <input class="input tiny mem-nm" v-model="m.memberName" placeholder="成员名" />
                <select class="select tiny" style="width:150px" v-model="m.valueType">
                  <option v-for="t in CYBER_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
                <label class="chk"><input type="checkbox" v-model="m.static" /> 全局 static</label>
                <span class="spacer" />
                <button class="btn tiny danger ic" title="删除成员" @click="removeMember(m.memberId)">✕</button>
              </div>
            </div>
          </section>

          <!-- 枚举卡片 -->
          <div v-if="filteredEnums.length" class="grp enum-grp">枚举类型</div>
          <section v-for="e in filteredEnums" :key="e.enumId" class="card enum" :class="{ collapsed: collapsed.has(e.enumId) }">
            <header class="card-head">
              <button class="caret-btn" @click="toggleCollapse(e.enumId)">
                {{ collapsed.has(e.enumId) ? "▸" : "▾" }}
              </button>
              <span class="ico">▦</span>
              <code class="cls-name-primary">{{ e.name }}</code>
              <div class="name-input-wrap">
                <span class="input-lbl">枚举名</span>
                <input class="input tiny name-in" v-model="e.name" placeholder="枚举名" />
              </div>
              <span class="spacer" />
              <span class="counts nowrap"><b>{{ e.items.length }}</b> 项</span>
              <button class="btn tiny" @click="addEnumItem(e.enumId)">＋项</button>
              <button class="btn tiny danger ic" title="删除枚举" @click="removeEnum(e.enumId)">🗑</button>
            </header>
            <div v-if="!collapsed.has(e.enumId)" class="card-body">
              <div class="param-head">
                <span style="width:180px">运行值 (NativeValue)</span>
                <span>显示名</span>
              </div>
              <div v-for="(it, idx) in e.items" :key="idx" class="member-row">
                <input class="input tiny" style="width:180px" v-model="it.runtimeValue" placeholder="Idle" />
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
.page { display: flex; flex-direction: column; gap: var(--space-3); height: 100%; min-height: 0; }
.grid { display: flex; gap: var(--space-2); flex: 1; min-height: 0; min-width: 0; }
.grid > .panel { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.grid > .panel:first-child { flex: 0 0 46%; }
.grid.single > .panel:first-child { flex: 1 1 0; }
.panel { padding: var(--space-2); }
.ptitle { font-size: 11px; color: var(--accent); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.xml { width: 100%; height: calc(100% - 26px); resize: none; font-size: 11.5px; }

/* —— 工具条 —— */
.toolbar {
  display: flex; align-items: center; gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-1);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-2);
  flex: 0 0 auto;
}
.search-wrap {
  position: relative; flex: 1 1 260px; min-width: 200px;
  display: flex; align-items: center;
}
.search-wrap .s-ico {
  position: absolute; left: 8px; color: var(--text-tertiary); font-size: 13px; pointer-events: none;
}
.search { padding-left: 26px; padding-right: 26px; }
.search-wrap .s-x {
  position: absolute; right: 2px;
  padding: 0 6px; min-height: 22px; font-size: 11px;
}
.btn-grp { display: inline-flex; gap: 2px; }
.btn-grp .btn { border-radius: 0; }
.btn-grp .btn:first-child { border-top-left-radius: var(--radius-md); border-bottom-left-radius: var(--radius-md); }
.btn-grp .btn:last-child { border-top-right-radius: var(--radius-md); border-bottom-right-radius: var(--radius-md); }

.typewrap { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }

.empty-big {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 20px; gap: 8px; color: var(--text-tertiary);
}
.empty-big .empty-ico { font-size: 40px; color: var(--text-disabled); }
.empty-big .empty-t { color: var(--text-secondary); font-size: 14px; font-weight: 600; }
.empty-big .empty-hint { font-size: 12px; }

/* 新增行短暂高亮 */
.just-added { animation: flash-added 1.4s ease-out; }
@keyframes flash-added {
  0%   { background: var(--accent-soft); box-shadow: 0 0 0 2px var(--accent-border) inset; }
  100% { background: transparent; box-shadow: none; }
}

/* —— caret 按钮:统一样式(替换裸 span 触发误按) —— */
.caret-btn {
  background: transparent; border: none; cursor: pointer;
  color: var(--text-tertiary); font-size: 11px;
  width: 20px; height: 20px; border-radius: var(--radius-sm);
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.12s, color 0.12s;
  flex: 0 0 auto;
}
.caret-btn:hover { background: var(--surface-4); color: var(--text-primary); }
.caret-btn.small { width: 18px; height: 18px; font-size: 10px; }

/* —— 类型卡片 —— */
.card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-3);
  background: var(--surface-2);
  overflow: hidden;
  transition: border-color 0.12s;
}
.card.cls { border-left: 3px solid var(--accent); }
.card.enum { border-left: 3px solid var(--warn); }
.card:hover { border-color: var(--border-strong); }
.card.cls:hover { border-left-color: var(--accent); }
.card.collapsed { background: var(--surface-2); }

.card-head {
  display: flex; align-items: center; gap: var(--space-2);
  padding: 8px 12px;
  background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
  border-bottom: 1px solid var(--border-subtle);
  min-width: 0;
}
.card.collapsed .card-head { border-bottom: none; }
.card-head .ico { color: var(--accent); font-size: 13px; flex: 0 0 auto; }
.card.enum .card-head .ico { color: var(--warn); }

/* className:主 ID(等宽,不可编辑);当"类身份"看待 */
.cls-name-primary {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--text-primary);
  background: var(--surface-1);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  font-weight: 600;
  flex: 0 0 auto;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 显示名输入:带轻标签,让用户一眼看出"这里是中文改名的地方" */
.name-input-wrap {
  display: inline-flex; align-items: center; gap: 4px;
  flex: 0 0 auto;
}
.input-lbl {
  font-size: 10px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex: 0 0 auto;
}
.name-in { width: 140px; font-weight: 500; }

/* 类描述:副行,全宽,斜体 —— 与 displayName 拉开视觉距离 */
.card-subhead {
  display: flex; align-items: center; gap: var(--space-2);
  padding: 6px 12px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
}
.desc-in { flex: 1 1 auto; font-style: italic; font-size: 11.5px; }

.counts { font-size: 11px; color: var(--text-tertiary); flex: 0 0 auto; }
.counts b { color: var(--text-primary); font-weight: 600; }
.btn.tiny.ic { padding: 2px 6px; }
.card-body { padding: 10px 12px 12px; }

.sub-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 10.5px; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.5px;
  margin: 10px 0 6px;
}
.sub-head:first-child { margin-top: 2px; }
.sub-head .sh-hint { text-transform: none; letter-spacing: 0; margin-left: 4px; opacity: 0.8; }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot.m { background: var(--accent); }
.dot.v { background: var(--warn); }
.sub-empty { padding: 4px 0 6px; font-size: 11px; }

/* —— 方法卡 —— */
.method {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 6px 8px;
  margin-bottom: 6px;
  background: var(--surface-3);
  transition: background 0.12s;
}
.method:hover { background: var(--surface-4); }
.method.m-collapsed { padding-bottom: 6px; }

.m-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.m-name-primary {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-primary);
  background: var(--surface-1);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  flex: 0 0 auto;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-nm { width: 120px; display: none; } /* 方法名的可编辑输入用 code+双击进入模式;这里默认隐藏保持整齐 */
.m-disp { width: 130px; }
.m-cat { width: 92px; }
.param-cnt { font-size: 10.5px; }

.m-body {
  padding: 6px 0 2px;
  border-top: 1px dashed var(--border-subtle);
  margin-top: 6px;
}
.input.tiny.desc { width: 100%; margin: 0 0 6px; opacity: 0.9; font-style: italic; font-size: 11.5px; }

.param-head { display: flex; gap: 6px; font-size: 9.5px; color: var(--text-tertiary); margin: 4px 0 2px 22px; text-transform: uppercase; letter-spacing: 0.4px; }
.param-row { display: flex; gap: 6px; align-items: center; margin: 3px 0 0 22px; }
.dir-out { color: var(--warn); }
.dir-in { color: var(--text-secondary); }

.member-row { display: flex; gap: 8px; align-items: center; font-size: 12px; padding: 4px 0; }
.mem-nm { width: 160px; }
.chk { font-size: 11px; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; color: var(--text-secondary); }

.dlg-fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dlg-fld > span { color: var(--text-secondary); }
.grp { font-size: 10.5px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.6px; margin: 14px 2px 6px; }
.enum-grp { margin-top: 18px; }
.spacer { flex: 1; }
.nowrap { white-space: nowrap; }
.muted-3 { color: var(--text-tertiary); font-size: 11px; }
</style>
