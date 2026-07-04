/**
 * 模型目录扫描结果 → workspace store 的统一 ingest 入口。
 *
 * 老版模型目录同时含 .cmp(函数签名)+ .mui(类元数据),需走 parseModelDirPaired;
 * 新版仅 .cmp,走 parseModelDir。
 *
 * 用户明确要求:选择工作空间目录、上传弹窗完成后就应该抽取完成 —— 不再让用户
 * 去「模型类型抽取」二次点按钮。故此处 ingest 完毕后立刻把全部原始类抽到类型空间,
 * 让后续 Root/叶子节点的"类+函数"下拉立即有内容可选。
 */
import type { ScannedModelDir } from "@/services/tauri";
import { useWorkspaceStore } from "@/stores/workspace";

export interface IngestOutcome {
  classes: number;
  functions: number;
  paired: boolean; // true = 走 parseModelDirPaired(.mui 配对);false = 走 parseModelDir(仅 .cmp)
  extractedClasses: number;
  extractedFunctions: number;
}

/**
 * 把 readModelCmpFiles / webkitdirectory 拿到的结果注入 workspace store,
 * 然后立刻把全部原始类抽取到类型空间(上传即抽取,不需要用户二次操作)。
 */
export function ingestScannedModel(res: ScannedModelDir): IngestOutcome {
  const ws = useWorkspaceStore();
  let parsed: { classes: number; functions: number };
  let paired: boolean;
  if (res.muiFiles && res.muiFiles.length > 0) {
    parsed = ws.parseModelDirPaired(res.root, res.files, res.muiFiles);
    paired = true;
  } else {
    parsed = ws.parseModelDir(res.root, res.contents);
    paired = false;
  }
  // 上传即抽取:把刚解析出来的全部原始类塞进类型空间,让节点绑定 UI 立刻可用。
  const allClassNames = ws.modelRawClasses.map((c) => c.className);
  const extracted = allClassNames.length > 0
    ? ws.extractToTypeSpace(allClassNames)
    : { classes: 0, functions: 0 };
  return { ...parsed, paired, extractedClasses: extracted.classes, extractedFunctions: extracted.functions };
}
