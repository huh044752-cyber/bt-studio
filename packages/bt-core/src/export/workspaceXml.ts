/**
 * 单一 Workspace -> *.workspace.xml(behaviac/vue2 风格,设计态全 XML 持久化)。
 *
 * 结构:
 *   <Workspace name language>
 *     <Meta> ... (内联 meta.xml 的 <meta> 内容) ... </Meta>   -- 类型/Agent/枚举/结构体
 *     <GlobalBlackboards><Blackboard ...><Variable .../></Blackboard></GlobalBlackboards>
 *     <Behaviors>
 *       <Behavior name kind="behavior_tree" rootClass>...内联运行 XML...</Behavior>
 *       <Behavior name kind="state_machine">...内联 FSM XML...</Behavior>
 *     </Behaviors>
 *   </Workspace>
 *
 * BT 行为内联 FOSim *.bt.xml;FSM 内联 behaviac 式 FSM XML。导入可据此恢复。
 */
import type { DesignTree } from "../types/editor.js";
import type { Blackboard, CatalogBundle } from "../types/catalog.js";
import { xmlEscape } from "./xmlSerializer.js";
import { serializeBehaviorTreeXml } from "./xmlSerializer.js";
import { toBehaviorTreeDef } from "./toBehaviorTreeDef.js";
import { serializeFsmXml } from "./fsmXml.js";
import { serializeMetaXml } from "./metaXml.js";
import { malToXmlType } from "../mal/malMapping.js";

function attr(name: string, value: string | undefined): string {
  if (value === undefined || value === "") return "";
  return ` ${name}="${xmlEscape(String(value))}"`;
}
function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .filter((l) => l.length && !l.startsWith("<?xml"))
    .map((l) => pad + l)
    .join("\n");
}

/** 工作空间配置(对齐 behaviac workspace 的 name/folder/export/language/version,FOSim 扩展模型目录/命名空间)。 */
export interface WorkspaceConfig {
  /** 模型目录(FZFOSimModel 根)。 */
  modelRoot?: string;
  /** C++ 导出代码目录。 */
  exportCodeDir?: string;
  /** C++ 命名空间。 */
  cppNamespace?: string;
  /** 引擎源码根目录(拷贝真实 BT/FSM 运行时 + MAL 到工程 runtime/)。 */
  engineSrcDir?: string;
  version?: number;
}

export interface WorkspaceXmlInput {
  name: string;
  language?: string;
  config?: WorkspaceConfig;
  trees: DesignTree[];
  globalBlackboards: Blackboard[];
  catalog: CatalogBundle;
}

export function serializeWorkspaceXml(ws: WorkspaceXmlInput): string {
  const cfg = ws.config ?? {};
  const lines: string[] = ["<?xml version='1.0' encoding='utf-8'?>"];
  lines.push(
    `<Workspace${attr("name", ws.name)}${attr("language", ws.language ?? "cpp")}${attr("version", String(cfg.version ?? 1))}>`,
  );

  // 配置(模型目录 / 导出目录 / 命名空间)—— 供"打开工作空间"恢复数据用。
  const cfgAttrs = `${attr("modelRoot", cfg.modelRoot)}${attr("exportCodeDir", cfg.exportCodeDir)}${attr("cppNamespace", cfg.cppNamespace)}${attr("engineSrcDir", cfg.engineSrcDir)}`;
  lines.push(`  <Config${cfgAttrs} />`);

  // 内联 meta(去掉其 xml 声明)
  const meta = serializeMetaXml(ws.catalog);
  lines.push(indent(meta, "  "));

  // 全局黑板
  lines.push("  <GlobalBlackboards>");
  for (const bb of ws.globalBlackboards) {
    const head = `    <Blackboard${attr("id", bb.blackboardId)}${attr("name", bb.name)} scope="global">`;
    if (bb.variables.length === 0) {
      lines.push(`${head.slice(0, -1)} />`);
      continue;
    }
    lines.push(head);
    for (const v of bb.variables) {
      lines.push(
        `      <Variable${attr("key", v.name)}${attr("id", v.variableId)}${attr("type", v.malType ? malToXmlType(v.malType) : "FZStringType")}${attr("value", v.defaultValue)}${attr("displayType", v.displayType)} />`,
      );
    }
    lines.push("    </Blackboard>");
  }
  lines.push("  </GlobalBlackboards>");

  // 行为
  lines.push("  <Behaviors>");
  for (const tree of ws.trees) {
    const kind = tree.projectKind ?? "behavior_tree";
    lines.push(
      `    <Behavior${attr("name", tree.treeName)} kind="${kind}"${attr("rootClass", tree.rootClassName)}>`,
    );
    try {
      const xml = kind === "state_machine" ? serializeFsmXml(tree) : serializeBehaviorTreeXml(toBehaviorTreeDef(tree));
      lines.push(indent(xml, "      "));
    } catch (e) {
      lines.push(`      <!-- 行为序列化失败: ${xmlEscape(String((e as Error).message))} -->`);
    }
    lines.push("    </Behavior>");
  }
  lines.push("  </Behaviors>");

  lines.push("</Workspace>");
  return lines.join("\n") + "\n";
}
