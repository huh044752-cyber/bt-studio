/**
 * Tauri 桥接层。在 Tauri 中走 invoke;在纯浏览器(vite 预览)中降级为浏览器实现,
 * 保证设计/校验/导出主链路无需 Rust 后端即可演示。
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn | null> {
  if (!isTauri()) return null;
  if (cachedInvoke) return cachedInvoke;
  const mod = await import("@tauri-apps/api/core");
  cachedInvoke = mod.invoke as InvokeFn;
  return cachedInvoke;
}

/** 通用调用:Tauri 优先,否则返回 null 让调用方走浏览器降级。
 *  invoke 本身也 try/catch —— Rust 侧命令未注册(dev 阶段 rebuild 前的新命令)/内部 panic 时,
 *  不再一路 throw 让 UI 静默死掉,而是与"未在 Tauri 中"同一路径,让调用方走降级。 */
export async function invokeOpt<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; data: null; error?: string }> {
  const invoke = await getInvoke();
  if (!invoke) return { ok: false, data: null };
  try {
    const data = await invoke<T>(cmd, args);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, data: null, error: String(e) };
  }
}

/** 浏览器降级:把内容作为文件下载。 */
export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 写运行资产:Tauri 下原子写盘(临时文件->替换);浏览器下触发下载。
 * 返回写入路径(或下载文件名)。
 */
export async function writeArtifact(
  path: string,
  content: string,
): Promise<{ path: string; viaDownload: boolean }> {
  const res = await invokeOpt<string>("write_runtime_xml", { path, content });
  if (res.ok) return { path: res.data, viaDownload: false };
  const filename = path.split(/[\\/]/).pop() || "asset.txt";
  downloadText(filename, content);
  return { path: filename, viaDownload: true };
}

/**
 * 选择模型目录并读取所有 *.cmp 内容。
 * Tauri:invoke scan_model_cmp(root);浏览器:webkitdirectory 选目录读取。
 */
export interface ScannedModelFile { path: string; content: string }
export interface ScannedModelDir {
  root: string;
  contents: string[]; // 老调用方:.cmp 内容数组
  files: ScannedModelFile[]; // .cmp 文件(路径+内容,供按 baseName 配对)
  muiFiles: ScannedModelFile[]; // 老版 .mui 文件
}

export async function readModelCmpFiles(
  root?: string,
): Promise<ScannedModelDir | null> {
  if (root) {
    const res = await invokeOpt<{
      root: string;
      files: { path: string; content: string }[];
      mui_files?: { path: string; content: string }[];
      missing: boolean;
    }>("scan_model_cmp", { root });
    if (res.ok) {
      if (res.data.missing) return { root, contents: [], files: [], muiFiles: [] };
      return {
        root: res.data.root,
        contents: res.data.files.map((f) => f.content),
        files: res.data.files,
        muiFiles: res.data.mui_files ?? [],
      };
    }
  }
  // 浏览器降级:目录选择器(从 webkitRelativePath 取真实顶层文件夹名)
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    input.multiple = true;
    input.onchange = async () => {
      const all = [...(input.files ?? [])];
      if (all.length === 0) return resolve(null); // 取消选择
      const rel = (all[0] as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? "";
      const folder = rel ? rel.split("/")[0]! : "选择的目录";
      const cmps = all.filter((f) => f.name.endsWith(".cmp"));
      const muis = all.filter((f) => f.name.endsWith(".mui"));
      const cmpData = await Promise.all(cmps.map(async (f) => ({
        path: (f as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? f.name,
        content: await f.text(),
      })));
      const muiData = await Promise.all(muis.map(async (f) => ({
        path: (f as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? f.name,
        content: await f.text(),
      })));
      resolve({
        root: folder,
        contents: cmpData.map((c) => c.content),
        files: cmpData,
        muiFiles: muiData,
      });
    };
    input.click();
  });
}

// --- 浏览器 File System Access API 最小类型(tsconfig lib 未必带) ---
interface FsFile {
  text(): Promise<string>;
}
interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  name: string;
  createWritable(): Promise<FsWritable>;
  getFile(): Promise<FsFile>;
  requestPermission?(opts: { mode: string }): Promise<string>;
  queryPermission?(opts: { mode: string }): Promise<string>;
}
export interface FsDirHandle {
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  requestPermission?(opts: { mode: string }): Promise<string>;
  queryPermission?(opts: { mode: string }): Promise<string>;
}

/** 浏览器 File System Access API 缓存的文件句柄。前端按 tag 存,后续写入用同一句柄不再弹框。 */
const _savedFileHandles = new Map<string, FsFileHandle>();
const BROWSER_PATH_MARK = "browser::";

/** 浏览器是否有可用的"另存为"API(Chromium 系原生;Firefox/Safari 无)。 */
export function browserHasSaveFilePicker(): boolean {
  return typeof window !== "undefined"
    && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

/**
 * 浏览器 File System Access API 弹"另存为",拿到 FileHandle 并按 tag 缓存。
 * 返回文件名(浏览器沙箱下拿不到绝对路径,前端加 browser:: 前缀展示)。
 * 后续调用 writeToCachedSaveFile(tag, content) 会直接写到用户当初选的那个文件,不再弹框。
 */
async function pickSaveHandleAndCache(
  tag: string,
  suggestedName: string,
  filters?: FileFilter[],
): Promise<string | null> {
  const anyWin = window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FsFileHandle>;
  };
  if (typeof anyWin.showSaveFilePicker !== "function") return null;
  const types = (filters ?? []).map((f) => {
    const exts = f.extensions.map((e) => "." + e.replace(/^\./, ""));
    return { description: f.name, accept: { "application/xml": exts } };
  });
  try {
    const h = await anyWin.showSaveFilePicker({ suggestedName, types });
    _savedFileHandles.set(tag, h);
    return `${BROWSER_PATH_MARK}${h.name}`;
  } catch {
    return null; // 用户取消 / 不支持
  }
}

/**
 * 向按 tag 缓存的 FileHandle 写入文本。没有缓存(用户未选过 or Tauri 模式)→ 返回 null。
 * 权限过期会先请求 readwrite;拒绝则抛错(不静默下载)。
 */
export async function writeToCachedSaveFile(
  tag: string,
  content: string,
): Promise<{ path: string } | null> {
  const h = _savedFileHandles.get(tag);
  if (!h) return null;
  if (h.requestPermission) {
    let perm = "granted";
    if (h.queryPermission) perm = await h.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") perm = await h.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") throw new Error("用户未授予该文件写入权限");
  }
  const w = await h.createWritable();
  await w.write(content);
  await w.close();
  return { path: `${BROWSER_PATH_MARK}${h.name}` };
}

/** 判断某 tag 的浏览器另存句柄是否已缓存(UI 可用它决定"保存"按钮直写还是弹框)。 */
export function hasCachedSaveFile(tag: string): boolean {
  return _savedFileHandles.has(tag);
}

/** 清空某 tag 的缓存句柄(如用户"重新选择位置")。 */
export function clearCachedSaveFile(tag: string): void {
  _savedFileHandles.delete(tag);
}

/**
 * 选择目录:Tauri 用原生文件夹对话框(返回绝对路径);浏览器降级用 File System Access API
 * (只拿到文件夹名,拿不到绝对路径——浏览器安全限制),再不行返回 null。
 */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  const res = await invokeOpt<string | null>("pick_directory", { defaultPath: defaultPath ?? null });
  if (res.ok) return res.data;
  const anyWin = window as unknown as { showDirectoryPicker?: () => Promise<{ name: string }> };
  if (typeof anyWin.showDirectoryPicker === "function") {
    try {
      const handle = await anyWin.showDirectoryPicker();
      return handle.name;
    } catch {
      return null; // 用户取消
    }
  }
  return null;
}

/**
 * 浏览器:选择【可写】目录,返回目录句柄(可真正写入文件)。Tauri 下返回 null(改走原生路径)。
 */
export async function pickWritableDir(): Promise<FsDirHandle | null> {
  if (isTauri()) return null;
  const anyWin = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FsDirHandle>;
  };
  if (typeof anyWin.showDirectoryPicker !== "function") return null;
  try {
    return await anyWin.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return null; // 用户取消
  }
}

/**
 * 浏览器:把文件集写入已选目录句柄(支持 a/b/c.txt 嵌套路径,自动建子目录)。
 * 若目标 .h/.cpp 已存在且新内容含 `///<<< BEGIN WRITING YOUR CODE` 保留区,
 * 走 mergePreservedRegions:用新内容(签名/继承/注册等)覆盖,只保留旧文件保留区内的用户代码。
 * 与 Tauri 的 write_project_files 行为对齐。
 */
export async function writeFilesToDirHandle(
  handle: FsDirHandle,
  files: { path: string; content: string }[],
): Promise<{ written: number; preserved: number }> {
  if (handle.requestPermission) {
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") throw new Error("用户未授予该目录写入权限");
  }
  const { mergePreservedRegions } = await import("@btstudio/bt-core");
  let written = 0;
  let preserved = 0;
  for (const f of files) {
    const parts = f.path.split(/[\\/]/).filter(Boolean);
    const fname = parts.pop()!;
    let dir = handle;
    for (const seg of parts) dir = await dir.getDirectoryHandle(seg, { create: true });
    let toWrite = f.content;
    // 新内容含保留区 + 旧文件已存在 → 合并(签名/继承/注册等用新版,保留区正文用旧版)。
    if (f.content.includes("///<<< BEGIN WRITING YOUR CODE")) {
      try {
        const existing = await dir.getFileHandle(fname, { create: false });
        const old = await (await existing.getFile()).text();
        if (old.includes("///<<< BEGIN WRITING YOUR CODE")) {
          toWrite = mergePreservedRegions(old, f.content);
          preserved++;
        }
      } catch {
        /* 文件不存在:首次生成,正常写入新内容 */
      }
    }
    const fh = await dir.getFileHandle(fname, { create: true });
    const w = await fh.createWritable();
    await w.write(toWrite);
    await w.close();
    written++;
  }
  return { written, preserved };
}

/**
 * 把真实引擎 BT/FSM 运行时(modules/extern)+ MAL 拷贝进生成工程的 runtime/(Tauri,不改源码)。
 * 浏览器无法访问任意磁盘路径,返回 null。
 */
export async function vendorEngineRuntime(
  engineDir: string,
  destDir: string,
): Promise<{ copied: number; headers: number; sources: number; message: string } | null> {
  const res = await invokeOpt<{ copied: number; headers: number; sources: number; message: string }>(
    "vendor_engine_runtime",
    { engineDir, destDir },
  );
  return res.ok ? res.data : null;
}

/**
 * 取应用内置的【真实引擎运行时核心库】(modules/extern + core/mal + pugi,verbatim),
 * 返回放到工程 runtime/ 下的文件集。浏览器预览与桌面端都用同源 fetch(/fosim-runtime/)。
 * 这些是行为树/状态机节点(Action/Sequence/…)的真实 XML 解析(bt_xml_loader)与调度(bt_runtime)。
 */
let _runtimeCache: { path: string; content: string }[] | null = null;
export async function fetchBundledRuntime(): Promise<{ path: string; content: string }[]> {
  if (_runtimeCache) return _runtimeCache;
  const base = `${import.meta.env.BASE_URL ?? "/"}fosim-runtime`;
  const mf = await fetch(`${base}/manifest.json`);
  if (!mf.ok) return [];
  const manifest = (await mf.json()) as { files: string[] };
  const out: { path: string; content: string }[] = [];
  for (const rel of manifest.files) {
    const r = await fetch(`${base}/${rel}`);
    if (r.ok) out.push({ path: `engine-core/${rel}`, content: await r.text() });
  }
  // 真实核心库的 CMake(modules/extern 的 XML 解析 bt_xml_loader + 调度 bt_runtime + MAL + pugi)。
  out.push({ path: "engine-core/CMakeLists.txt", content: ENGINE_CORE_CMAKE });
  _runtimeCache = out;
  return out;
}

const ENGINE_CORE_CMAKE = `# engine-core/ —— FOSim 引擎 modules/extern + core/mal + pugi 的【真实】源码(verbatim,不魔改):
#   include/ = 所有 header (BT/FSM 节点/任务/loader 定义、MAL API、pugi XML)
#   src/     = 所有实现 (bt_xml_loader / state_machine_loader / behavior_node_agent / agent /
#              bt_runtime / state_machine_runtime / register_wrapper / MAL / pugi)
#
# 默认作 INTERFACE 目标(仅暴露 header 路径,不编译源文件):
#   - bt_runtime.cpp / state_machine_runtime.cpp / agent.cpp / behavior_node_agent.cpp 依赖引擎
#     业务头 (FZSimIO/models/modules/core-logging 等),脱离 FOSim 引擎本体无法编译。
#   - 而 header 是自洽的接口定义,skeleton 里的 shim (BT::BTXmlLoader / BT::TreeTask) 与之接口对齐,
#     这样生成工程即使不接 FOSim 也能一键编译并跑通调度。
#
# 接入真实引擎:
#   1. cmake 时加 -DUSE_REAL_ENGINE_LOADER=ON 并指定 -DENGINE_EXTRA_INCLUDE=<FOSim 引擎 include 根>
#   2. 这将改为 STATIC 构建 bt_xml_loader.cpp / state_machine_loader.cpp / register_wrapper.cpp
#      等业务无关的实现文件(shim 里的解析退为兜底)
#   3. 若 ENGINE_EXTRA_INCLUDE 指到完整业务头, 也可以把 bt_runtime.cpp 等业务耦合源加进构建
cmake_minimum_required(VERSION 3.16)
option(USE_REAL_ENGINE_LOADER "编译 modules/extern 里业务无关的 loader/register_wrapper(需要引擎 include)" OFF)
set(ENGINE_EXTRA_INCLUDE "" CACHE PATH "FOSim 引擎 include 根(用于解析业务头)")

add_library(fosim_engine_core INTERFACE)
target_include_directories(fosim_engine_core INTERFACE
    "\${CMAKE_CURRENT_SOURCE_DIR}/include"
    "\${CMAKE_CURRENT_SOURCE_DIR}/include/FOSim/Engine")
if(ENGINE_EXTRA_INCLUDE)
    target_include_directories(fosim_engine_core INTERFACE "\${ENGINE_EXTRA_INCLUDE}")
endif()

if(USE_REAL_ENGINE_LOADER)
    # 业务无关的实现文件(不依赖 FZSimIO/models/modules);升级为 STATIC 与 skeleton 并存时,
    # skeleton 应关闭其自带的 BTXmlLoader 声明避免符号冲突。当前 skeleton 已提供等价 API,
    # 只在你确实想跑真解析器时开启此选项。
    set(REAL_LOADER_SOURCES
        "\${CMAKE_CURRENT_SOURCE_DIR}/src/modules/extern/bt_xml_loader.cpp"
        "\${CMAKE_CURRENT_SOURCE_DIR}/src/modules/extern/state_machine_loader.cpp"
        "\${CMAKE_CURRENT_SOURCE_DIR}/src/modules/extern/register_wrapper.cpp"
        "\${CMAKE_CURRENT_SOURCE_DIR}/src/pugi/pugixml.cpp")
    add_library(fosim_engine_core_loader STATIC \${REAL_LOADER_SOURCES})
    target_link_libraries(fosim_engine_core_loader PUBLIC fosim_engine_core)
    set_target_properties(fosim_engine_core_loader PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
endif()
`;

export async function writeProjectFiles(
  dir: string,
  files: { path: string; content: string }[],
): Promise<{ count: number; viaDownload: boolean }> {
  const map: Record<string, string> = {};
  for (const f of files) map[f.path] = f.content;
  const res = await invokeOpt<number>("write_project_files", { dir, files: map });
  if (res.ok) return { count: res.data, viaDownload: false };
  for (const f of files) downloadText(f.path.replace(/[\\/]/g, "__"), f.content);
  return { count: files.length, viaDownload: true };
}

/** 扫描场景目录(Tauri);浏览器返回 null,改用手动选 .sdata 文件。 */
export async function scanScenarios(
  root: string,
): Promise<{ name: string; sdataPath: string }[] | null> {
  const res = await invokeOpt<{ scenarios: { name: string; sdata_path: string }[]; missing: boolean }>(
    "scan_scenarios",
    { root },
  );
  if (res.ok) return res.data.scenarios.map((s) => ({ name: s.name, sdataPath: s.sdata_path }));
  return null;
}

/** 读取指定路径文本(Tauri);浏览器返回 null。 */
export async function readPathText(path: string): Promise<string | null> {
  const res = await invokeOpt<{ name: string; content: string }>("read_text_path", { path });
  return res.ok ? res.data.content : null;
}

/** 带备份写回场景(Tauri);浏览器降级为下载。 */
export async function writeScenarioFile(
  path: string,
  content: string,
  backup = true,
): Promise<{ ok: boolean; path: string; backupPath?: string; viaDownload: boolean }> {
  const res = await invokeOpt<{ ok: boolean; path: string; backup_path?: string }>("write_scenario", {
    path,
    content,
    backup,
  });
  if (res.ok) return { ok: res.data.ok, path: res.data.path, backupPath: res.data.backup_path, viaDownload: false };
  const filename = path.split(/[\\/]/).pop() || "scenario.sdata";
  downloadText(filename, content);
  return { ok: true, path: filename, viaDownload: true };
}

export interface FileFilter { name: string; extensions: string[] }
export interface OpenedTextFile { name: string; content: string; path?: string }

/**
 * 选择文件读取。
 * Tauri:原生对话框(可传 filters/defaultDir);浏览器:<input type=file>(accept 由 filters 首个决定)。
 * 返回值多一个 path:桌面端是绝对路径,浏览器沙箱下缺失 —— 前端据此决定要不要写回 workspaceFilePath。
 */
export async function readTextFile(
  filters?: FileFilter[],
  defaultDir?: string,
): Promise<OpenedTextFile | null> {
  const res = await invokeOpt<OpenedTextFile>("open_text_file", { filters, defaultDir });
  if (res.ok) return res.data;
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = (filters?.[0]?.extensions ?? ["xml", "bt", "json", "zip"]).map((e) => "." + e).join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, content: String(reader.result ?? "") });
      reader.readAsText(file);
    };
    input.click();
  });
}

/**
 * "另存为"对话框 + 写盘。
 * Tauri:原生 save 对话框,原子写入,返回选中的路径(取消返回 null)。
 * 浏览器:降级为下载,path 返回 defaultName(仅作展示,非真实路径)。
 * 调用方拿 path 记入 workspaceFilePath 供下次静默保存。
 */
export async function saveTextFile(
  defaultName: string,
  content: string,
  opts: { defaultDir?: string; filters?: FileFilter[] } = {},
): Promise<{ path: string; viaDownload: boolean } | null> {
  const res = await invokeOpt<string | null>("save_text_file", {
    defaultName,
    defaultDir: opts.defaultDir,
    filters: opts.filters,
    content,
  });
  if (res.ok) {
    if (!res.data) return null; // 用户取消
    return { path: res.data, viaDownload: false };
  }
  downloadText(defaultName, content, "application/xml");
  return { path: defaultName, viaDownload: true };
}

/**
 * "选择保存位置"对话框。多路径降级:
 *   1) Tauri Rust `pick_save_file_path` —— 原生"另存为"选完整绝对路径
 *   2) Tauri Rust `pick_directory` + 拼 defaultName —— 命令未注册(dev 未 rebuild)/失败时的兜底
 *   3) 浏览器 `showSaveFilePicker` —— 弹原生"另存为",按 saveFileTag 缓存 FileHandle,
 *      后续 writeToCachedSaveFile(tag) 直写不再弹框;返回 "browser::文件名" 记号串
 *   4) 完全无法 —— 返回 null
 *
 * saveFileTag 是浏览器路径专用:同 tag 会复用/覆盖同一句柄。默认 "workspace-xml"。
 */
export async function pickSaveFilePath(
  defaultName: string,
  opts: { defaultDir?: string; filters?: FileFilter[]; saveFileTag?: string } = {},
): Promise<string | null> {
  const res = await invokeOpt<string | null>("pick_save_file_path", {
    defaultName,
    defaultDir: opts.defaultDir,
    filters: opts.filters,
  });
  if (res.ok) return res.data;
  if (isTauri()) {
    const dir = await pickDirectory(opts.defaultDir);
    if (!dir) return null;
    return `${dir.replace(/[\\/]+$/, "")}/${defaultName}`;
  }
  // 浏览器:用 File System Access API 拿真实文件句柄,缓存起来供"保存 XML"直写。
  if (browserHasSaveFilePicker()) {
    return pickSaveHandleAndCache(opts.saveFileTag ?? "workspace-xml", defaultName, opts.filters);
  }
  return null;
}
