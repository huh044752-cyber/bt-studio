//! 场景扫描与写回(R4)。解析/挂接逻辑在前端 bt-core(scenario.ts),这里只读盘/扫描/带备份写回。
use crate::fs_ops::atomic_write;
use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct ScenarioEntry {
    pub name: String,
    pub sdata_path: String,
}

#[derive(Debug, Serialize, Default)]
pub struct ScenarioScanResult {
    pub root: String,
    pub scenarios: Vec<ScenarioEntry>,
    pub missing: bool,
}

/// 扫描 ScenarioSource 下的 *.sdata。
pub fn scan_scenarios(root: &str) -> ScenarioScanResult {
    let mut out = ScenarioScanResult { root: root.to_string(), ..Default::default() };
    // root 可能是 FZFOSimModel 或其 ScenarioSource
    let base = {
        let p = Path::new(root).join("ScenarioSource");
        if p.exists() { p } else { Path::new(root).to_path_buf() }
    };
    if !base.exists() {
        out.missing = true;
        return out;
    }
    for e in WalkDir::new(&base).max_depth(3).into_iter().flatten() {
        if e.file_type().is_file() && e.path().extension().and_then(|x| x.to_str()) == Some("sdata") {
            let name = e
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("scenario")
                .to_string();
            out.scenarios.push(ScenarioEntry {
                name,
                sdata_path: e.path().to_string_lossy().to_string(),
            });
        }
    }
    out
}

#[derive(Debug, Serialize)]
pub struct WriteResult {
    pub ok: bool,
    pub path: String,
    pub backup_path: Option<String>,
    pub message: String,
}

/// 带备份的写回:先复制 path->path.bak,再原子写入新内容。
pub fn write_scenario(path: &str, content: &str, backup: bool) -> WriteResult {
    let p = Path::new(path);
    let mut backup_path = None;
    if backup && p.exists() {
        let bak = format!("{path}.bak");
        if std::fs::copy(p, &bak).is_ok() {
            backup_path = Some(bak);
        }
    }
    match atomic_write(p, content) {
        Ok(()) => WriteResult { ok: true, path: path.to_string(), backup_path, message: "写回成功".into() },
        Err(e) => WriteResult { ok: false, path: path.to_string(), backup_path, message: format!("写回失败: {e}") },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn scan_missing() {
        let r = scan_scenarios("F:/__no_scenario_root__");
        assert!(r.missing);
    }

    #[test]
    fn write_with_backup() {
        let mut p = env::temp_dir();
        p.push("bt_scn_test.sdata");
        let path = p.to_string_lossy().to_string();
        std::fs::write(&path, "<old/>").unwrap();
        let r = write_scenario(&path, "<new/>", true);
        assert!(r.ok);
        assert!(r.backup_path.is_some());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "<new/>");
        let _ = std::fs::remove_file(&path);
        if let Some(b) = r.backup_path { let _ = std::fs::remove_file(b); }
    }
}
