//! BehaviorLogic 挂接、冲突策略与回滚(文档 §13)。
//!
//! 真实写回需解析 FOSim sdata 结构;此处实现策略/备份/回滚骨架,接入引擎时替换 write_logic。
use crate::fs_ops::atomic_write;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OverwritePolicy {
    Reject,
    Overwrite,
    BackupThenOverwrite,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AttachRequest {
    pub scenario_path: String,
    pub target_object_ref: String,
    pub tree_asset_name: String,
    pub new_content: String,
    pub overwrite_policy: OverwritePolicy,
    pub operator_confirmed: bool,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AttachResult {
    pub success: bool,
    pub scenario_name: String,
    pub target_object_ref: String,
    pub tree_asset_name: String,
    pub conflict_detected: bool,
    pub conflict_summary: Option<String>,
    pub backup_path: Option<String>,
    pub written_file_path: Option<String>,
    pub rollback_applied: bool,
    pub message: String,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

/// 写回 BehaviorLogic。返回结果模型(文档 §13.6)。
pub fn write_logic(req: &AttachRequest) -> AttachResult {
    let mut res = AttachResult {
        target_object_ref: req.target_object_ref.clone(),
        tree_asset_name: req.tree_asset_name.clone(),
        ..Default::default()
    };
    let path = Path::new(&req.scenario_path);
    res.scenario_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    // 1. 写回前校验:目标文件必须存在
    if !path.exists() {
        res.errors.push(format!("BehaviorLogic 写回目标不存在: {}", req.scenario_path));
        res.message = "目标文件不存在,写回失败".into();
        return res;
    }
    if !req.operator_confirmed {
        res.errors.push("操作员未确认".into());
        res.message = "未确认,写回中止".into();
        return res;
    }

    // 2. 冲突检测(骨架:目标文件已含资产名即视为冲突)
    let original = fs::read_to_string(path).unwrap_or_default();
    res.conflict_detected = original.contains(&req.tree_asset_name);
    if res.conflict_detected {
        res.conflict_summary = Some(format!("目标已挂接 {}", req.tree_asset_name));
        if req.overwrite_policy == OverwritePolicy::Reject {
            res.errors.push("存在冲突且策略为 reject".into());
            res.message = "冲突未处理,写回被拒绝".into();
            return res;
        }
    }

    // 3. 备份
    if req.overwrite_policy == OverwritePolicy::BackupThenOverwrite {
        let backup = format!("{}.bak", req.scenario_path);
        if let Err(e) = fs::copy(path, &backup) {
            res.errors.push(format!("备份失败: {e}"));
            res.message = "备份失败,写回中止".into();
            return res;
        }
        res.backup_path = Some(backup);
    }

    // 4. 原子写入新内容;失败则回滚
    match atomic_write(path, &req.new_content) {
        Ok(()) => {
            res.success = true;
            res.written_file_path = Some(req.scenario_path.clone());
            res.message = "写回成功".into();
        }
        Err(e) => {
            res.errors.push(format!("写入失败: {e}"));
            if let Some(bk) = &res.backup_path {
                if fs::copy(bk, path).is_ok() {
                    res.rollback_applied = true;
                    res.message = "写入失败,已回滚".into();
                } else {
                    res.message = format!("写入失败且回滚失败,人工恢复路径: {bk}");
                }
            } else {
                res.message = "写入失败,原文件未改动".into();
            }
        }
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tmp(name: &str) -> String {
        let mut p = env::temp_dir();
        p.push(name);
        p.to_string_lossy().to_string()
    }

    #[test]
    fn missing_target_fails() {
        let req = AttachRequest {
            scenario_path: tmp("bt_no_such_scenario_xyz.sdata"),
            target_object_ref: "obj".into(),
            tree_asset_name: "t".into(),
            new_content: "x".into(),
            overwrite_policy: OverwritePolicy::BackupThenOverwrite,
            operator_confirmed: true,
        };
        let res = write_logic(&req);
        assert!(!res.success);
        assert!(res.errors.iter().any(|e| e.contains("不存在")));
    }

    #[test]
    fn reject_policy_blocks_conflict() {
        let path = tmp("bt_conflict_scenario.sdata");
        fs::write(&path, "<sdata>tree_existing</sdata>").unwrap();
        let req = AttachRequest {
            scenario_path: path.clone(),
            target_object_ref: "obj".into(),
            tree_asset_name: "tree_existing".into(),
            new_content: "<sdata>new</sdata>".into(),
            overwrite_policy: OverwritePolicy::Reject,
            operator_confirmed: true,
        };
        let res = write_logic(&req);
        assert!(!res.success);
        assert!(res.conflict_detected);
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn backup_then_overwrite_succeeds() {
        let path = tmp("bt_ok_scenario.sdata");
        fs::write(&path, "<sdata>orig</sdata>").unwrap();
        let req = AttachRequest {
            scenario_path: path.clone(),
            target_object_ref: "obj".into(),
            tree_asset_name: "tree_new".into(),
            new_content: "<sdata>tree_new</sdata>".into(),
            overwrite_policy: OverwritePolicy::BackupThenOverwrite,
            operator_confirmed: true,
        };
        let res = write_logic(&req);
        assert!(res.success);
        assert!(res.backup_path.is_some());
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(format!("{path}.bak"));
    }
}
