/**
 * Tauri 桥接层 (Tauri-only)。
 *
 * BT Studio 现在只以 Tauri 桌面 exe 形式交付。所有文件/对话框操作都走本 crate 的
 * #[tauri::command] 直调:成功返回数据,失败 throw Error。历史上曾支持"vite 预览
 * 浏览器降级 → downloadText / showSaveFilePicker / webkitdirectory / FileSystem
 * Access API",给用户造成"配了 modelRoot 挂接却在下载"的误导,已经全部移除。
 *
 * 应用启动时 App.vue 会检查 isTauri();非 Tauri 环境显示阻断页,不再让用户误入。
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** 当前运行在 Tauri 桌面 webview 里 (window.__TAURI_INTERNALS__ 由 Tauri 注入)。 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 直接调用 Tauri #[tauri::command]。非 Tauri 环境 (vite 预览浏览器) 直接抛错,
 * 让 UI 明确暴露"这不是桌面 App"—— 而不是静默走下载假成功。
 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri 环境未就绪:命令 ${cmd} 只能在桌面 exe 中调用。请从 BT Studio 桌面版启动。`);
  }
  return (await tauriInvoke(cmd, args)) as T;
}

/**
 * 写运行资产:原子写盘 (临时文件->替换)。返回真实绝对路径。
 * 失败 (路径不存在/权限拒绝) 直接 throw。
 */
export async function writeArtifact(path: string, content: string): Promise<{ path: string }> {
  const written = await invoke<string>("write_runtime_xml", { path, content });
  return { path: written };
}

export interface ScannedModelFile { path: string; content: string }
export interface ScannedModelDir {
  root: string;
  contents: string[];       // 老调用方:.cmp 内容数组
  files: ScannedModelFile[]; // .cmp 文件 (路径+内容,供按 baseName 配对)
  muiFiles: ScannedModelFile[]; // 老版 .mui 文件
}

/**
 * 选中模型目录后由 Rust 递归扫描 *.cmp / *.mui,返回全部内容。
 * root 必传 (来自"工作空间配置"里选好的 modelRoot)。
 */
export async function readModelCmpFiles(root: string): Promise<ScannedModelDir> {
  const res = await invoke<{
    root: string;
    files: { path: string; content: string }[];
    mui_files?: { path: string; content: string }[];
    missing: boolean;
  }>("scan_model_cmp", { root });
  if (res.missing) return { root, contents: [], files: [], muiFiles: [] };
  return {
    root: res.root,
    contents: res.files.map((f) => f.content),
    files: res.files,
    muiFiles: res.mui_files ?? [],
  };
}

/**
 * 选择目录 (原生对话框)。取消返回 null。
 */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  return await invoke<string | null>("pick_directory", { defaultPath: defaultPath ?? null });
}

/**
 * 把真实引擎 BT/FSM 运行时 (modules/extern) + MAL 拷贝进生成工程的 runtime/。
 * 失败 throw。
 */
export async function vendorEngineRuntime(
  engineDir: string,
  destDir: string,
): Promise<{ copied: number; headers: number; sources: number; message: string }> {
  return await invoke("vendor_engine_runtime", { engineDir, destDir });
}

/**
 * 取应用内置的【真实引擎运行时核心库】(modules/extern + core/mal + pugi,verbatim),
 * 返回放到工程 runtime/ 下的文件集。走 tauri:// 协议加载打包资源。
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

/**
 * 把一整个文件集写到指定目录,保留 ///<<< BEGIN WRITING YOUR CODE 用户区。
 * 失败 throw。
 */
export async function writeProjectFiles(
  dir: string,
  files: { path: string; content: string }[],
): Promise<{ count: number }> {
  const map: Record<string, string> = {};
  for (const f of files) map[f.path] = f.content;
  const count = await invoke<number>("write_project_files", { dir, files: map });
  return { count };
}

/** 扫描场景目录,返回 .sdata 清单 (空目录返回空数组)。 */
export async function scanScenarios(root: string): Promise<{ name: string; sdataPath: string }[]> {
  const res = await invoke<{ scenarios: { name: string; sdata_path: string }[]; missing: boolean }>(
    "scan_scenarios",
    { root },
  );
  return res.scenarios.map((s) => ({ name: s.name, sdataPath: s.sdata_path }));
}

/** 读取指定路径文本。失败/文件不存在返回 null。 */
export async function readPathText(path: string): Promise<string | null> {
  try {
    const res = await invoke<{ name: string; content: string }>("read_text_path", { path });
    return res.content;
  } catch {
    return null;
  }
}

/** 带备份写回场景。 */
export async function writeScenarioFile(
  path: string,
  content: string,
  backup = true,
): Promise<{ ok: boolean; path: string; backupPath?: string }> {
  const res = await invoke<{ ok: boolean; path: string; backup_path?: string }>("write_scenario", {
    path,
    content,
    backup,
  });
  return { ok: res.ok, path: res.path, backupPath: res.backup_path };
}

export interface FileFilter { name: string; extensions: string[] }
export interface OpenedTextFile { name: string; content: string; path?: string }

/**
 * 原生"打开文件"对话框,读文本。取消返回 null。
 */
export async function readTextFile(
  filters?: FileFilter[],
  defaultDir?: string,
): Promise<OpenedTextFile | null> {
  return await invoke<OpenedTextFile | null>("open_text_file", { filters, defaultDir });
}

/**
 * 原生"另存为"对话框 + 写盘。取消返回 null。
 */
export async function saveTextFile(
  defaultName: string,
  content: string,
  opts: { defaultDir?: string; filters?: FileFilter[] } = {},
): Promise<{ path: string } | null> {
  const p = await invoke<string | null>("save_text_file", {
    defaultName,
    defaultDir: opts.defaultDir,
    filters: opts.filters,
    content,
  });
  if (!p) return null;
  return { path: p };
}

/**
 * "选择保存位置"对话框,只返回路径不写盘 (用户在"工作空间配置"里挑保存位置,
 * 配置阶段不产生空文件)。取消返回 null。
 */
export async function pickSaveFilePath(
  defaultName: string,
  opts: { defaultDir?: string; filters?: FileFilter[] } = {},
): Promise<string | null> {
  return await invoke<string | null>("pick_save_file_path", {
    defaultName,
    defaultDir: opts.defaultDir,
    filters: opts.filters,
  });
}
