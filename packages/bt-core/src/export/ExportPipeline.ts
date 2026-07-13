/**
 * Export Pipeline(文档 §10.5 / §11.3)。
 * 流程:校验(Error 阻断) -> 转 BehaviorTreeDef -> 序列化 XML -> 生成 Meta / binding manifest。
 * 失败不得覆盖旧文件:本层只产出内容字符串,落盘(临时文件->替换)由 Rust/调用方完成。
 */
import type { TreeDesignDocument, DesignTree } from "../types/editor.js";
import type { Blackboard, CatalogBundle, Issue } from "../types/catalog.js";
import type { NodeRegistry } from "../registry/NodeRegistry.js";
import { defaultRegistry } from "../registry/NodeRegistry.js";
import { ValidationEngine } from "../validation/ValidationEngine.js";
import { toBehaviorTreeDef, ExportError } from "./toBehaviorTreeDef.js";
import { serializeBehaviorTreeXml, serializeGlobalBlackboardsXml } from "./xmlSerializer.js";
import { nowIso } from "../model/ids.js";

export interface ExportInput {
  doc: TreeDesignDocument;
  blackboards?: Blackboard[];
  catalogs?: CatalogBundle;
  registry?: NodeRegistry;
}

export interface ExportArtifacts {
  xml: string;
  meta: string;
  bindingManifest: string;
  /**
   * scenario 层全局黑板 XML(对齐老引擎 backport 后的 ModelDatabase/global_black_boards.xml)。
   * 老引擎在启动阶段用 BT::LoadBlackboardsFromXmlContent + BTXmlLoader::SetGlobalBlackboards 加载。
   * BT 里 <Input source="global"> 通过 blackboardKey/variableKey 引用此表。
   */
  globalBlackboardsXml: string;
}

export interface ExportResult {
  ok: boolean;
  issues: Issue[];
  artifacts?: ExportArtifacts;
  error?: string;
}

export class ExportPipeline {
  private readonly registry: NodeRegistry;
  private readonly validation: ValidationEngine;

  constructor(registry: NodeRegistry = defaultRegistry) {
    this.registry = registry;
    this.validation = new ValidationEngine(registry);
  }

  /** 预检:返回校验问题(不导出)。
   * **phase=export**:导出闸门必须严格,把 editing 阶段降级的 soft 规则(孤儿/未绑函数/必填未填等)
   * 全部升回 error,保证生成的 XML 一定完整可跑。 */
  precheck(input: ExportInput): Issue[] {
    return this.validation.validate(input.doc.tree, {
      mode: input.doc.tree.mode,
      blackboards: input.blackboards,
      catalogs: input.catalogs,
      registry: input.registry ?? this.registry,
      phase: "export",
    });
  }

  exportAll(input: ExportInput): ExportResult {
    const issues = this.precheck(input);
    if (issues.some((i) => i.level === "error")) {
      return { ok: false, issues, error: "存在 Error,导出被阻断" };
    }
    try {
      const def = toBehaviorTreeDef(input.doc.tree, {
        blackboards: input.blackboards,
        registry: input.registry ?? this.registry,
      });
      const xml = serializeBehaviorTreeXml(def);
      const meta = this.buildMeta(input.doc.tree);
      const bindingManifest = this.buildBindingManifest(input.doc.tree, input.catalogs);
      const globalBlackboardsXml = serializeGlobalBlackboardsXml(def.blackboards);
      return { ok: true, issues, artifacts: { xml, meta, bindingManifest, globalBlackboardsXml } };
    } catch (err) {
      const msg = err instanceof ExportError ? err.message : String(err);
      return { ok: false, issues, error: msg };
    }
  }

  /** 仅导出运行 XML(校验后)。 */
  exportRuntimeXml(input: ExportInput): ExportResult {
    const res = this.exportAll(input);
    if (!res.ok || !res.artifacts) return res;
    return {
      ok: true,
      issues: res.issues,
      artifacts: { xml: res.artifacts.xml, meta: "", bindingManifest: "", globalBlackboardsXml: res.artifacts.globalBlackboardsXml },
    };
  }

  /** *.bt.meta.json:UI 布局 / 注释 / 折叠等,不进运行 XML。 */
  buildMeta(tree: DesignTree): string {
    const meta = {
      schema: "bt-studio.meta/0.1",
      treeId: tree.treeId,
      treeName: tree.treeName,
      editorMeta: tree.editorMeta,
      comments: Object.fromEntries(
        Object.values(tree.nodes)
          .filter((n) => n.comment)
          .map((n) => [n.nodeId, n.comment]),
      ),
      exportedAt: nowIso(),
    };
    return JSON.stringify(meta, null, 2);
  }

  /** binding_manifest.json:本资产实际用到的函数/变量/MAL 签名(文档 §7.2)。 */
  buildBindingManifest(tree: DesignTree, catalogs?: CatalogBundle): string {
    const usedFunctions = new Set<string>();
    const usedVariables = new Set<string>();
    for (const node of Object.values(tree.nodes)) {
      if (node.functionRef) usedFunctions.add(node.functionRef);
      for (const i of node.inputBindings) if (i.variableId) usedVariables.add(i.variableId);
      for (const o of node.outputBindings) if (o.variableId) usedVariables.add(o.variableId);
    }
    const fnCat = catalogs?.functionCatalog.functions ?? [];
    const functions = [...usedFunctions].map((ref) => {
      const fn = fnCat.find((f) => f.functionId === ref || f.name === ref);
      return {
        ref,
        functionId: fn?.functionId,
        bindingTarget: fn?.bindingTarget,
        signatureHash: fn?.signatureHash,
        params: fn?.params.map((p) => ({
          name: p.name,
          direction: p.direction,
          displayType: p.displayType,
          malType: p.malType,
        })),
      };
    });
    const manifest = {
      schema: "bt-studio.binding-manifest/0.1",
      treeId: tree.treeId,
      treeName: tree.treeName,
      malVersion: "fosim-marg/1",
      functions,
      variables: [...usedVariables],
      exportedAt: nowIso(),
    };
    return JSON.stringify(manifest, null, 2);
  }
}

export const defaultExportPipeline = new ExportPipeline();
