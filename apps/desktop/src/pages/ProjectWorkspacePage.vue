<script setup lang="ts">
import { ref, computed } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useConsoleStore } from "@/stores/console";
import ActionButton from "@/components/common/ActionButton.vue";
import ModalDialog from "@/components/common/ModalDialog.vue";
import ExportSelectModal from "@/components/workspace/ExportSelectModal.vue";
import { seedWorkspace } from "@/stores/seed";
import {
  downloadText,
  readTextFile,
  writeProjectFiles,
  pickDirectory,
  pickWritableDir,
  writeFilesToDirHandle,
  readModelCmpFiles,
  isTauri,
  type FsDirHandle,
} from "@/services/tauri";
import ModelExtractPanel from "@/components/workspace/ModelExtractPanel.vue";

const ws = useWorkspaceStore();
const c = useConsoleStore();

const tab = ref<"overview" | "extract">("overview");

// 浏览器:已选的可写导出目录句柄(用它把生成代码真正写进该文件夹,而非下载)。
const exportDirHandle = ref<FsDirHandle | null>(null);

// 导出选择对话框:用户勾选哪些 BT/FSM 包含进本次导出。
const exportSelectOpen = ref(false);
type ExportTarget = "workspace-xml" | "cpp-project";
const exportTarget = ref<ExportTarget>("cpp-project");

// --- 配置对话框(共用 New / Edit)。引擎源码目录已移除:engine-core 不再默认导出,该字段无作用。 ---
type CfgForm = { name: string; modelRoot: string; exportCodeDir: string; cppNamespace: string; language: "cpp" | "cs" };
const newOpen = ref(false);
const cfgOpen = ref(false);
const newCfg = ref<CfgForm>({ name: "workspace", modelRoot: "", exportCodeDir: "", cppNamespace: "btproj", language: "cpp" });
const cfg = ref<CfgForm>({ name: "", modelRoot: "", exportCodeDir: "", cppNamespace: "btproj", language: "cpp" });

/** 浏览器选目录拿不到绝对路径,store 里记 "browser::<name>" 标记;UI 自行解码展示。 */
const BROWSER_MARK = "browser::";
function displayPath(raw: string): { text: string; isBrowserName: boolean } {
  if (!raw) return { text: "", isBrowserName: false };
  if (raw.startsWith(BROWSER_MARK)) return { text: raw.slice(BROWSER_MARK.length), isBrowserName: true };
  return { text: raw, isBrowserName: false };
}
const modelPath = computed(() => displayPath(ws.modelRoot));
const exportPath = computed(() => displayPath(ws.exportCodeDir));

function openNew() {
  newCfg.value = {
    name: "workspace",
    modelRoot: "",
    exportCodeDir: "",
    cppNamespace: "btproj",
    language: "cpp",
  };
  newOpen.value = true;
}
async function confirmNew() {
  ws.newWorkspace(newCfg.value.name.trim() || "workspace");
  ws.modelRoot = newCfg.value.modelRoot;
  ws.exportCodeDir = newCfg.value.exportCodeDir;
  ws.cppNamespace = newCfg.value.cppNamespace || "btproj";
  ws.language = newCfg.value.language;
  newOpen.value = false;
  await autoScanModel();
}

function openCfg() {
  cfg.value = {
    name: ws.workspaceName,
    modelRoot: ws.modelRoot,
    exportCodeDir: ws.exportCodeDir,
    cppNamespace: ws.cppNamespace,
    language: ws.language,
  };
  cfgOpen.value = true;
}
async function applyCfg() {
  const modelChanged = cfg.value.modelRoot !== ws.modelRoot;
  ws.workspaceName = cfg.value.name.trim() || ws.workspaceName;
  ws.modelRoot = cfg.value.modelRoot;
  ws.exportCodeDir = cfg.value.exportCodeDir;
  ws.cppNamespace = cfg.value.cppNamespace || "btproj";
  ws.language = cfg.value.language;
  cfgOpen.value = false;
  c.success("workspace", `工作空间配置已更新:${ws.workspaceName}`);
  if (modelChanged) await autoScanModel();
}

// 浏览器选目录时一次性读到的 .cmp 内容,暂存以便确定后扫描(避免再次弹选择框)。
const pendingModel = ref<{ root: string; contents: string[] } | null>(null);

/** 配置了模型目录即自动扫描解析(无需再手动点"扫描模型目录")。 */
async function autoScanModel() {
  if (!ws.modelRoot) return;
  // 浏览器记号目录在 store 直接重开时已没有真实 contents,跳过自动扫描;
  // 用户可在「模型类型抽取」页重新拖入。
  if (ws.modelRoot.startsWith(BROWSER_MARK)) return;
  if (pendingModel.value && pendingModel.value.root === ws.modelRoot) {
    const p = pendingModel.value;
    pendingModel.value = null;
    if (p.contents.length) { ws.parseModelDir(p.root, p.contents); tab.value = "extract"; }
    else c.warning("import", `所选目录无 .cmp:${p.root}`);
    return;
  }
  const res = await readModelCmpFiles(ws.modelRoot);
  if (res && res.contents.length) {
    ws.parseModelDir(res.root, res.contents);
    tab.value = "extract";
  } else if (res) {
    c.warning("import", `模型目录无 .cmp:${res.root}`);
  }
}

async function pickModelDir(target: "new" | "cfg") {
  const setVal = (v: string) => { if (target === "new") newCfg.value.modelRoot = v; else cfg.value.modelRoot = v; };
  if (isTauri()) {
    const cur = target === "new" ? newCfg.value.modelRoot : cfg.value.modelRoot;
    const native = await pickDirectory(cur);
    if (!native) return;
    setVal(native);
    pendingModel.value = null;
    return;
  }
  const res = await readModelCmpFiles();
  if (!res) return;
  // 浏览器:文件夹"名"加 browser:: 前缀,避免冒充绝对路径
  setVal(`${BROWSER_MARK}${res.root}`);
  pendingModel.value = { root: `${BROWSER_MARK}${res.root}`, contents: res.contents };
  c.info("import", `已选目录 ${res.root}:${res.contents.length} 个 .cmp(确定后抽取)`);
}

async function pickExportDir(target: "new" | "cfg") {
  const setVal = (v: string) => { if (target === "new") newCfg.value.exportCodeDir = v; else cfg.value.exportCodeDir = v; };
  if (isTauri()) {
    const cur = target === "new" ? newCfg.value.exportCodeDir : cfg.value.exportCodeDir;
    const dir = await pickDirectory(cur);
    if (!dir) return;
    setVal(dir);
    return;
  }
  const handle = await pickWritableDir();
  if (!handle) { c.warning("export", "未选择目录"); return; }
  exportDirHandle.value = handle;
  setVal(`${BROWSER_MARK}${handle.name}`);
  c.info("export", `已选导出目录(可写):${handle.name},生成时将直接写入(浏览器沙箱无法显示绝对路径)`);
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

/** 开始导出流程:无树则跳过选择直接导出整个 catalog(workspace.xml 也可以只含类型空间)。 */
function startExport(target: ExportTarget) {
  exportTarget.value = target;
  // 无树:工作空间 XML 仍允许保存(只含类型空间);C++ 工程也允许(用户类 + 空 behaviors/)。
  if (ws.trees.length === 0) {
    doExport([]);
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

async function exportWorkspaceXml(selectedTreeIds: string[]) {
  if (!ensureExportable()) return;
  const xml = ws.exportWorkspaceXml(ws.workspaceName, selectedTreeIds);
  downloadText(`${ws.workspaceName}.workspace.xml`, xml, "application/xml");
  // 同步写入「最近工作空间」(localStorage 持久),刷新后可直接还原
  ws.rememberRecent(ws.workspaceName, xml);
  const totalTrees = selectedTreeIds.length || ws.trees.length;
  c.success("export", `导出工程包 *.workspace.xml(${totalTrees} 棵树)· 已加入最近工作空间`);
}

async function genProject(selectedTreeIds: string[]) {
  if (!ensureCodegenable()) return;
  const files = ws.generateProjectFiles(selectedTreeIds);

  // 浏览器:已选可写目录句柄 → 直接写入该文件夹(不下载)。
  if (!isTauri()) {
    let handle = exportDirHandle.value;
    if (!handle) {
      handle = await pickWritableDir();
      if (!handle) { c.warning("export", "未选择导出目录,已取消"); return; }
      exportDirHandle.value = handle;
      ws.exportCodeDir = `${BROWSER_MARK}${handle.name}`;
    }
    try {
      const { written, preserved } = await writeFilesToDirHandle(handle, files);
      c.success("export", `生成完整工程:写入 ${written} 个文件 → 文件夹「${handle.name}」${preserved ? `(合并 ${preserved} 个含用户代码的文件)` : ""}`);
    } catch (e) {
      c.warning("export", `写入目录失败:${(e as Error).message}`);
    }
    return;
  }

  // 桌面端:原生路径,写入配置的导出目录(可临时再选)。
  const initial = ws.exportCodeDir.startsWith(BROWSER_MARK) ? "" : ws.exportCodeDir;
  const picked = await pickDirectory(initial);
  if (!picked) return;
  ws.exportCodeDir = picked;
  const out = await writeProjectFiles(picked, files);
  c.success("export", `生成完整工程 ${files.length} 个文件 → ${picked}${out.viaDownload ? "(浏览器逐个下载)" : ""}`);
}

/** 打开本地工作空间(*.workspace.xml):恢复配置 + 类型 + 行为树 + 黑板,然后可继续操作。 */
async function openWorkspace() {
  const f = await readTextFile();
  if (!f) return;
  if (!/<Workspace\b/.test(f.content)) { c.warning("import", "非 *.workspace.xml"); return; }
  ws.importWorkspaceXml(f.content);
  ws.rememberRecent(ws.workspaceName, f.content);
  if (ws.modelRoot && !ws.modelRoot.startsWith(BROWSER_MARK) && isTauri()) {
    const res = await readModelCmpFiles(ws.modelRoot);
    if (res && res.contents.length) ws.parseModelDir(res.root, res.contents);
  }
  c.success("import", `已打开工作空间:${ws.workspaceName}`);
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
    <!-- 顶部操作条 -->
    <div class="page-bar panel">
      <div class="title">
        <span class="dot" />
        <strong>工作空间</strong>
        <span class="ws-name" :title="ws.workspaceName">{{ ws.workspaceName }}</span>
      </div>
      <span class="spacer" />
      <ActionButton label="新建" :primary="true" confirm="将清空当前工作空间,确认?" @run="openNew" />
      <ActionButton label="打开…" @run="openWorkspace" />
      <ActionButton label="保存 XML…" @run="() => startExport('workspace-xml')" />
      <ActionButton label="工作空间配置…" @run="openCfg" />
      <ActionButton label="生成 C++ 工程…" :primary="true" @run="() => startExport('cpp-project')" />
    </div>

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
      <section v-if="!isEmpty" class="card">
        <header class="card-head">
          <span class="card-icon">⚙</span>
          <span class="card-title">工作空间配置</span>
          <span class="spacer" />
          <button class="link" @click="openCfg">编辑配置 →</button>
        </header>
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
          <div class="cfg-row path">
            <span class="cfg-k">模型目录</span>
            <span class="cfg-v path-v" :class="{ unset: !ws.modelRoot }">
              <span v-if="modelPath.isBrowserName" class="path-prefix" title="浏览器沙箱限制:无法获取绝对路径,只能保留文件夹名">浏览器:</span>
              <span class="path-text mono"
                :title="ws.modelRoot ? (modelPath.isBrowserName ? `浏览器选择的文件夹「${modelPath.text}」· 出于安全沙箱限制无法暴露绝对路径,如需绝对路径请在 Tauri 桌面端打开` : ws.modelRoot) : '未配置 — 点「编辑配置」选择 FZFOSimModel 目录'">
                {{ modelPath.text || "未配置" }}
              </span>
              <button v-if="ws.modelRoot && !modelPath.isBrowserName" class="copy" :title="`复制 ${modelPath.text}`" @click="copyText(modelPath.text, '模型目录')">⧉</button>
            </span>
          </div>
          <div class="cfg-row path">
            <span class="cfg-k">导出代码目录</span>
            <span class="cfg-v path-v" :class="{ unset: !ws.exportCodeDir }">
              <span v-if="exportPath.isBrowserName" class="path-prefix" title="浏览器沙箱限制:无法获取绝对路径,只能保留文件夹名">浏览器:</span>
              <span class="path-text mono"
                :title="ws.exportCodeDir ? (exportPath.isBrowserName ? `浏览器选择的文件夹「${exportPath.text}」· 已授予读写权限,写入将通过 File System Access API;绝对路径不可见` : ws.exportCodeDir) : '未配置 — 生成 C++ 工程时会要求选择'">
                {{ exportPath.text || "未配置(生成时再选)" }}
              </span>
              <button v-if="ws.exportCodeDir && !exportPath.isBrowserName" class="copy" :title="`复制 ${exportPath.text}`" @click="copyText(exportPath.text, '导出目录')">⧉</button>
            </span>
          </div>
        </div>
        <div v-if="modelPath.isBrowserName || exportPath.isBrowserName" class="path-hint">
          ⓘ 浏览器预览模式无法显示目录绝对路径(File System Access API 安全限制)。在 Tauri 桌面端打开本应用将看到完整绝对路径。
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
      <label class="fld"><span>工作空间名 <em>*</em></span><input class="input" v-model="newCfg.name" placeholder="my_workspace" /></label>
      <label class="fld">
        <span>模型目录 (FZFOSimModel)</span>
        <div class="pick">
          <input class="input" v-model="newCfg.modelRoot" placeholder="如 F:/FOSim/FZFOSimModel" />
          <button class="btn tiny" @click="pickModelDir('new')">选择…</button>
        </div>
      </label>
      <label class="fld">
        <span>C++ 导出代码目录</span>
        <div class="pick">
          <input class="input" v-model="newCfg.exportCodeDir" placeholder="生成 C++ 工程时输出到此目录(可后选)" />
          <button class="btn tiny" @click="pickExportDir('new')">选择…</button>
        </div>
      </label>
      <label class="fld"><span>C++ 命名空间</span><input class="input" v-model="newCfg.cppNamespace" placeholder="btproj" /></label>
      <label class="fld">
        <span>语言</span>
        <select class="select" v-model="newCfg.language">
          <option value="cpp">C++</option>
          <option value="cs">C#</option>
        </select>
      </label>
      <div class="note">将清空当前类型/树/黑板,以上述配置开始新工作空间。配置模型目录后将<strong>自动扫描</strong>,直接到「模型类型抽取」勾选抽取即可。</div>
    </ModalDialog>

    <!-- 工作空间配置对话框 -->
    <ModalDialog :open="cfgOpen" title="工作空间配置" ok-label="应用" @ok="applyCfg" @cancel="cfgOpen = false">
      <label class="fld"><span>工作空间名</span><input class="input" v-model="cfg.name" /></label>
      <label class="fld">
        <span>模型目录 (FZFOSimModel)</span>
        <div class="pick">
          <input class="input" v-model="cfg.modelRoot" placeholder="如 F:/FOSim/FZFOSimModel" />
          <button class="btn tiny" @click="pickModelDir('cfg')">选择…</button>
        </div>
      </label>
      <label class="fld">
        <span>C++ 导出代码目录</span>
        <div class="pick">
          <input class="input" v-model="cfg.exportCodeDir" placeholder="生成 C++ 工程时的输出根目录" />
          <button class="btn tiny" @click="pickExportDir('cfg')">选择…</button>
        </div>
      </label>
      <label class="fld"><span>C++ 命名空间</span><input class="input" v-model="cfg.cppNamespace" placeholder="btproj" /></label>
      <label class="fld">
        <span>语言</span>
        <select class="select" v-model="cfg.language">
          <option value="cpp">C++</option>
          <option value="cs">C#</option>
        </select>
      </label>
      <div class="note">生成完整工程将在「导出代码目录」下产出:用户 Agent 类(继承 CyberDecisionAgentBase)+ RegisterFunctions + 行为树 XML + main.cpp + CMakeLists。改动模型目录后将自动重扫。</div>
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

/* 配置卡 */
.cfg-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px;
}
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
.pick { display: flex; gap: 6px; }
.pick .input { flex: 1; }
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
