/**
 * Import Pipeline(文档 §10.6 / §9.2)。
 * 四级映射:稳定 ID -> 绑定目标 -> MAL 签名 -> 显示名弱匹配;不可恢复进人工修复。
 */
import type { CatalogBundle, ImportMappingReport, MappingEntry } from "../types/catalog.js";
import type { NodeRegistry } from "../registry/NodeRegistry.js";
import { defaultRegistry } from "../registry/NodeRegistry.js";
import { importXmlToDesignTree, type ParseResult } from "./xmlParser.js";

export interface ImportResult extends ParseResult {
  report: ImportMappingReport;
}

export class ImportPipeline {
  private readonly registry: NodeRegistry;

  constructor(registry: NodeRegistry = defaultRegistry) {
    this.registry = registry;
  }

  importRuntimeXml(xml: string, catalogs?: CatalogBundle): ImportResult {
    const parsed = importXmlToDesignTree(xml, this.registry);
    const report = this.resolveMappings(parsed, catalogs);
    return { ...parsed, report };
  }

  resolveMappings(parsed: ParseResult, catalogs?: CatalogBundle): ImportMappingReport {
    const entries: MappingEntry[] = [];
    const fns = catalogs?.functionCatalog.functions ?? [];

    for (const ref of parsed.referencedFunctions) {
      // 1) 稳定 ID
      const byId = fns.find((f) => f.functionId === ref);
      if (byId) {
        entries.push({ kind: "function", sourceRef: ref, resolvedId: byId.functionId, matchLevel: "stable-id", needsManualRepair: false });
        continue;
      }
      // 2) 绑定目标
      const byTarget = fns.find((f) => f.bindingTarget === ref);
      if (byTarget) {
        entries.push({ kind: "function", sourceRef: ref, resolvedId: byTarget.functionId, matchLevel: "binding-target", needsManualRepair: false });
        continue;
      }
      // 4) 显示名弱匹配
      const byName = fns.find((f) => f.name === ref || f.displayName === ref);
      if (byName) {
        entries.push({
          kind: "function",
          sourceRef: ref,
          resolvedId: byName.functionId,
          matchLevel: "weak-name",
          needsManualRepair: true,
          message: "仅显示名匹配,需人工确认 MAL 签名",
        });
        continue;
      }
      entries.push({ kind: "function", sourceRef: ref, matchLevel: "unmatched", needsManualRepair: true, message: "未找到匹配函数" });
    }

    // 受限节点类型作为不可恢复项
    for (const t of parsed.restrictedTypes) {
      entries.push({
        kind: "subtree",
        sourceRef: t,
        matchLevel: "unmatched",
        needsManualRepair: true,
        message: `受限/未知节点类型 ${t},仅可查看/删除/替换`,
      });
    }

    const unresolvedCount = entries.filter((e) => e.needsManualRepair).length;
    return { assetName: parsed.tree.treeName, entries, unresolvedCount };
  }
}

export const defaultImportPipeline = new ImportPipeline();
