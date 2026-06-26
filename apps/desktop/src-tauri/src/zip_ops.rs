//! 工程包 ZIP 打包/解包(文档 §5.15 Workspace Package Center)。
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;

/// 把 (相对路径 -> 内容) 打包为 ZIP 字节。
pub fn pack(entries: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    let buf = Vec::new();
    let mut zip = zip::ZipWriter::new(Cursor::new(buf));
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, content) in entries {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }
    let cursor = zip.finish().map_err(|e| e.to_string())?;
    Ok(cursor.into_inner())
}

/// 解包 ZIP 字节为 (相对路径 -> 内容)。要求包含 manifest.json,否则报错。
pub fn unpack(bytes: &[u8]) -> Result<HashMap<String, String>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut out = HashMap::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();
        let mut content = String::new();
        file.read_to_string(&mut content).map_err(|e| e.to_string())?;
        out.insert(name, content);
    }
    if !out.contains_key("manifest.json") {
        return Err("工程包缺少 manifest.json".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_unpack_roundtrip() {
        let mut e = HashMap::new();
        e.insert("manifest.json".to_string(), "{\"v\":1}".to_string());
        e.insert("trees/a.bt.xml".to_string(), "<Root/>".to_string());
        let bytes = pack(&e).unwrap();
        let back = unpack(&bytes).unwrap();
        assert_eq!(back.get("trees/a.bt.xml").unwrap(), "<Root/>");
    }

    #[test]
    fn unpack_without_manifest_fails() {
        let mut e = HashMap::new();
        e.insert("a.txt".to_string(), "x".to_string());
        let bytes = pack(&e).unwrap();
        assert!(unpack(&bytes).is_err());
    }
}
