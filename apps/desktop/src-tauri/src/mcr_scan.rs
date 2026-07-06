//! 扫描 FOSim 老引擎的 .mcr 文件(Model Class Registry / 实体模板)。
//! 目录规范:`<modelRoot>/ModelDatabase/FZMCR/<category>/<name>.mcr`
//! 前端 bt-core 的 mcr.ts 负责真正的解析;这里只做递归读盘并附上父目录名做分类。
use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct McrEntry {
    /// 文件名去后缀:F16 / 卫星 / HQ-9A地导系统
    pub template_name: String,
    /// 父目录名:飞机 / 舰船 / ... 兜底 ""
    pub category: String,
    /// 完整磁盘路径
    pub path: String,
    /// 原始 XML 文本
    pub xml: String,
}

#[derive(Debug, Serialize, Default)]
pub struct McrScanResult {
    pub root: String,
    pub templates: Vec<McrEntry>,
    pub missing: bool,
}

/// 在 root 下寻找 ModelDatabase/FZMCR,若不存在则直接在 root 下扫。
pub fn scan_mcr(root: &str) -> McrScanResult {
    let mut out = McrScanResult { root: root.to_string(), ..Default::default() };
    let base = {
        let p = Path::new(root).join("ModelDatabase").join("FZMCR");
        if p.exists() { p } else { Path::new(root).to_path_buf() }
    };
    if !base.exists() {
        out.missing = true;
        return out;
    }
    for e in WalkDir::new(&base).max_depth(4).into_iter().flatten() {
        if !e.file_type().is_file() { continue; }
        if e.path().extension().and_then(|x| x.to_str()) != Some("mcr") { continue; }
        let template_name = e
            .path()
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("mcr")
            .to_string();
        // 父目录名作为 category(FZMCR 目录下的分类文件夹)
        let category = e
            .path()
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let xml = match std::fs::read_to_string(e.path()) {
            Ok(s) => s,
            Err(_) => continue,
        };
        out.templates.push(McrEntry {
            template_name,
            category,
            path: e.path().to_string_lossy().to_string(),
            xml,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_missing() {
        let r = scan_mcr("F:/__no_such_mcr_root__");
        assert!(r.missing);
    }
}
