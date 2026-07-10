<script setup lang="ts">
import { ref, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import ActionButton from "@/components/common/ActionButton.vue";
import ModalDialog from "@/components/common/ModalDialog.vue";
import PageBar from "@/components/common/PageBar.vue";
import ExportSelectModal from "@/components/workspace/ExportSelectModal.vue";
import { seedWorkspace } from "@/stores/seed";
import {
  readTextFile,
  writeArtifact,
  writeProjectFiles,
  pickDirectory,
  pickSaveFilePath,
  readModelCmpFiles,
  fetchBundledRuntime,
  type ScannedModelDir,
} from "@/services/tauri";
import ModelExtractPanel from "@/components/workspace/ModelExtractPanel.vue";
import { ingestScannedModel } from "@/composables/useModelIngest";

const ws = useWorkspaceStore();
const c = useConsoleStore();

const tab = ref<"overview" | "extract">("overview");

// 导出选择对话框:用户勾选哪些 BT/FSM 包含进本次导出。
const exportSelectOpen = ref(false);
type ExportTarget = "workspace-xml" | "cpp-project";
const exportTarget = ref<ExportTarget>("cpp-project");

// --- 配置对话框(共用 New / Edit)。引擎源码目录已移除:engine-core 不再默认导出,该字段无作用。 ---
// workspaceFilePath = 工作空间 XML 的落盘绝对路径(打开/另存后回写);为空则"保存 XML"走另存为对话框。
type CfgForm = { name: string; modelRoot: string; exportCodeDir: string; workspaceFilePath: string; cppNamespace: string; language: "cpp" | "cs" };
const newOpen = ref(false);
const cfgOpen = ref(false);
const newCfg = ref<CfgForm>({ name: "workspace", modelRoot: "", exportCodeDir: "", workspaceFilePath: "", cppNamespace: "btproj", language: "cpp" });
const cfg = ref<CfgForm>({ name: "", modelRoot: "", exportCodeDir: "", workspaceFilePath: "", cppNamespace: "btproj", language: "cpp" });

/** Tauri-only:所有路径都是绝对路径,直接展示。 */
function displayPath(raw: string): { text: string; isBrowserName: boolean } {
  return { text: raw ?? "", isBrowserName: false };
}
const modelPath = computed(() => displayPath(ws.modelRoot));
const exportPath = computed(() => displayPath(ws.exportCodeDir));

function openNew() {
  newCfg.value = {
    name: "workspace",
    modelRoot: "",
    exportCodeDir: "",
    workspaceFilePath: "",
    cppNamespace: "btproj",
    language: "cpp",
  };
  newOpen.value = true;
}
async function confirmNew() {
  ws.newWorkspace(newCfg.value.name.trim() || "workspace");
  ws.modelRoot = newCfg.value.modelRoot;
  ws.exportCodeDir = newCfg.value.exportCodeDir;
  ws.workspaceFilePath = newCfg.value.workspaceFilePath;
  ws.cppNamespace = newCfg.value.cppNamespace || "btproj";
  ws.language = newCfg.value.language;
  newOpen.value = false;
  if (ws.modelRoot) await autoScanModel();
}

function openCfg() {
  cfg.value = {
    name: ws.workspaceName,
    modelRoot: ws.modelRoot,
    exportCodeDir: ws.exportCodeDir,
    workspaceFilePath: ws.workspaceFilePath,
    cppNamespace: ws.cppNamespace,
    language: ws.language,
  };
  cfgOpen.value = true;
}
async function applyCfg() {
  ws.workspaceName = cfg.value.name.trim() || ws.workspaceName;
  ws.modelRoot = cfg.value.modelRoot;
  ws.exportCodeDir = cfg.value.exportCodeDir;
  ws.workspaceFilePath = cfg.value.workspaceFilePath;
  ws.cppNamespace = cfg.value.cppNamespace || "btproj";
  ws.language = cfg.value.language;
  cfgOpen.value = false;
  c.success("workspace", `工作空间配置已更新:${ws.workspaceName}`);
  // 客户预期"配了目录就自动扫描" —— 不再判断是否改动,只要有 modelRoot 就重扫。
  // autoScanModel 内部对同路径重扫是安全的(读取 .cmp 幂等),
  // 也覆盖"用户填了默认路径没触发变更"这种边界。
  if (ws.modelRoot) await autoScanModel();
}

// 浏览器选目录时一次性读到的扫描结果,暂存以便"确定"后走 ingest 全流程(避免再次弹选择框)。
// 必须保留 files+muiFiles,否则老版 .cmp+.mui 配对解析路径会丢失 .mui 信息。
const pendingModel = ref<ScannedModelDir | null>(null);

function reportIngest(root: string, r: ReturnType<typeof ingestScannedModel>): void {
  c.success(
    "import",
    `工作空间上传完成 · ${r.paired ? "配对.cmp+.mui" : ".cmp"}:${r.classes} 类 · ${r.functions} 方法 → 已自动抽取 ${r.extractedFunctions} 方法到类型空间`,
    { detail: root },
  );
}

/** 配置了模型目录即自动扫描并抽取到类型空间(无需再手动点"扫描/抽取")。 */
async function autoScanModel() {
  if (!ws.modelRoot) return;
  const res = await readModelCmpFiles(ws.modelRoot);
  if (res.contents.length) {
    const r = ingestScannedModel(res);
    reportIngest(res.root, r);
    tab.value = "overview";
  } else {
    c.warning("import", `模型目录无 .cmp:${res.root}`);
  }
}

async function pickModelDir(target: "new" | "cfg") {
  const setVal = (v: string) => { if (target === "new") newCfg.value.modelRoot = v; else cfg.value.modelRoot = v; };
  const cur = target === "new" ? newCfg.value.modelRoot : cfg.value.modelRoot;
  const native = await pickDirectory(cur);
  if (!native) return;
  setVal(native);
  pendingModel.value = null;
}

/** 弹原生"另存为"对话框选"工作空间文件保存路径"(.workspace.xml),拿到绝对路径写回表单。 */
async function pickWorkspaceFile(target: "new" | "cfg") {
  const form = target === "new" ? newCfg.value : cfg.value;
  const wsName = (form.name.trim() || ws.workspaceName || "workspace");
  const defaultName = `${wsName}.workspace.xml`;
  // 默认目录:已填的路径的父目录 → 模型目录父目录 → 模型目录本身。
  const rawPath = form.workspaceFilePath?.trim() ?? "";
  let defaultDir: string | undefined;
  if (rawPath) {
    const idx = Math.max(rawPath.lastIndexOf("/"), rawPath.lastIndexOf("\\"));
    if (idx > 0) defaultDir = rawPath.slice(0, idx);
  }
  if (!defaultDir && form.modelRoot) {
    defaultDir = deriveDefaultSaveDir(form.modelRoot) ?? form.modelRoot;
  }
  const picked = await pickSaveFilePath(defaultName, {
    defaultDir,
    filters: [{ name: "工作空间 XML", extensions: ["xml"] }],
  });
  if (picked) {
    form.workspaceFilePath = picked;
    c.info("workspace", `已选择保存位置:${picked}`);
  } else {
    c.info("workspace", "已取消选择保存位置");
  }
}

/** 概览"工作空间文件"行的📁按钮:不打开配置弹窗,直接调起原生对话框选择保存位置,选完写回 store。 */
async function pickWorkspaceFileFromOverview() {
  const wsName = ws.workspaceName || "workspace";
  const defaultName = `${wsName}.workspace.xml`;
  const rawPath = (ws.workspaceFilePath ?? "").trim();
  let defaultDir: string | undefined;
  if (rawPath) {
    const idx = Math.max(rawPath.lastIndexOf("/"), rawPath.lastIndexOf("\\"));
    if (idx > 0) defaultDir = rawPath.slice(0, idx);
  }
  if (!defaultDir && ws.modelRoot) {
    defaultDir = deriveDefaultSaveDir(ws.modelRoot) ?? ws.modelRoot;
  }
  const picked = await pickSaveFilePath(defaultName, {
    defaultDir,
    filters: [{ name: "工作空间 XML", extensions: ["xml"] }],
  });
  if (picked) {
    ws.workspaceFilePath = picked;
    c.success("workspace", `已选择保存位置:${picked}`);
  }
}

async function pickExportDir(target: "new" | "cfg") {
  const setVal = (v: string) => { if (target === "new") newCfg.value.exportCodeDir = v; else cfg.value.exportCodeDir = v; };
  const cur = target === "new" ? newCfg.value.exportCodeDir : cfg.value.exportCodeDir;
  const dir = await pickDirectory(cur);
  if (!dir) return;
  setVal(dir);
}

/** 导出前置校验:有阻断错误则中止并提示(节点已暴红)。返回 true=可继续。 */
function ensureExportable(): boolean {
  const blockers = ws.exportBlockers();
  if (blockers.length) {
    const b = blockers[0]!;
    c.error("export", `导出阻断:全工作空间有 ${blockers.length} 个错误,请修正后再导出。首个:[${b.treeName}] ${b.message}`);
    return false;
  }
  return true;
}

/**
 * 代码生成前置:只看类型空间错误,不阻断于行为树完整性。
 * 生成的 C++ 仅基于类目录(类/方法/成员/枚举/结构);行为树 XML 是字符串拷进 behaviors/,
 * 即便节点未连完也不影响 C++ 工程编译。
 */
function ensureCodegenable(): boolean {
  const blockers = ws.codegenBlockers();
  if (blockers.length) {
    const b = blockers[0]!;
    c.error("export", `代码生成阻断(类型空间):${b.message}`);
    return false;
  }
  return true;
}

/**
 * 开始导出流程:
 *   - 生成 C++ 工程:一律全量(BT + FSM 全部包含),不弹选择框——C++ 需要完整代码,勾选反而增加操作步骤。
 *   - 保存工作空间 XML:仍走选择框,允许"只把这几棵树打进 workspace 存档"的场景。
 *   - 无树:两种目标都直接直出(workspace.xml 只含类型空间,C++ 工程只含用户类骨架)。
 */
function startExport(target: ExportTarget) {
  exportTarget.value = target;
  if (ws.trees.length === 0) {
    doExport([]);
    return;
  }
  if (target === "cpp-project") {
    doExport(ws.trees.map((t) => t.treeId));
    return;
  }
  exportSelectOpen.value = true;
}

async function doExport(selectedTreeIds: string[]) {
  exportSelectOpen.value = false;
  if (exportTarget.value === "workspace-xml") {
    await exportWorkspaceXml(selectedTreeIds);
  } else {
    await genProject(selectedTreeIds);
  }
}

/**
 * 保存工作空间 XML(Tauri 直写盘):
 *   1) workspaceFilePath 是完整 .xml → 直接原子写,不 confirm
 *   2) 是目录 → 补 <dir>/<name>.workspace.xml,confirm 一次并回写
 *   3) 未配置但有 modelRoot → 派生 <modelRoot 父>/<name>.workspace.xml,confirm 一次并回写
 *   4) 都无 → 弹原生"另存为"选路径,回写
 */
async function exportWorkspaceXml(selectedTreeIds: string[]) {
  if (!ensureExportable()) return;
  const totalTrees = selectedTreeIds.length || ws.trees.length;
  const xml = ws.exportWorkspaceXml(ws.workspaceName, selectedTreeIds);
  const defaultName = `${ws.workspaceName}.workspace.xml`;

  const rawPath = (ws.workspaceFilePath ?? "").trim();
  const isExplicitFile = rawPath && rawPath.toLowerCase().endsWith(".xml");
  let target = normalizeWorkspaceFileTarget(rawPath, defaultName);
  let derived = !isExplicitFile;
  if (!target && ws.modelRoot) {
    const parent = deriveDefaultSaveDir(ws.modelRoot);
    if (parent) {
      target = `${parent.replace(/[\\/]+$/, "")}/${defaultName}`;
      derived = true;
    }
  }
  // 全都无 → 直接弹原生另存为,拿到路径就直写。
  if (!target) {
    const picked = await pickSaveFilePath(defaultName, {
      filters: [{ name: "工作空间 XML", extensions: ["xml"] }],
    });
    if (!picked) { c.warning("export", "已取消保存"); return; }
    target = picked;
    derived = false;
  }
  if (derived && !window.confirm(`将保存工作空间到:\n${target}\n\n继续?`)) {
    c.warning("export", "已取消保存");
    return;
  }
  try {
    const out = await writeArtifact(target, xml);
    ws.workspaceFilePath = out.path;
    ws.rememberRecent(ws.workspaceName, xml);
    c.success("export", `已保存工作空间(${totalTrees} 棵树)→ ${out.path}`);
  } catch (e) {
    c.error("export", `写入失败:${(e as Error).message}。请检查目标目录是否可写、路径是否合法。`);
  }
}

/**
 * 用户在"工作空间文件"里可能填的是目录(如 F:/0411/ccc/FOSimEngine)而不是文件。
 * 规则:
 *   - 空 → 返回 undefined,由 caller 走派生。
 *   - 以 .xml / .workspace.xml 结尾 → 视为文件路径,原样返回。
 *   - 否则视为目录:在末尾补 /<defaultName>,让 writeArtifact 真能落到具体文件。
 */
function normalizeWorkspaceFileTarget(raw: string | undefined, defaultName: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(".xml")) return trimmed;
  return `${trimmed.replace(/[\\/]+$/, "")}/${defaultName}`;
}

/** 派生"另存为"默认目录:root 存在 → 取其父目录;否则空。 */
function deriveDefaultSaveDir(root: string): string | undefined {
  if (!root) return undefined;
  const idx = Math.max(root.lastIndexOf("/"), root.lastIndexOf("\\"));
  return idx > 0 ? root.slice(0, idx) : root;
}

async function genProject(selectedTreeIds: string[]) {
  if (!ensureCodegenable()) return;
  const projectFiles = ws.generateProjectFiles(selectedTreeIds);
  // 拉打包的真引擎 modules/extern + core/mal + pugi(路径已带 engine-core/ 前缀,不与 skeleton 冲突)。
  const engineFiles = await fetchBundledRuntime().catch(() => [] as { path: string; content: string }[]);
  const files = [...projectFiles, ...engineFiles];

  // 配置里已有绝对路径就直接写入;未配置才弹一次原生对话框选目录,选完回写。
  let target = ws.exportCodeDir ?? "";
  if (!target) {
    const picked = await pickDirectory("");
    if (!picked) { c.warning("export", "未选择导出目录,已取消生成"); return; }
    target = picked;
    ws.exportCodeDir = picked;
    c.info("export", `已记住导出目录:${picked}(下次「生成 C++ 工程」直接写入)`);
  }
  const out = await writeProjectFiles(target, files);
  c.success("export", `已生成 C++ 工程(${out.count} 个文件)→ ${target}`);
}

/**
 * 打开本地工作空间(*.workspace.xml):恢复配置 + 类型 + 行为树 + 黑板。
 * Tauri:原生对话框,默认目录取上次保存位置或 modelRoot 父目录,过滤 *.workspace.xml / *.xml。
 * 打开后把绝对路径(f.path)记入 workspaceFilePath,后续"保存 XML"静默覆写。
 * XML 内层若已含 workspaceFilePath 配置(旧版另存/手改)会被 importWorkspaceXml 覆盖上,
 * 之后 f.path 再一次覆盖 —— 以用户实际打开的路径为准。
 */
async function openWorkspace() {
  const defaultDir = deriveDefaultSaveDir(ws.workspaceFilePath || ws.modelRoot);
  const f = await readTextFile([{ name: "工作空间 XML", extensions: ["workspace.xml", "xml"] }], defaultDir);
  if (!f) return;
  if (!/<Workspace\b/.test(f.content)) { c.warning("import", "非 *.workspace.xml"); return; }
  ws.importWorkspaceXml(f.content);
  if (f.path) ws.workspaceFilePath = f.path; // 桌面端拿到真实路径;浏览器沙箱无 path 保留 XML 里的记录
  ws.rememberRecent(ws.workspaceName, f.content);
  if (ws.modelRoot) {
    const res = await readModelCmpFiles(ws.modelRoot);
    if (res.contents.length) {
      const r = ingestScannedModel(res);
      reportIngest(res.root, r);
    }
  }
  c.success("import", `已打开工作空间:${ws.workspaceName}${f.path ? " · " + f.path : ""}`);
}

/** 加载内置示例(空战决策树+状态机)。供首次进入/空状态使用。 */
function loadDemo() {
  if (ws.trees.length > 0) {
    c.warning("workspace", "当前工作空间已有内容;先「新建」清空后再加载示例。");
    return;
  }
  seedWorkspace();
  c.success("workspace", "已加载示例:空战决策(行为树 + 状态机)");
}

/** 从最近列表加载第 idx 项。 */
function loadFromRecent(idx: number) {
  if (ws.trees.length > 0) {
    if (!confirm("当前工作空间将被覆盖,继续从最近列表加载?")) return;
    ws.newWorkspace(ws.workspaceName);
  }
  if (ws.loadRecent(idx)) c.success("workspace", `已从最近列表恢复:${ws.recentWorkspaces[0]?.name ?? ""}`);
}

function removeFromRecent(idx: number) {
  ws.removeRecent(idx);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = (now - ts) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** 复制文本到剪贴板,带 toast 反馈。 */
async function copyText(text: string, label: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    c.info("workspace", `已复制 ${label}: ${text}`);
  } catch {
    c.warning("workspace", "复制失败,请手动选中复制");
  }
}

const isEmpty = computed(() => ws.trees.length === 0 && ws.classes.length === 0 && ws.functionCatalog.functions.length === 0);

const stats = computed(() => {
  void ws.rev;
  const bts = ws.trees.filter((t) => (t.projectKind ?? "behavior_tree") !== "state_machine").length;
  const fsms = ws.trees.length - bts;
  const totalNodes = ws.trees.reduce((sum, t) => sum + Object.keys(t.nodes).length, 0);
  const totalVars = ws.globalBlackboards.reduce((s, b) => s + b.variables.length, 0);
  return {
    bts, fsms,
    totalNodes,
    classes: ws.classes.length,
    functions: ws.functionCatalog.functions.length,
    members: ws.members.length,
    enums: ws.enums.length,
    structs: ws.structs.length,
    globals: ws.globalBlackboards.length,
    totalVars,
    blocking: ws.allErrorCount,
    warnings: ws.allWarningCount,
  };
});
</script>

<template>
  <div class="page">
    <PageBar title="工作空间" :subtitle="ws.workspaceName" dot="brand" help-title="工作空间 · 使用帮助" :help-width="720">
      <template #actions>
        <ActionButton label="新建" :primary="true" confirm="将清空当前工作空间,确认?" @run="openNew" />
        <ActionButton label="打开…" @run="openWorkspace" />
        <ActionButton label="保存 XML…" @run="() => startExport('workspace-xml')" />
        <ActionButton label="工作空间配置…" @run="openCfg" />
        <ActionButton label="生成 C++ 工程…" :primary="true" @run="() => startExport('cpp-project')" />
      </template>
      <template #help>
        <section class="help-sec">
          <h3>① 工作流总览</h3>
          <ol>
            <li><strong>新建 / 打开</strong> 工作空间 —— 命名 + 语言 + 命名空间</li>
            <li><strong>⇩ 输入</strong>:配置模型目录 (FZFOSimModel),自动扫 <code>.cmp</code> 抽取类/方法到"类型空间"</li>
            <li><strong>设计</strong>:在"设计"页拖节点组行为树/状态机;叶子节点绑类 + 函数(来自类型空间)</li>
            <li><strong>场景挂接</strong>:选想定 + 选实体 + 勾要挂的树 → 批量校验 → 写回 <code>.sdata</code> + 各自 <code>.bt/.sm</code></li>
            <li><strong>⇧ 输出</strong>:「保存 XML」写 <code>*.workspace.xml</code>;「生成 C++ 工程」写 Agent 类骨架 + BT/FSM XML + CMake</li>
          </ol>
        </section>
        <section class="help-sec">
          <h3>② 生成的 C++ 工程结构</h3>
<pre class="help-tree">工程根/
├─ CMakeLists.txt         顶层:含 tick_check + ctest + whole-archive
├─ runtime/               fosim_bt_runtime 库:BT/FSM 解析+调度+MAL
├─ types/                 &lt;ns&gt;_types 库:Agent 类 .h/.cpp(含 FOSIM_REGISTER_AGENT 宏)
├─ app/main.cpp           入口:仅调 CyberAgentRegistry::instance().RegisterAll()
├─ tests/tick_check.cpp   自动化:遍历 behaviors/ 跑 Tick 断言最终状态(ctest)
├─ behaviors/             行为树/状态机 XML
└─ engine-core/           FOSim modules/extern + core/mal + pugi 真源码</pre>
          <p><strong>宏静态注册</strong> — 每个 Agent 类的 <code>.cpp</code> 底部展开一次 <code>FOSIM_REGISTER_AGENT(ClassName);</code>,全局 static 对象在 main 之前构造,自动把工厂塞进 <code>CyberAgentRegistry</code>。</p>
        </section>
        <section class="help-sec">
          <h3>③ 编译 + 自动化测试</h3>
<pre class="help-tree">cmake -S . -B build
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure</pre>
          <p><code>tick_check</code> 会加载 <code>behaviors/*.bt.xml/*.fsm.xml</code>,Tick 到终止或 200 帧,断言 BT 必须终止,FSM 允许 Running 自旋。</p>
        </section>
        <div class="help-note">
          「新建工作空间」会<strong>清空当前所有类型 / 树 / 黑板</strong>,操作前先保存。<br>
          模型目录改动后会<strong>自动重扫</strong>;旧类型可到「模型类型抽取」页手动清理。<br>
          场景挂接的<strong>完整校验</strong>是硬闸门:任一节点的类/函数在实体 components 里查不到就无法写回。
        </div>
      </template>
    </PageBar>

    <!-- 选项卡 -->
    <div class="tabs panel">
      <button class="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">
        <span class="ti">概览</span>
      </button>
      <button class="tab" :class="{ active: tab === 'extract' }" @click="tab = 'extract'">
        <span class="ti">模型类型抽取</span>
      </button>
      <span class="spacer" />
      <span class="tab-meta">{{ stats.classes }} 类 · {{ stats.functions }} 方法 · {{ stats.globals }} 全局黑板</span>
    </div>

    <!-- 模型类型抽取 -->
    <div v-show="tab === 'extract'" class="panel extract-wrap">
      <ModelExtractPanel />
    </div>

    <!-- 概览:四张卡片(配置 / 内容统计 / 行为树+状态机 / 全局黑板)-->
    <div v-show="tab === 'overview'" class="overview scroll" :class="{ 'is-empty': isEmpty }">
      <!-- 空状态:无任何树/类/函数时,展示「新建 / 打开 / 加载示例 + 最近列表」 -->
      <div v-if="isEmpty" class="hero">
        <div class="hero-card">
          <div class="hero-icon">⌬</div>
          <div class="hero-title">开始一个工作空间</div>
          <div class="hero-sub">
            BT Studio 不再自动加载演示数据。请「新建」一个空工作空间、从本地「打开」一个 *.workspace.xml,
            或「加载示例」体验空战决策树+状态机。
          </div>
          <div class="hero-actions">
            <button class="btn primary lg" @click="openNew">+ 新建工作空间</button>
            <button class="btn lg" @click="openWorkspace">⇪ 打开 XML…</button>
            <button class="btn lg ghost" @click="loadDemo">⚑ 加载示例</button>
          </div>
        </div>

        <div v-if="ws.recentWorkspaces.length" class="recent-card">
          <header class="recent-head">
            <span class="card-icon">⏱</span>
            <span class="card-title">最近工作空间</span>
            <span class="card-meta">{{ ws.recentWorkspaces.length }} 个 · 本地浏览器持久</span>
          </header>
          <ul class="recent-list">
            <li v-for="(r, i) in ws.recentWorkspaces" :key="r.name + r.savedAt" class="recent-item">
              <button class="recent-main" :title="`保存于 ${new Date(r.savedAt).toLocaleString()} · 约 ${r.sizeKB}KB`" @click="loadFromRecent(i)">
                <span class="recent-name">{{ r.name }}</span>
                <span class="recent-meta">{{ formatTime(r.savedAt) }} · {{ r.sizeKB }}KB</span>
              </button>
              <button class="recent-del" :title="`移除 ${r.name}`" @click="removeFromRecent(i)">✕</button>
            </li>
          </ul>
        </div>
      </div>

      <!-- 配置卡 -->
      <section v-if="!isEmpty" class="card cfg-card">
        <header class="card-head">
          <span class="card-icon">⚙</span>
          <span class="card-title">工作空间配置</span>
          <span class="card-meta">属性 · 输入 · 输出</span>
          <span class="spacer" />
          <button class="link" @click="openCfg">编辑配置 →</button>
        </header>

        <!-- ⚙ 属性 -->
        <div class="cfg-block attr">
          <div class="cfg-bhd"><span class="bico">⚙</span><span>工程属性</span></div>
          <div class="cfg-grid">
            <div class="cfg-row">
              <span class="cfg-k">名称</span>
              <span class="cfg-v">{{ ws.workspaceName || "未命名" }}</span>
            </div>
            <div class="cfg-row">
              <span class="cfg-k">语言</span>
              <span class="cfg-v"><span class="chip">{{ ws.language === "cs" ? "C#" : "C++" }}</span></span>
            </div>
            <div class="cfg-row">
              <span class="cfg-k">命名空间</span>
              <span class="cfg-v mono">{{ ws.cppNamespace || "btproj" }}</span>
            </div>
          </div>
        </div>

        <!-- ⇩ 输入 -->
        <div class="cfg-block inp">
          <div class="cfg-bhd"><span class="bico" title="读取源">⇩</span><span>输入 · 从这里读取模型类型</span></div>
          <div class="cfg-grid one-col">
            <div class="cfg-row path">
              <span class="cfg-k">模型目录</span>
              <span class="cfg-v path-v" :class="{ unset: !ws.modelRoot }">
                <span v-if="modelPath.isBrowserName" class="path-prefix" title="浏览器沙箱限制:无法获取绝对路径,只能保留文件夹名">浏览器:</span>
                <span class="path-text mono"
                  :title="ws.modelRoot ? (modelPath.isBrowserName ? `浏览器选择的文件夹「${modelPath.text}」· 沙箱限制不暴露绝对路径` : ws.modelRoot) : '未配置 — 点「编辑配置」选择 FZFOSimModel 目录'">
                  {{ modelPath.text || "未配置(点编辑配置选目录)" }}
                </span>
                <button v-if="ws.modelRoot && !modelPath.isBrowserName" class="copy" :title="`复制 ${modelPath.text}`" @click="copyText(modelPath.text, '模型目录')">⧉</button>
              </span>
            </div>
          </div>
          <div class="cfg-tip">扫描此目录下 <span class="mono">.cmp</span> 抽取类/方法到类型空间。BT Studio 只读,不会写入。</div>
        </div>

        <!-- ⇧ 输出 -->
        <div class="cfg-block out">
          <div class="cfg-bhd"><span class="bico" title="写盘目标">⇧</span><span>输出 · 保存到这里</span></div>
          <div class="cfg-grid one-col">
            <div class="cfg-row path">
              <span class="cfg-k">① 工作空间 XML</span>
              <span class="cfg-v path-v" :class="{ unset: !ws.workspaceFilePath }">
                <span class="path-text mono"
                  :title="ws.workspaceFilePath || '未落盘 — 首次「保存 XML」会弹另存为并记住位置'">
                  {{ ws.workspaceFilePath || "未落盘(点「保存 XML」选择位置)" }}
                </span>
                <button class="copy" :title="ws.workspaceFilePath ? '重新选择保存位置' : '选择保存位置'" @click="pickWorkspaceFileFromOverview">📁</button>
                <button v-if="ws.workspaceFilePath" class="copy" :title="`复制 ${ws.workspaceFilePath}`" @click="copyText(ws.workspaceFilePath, '工作空间文件路径')">⧉</button>
              </span>
            </div>
            <div class="cfg-row path">
              <span class="cfg-k">② C++ 工程目录</span>
              <span class="cfg-v path-v" :class="{ unset: !ws.exportCodeDir }">
                <span v-if="exportPath.isBrowserName" class="path-prefix" title="浏览器沙箱限制:无法获取绝对路径,只能保留文件夹名">浏览器:</span>
                <span class="path-text mono"
                  :title="ws.exportCodeDir ? (exportPath.isBrowserName ? `浏览器文件夹「${exportPath.text}」· 已授权读写` : ws.exportCodeDir) : '未配置 — 生成 C++ 工程时会要求选择'">
                  {{ exportPath.text || "未配置(生成时再选)" }}
                </span>
                <button v-if="ws.exportCodeDir && !exportPath.isBrowserName" class="copy" :title="`复制 ${exportPath.text}`" @click="copyText(exportPath.text, '导出目录')">⧉</button>
              </span>
            </div>
          </div>
          <div class="cfg-tip">
            <span class="tip-line"><strong>①</strong> 点顶栏「保存 XML」时写这里。留空即弹另存为。</span>
            <span class="tip-line"><strong>②</strong> 点顶栏「生成 C++ 工程」时写这里。生成物:Agent 类骨架 + 注册 + BT/FSM XML + main + CMakeLists。</span>
          </div>
        </div>

        <div v-if="modelPath.isBrowserName || exportPath.isBrowserName" class="path-hint">
          ⓘ 浏览器预览模式无法显示目录绝对路径(File System Access API 安全限制)。桌面端可见完整路径。
        </div>
      </section>

      <!-- 内容统计卡 -->
      <section v-if="!isEmpty" class="card">
        <header class="card-head">
          <span class="card-icon">▦</span>
          <span class="card-title">内容统计</span>
          <span class="spacer" />
          <span v-if="stats.blocking" class="status err">⚠ {{ stats.blocking }} 阻断</span>
          <span v-else-if="stats.warnings" class="status warn">⚠ {{ stats.warnings }} 警告</span>
          <span v-else class="status ok">✓ 无问题</span>
        </header>
        <div class="stat-grid">
          <div class="stat" :class="{ zero: stats.bts === 0 }">
            <div class="stat-num">{{ stats.bts }}</div>
            <div class="stat-lbl">行为树</div>
          </div>
          <div class="stat" :class="{ zero: stats.fsms === 0 }">
            <div class="stat-num">{{ stats.fsms }}</div>
            <div class="stat-lbl">状态机</div>
          </div>
          <div class="stat" :class="{ zero: stats.totalNodes === 0 }">
            <div class="stat-num">{{ stats.totalNodes }}</div>
            <div class="stat-lbl">节点总数</div>
          </div>
          <div class="stat" :class="{ zero: stats.classes === 0 }">
            <div class="stat-num">{{ stats.classes }}</div>
            <div class="stat-lbl">Agent 类</div>
          </div>
          <div class="stat" :class="{ zero: stats.functions === 0 }">
            <div class="stat-num">{{ stats.functions }}</div>
            <div class="stat-lbl">决策方法</div>
          </div>
          <div class="stat" :class="{ zero: stats.members === 0 }">
            <div class="stat-num">{{ stats.members }}</div>
            <div class="stat-lbl">成员</div>
          </div>
          <div class="stat" :class="{ zero: stats.enums + stats.structs === 0 }">
            <div class="stat-num">{{ stats.enums }}<span class="stat-sep">/</span>{{ stats.structs }}</div>
            <div class="stat-lbl">枚举 / 结构</div>
          </div>
          <div class="stat" :class="{ zero: stats.totalVars === 0 }">
            <div class="stat-num">{{ stats.totalVars }}</div>
            <div class="stat-lbl">全局变量</div>
          </div>
        </div>
      </section>

      <!-- 行为树 / 状态机 列表(统一) -->
      <section v-if="!isEmpty" class="card">
        <header class="card-head">
          <span class="card-icon">⌬</span>
          <span class="card-title">行为树与状态机</span>
          <span class="card-meta">{{ ws.trees.length }} 项</span>
          <span class="spacer" />
        </header>
        <div v-if="ws.trees.length === 0" class="empty">尚无行为树/状态机。前往「设计」页新建。</div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th class="th-name">名称</th>
              <th>类型</th>
              <th class="num">节点</th>
              <th>当前</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in ws.trees" :key="t.treeId" :class="{ active: t.treeId === ws.currentTreeId }">
              <td class="th-name"><span class="tree-name">{{ t.displayName || t.treeName }}</span></td>
              <td>
                <span class="kind" :class="t.projectKind === 'state_machine' ? 'fsm' : 'bt'">
                  {{ t.projectKind === "state_machine" ? "状态机" : "行为树" }}
                </span>
              </td>
              <td class="num">{{ Object.keys(t.nodes).length }}</td>
              <td>
                <span v-if="t.treeId === ws.currentTreeId" class="curdot" title="当前编辑中">●</span>
              </td>
              <td>
                <button class="btn tiny" :disabled="t.treeId === ws.currentTreeId" @click="ws.switchTree(t.treeId)">
                  {{ t.treeId === ws.currentTreeId ? "已切换" : "切换" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 全局黑板 -->
      <section v-if="!isEmpty && ws.globalBlackboards.length" class="card">
        <header class="card-head">
          <span class="card-icon">◈</span>
          <span class="card-title">全局黑板</span>
          <span class="card-meta">{{ ws.globalBlackboards.length }} 张 · {{ stats.totalVars }} 个变量</span>
        </header>
        <div class="bb-list">
          <div v-for="b in ws.globalBlackboards" :key="b.blackboardId" class="bb-item">
            <span class="bb-name">{{ b.name }}</span>
            <span class="bb-meta">{{ b.variables.length }} 变量</span>
          </div>
        </div>
      </section>
    </div>

    <!-- 新建工作空间对话框 -->
    <ModalDialog :open="newOpen" title="新建工作空间" ok-label="新建" @ok="confirmNew" @cancel="newOpen = false">
      <div class="cfg-form">
        <!-- ⚙ 属性 -->
        <section class="cfg-sec attr">
          <header class="cfg-sec-hd">
            <span class="sec-ico">⚙</span>
            <span class="sec-tt">工作空间属性</span>
            <span class="sec-sub">工程的名称与代码风格,存进 workspace.xml</span>
          </header>
          <div class="cfg-sec-body">
            <label class="fld half">
              <span>工作空间名 <em>*</em></span>
              <input class="input" v-model="newCfg.name" placeholder="my_workspace" />
            </label>
            <label class="fld half">
              <span>语言</span>
              <select class="select" v-model="newCfg.language">
                <option value="cpp">C++</option>
                <option value="cs">C#</option>
              </select>
            </label>
            <label class="fld">
              <span>C++ 命名空间</span>
              <input class="input" v-model="newCfg.cppNamespace" placeholder="btproj" />
            </label>
          </div>
        </section>

        <!-- ⇩ 输入 -->
        <section class="cfg-sec inp">
          <header class="cfg-sec-hd">
            <span class="sec-ico" title="从此目录读取">⇩</span>
            <span class="sec-tt">输入 · 模型类型来源</span>
            <span class="sec-sub">扫描 .cmp 抽取类/方法到类型空间(BT Studio 只读,不写入)</span>
          </header>
          <div class="cfg-sec-body">
            <label class="fld">
              <span>模型目录 <em class="muted-2">·扫描此目录下的 *.cmp 文件</em></span>
              <div class="pick">
                <input class="input" v-model="newCfg.modelRoot" placeholder="如 F:/FOSim/FZFOSimModel" />
                <button class="btn tiny" @click="pickModelDir('new')">📂 选择目录…</button>
              </div>
              <span class="fld-hint">确定后会自动扫描并抽取类/方法。之后在「模型类型抽取」页勾选想要的类。</span>
            </label>
          </div>
        </section>
        <!-- ⇧ 输出 -->
        <section class="cfg-sec out">
          <header class="cfg-sec-hd">
            <span class="sec-ico" title="写盘目标">⇧</span>
            <span class="sec-tt">输出 · 保存目标</span>
            <span class="sec-sub">点顶栏「保存 XML」和「生成 C++ 工程」时,分别写到这两处</span>
          </header>
          <div class="cfg-sec-body">
            <label class="fld">
              <span>① 工作空间 XML 保存路径 <em class="muted-2">·「保存 XML」目标文件</em></span>
              <div class="pick">
                <input class="input" v-model="newCfg.workspaceFilePath" :placeholder="`留空即在保存时弹另存为(${newCfg.name || 'workspace'}.workspace.xml)`" />
                <button class="btn tiny" @click="pickWorkspaceFile('new')">💾 选择文件…</button>
              </div>
              <span class="fld-hint">留空亦可 —— 首次「保存 XML」会弹出另存为并把选择记回这里。</span>
            </label>
            <label class="fld">
              <span>② C++ 工程输出目录 <em class="muted-2">·「生成 C++ 工程」目标目录</em></span>
              <div class="pick">
                <input class="input" v-model="newCfg.exportCodeDir" placeholder="留空即在生成时弹目录选择器" />
                <button class="btn tiny" @click="pickExportDir('new')">📁 选择目录…</button>
              </div>
              <span class="fld-hint">生成物:Agent 类骨架(.h/.cpp) + RegisterFunctions + BT/FSM XML + main.cpp + CMakeLists。</span>
            </label>
          </div>
        </section>
      </div>
      <div class="note">
        点「新建」将<strong>清空当前工作空间</strong>并按上述配置开新工程。模型目录配好即
        <strong>自动扫描</strong>,直接到「模型类型抽取」页勾选抽取到类型空间。
      </div>
    </ModalDialog>

    <!-- 工作空间配置对话框 -->
    <ModalDialog :open="cfgOpen" title="工作空间配置" ok-label="应用" @ok="applyCfg" @cancel="cfgOpen = false">
      <div class="cfg-form">
        <!-- ⚙ 属性 -->
        <section class="cfg-sec attr">
          <header class="cfg-sec-hd">
            <span class="sec-ico">⚙</span>
            <span class="sec-tt">工作空间属性</span>
            <span class="sec-sub">工程的名称与代码风格,存进 workspace.xml</span>
          </header>
          <div class="cfg-sec-body">
            <label class="fld half">
              <span>工作空间名</span>
              <input class="input" v-model="cfg.name" />
            </label>
            <label class="fld half">
              <span>语言</span>
              <select class="select" v-model="cfg.language">
                <option value="cpp">C++</option>
                <option value="cs">C#</option>
              </select>
            </label>
            <label class="fld">
              <span>C++ 命名空间</span>
              <input class="input" v-model="cfg.cppNamespace" placeholder="btproj" />
            </label>
          </div>
        </section>

        <!-- ⇩ 输入 -->
        <section class="cfg-sec inp">
          <header class="cfg-sec-hd">
            <span class="sec-ico" title="从此目录读取">⇩</span>
            <span class="sec-tt">输入 · 模型类型来源</span>
            <span class="sec-sub">扫描 .cmp 抽取类/方法到类型空间(BT Studio 只读,不写入)</span>
          </header>
          <div class="cfg-sec-body">
            <label class="fld">
              <span>模型目录 <em class="muted-2">·扫描此目录下的 *.cmp 文件</em></span>
              <div class="pick">
                <input class="input" v-model="cfg.modelRoot" placeholder="如 F:/FOSim/FZFOSimModel" />
                <button class="btn tiny" @click="pickModelDir('cfg')">📂 选择目录…</button>
              </div>
              <span class="fld-hint">改动后点应用即自动重扫。</span>
            </label>
          </div>
        </section>

        <!-- ⇧ 输出 -->
        <section class="cfg-sec out">
          <header class="cfg-sec-hd">
            <span class="sec-ico" title="写盘目标">⇧</span>
            <span class="sec-tt">输出 · 保存目标</span>
            <span class="sec-sub">「保存 XML」和「生成 C++ 工程」直写到这两处</span>
          </header>
          <div class="cfg-sec-body">
            <label class="fld">
              <span>① 工作空间 XML 保存路径 <em class="muted-2">·「保存 XML」目标文件</em></span>
              <div class="pick">
                <input class="input" v-model="cfg.workspaceFilePath" :placeholder="`如 ${cfg.name || ws.workspaceName}.workspace.xml 的绝对路径`" />
                <button class="btn tiny" @click="pickWorkspaceFile('cfg')">💾 选择文件…</button>
              </div>
              <span class="fld-hint">留空:首次保存时弹另存为并把路径记回这里,之后就静默覆写不再打扰。</span>
            </label>
            <label class="fld">
              <span>② C++ 工程输出目录 <em class="muted-2">·「生成 C++ 工程」目标目录</em></span>
              <div class="pick">
                <input class="input" v-model="cfg.exportCodeDir" placeholder="生成 C++ 工程的输出根目录" />
                <button class="btn tiny" @click="pickExportDir('cfg')">📁 选择目录…</button>
              </div>
              <span class="fld-hint">生成物:Agent 类骨架 + 注册函数 + BT/FSM XML + main.cpp + CMakeLists。</span>
            </label>
          </div>
        </section>
      </div>
      <div class="note">
        改动模型目录后将<strong>自动重扫</strong>。保存路径留空时,「保存 XML」会弹另存为并把路径记回此处。
      </div>
    </ModalDialog>


    <!-- 导出选择对话框:勾选要包含到本次导出的 BT/FSM -->
    <ExportSelectModal
      :open="exportSelectOpen"
      :title="exportTarget === 'workspace-xml' ? '保存工作空间 XML — 选择内容' : '生成 C++ 工程 — 选择行为树/状态机'"
      :ok-label="exportTarget === 'workspace-xml' ? '保存 XML' : '生成工程'"
      @ok="doExport"
      @cancel="exportSelectOpen = false"
    />
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }

/* 顶部操作条 */
.page-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 9px 14px;
}
.title { display: flex; align-items: center; gap: 8px; }
.title .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: linear-gradient(135deg, var(--accent, #5eb3ff), #47d6a4);
  box-shadow: 0 0 6px rgba(94,179,255,0.55);
}
.ws-name {
  color: var(--muted); font-size: 12.5px;
  max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-left: 1px solid var(--line-soft); padding-left: 8px; margin-left: 2px;
}
.spacer { flex: 1; }

/* 选项卡 */
.tabs { display: flex; align-items: center; gap: 4px; padding: 4px 10px; flex: 0 0 auto; }
.tab {
  background: transparent; border: 1px solid transparent;
  color: var(--muted); font-size: 12.5px;
  padding: 6px 16px; border-radius: 7px; cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.tab:hover { color: var(--text); background: rgba(255,255,255,0.03); }
.tab.active {
  background: rgba(94,179,255,0.14); color: var(--accent);
  border-color: rgba(94,179,255,0.32);
}
.tab .ti { font-weight: 500; }
.tab-meta { font-size: 11px; color: var(--muted-2); padding-right: 6px; }

/* 抽取面板 */
.extract-wrap { flex: 1; min-height: 0; padding: 10px; overflow: hidden; display: flex; }
.extract-wrap > :deep(.extract) { flex: 1; min-height: 0; }

/* 概览:卡片网格 */
.overview {
  flex: 1; min-height: 0; overflow-y: auto;
  display: grid; gap: 10px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-auto-rows: min-content;
  padding: 2px;
}
.overview.is-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  gap: 16px; padding: 28px 18px;
}
.overview > .card:nth-child(3),
.overview > .card:nth-child(4) { grid-column: span 2; }

/* 空状态 hero */
.hero { display: flex; flex-direction: column; gap: 14px; width: min(720px, 100%); }
.hero-card {
  border: 1px solid var(--line-soft); border-radius: 12px;
  background: linear-gradient(160deg, rgba(94,179,255,0.05), rgba(94,179,255,0.01));
  padding: 28px 26px; text-align: center;
}
.hero-icon {
  font-size: 30px; color: var(--accent);
  width: 56px; height: 56px; border-radius: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(94,179,255,0.1);
  border: 1px solid rgba(94,179,255,0.28);
  margin-bottom: 12px;
}
.hero-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; color: var(--text); }
.hero-sub { font-size: 12px; color: var(--muted); line-height: 1.6; margin-bottom: 18px; }
.hero-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.btn.lg { padding: 9px 16px; font-size: 13px; border-radius: 7px; }
.btn.ghost {
  background: transparent; border: 1px dashed var(--line-soft); color: var(--muted);
}
.btn.ghost:hover { color: var(--accent); border-color: rgba(94,179,255,0.4); }

.recent-card {
  border: 1px solid var(--line-soft); border-radius: 10px;
  background: rgba(255,255,255,0.018);
  padding: 12px 14px;
}
.recent-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px; padding-bottom: 8px;
  border-bottom: 1px dashed var(--line-soft);
}
.recent-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.recent-item {
  display: flex; align-items: stretch; gap: 4px;
  border: 1px solid var(--line-soft); border-radius: 6px;
  background: rgba(0,0,0,0.14);
  transition: border-color 0.1s, background 0.1s;
}
.recent-item:hover { border-color: rgba(94,179,255,0.32); background: rgba(94,179,255,0.06); }
.recent-main {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 10px;
  background: transparent; border: none; padding: 8px 12px;
  cursor: pointer; text-align: left;
}
.recent-name { flex: 1; font-size: 12.5px; color: var(--text); font-weight: 500; }
.recent-meta { font-size: 11px; color: var(--muted-2); font-family: var(--mono, monospace); }
.recent-del {
  background: transparent; border: none; color: var(--muted-2);
  padding: 0 12px; cursor: pointer; font-size: 12px;
  border-left: 1px solid var(--line-soft);
}
.recent-del:hover { color: var(--err); background: rgba(240,109,109,0.06); }

/* 路径前缀(浏览器:) + 浏览器沙箱提示 */
.path-prefix {
  font-size: 10px; padding: 2px 6px; border-radius: 4px;
  color: var(--warn, #f5b65c); background: rgba(245,182,92,0.1);
  border: 1px solid rgba(245,182,92,0.28);
  flex: 0 0 auto;
}
.path-hint {
  grid-column: span 2;
  margin-top: 8px;
  font-size: 11px; line-height: 1.55; color: var(--muted-2);
  background: rgba(245,182,92,0.06);
  border-left: 2px solid rgba(245,182,92,0.4);
  padding: 6px 10px; border-radius: 0 6px 6px 0;
}

/* 卡片 */
.card {
  background: rgba(255,255,255,0.018);
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  padding: 12px 14px;
  transition: border-color 0.12s, background 0.12s;
}
.card:hover { border-color: rgba(94,179,255,0.22); }
.card-head {
  display: flex; align-items: center; gap: 8px;
  margin: -2px 0 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--line-soft);
}
.card-icon {
  font-size: 13px; color: var(--accent);
  width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(94,179,255,0.1);
  border: 1px solid rgba(94,179,255,0.22);
}
.card-title { font-size: 12.5px; font-weight: 600; color: var(--text); letter-spacing: 0.02em; }
.card-meta { font-size: 11px; color: var(--muted-2); margin-left: 4px; }
.link {
  background: transparent; border: none; color: var(--accent);
  font-size: 11.5px; cursor: pointer; padding: 2px 4px; border-radius: 4px;
}
.link:hover { background: rgba(94,179,255,0.1); }
.status { font-size: 11px; padding: 2px 8px; border-radius: 10px; }
.status.ok { color: var(--ok); background: rgba(71,214,164,0.1); }
.status.warn { color: var(--warn, #f5b65c); background: rgba(245,182,92,0.1); }
.status.err { color: var(--err); background: rgba(240,109,109,0.1); }

/* 配置卡 —— 分区式:属性 / ⇩ 输入 / ⇧ 输出。视觉线索来自左侧强调色边条。 */
.cfg-card { display: flex; flex-direction: column; gap: 8px; }
.cfg-block {
  border: 1px solid var(--line-soft); border-radius: 8px;
  padding: 10px 12px 8px;
  background: rgba(0,0,0,0.12);
  position: relative;
}
.cfg-block::before {
  content: ""; position: absolute; top: 8px; bottom: 8px; left: 0; width: 3px;
  border-radius: 3px 0 0 3px;
}
.cfg-block.attr::before { background: var(--muted, #7d8ba1); }
.cfg-block.inp::before { background: linear-gradient(180deg, #47d6a4, #35a37c); }
.cfg-block.out::before { background: linear-gradient(180deg, #f5b65c, #d98a2a); }
.cfg-bhd {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; font-weight: 600; color: var(--text);
  margin-bottom: 8px; letter-spacing: 0.02em;
}
.cfg-bhd .bico {
  width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px;
}
.cfg-block.attr .bico { background: rgba(125,139,161,0.12); color: var(--muted); border: 1px solid rgba(125,139,161,0.28); }
.cfg-block.inp .bico { background: rgba(71,214,164,0.12); color: var(--ok, #47d6a4); border: 1px solid rgba(71,214,164,0.32); }
.cfg-block.out .bico { background: rgba(245,182,92,0.12); color: var(--warn, #f5b65c); border: 1px solid rgba(245,182,92,0.32); }
.cfg-tip {
  margin-top: 6px; font-size: 10.5px; line-height: 1.55; color: var(--muted-2);
  display: flex; flex-direction: column; gap: 2px;
}
.cfg-tip .tip-line strong { color: var(--warn, #f5b65c); margin-right: 4px; }

.cfg-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px;
}
.cfg-grid.one-col { grid-template-columns: 1fr; }
.cfg-row { display: flex; align-items: center; gap: 10px; min-height: 24px; font-size: 12.5px; }
.cfg-row.path { grid-column: span 2; }
.cfg-k { color: var(--muted); flex: 0 0 100px; font-size: 11.5px; }
.cfg-v { color: var(--text); flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
.path-v { font-size: 11.5px; }
.path-v.unset .path-text { color: var(--muted-2); font-style: italic; }
.path-text {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 4px 8px;
  background: rgba(0,0,0,0.18);
  border: 1px solid var(--line-soft);
  border-radius: 5px;
}
.copy {
  flex: 0 0 auto;
  background: transparent; border: 1px solid var(--line-soft);
  color: var(--muted); cursor: pointer;
  padding: 3px 8px; border-radius: 5px; font-size: 12px;
}
.copy:hover { color: var(--accent); border-color: rgba(94,179,255,0.4); }
.chip {
  display: inline-block;
  font-size: 10.5px; padding: 1px 8px; border-radius: 8px;
  background: rgba(94,179,255,0.14); color: var(--accent);
  border: 1px solid rgba(94,179,255,0.28);
}

/* 统计 */
.stat-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
}
.stat {
  padding: 10px 8px; text-align: center;
  background: rgba(0,0,0,0.16);
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  transition: border-color 0.12s;
}
.stat:hover { border-color: rgba(94,179,255,0.3); }
.stat.zero { opacity: 0.45; }
.stat-num { font-size: 20px; font-weight: 600; color: var(--text); line-height: 1.2; font-family: var(--mono, monospace); }
.stat-num .stat-sep { color: var(--muted-2); margin: 0 2px; font-weight: 400; }
.stat-lbl { font-size: 10.5px; color: var(--muted); margin-top: 2px; letter-spacing: 0.02em; }

/* 列表 */
.tbl { width: 100%; border-collapse: collapse; }
.tbl th {
  text-align: left; font-size: 10.5px; color: var(--muted-2);
  padding: 6px 8px; font-weight: 500; letter-spacing: 0.04em;
  border-bottom: 1px solid var(--line-soft);
}
.tbl th.num { text-align: right; }
.tbl td { padding: 7px 8px; border-bottom: 1px solid var(--line-soft); font-size: 12px; }
.tbl td.num { text-align: right; font-family: var(--mono, monospace); color: var(--muted); }
.tbl tr.active td { background: rgba(94,179,255,0.08); }
.tbl tr:hover td { background: rgba(255,255,255,0.018); }
.th-name { width: 36%; }
.tree-name { font-weight: 500; }
.kind {
  font-size: 10.5px; padding: 1px 7px; border-radius: 8px; letter-spacing: 0.02em;
}
.kind.bt { color: var(--accent); background: rgba(94,179,255,0.12); border: 1px solid rgba(94,179,255,0.28); }
.kind.fsm { color: var(--warn, #f5b65c); background: rgba(245,182,92,0.12); border: 1px solid rgba(245,182,92,0.28); }
.curdot { color: var(--ok); font-size: 10px; }

.empty {
  padding: 20px 8px; text-align: center; font-size: 12px;
  color: var(--muted-2);
}

/* 全局黑板 */
.bb-list { display: flex; flex-wrap: wrap; gap: 6px; }
.bb-item {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 6px;
  background: rgba(94,179,255,0.06);
  border: 1px solid var(--line-soft);
  font-size: 11.5px;
}
.bb-name { color: var(--text); font-weight: 500; }
.bb-meta { color: var(--muted-2); font-size: 10.5px; }

/* 对话框字段 */
.fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; margin-bottom: 8px; }
.fld > span { color: var(--muted); font-size: 11.5px; }
.fld em { color: var(--err); font-style: normal; margin-left: 2px; }
.fld em.muted-2 { color: var(--muted-2); font-size: 10.5px; margin-left: 4px; }
.fld-hint { color: var(--muted-2); font-size: 10.5px; line-height: 1.5; margin-top: 2px; }
.pick { display: flex; gap: 6px; }
.pick .input { flex: 1; }

/* 对话框分区(⚙ 属性 / ⇩ 输入 / ⇧ 输出)—— 视觉上和概览配置卡呼应,左边细色条区分类别 */
.cfg-form { display: flex; flex-direction: column; gap: 10px; }
.cfg-sec {
  border: 1px solid var(--line-soft); border-radius: 8px;
  padding: 10px 12px 6px;
  background: rgba(0,0,0,0.14);
  position: relative;
}
.cfg-sec::before {
  content: ""; position: absolute; top: 10px; bottom: 10px; left: 0; width: 3px;
  border-radius: 3px 0 0 3px;
}
.cfg-sec.attr::before { background: var(--muted, #7d8ba1); }
.cfg-sec.inp::before { background: linear-gradient(180deg, #47d6a4, #35a37c); }
.cfg-sec.out::before { background: linear-gradient(180deg, #f5b65c, #d98a2a); }
.cfg-sec-hd {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  padding-bottom: 6px; border-bottom: 1px dashed var(--line-soft);
}
.cfg-sec-hd .sec-ico {
  width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600;
}
.cfg-sec.attr .sec-ico { background: rgba(125,139,161,0.12); color: var(--muted); border: 1px solid rgba(125,139,161,0.3); }
.cfg-sec.inp .sec-ico { background: rgba(71,214,164,0.12); color: var(--ok, #47d6a4); border: 1px solid rgba(71,214,164,0.32); }
.cfg-sec.out .sec-ico { background: rgba(245,182,92,0.12); color: var(--warn, #f5b65c); border: 1px solid rgba(245,182,92,0.32); }
.cfg-sec-hd .sec-tt { font-size: 12.5px; font-weight: 600; color: var(--text); }
.cfg-sec-hd .sec-sub { font-size: 10.5px; color: var(--muted-2); margin-left: 4px; }
.cfg-sec-body {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px;
}
.cfg-sec-body > .fld { grid-column: span 2; }
.cfg-sec-body > .fld.half { grid-column: span 1; }
.note {
  font-size: 11px; line-height: 1.55;
  color: var(--muted-2);
  background: rgba(94,179,255,0.04);
  border-left: 2px solid rgba(94,179,255,0.4);
  padding: 6px 10px; border-radius: 0 6px 6px 0;
  margin-top: 4px;
}
.ok { color: var(--ok); } .err { color: var(--err); }
</style>
