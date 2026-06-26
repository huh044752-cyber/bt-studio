//! 原子写入与基础文件操作(文档 §7.2:导出失败不得覆盖旧文件)。
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 原子写入:先写临时文件,成功后再替换正式文件;失败时正式文件保持不变。
pub fn atomic_write(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let tmp: PathBuf = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("out")
    ));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    // 替换正式文件
    fs::rename(&tmp, path)?;
    Ok(())
}

/// 读取文本文件。
pub fn read_text(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

/// 递归复制目录,只复制后缀在 `exts` 内的文件(用于把引擎头文件整棵 verbatim 拷贝)。返回复制的文件数。
pub fn copy_dir_filtered(src: &Path, dst: &Path, exts: &[&str]) -> std::io::Result<usize> {
    let mut count = 0usize;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            count += copy_dir_filtered(&path, &target, exts)?;
        } else if path.is_file() {
            let keep = exts.is_empty()
                || path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| exts.iter().any(|x| x.trim_start_matches('.').eq_ignore_ascii_case(e)))
                    .unwrap_or(false);
            if keep {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&path, &target)?;
                count += 1;
            }
        }
    }
    Ok(count)
}

/// 保留区合并:把 old 中 `///<<< BEGIN WRITING YOUR CODE <tag>` ... `///<<< END WRITING YOUR CODE`
/// 之间用户手写的正文,按 tag 搬进 new(不覆盖)。无标记则原样返回 new。
pub fn merge_preserved_regions(old: &str, new: &str) -> String {
    const BEGIN: &str = "///<<< BEGIN WRITING YOUR CODE ";
    const END: &str = "///<<< END WRITING YOUR CODE";
    if !old.contains(BEGIN) || !new.contains(BEGIN) {
        return new.to_string();
    }
    // 1) 收集旧块:tag -> 正文
    let mut old_blocks: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut search = 0usize;
    while let Some(bpos) = old[search..].find(BEGIN) {
        let abs = search + bpos;
        let tag_start = abs + BEGIN.len();
        let tag_end = old[tag_start..].find('\n').map(|x| tag_start + x).unwrap_or(old.len());
        let tag = old[tag_start..tag_end].trim().to_string();
        let body_start = (tag_end + 1).min(old.len());
        if let Some(epos) = old[body_start..].find(END) {
            let body = old[body_start..body_start + epos].to_string();
            old_blocks.entry(tag).or_insert(body);
            search = body_start + epos + END.len();
        } else {
            break;
        }
    }
    // 2) 用旧正文重建 new
    let mut out = String::new();
    let mut idx = 0usize;
    while let Some(bpos) = new[idx..].find(BEGIN) {
        let abs = idx + bpos;
        let tag_start = abs + BEGIN.len();
        let tag_end = new[tag_start..].find('\n').map(|x| tag_start + x).unwrap_or(new.len());
        let tag = new[tag_start..tag_end].trim().to_string();
        let body_start = (tag_end + 1).min(new.len());
        if let Some(epos) = new[body_start..].find(END) {
            let new_body_end = body_start + epos;
            out.push_str(&new[idx..body_start]); // 含 BEGIN 行
            match old_blocks.get(&tag) {
                Some(old_body) => out.push_str(old_body),
                None => out.push_str(&new[body_start..new_body_end]),
            }
            out.push_str(END);
            idx = new_body_end + END.len();
        } else {
            break;
        }
    }
    out.push_str(&new[idx..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn merge_keeps_user_code() {
        let old = "void f() {\n///<<< BEGIN WRITING YOUR CODE f\n  int x = 42; // user\n///<<< END WRITING YOUR CODE\n}\n";
        let new = "void f() {\n///<<< BEGIN WRITING YOUR CODE f\n  // TODO\n///<<< END WRITING YOUR CODE\n}\n";
        let merged = merge_preserved_regions(old, new);
        assert!(merged.contains("int x = 42; // user"));
        assert!(!merged.contains("// TODO"));
    }
    #[test]
    fn merge_no_marker_returns_new() {
        assert_eq!(merge_preserved_regions("old", "new code"), "new code");
    }

    #[test]
    fn atomic_write_creates_file() {
        let mut p = env::temp_dir();
        p.push("bt_studio_atomic_test.bt.xml");
        let _ = fs::remove_file(&p);
        atomic_write(&p, "<Root/>").unwrap();
        assert_eq!(read_text(&p).unwrap(), "<Root/>");
        fs::remove_file(&p).unwrap();
    }

    #[test]
    fn atomic_write_replaces_existing() {
        let mut p = env::temp_dir();
        p.push("bt_studio_atomic_replace.bt.xml");
        atomic_write(&p, "old").unwrap();
        atomic_write(&p, "new").unwrap();
        assert_eq!(read_text(&p).unwrap(), "new");
        fs::remove_file(&p).unwrap();
    }
}
