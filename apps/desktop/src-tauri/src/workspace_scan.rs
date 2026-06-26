//! Linked FOSim 工作区扫描(文档 §5.12)。索引 ModelDatabase / ScenarioSource。
use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Default)]
pub struct WorkspaceIndex {
    pub root: String,
    pub behavior_trees: Vec<String>,
    pub scenarios: Vec<String>,
    pub missing_dirs: Vec<String>,
}

/// 扫描工作区:ModelDatabase/BehaviacTree 下的 *.bt,ScenarioSource 下的 *.sdata。
pub fn scan_workspace(root: &str) -> WorkspaceIndex {
    let mut idx = WorkspaceIndex {
        root: root.to_string(),
        ..Default::default()
    };
    let model_db = Path::new(root).join("ModelDatabase");
    let scenario_src = Path::new(root).join("ScenarioSource");

    if model_db.exists() {
        for e in WalkDir::new(&model_db).into_iter().flatten() {
            if e.file_type().is_file() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some("bt") {
                    idx.behavior_trees.push(p.to_string_lossy().to_string());
                }
            }
        }
    } else {
        idx.missing_dirs.push(model_db.to_string_lossy().to_string());
    }

    if scenario_src.exists() {
        for e in WalkDir::new(&scenario_src).into_iter().flatten() {
            if e.file_type().is_file() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some("sdata") {
                    idx.scenarios.push(p.to_string_lossy().to_string());
                }
            }
        }
    } else {
        idx.missing_dirs.push(scenario_src.to_string_lossy().to_string());
    }

    idx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_dirs_reported() {
        let idx = scan_workspace("F:/__bt_studio_no_such_root__");
        assert_eq!(idx.missing_dirs.len(), 2);
    }
}
