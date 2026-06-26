/**
 * *.workspace.xml -> 工程内容(全局黑板 + 目录 + 行为列表)。
 * 行为内联运行 XML:BT 用 importRuntimeXml 还原设计树;FSM 暂返回原始 XML 供后续解析。
 */
import { XMLParser } from "fast-xml-parser";
import type { Blackboard, CatalogBundle, Variable } from "../types/catalog.js";
import type { DesignTree } from "../types/editor.js";
import { parseMetaObject } from "./metaXml.js";
import { ImportPipeline } from "./ImportPipeline.js";
import { parseFsmXml } from "./fsmXml.js";
import { newVariableId } from "../model/ids.js";

export interface WorkspaceParseResult {
  name: string;
  language?: string;
  config: { modelRoot?: string; exportCodeDir?: string; cppNamespace?: string; engineSrcDir?: string };
  catalog: Partial<CatalogBundle>;
  globalBlackboards: Blackboard[];
  /** 已还原的行为树(BT + FSM) */
  behaviorTrees: DesignTree[];
}

function attrsOf(openTag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of openTag.matchAll(/([A-Za-z_][\w]*)="([^"]*)"/g)) out[m[1]!] = m[2]!;
  return out;
}

export function parseWorkspaceXml(xml: string): WorkspaceParseResult {
  const importer = new ImportPipeline();
  const nameMatch = xml.match(/<Workspace\b([^>]*)>/);
  const wsAttrs = nameMatch ? attrsOf(nameMatch[1]!) : {};
  const wsName = wsAttrs["name"] ?? "workspace";

  // 配置(模型目录/导出目录/命名空间)
  const cfgMatch = xml.match(/<Config\b([^>]*?)\/>/);
  const cfgA = cfgMatch ? attrsOf(cfgMatch[1]!) : {};
  const config = {
    modelRoot: cfgA["modelRoot"] || undefined,
    exportCodeDir: cfgA["exportCodeDir"] || undefined,
    cppNamespace: cfgA["cppNamespace"] || undefined,
    engineSrcDir: cfgA["engineSrcDir"] || undefined,
  };

  // meta(结构化解析)
  let catalog: Partial<CatalogBundle> = {};
  const metaBlock = xml.match(/<meta>[\s\S]*?<\/meta>/);
  if (metaBlock) {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const parsed = parser.parse(metaBlock[0]) as { meta?: Record<string, unknown> };
    catalog = parseMetaObject(parsed.meta ?? {});
  }

  // 全局黑板
  const globalBlackboards: Blackboard[] = [];
  const gbBlock = xml.match(/<GlobalBlackboards>[\s\S]*?<\/GlobalBlackboards>/);
  if (gbBlock) {
    for (const bbm of gbBlock[0].matchAll(/<Blackboard\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Blackboard>)/g)) {
      const a = attrsOf(bbm[1]!);
      const vars: Variable[] = [];
      for (const vm of (bbm[2] ?? "").matchAll(/<Variable\b([^>]*?)\/>/g)) {
        const va = attrsOf(vm[1]!);
        vars.push({
          variableId: va["id"] ?? newVariableId(),
          name: va["key"] ?? "var",
          scope: "global",
          displayType: (va["displayType"] as Variable["displayType"]) ?? "string",
          valueFormat: "literal",
          defaultValue: va["value"],
        });
      }
      globalBlackboards.push({
        blackboardId: a["id"] ?? newVariableId(),
        name: a["name"] ?? "全局板",
        scope: "global",
        runtimeScope: "Global",
        linked: true,
        variables: vars,
      });
    }
  }

  // 行为(BT 与 FSM 统一返回为 DesignTree)
  const behaviorTrees: DesignTree[] = [];
  for (const bm of xml.matchAll(/<Behavior\b([^>]*)>([\s\S]*?)<\/Behavior>/g)) {
    const a = attrsOf(bm[1]!);
    const inner = bm[2]!.trim();
    if ((a["kind"] ?? "behavior_tree") === "state_machine") {
      try {
        const fsmTree = parseFsmXml(inner);
        if (a["name"]) {
          fsmTree.treeName = a["name"];
          fsmTree.displayName = a["name"];
        }
        if (a["rootClass"]) fsmTree.rootClassName = a["rootClass"];
        fsmTree.projectKind = "state_machine";
        behaviorTrees.push(fsmTree);
      } catch {
        /* 跳过无法解析的 FSM */
      }
      continue;
    }
    try {
      const res = importer.importRuntimeXml(inner);
      res.tree.treeName = a["name"] ?? res.tree.treeName;
      res.tree.displayName = a["name"] ?? res.tree.displayName;
      if (a["rootClass"]) res.tree.rootClassName = a["rootClass"];
      behaviorTrees.push(res.tree);
    } catch {
      /* 跳过无法解析的行为 */
    }
  }

  return { name: wsName, language: wsAttrs["language"], config, catalog, globalBlackboards, behaviorTrees };
}
