//! 扫描真实 FOSim 模型目录,收集 *.cmp 文件内容(R1)。
//! 解析在前端 bt-core(parseCmpFiles)完成,这里只负责读盘。
use serde::Serialize;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Default)]
pub struct CmpScanResult {
    pub root: String,
    pub files: Vec<CmpFile>,
    pub missing: bool,
}

#[derive(Debug, Serialize)]
pub struct CmpFile {
    pub path: String,
    pub content: String,
}

/// 在 root(如 F:\FOSim\FZFOSimModel)下递归收集 *.cmp。
/// 优先 ModelSource,其次整个 root。
pub fn scan_model_cmp(root: &str) -> CmpScanResult {
    let mut out = CmpScanResult { root: root.to_string(), ..Default::default() };
    let base = std::path::Path::new(root);
    if !base.exists() {
        out.missing = true;
        return out;
    }
    for e in WalkDir::new(base).into_iter().flatten() {
        if e.file_type().is_file()
            && e.path().extension().and_then(|x| x.to_str()) == Some("cmp")
        {
            if let Ok(content) = std::fs::read_to_string(e.path()) {
                out.files.push(CmpFile {
                    path: e.path().to_string_lossy().to_string(),
                    content,
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_root() {
        let r = scan_model_cmp("F:/__no_such_model_root__");
        assert!(r.missing);
        assert_eq!(r.files.len(), 0);
    }
}
