//! 运行时后台(文档 §10.7):解析导出的行为树 XML 并产出 Tick 轨迹 + 错误。
//!
//! 默认提供不依赖引擎的后台实现:对导出的 *.bt.xml 做结构扫描,按文档序产出
//! enter/exit 轨迹(供"运行/调试"接入后台数据)。接入真实 FOSim 时启用 `fosim-runtime`
//! feature,改为通过 FFI 调用 BT::BTXmlLoader + 调度,产出真实节点状态。
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct LoadResult {
    pub ok: bool,
    pub tree_handle: u64,
    pub node_count: usize,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct TraceEvent {
    pub tick: u32,
    pub node_id: String,
    pub node_type: String,
    pub name: String,
    pub phase: String,  // enter | exit
    pub status: String, // Running | Success | Failure
}

#[derive(Debug, Serialize)]
pub struct RunResult {
    pub ok: bool,
    pub node_count: usize,
    pub trace: Vec<TraceEvent>,
    pub errors: Vec<String>,
    pub message: String,
}

struct ScanNode {
    node_type: String,
    id: String,
    name: String,
    function: String,
    class: String,
}

/// 取标签内某属性值(简单扫描,够用于结构遍历)。
fn attr(tag: &str, key: &str) -> String {
    let pat = format!("{key}=\"");
    if let Some(p) = tag.find(&pat) {
        let start = p + pat.len();
        if let Some(end) = tag[start..].find('"') {
            return tag[start..start + end].to_string();
        }
    }
    String::new()
}

/// 结构扫描导出 XML:收集"节点元素"(带 id 属性的非声明标签)。
fn scan_nodes(xml: &str) -> Vec<ScanNode> {
    let mut nodes = Vec::new();
    let bytes = xml.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            // 跳过声明/注释/结束标签
            if xml[i..].starts_with("<?") || xml[i..].starts_with("<!") || xml[i..].starts_with("</") {
                if let Some(close) = xml[i..].find('>') {
                    i += close + 1;
                    continue;
                }
                break;
            }
            if let Some(close) = xml[i..].find('>') {
                let tag = &xml[i + 1..i + close]; // 去掉 < 和 >
                let id = attr(tag, "id");
                if !id.is_empty() {
                    let name_end = tag.find(|c: char| c.is_whitespace() || c == '/').unwrap_or(tag.len());
                    let node_type = tag[..name_end].to_string();
                    nodes.push(ScanNode {
                        node_type,
                        id,
                        name: attr(tag, "name"),
                        function: attr(tag, "function"),
                        class: attr(tag, "className"),
                    });
                }
                i += close + 1;
                continue;
            }
            break;
        }
        i += 1;
    }
    nodes
}

/// 收集结构性错误(供"全面错误显示")。
fn collect_errors(nodes: &[ScanNode]) -> Vec<String> {
    let mut errors = Vec::new();
    for n in nodes {
        if !n.function.is_empty() && n.class.is_empty() {
            errors.push(format!(
                "节点 {}({}) 绑定了函数 {} 但未指定 className",
                n.name, n.id, n.function
            ));
        }
    }
    errors
}

pub fn load_tree(xml: &str) -> LoadResult {
    if xml.trim().is_empty() {
        return LoadResult { ok: false, tree_handle: 0, node_count: 0, message: "XML 为空".into() };
    }
    let nodes = scan_nodes(xml);
    LoadResult {
        ok: !nodes.is_empty(),
        tree_handle: 1,
        node_count: nodes.len(),
        message: if nodes.is_empty() {
            "未解析到任何节点".into()
        } else {
            format!("后台加载成功:{} 个节点", nodes.len())
        },
    }
}

/// 运行 N 帧:对每个节点产出 enter/exit 轨迹(后台数据)。
pub fn run_tree(xml: &str, ticks: u32) -> RunResult {
    if xml.trim().is_empty() {
        return RunResult {
            ok: false,
            node_count: 0,
            trace: vec![],
            errors: vec!["XML 为空".into()],
            message: "运行失败".into(),
        };
    }
    let nodes = scan_nodes(xml);
    let errors = collect_errors(&nodes);
    let mut trace = Vec::new();
    let frames = ticks.clamp(1, 50);
    for t in 1..=frames {
        for n in &nodes {
            trace.push(TraceEvent {
                tick: t,
                node_id: n.id.clone(),
                node_type: n.node_type.clone(),
                name: n.name.clone(),
                phase: "enter".into(),
                status: "Running".into(),
            });
            trace.push(TraceEvent {
                tick: t,
                node_id: n.id.clone(),
                node_type: n.node_type.clone(),
                name: n.name.clone(),
                phase: "exit".into(),
                status: "Success".into(),
            });
        }
    }
    let err_n = errors.len();
    RunResult {
        ok: !nodes.is_empty(),
        node_count: nodes.len(),
        trace,
        errors,
        message: format!("后台运行 {frames} 帧 · {} 节点 · {} 错误", nodes.len(), err_n),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scans_nodes_and_traces() {
        let xml = r#"<?xml version='1.0'?><Root id="1"><Sequence id="2"><Action id="3" name="Go" function="Engage" className="FZAirFighter"/></Sequence></Root>"#;
        let r = run_tree(xml, 2);
        assert!(r.ok);
        assert_eq!(r.node_count, 3);
        assert_eq!(r.trace.len(), 3 * 2 * 2);
        assert!(r.errors.is_empty());
    }
    #[test]
    fn reports_unbound_function() {
        let xml = r#"<Root id="1"><Action id="2" name="X" function="Foo"/></Root>"#;
        let r = run_tree(xml, 1);
        assert_eq!(r.errors.len(), 1);
    }
}
