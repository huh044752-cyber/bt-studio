//! BT Studio 桌面宿主本地服务层(Rust)。
//! 提供文件原子写入、工程包 ZIP、工作区扫描、BehaviorLogic 写回/回滚、stub 运行时。
//! 前端在非 Tauri(浏览器预览)环境会自动降级,这些命令仅在桌面应用中生效。

pub mod behaviorlogic;
pub mod fs_ops;
pub mod model_scan;
pub mod runtime;
pub mod scenario;
pub mod workspace_scan;
pub mod zip_ops;

use std::collections::HashMap;
use std::path::Path;

#[tauri::command]
fn write_runtime_xml(path: String, content: String) -> Result<String, String> {
    fs_ops::atomic_write(Path::new(&path), &content).map_err(|e| e.to_string())?;
    Ok(path)
}

#[derive(serde::Serialize)]
struct TextFile {
    name: String,
    content: String,
    /// 绝对路径(read_text_path 已知路径填回,open_text_file 由对话框拿到)。前端记入 workspaceFilePath。
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

#[tauri::command]
fn read_text_path(path: String) -> Result<TextFile, String> {
    let content = fs_ops::read_text(Path::new(&path)).map_err(|e| e.to_string())?;
    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    Ok(TextFile { name, content, path: Some(path) })
}

#[tauri::command]
fn scan_workspace(root: String) -> workspace_scan::WorkspaceIndex {
    workspace_scan::scan_workspace(&root)
}

#[tauri::command]
fn export_project_package_zip(path: String, entries: HashMap<String, String>) -> Result<String, String> {
    let bytes = zip_ops::pack(&entries)?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
fn scenario_attach(req: behaviorlogic::AttachRequest) -> behaviorlogic::AttachResult {
    behaviorlogic::write_logic(&req)
}

#[tauri::command]
fn runtime_load(xml: String) -> runtime::LoadResult {
    runtime::load_tree(&xml)
}

/// 后台运行 N 帧,返回轨迹 + 错误(供"运行/调试"接入后台数据)。
#[tauri::command]
fn runtime_run(xml: String, ticks: u32) -> runtime::RunResult {
    runtime::run_tree(&xml, ticks)
}

#[tauri::command]
fn scan_model_cmp(root: String) -> model_scan::CmpScanResult {
    model_scan::scan_model_cmp(&root)
}

#[tauri::command]
fn scan_scenarios(root: String) -> scenario::ScenarioScanResult {
    scenario::scan_scenarios(&root)
}

#[tauri::command]
fn write_scenario(path: String, content: String, backup: bool) -> scenario::WriteResult {
    scenario::write_scenario(&path, &content, backup)
}

/// 弹出原生文件夹选择对话框,返回选中的目录(取消返回 None)。
/// 在单独线程运行以避免与主事件循环冲突。
#[tauri::command]
fn pick_directory(default_path: Option<String>) -> Option<String> {
    std::thread::spawn(move || {
        let mut dialog = rfd::FileDialog::new();
        if let Some(p) = default_path {
            if !p.is_empty() && Path::new(&p).is_dir() {
                dialog = dialog.set_directory(&p);
            }
        }
        dialog
            .pick_folder()
            .map(|pb| pb.to_string_lossy().to_string())
    })
    .join()
    .ok()
    .flatten()
}

#[derive(serde::Deserialize)]
struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

/// 原生打开对话框 → 读文件文本。取消/失败返回 None(前端会降级到浏览器 <input type=file>)。
#[tauri::command]
fn open_text_file(
    filters: Option<Vec<FileFilter>>,
    default_dir: Option<String>,
) -> Option<TextFile> {
    let picked: Option<String> = std::thread::spawn(move || {
        let mut dialog = rfd::FileDialog::new();
        if let Some(d) = default_dir {
            if !d.is_empty() && Path::new(&d).is_dir() {
                dialog = dialog.set_directory(&d);
            }
        }
        if let Some(fs) = filters {
            for f in fs {
                let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
                dialog = dialog.add_filter(&f.name, &exts);
            }
        }
        dialog.pick_file().map(|p| p.to_string_lossy().to_string())
    })
    .join()
    .ok()
    .flatten();
    let path = picked?;
    let content = fs_ops::read_text(Path::new(&path)).ok()?;
    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    Some(TextFile { name, content, path: Some(path) })
}

/// 原生"另存为"对话框,只返回选中的路径,不写文件(用户在"工作空间配置"里
/// 挑一个未来保存的位置,配置阶段不该产生空文件)。取消返回 None。
#[tauri::command]
fn pick_save_file_path(
    default_name: Option<String>,
    default_dir: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Option<String> {
    std::thread::spawn(move || {
        let mut dialog = rfd::FileDialog::new();
        if let Some(d) = default_dir {
            if !d.is_empty() && Path::new(&d).is_dir() {
                dialog = dialog.set_directory(&d);
            }
        }
        if let Some(n) = default_name {
            if !n.is_empty() {
                dialog = dialog.set_file_name(&n);
            }
        }
        if let Some(fs) = filters {
            for f in fs {
                let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
                dialog = dialog.add_filter(&f.name, &exts);
            }
        }
        dialog.save_file().map(|p| p.to_string_lossy().to_string())
    })
    .join()
    .ok()
    .flatten()
}

/// 原生"另存为"对话框 → 原子写入选中文件,返回最终路径(取消返回 None)。
#[tauri::command]
fn save_text_file(
    default_name: Option<String>,
    default_dir: Option<String>,
    filters: Option<Vec<FileFilter>>,
    content: String,
) -> Result<Option<String>, String> {
    let picked: Option<String> = std::thread::spawn(move || {
        let mut dialog = rfd::FileDialog::new();
        if let Some(d) = default_dir {
            if !d.is_empty() && Path::new(&d).is_dir() {
                dialog = dialog.set_directory(&d);
            }
        }
        if let Some(n) = default_name {
            if !n.is_empty() {
                dialog = dialog.set_file_name(&n);
            }
        }
        if let Some(fs) = filters {
            for f in fs {
                let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
                dialog = dialog.add_filter(&f.name, &exts);
            }
        }
        dialog.save_file().map(|p| p.to_string_lossy().to_string())
    })
    .join()
    .ok()
    .flatten();
    let Some(path) = picked else {
        return Ok(None);
    };
    fs_ops::atomic_write(Path::new(&path), &content).map_err(|e| e.to_string())?;
    Ok(Some(path))
}

#[derive(serde::Serialize)]
struct VendorResult {
    copied: usize,
    headers: usize,
    sources: usize,
    message: String,
}

/// 把真实引擎的 BT/FSM 运行时(modules/extern)+ MAL 拷贝进生成工程的 runtime/(不改源码)。
/// - 头文件:整棵 include/FOSim/Engine 复制到 dest/runtime/include(保证 include 解析)。
/// - 源文件:仅复制可独立编译的 loader(bt_xml_loader / behavior_node_agent / state_machine_loader /
///   state_machine_agent)+ MAL 实现到 dest/runtime/src;业务耦合的 bt_runtime/state_machine_runtime/agent
///   需链接引擎库,默认不复制(避免缺业务符号无法编译)。
#[tauri::command]
fn vendor_engine_runtime(engine_dir: String, dest_dir: String) -> Result<VendorResult, String> {
    let engine = Path::new(&engine_dir);
    let dest_runtime = Path::new(&dest_dir).join("runtime");
    let inc_src = engine.join("include/FOSim/Engine");
    if !inc_src.is_dir() {
        return Err(format!("引擎 include 目录不存在: {}", inc_src.display()));
    }
    // 1) 复制整棵 include 树(头文件,verbatim)
    let inc_dst = dest_runtime.join("include/FOSim/Engine");
    let headers = fs_ops::copy_dir_filtered(&inc_src, &inc_dst, &[".h", ".hpp", ".inl"])
        .map_err(|e| e.to_string())?;
    // 2) 把【整个 modules/extern + core/mal】源码导出为库(保留子目录结构,verbatim 不魔改)。
    let src_dst = dest_runtime.join("src");
    let mut sources = 0usize;
    for sub in ["modules/extern", "core/mal"] {
        let from = engine.join("src").join(sub);
        if !from.is_dir() {
            continue;
        }
        let to = src_dst.join(sub);
        sources += fs_ops::copy_dir_filtered(&from, &to, &[".cpp", ".cc", ".cxx"])
            .map_err(|e| e.to_string())?;
    }
    // 真实引擎已就位:移除自包含骨架,避免与真实 loader/MAL 符号冲突。
    if sources > 0 {
        let _ = std::fs::remove_file(src_dst.join("bt_runtime.cpp"));
        let _ = std::fs::remove_dir_all(dest_runtime.join("include/fosim"));
    }
    Ok(VendorResult {
        copied: headers + sources,
        headers,
        sources,
        message: format!(
            "已把真实引擎 modules/extern + core/mal 导出为库:{headers} 个头文件 + {sources} 个源文件 → {};\
             并移除自包含骨架(fosim/ 与 bt_runtime.cpp)。业务耦合的 bt_runtime/agent 需链接引擎库;\
             types/ 下生成代码的 include 需指向真实头文件路径。",
            dest_runtime.display()
        ),
    })
}

/// 批量把生成的工程文件写入 dir 下的相对路径(原子写)。
#[tauri::command]
fn write_project_files(dir: String, files: HashMap<String, String>) -> Result<usize, String> {
    let base = Path::new(&dir);
    let mut count = 0;
    for (rel, content) in &files {
        let p = base.join(rel);
        // 已存在且含保留区:合并,保留用户在 <<<BEGIN..END>> 内手写的代码。
        let to_write = if p.is_file() && content.contains("///<<< BEGIN WRITING YOUR CODE") {
            match fs_ops::read_text(&p) {
                Ok(old) => fs_ops::merge_preserved_regions(&old, content),
                Err(_) => content.clone(),
            }
        } else {
            content.clone()
        };
        fs_ops::atomic_write(&p, &to_write).map_err(|e| format!("{rel}: {e}"))?;
        count += 1;
    }
    Ok(count)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            write_runtime_xml,
            read_text_path,
            scan_workspace,
            export_project_package_zip,
            scenario_attach,
            runtime_load,
            runtime_run,
            scan_model_cmp,
            scan_scenarios,
            write_scenario,
            pick_directory,
            open_text_file,
            save_text_file,
            pick_save_file_path,
            vendor_engine_runtime,
            write_project_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BT Studio");
}
