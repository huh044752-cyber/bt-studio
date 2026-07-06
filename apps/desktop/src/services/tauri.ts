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

/** 通用调用:Tauri 优先,否则返回 null 让调用方走浏览器降级。 */
export async function invokeOpt<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; data: null }> {
  const invoke = await getInvoke();
  if (!invoke) return { ok: false, data: null };
  const data = await invoke<T>(cmd, args);
  return { ok: true, data };
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
  createWritable(): Promise<FsWritable>;
  getFile(): Promise<FsFile>;
}
export interface FsDirHandle {
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  requestPermission?(opts: { mode: string }): Promise<string>;
  queryPermission?(opts: { mode: string }): Promise<string>;
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

const ENGINE_CORE_CMAKE = `# fosim_engine_core —— 从 FOSim 引擎 modules/extern 抽取的【真实】行为树/状态机核心库:
#   bt_xml_loader(Action/Sequence/Selector/… 节点 XML 解析)+ bt_runtime(映射/绑定/调度)
#   + state_machine_*(状态机)+ core/mal(CyberMalImpl)+ pugi(XML)。verbatim,不魔改。
# 注意:bt_runtime.cpp / agent.cpp 引用引擎业务头(models/cognition、modules/unit、CyberSimIO 等),
#       需把引擎 include 根加入 ENGINE_EXTRA_INCLUDE 才能完整编译;仅解析(bt_xml_loader)可独立编译。
cmake_minimum_required(VERSION 3.16)
set(ENGINE_EXTRA_INCLUDE "" CACHE PATH "FOSim 引擎 include 根(用于解析 bt_runtime 引用的业务头)")

file(GLOB_RECURSE ENGINE_CORE_SOURCES "\${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")
add_library(fosim_engine_core STATIC \${ENGINE_CORE_SOURCES})
target_include_directories(fosim_engine_core PUBLIC
    "\${CMAKE_CURRENT_SOURCE_DIR}/include"
    "\${CMAKE_CURRENT_SOURCE_DIR}/include/FOSim/Engine")
if(ENGINE_EXTRA_INCLUDE)
    target_include_directories(fosim_engine_core PUBLIC "\${ENGINE_EXTRA_INCLUDE}")
endif()
set_target_properties(fosim_engine_core PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
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

/** 扫描 <modelRoot>/ModelDatabase/FZMCR/**\/*.mcr(Tauri);浏览器返回 null,提示需桌面端。 */
export interface ScannedMcrFile {
  path: string;
  templateName: string;
  category: string;
  xml: string;
}
export async function scanMcrTemplates(root: string): Promise<ScannedMcrFile[] | null> {
  const res = await invokeOpt<{
    root: string;
    templates: { template_name: string; category: string; path: string; xml: string }[];
    missing: boolean;
  }>("scan_mcr", { root });
  if (!res.ok) return null;
  if (res.data.missing) return [];
  return res.data.templates.map((t) => ({
    path: t.path,
    templateName: t.template_name,
    category: t.category,
    xml: t.xml,
  }));
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

/** 选择文件读取(Tauri dialog);浏览器下用 <input type=file>。 */
export async function readTextFile(): Promise<{ name: string; content: string } | null> {
  const res = await invokeOpt<{ name: string; content: string }>("open_text_file");
  if (res.ok) return res.data;
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml,.bt,.json,.zip";
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
