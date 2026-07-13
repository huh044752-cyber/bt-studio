import { defineStore } from "pinia";
import { ref, computed, markRaw, shallowRef, triggerRef, watch } from "vue";
import {
  GraphCommandBus,
  ExportPipeline,
  ValidationEngine,
  ImportPipeline,
  defaultRegistry,
  autoLayout,
  createTree,
  createBlackboard,
  serializeFsmXml,
  serializeMetaXml,
  serializeWorkspaceXml,
  parseMetaXml,
  parseWorkspaceXml,
  parseCmpFiles,
  parseCmpMuiPairs,
  generateCpp,
  generateProject,
  toBehaviorTreeDef,
  serializeBehaviorTreeXml,
  reconcileTreeBindings,
  type CppFile,
  type DesignTree,
  type GraphCommand,
  type Issue,
  type Blackboard,
  type FunctionCatalog,
  type CatalogBundle,
  type EnumDescriptor,
  type TypeDescriptor,
  type ClassDescriptor,
  type FunctionDescriptor,
  type MemberDescriptor,
  type StructDescriptor,
  type StudioMode,
  type CommandResult,
} from "@btstudio/bt-core";
import { useConsoleStore } from "./console";

const exporter = new ExportPipeline();
const validator = new ValidationEngine();
const importer = new ImportPipeline();

export const useWorkspaceStore = defineStore("workspace", () => {
  const console = useConsoleStore();

  const mode = ref<StudioMode>("standalone");
  const workspaceName = ref("");
  // 默认空:用户在"新建工作空间"里显式配置 modelRoot / exportCodeDir。
  // 不再预填 F:/0411/ccc/FZFOSimModel 之类的测试路径,避免"打开新工作空间即出现测试数据"。
  const modelRoot = ref<string>("");
  // 工作空间配置(对齐 behaviac workspace.xml:导出代码目录/语言 + FOSim 命名空间)
  // Tauri 原生对话框返回的绝对路径,空串表示未配置。
  const exportCodeDir = ref<string>("");
  // 单树 BT/FSM XML 导出目录(设计页"导出XML"按钮落盘目录)。与 C++ 工程目录独立:
  // C++ 工程目录用来放整套代码骨架 + behaviors/,单树 XML 目录一般直接指向老引擎的
  // ModelDatabase 下的 BehaviacTree / StateMachine,让用户"改完即用"。
  const exportXmlDir = ref<string>("");
  const language = ref<"cpp" | "cs">("cpp");
  const cppNamespace = ref<string>("btproj");
  // 工作空间 XML 自身在磁盘上的绝对路径(打开/另存后回写),供"保存 XML"静默覆写。
  const workspaceFilePath = ref<string>("");
  // 引擎源码根目录:生成时把真实的 BT/FSM 运行时(modules/extern)+ MAL 拷贝进工程的 runtime/。
  const engineSrcDir = ref<string>("");
  // 解耦:原始模型目录(.cmp 解析结果),不直接进入类型空间;由"模型类型抽取"模块勾选抽取。
  const modelRawClasses = shallowRef<ClassDescriptor[]>([]);
  const modelRawFunctions = shallowRef<FunctionDescriptor[]>([]);
  const trees = shallowRef<DesignTree[]>([]);
  const buses = markRaw(new Map<string, GraphCommandBus>());
  // 已格式化(自动布局)过的树:进入工程时首次自动布局,之后保留用户手动摆放。
  const formattedTrees = markRaw(new Set<string>());
  const localBlackboards = ref<Record<string, Blackboard>>({});
  const currentTreeId = ref<string>("");
  const selectedNodeId = ref<string>("");
  const issues = ref<Issue[]>([]);
  // 复制/粘贴剪贴板:放在 store(模块级持久),跨页面/跨树存活(修复"新建树后粘贴显示剪贴板为空")。
  const clipboard = ref<unknown | null>(null);
  /** 全工作空间(所有树)的问题汇总,每条带 treeName/treeId,供"全面错误显示"。 */
  const allIssues = ref<(Issue & { treeName: string; treeId: string })[]>([]);
  const rev = ref(0); // 命令后自增以触发视图刷新

  // 目录中心
  const functionCatalog = ref<FunctionCatalog>({ functions: [] });
  const globalBlackboards = ref<Blackboard[]>([]);
  const enums = ref<EnumDescriptor[]>([]);
  const types = ref<TypeDescriptor[]>([]);
  const classes = ref<ClassDescriptor[]>([]);
  const members = ref<MemberDescriptor[]>([]);
  const structs = ref<StructDescriptor[]>([]);

  const currentTree = computed<DesignTree | undefined>(() => {
    void rev.value;
    return trees.value.find((t) => t.treeId === currentTreeId.value);
  });

  const currentBus = computed<GraphCommandBus | undefined>(() => buses.get(currentTreeId.value));

  const selectedNode = computed(() => {
    void rev.value;
    const t = currentTree.value;
    return t && selectedNodeId.value ? t.nodes[selectedNodeId.value] : undefined;
  });

  function bump(): void {
    rev.value++;
    trees.value = [...trees.value];
  }

  function catalogBundle(): CatalogBundle {
    return {
      functionCatalog: functionCatalog.value,
      globalBlackboards: globalBlackboards.value,
      enums: enums.value,
      structs: structs.value,
      types: types.value,
      classes: classes.value,
      members: members.value,
    };
  }

  function visibleBlackboards(treeId: string): Blackboard[] {
    const tree = trees.value.find((t) => t.treeId === treeId);
    if (!tree) return [];
    const local = localBlackboards.value[treeId];
    const linked = globalBlackboards.value.filter((b) =>
      tree.linkedGlobalBlackboardIds.includes(b.blackboardId),
    );
    return [...(local ? [local] : []), ...linked];
  }

  function registerTree(tree: DesignTree, local: Blackboard): void {
    trees.value = [...trees.value, tree];
    buses.set(tree.treeId, markRaw(new GraphCommandBus(tree, defaultRegistry)));
    localBlackboards.value[tree.treeId] = local;
  }

  /**
   * 依据函数目录重建所有树的函数节点绑定(输入参数恒带默认值)。
   * 在导入工程 / 导入 XML / 模型目录变更 / 抽取类型空间后调用,确保重开即渲染入参,
   * 无需再次手选方法,也避免空绑定被误判为「必填参数未赋值」阻断导出。
   */
  function reconcileAllBindings(): number {
    let changed = 0;
    for (const t of trees.value) changed += reconcileTreeBindings(t, functionCatalog.value);
    return changed;
  }

  /** 新建空工作空间:清空树/目录/黑板,保留/设置配置。 */
  function newWorkspace(name: string): void {
    for (const id of [...buses.keys()]) buses.delete(id);
    trees.value = [];
    localBlackboards.value = {};
    globalBlackboards.value = [];
    functionCatalog.value = { functions: [] };
    classes.value = [];
    members.value = [];
    enums.value = [];
    structs.value = [];
    types.value = [];
    modelRawClasses.value = [];
    modelRawFunctions.value = [];
    currentTreeId.value = "";
    selectedNodeId.value = "";
    issues.value = [];
    workspaceName.value = name || "workspace";
    workspaceFilePath.value = ""; // 新建 = 尚未落盘,首次保存会走另存为对话框
    bump();
    console.success("workspace", `新建工作空间 ${workspaceName.value}`);
  }

  function newTree(name: string, projectKind: "behavior_tree" | "state_machine" = "behavior_tree"): DesignTree {
    // 名称去重:同名会让 XML 索引 / 场景挂接 / SubTree 引用无法区分。若冲突,追加 _2/_3 …。
    let finalName = name;
    if (trees.value.some((t) => t.treeName === finalName)) {
      let i = 2;
      while (trees.value.some((t) => t.treeName === `${name}_${i}`)) i++;
      finalName = `${name}_${i}`;
      console.warning("workspace", `名称「${name}」已存在,改用「${finalName}」`);
    }
    // FSM 也有 Root 作为"根节点容器"(vue2 式:Root 下挂 State 节点,对齐连接规则 Root→State)。
    const tree = createTree({ treeName: finalName, mode: mode.value, projectKind, withRoot: true });
    const local = createBlackboard(`${name}-本地板`, "tree", { blackboardId: tree.localBlackboardId });
    registerTree(tree, local);
    currentTreeId.value = tree.treeId;
    selectedNodeId.value = tree.rootNodeId;
    console.success("workspace", `新建${projectKind === "state_machine" ? "状态机" : "行为树"} ${name}`, { relatedAssetId: tree.treeId });
    bump();
    return tree;
  }

  function switchTree(treeId: string): boolean {
    const bus = buses.get(currentTreeId.value);
    if (bus && bus.getDirtyState()) {
      // 自动保存草稿(此处为内存保存),失败则阻断
      bus.markSaved();
      console.info("workspace", `切换前自动保存草稿`, { relatedAssetId: currentTreeId.value });
    }
    currentTreeId.value = treeId;
    const t = trees.value.find((x) => x.treeId === treeId);
    selectedNodeId.value = t?.rootNodeId ?? "";
    // 进入工程即格式化:首次进入该树时自动布局(行为树/状态机各自的布局算法)。
    if (t && !formattedTrees.has(treeId)) {
      autoLayout(t);
      formattedTrees.add(treeId);
    }
    // 切树 → issues 属于旧树,清空;用户在新树想看问题时再点校验。
    issues.value = [];
    console.info("canvas", `切换到${(t?.projectKind ?? "behavior_tree") === "state_machine" ? "状态机" : "行为树"} ${t?.treeName ?? treeId}`);
    bump();
    return true;
  }

  /**
   * 命令执行:**不自动触发校验**。
   *
   * 设计原则(2026-07 重构):
   *   - 单次 run 只做 3 件事:(1) bus.execute (2) 若成功且创建了节点,selectedNodeId 指向新节点
   *     (3) bump 触发画布 sync。**校验完全由用户手动 `validate()` 或导出闸门 `exportBlockers()` 触发**。
   *   - 这样避免了粘贴/批量脚本时校验被反复触发,也避免"编辑中红字不断变化"的干扰。
   *   - undo/redo 会自动 revalidate(回到旧状态,issues 必须与之匹配)。
   *   - 切树 / 打开工程 会自动 revalidate(新语境必须有正确的 issues)。
   *
   * 用户流:
   *   拖节点 / 粘贴 / 连线 / 改属性 → issues 保持"未校验"态(空数组)。
   *   用户点顶部"校验"按钮 → validate() 一次算清所有问题。
   *   用户点"导出" → exportBlockers() 强制以 export phase 算一次,阻断级 error 会同步到画布。
   */
  function run(cmd: GraphCommand): CommandResult {
    const bus = currentBus.value;
    if (!bus) return { ok: false, reason: "无当前树", affectedNodeIds: [] };
    const res = bus.execute(cmd);
    if (!res.ok) {
      console.warning("canvas", `命令 ${cmd.kind} 被拒绝: ${res.reason}`);
    } else if (res.createdNodeId) {
      selectedNodeId.value = res.createdNodeId;
    }
    bump();
    return res;
  }

  /**
   * 批量执行命令 —— **一次性,单帧提交**。用于粘贴子树、批量导入等场景。
   *
   * 单次 `run` 每条命令都会 `bump()` → 触发 `watch([currentTreeId, ws.rev])` → `editor.sync()`
   * 全量增量 diff X6 画布。粘贴 N 个节点若走 N 次 run,就会有 N 次 sync,视觉上像"节点在爆"
   * (中间态一个个冒出来 + selectedNodeId 反复跳),用户体感就是"粘贴出来一堆"。
   *
   * runBatch 走同一个 bus 对每条命令逐条执行(bus 内部自己维护 undo 快照),
   * **只在最后 bump 一次**,画布只 sync 一次,selectedNodeId 只指定最终锚点(顶点)。
   * 校验依然不自动触发 —— 用户手动点。
   *
   * @param cmds 命令列表(顺序执行,前一条的 createdNodeId 可被后续通过 anchor 引用)
   * @param anchorSelectedNodeId 全部完成后 selectedNodeId 指向谁(通常是顶点)
   * @returns 每条命令的结果,order 与 cmds 一致
   */
  function runBatch(
    cmds: GraphCommand[],
    anchorSelectedNodeId?: string,
  ): CommandResult[] {
    const bus = currentBus.value;
    if (!bus) return cmds.map(() => ({ ok: false, reason: "无当前树", affectedNodeIds: [] }));
    const out: CommandResult[] = [];
    for (const cmd of cmds) {
      const res = bus.execute(cmd);
      if (!res.ok) console.warning("canvas", `批命令 ${cmd.kind} 被拒绝: ${res.reason}`);
      out.push(res);
    }
    if (anchorSelectedNodeId) selectedNodeId.value = anchorSelectedNodeId;
    bump(); // 只在最后 bump 一次 → 只一次画布 sync
    return out;
  }

  /** undo/redo 后 bus 内部 tree 引用已被替换,需把恢复后的树同步回 trees(否则视图不变)。 */
  function syncBusTree(): void {
    const bus = currentBus.value;
    if (!bus) return;
    const restored = bus.getTree();
    const idx = trees.value.findIndex((t) => t.treeId === restored.treeId);
    if (idx >= 0) {
      trees.value[idx] = restored;
      trees.value = [...trees.value];
    }
  }
  function undo(): void {
    if (currentBus.value?.undo()) syncBusTree();
    bump();
    // 不自动重算 issues:已计算过的可能已对不上恢复后的状态,清空 → "校验已过时,请重新点校验"。
    issues.value = [];
  }
  function redo(): void {
    if (currentBus.value?.redo()) syncBusTree();
    bump();
    issues.value = [];
  }

  function layout(): void {
    const t = currentTree.value;
    if (!t) return;
    autoLayout(t);
    formattedTrees.add(t.treeId);
    console.info("canvas", "自动布局完成");
    bump();
  }

  /** 对指定树执行自动布局(供 seed/进入工程时格式化)。 */
  function layoutTree(treeId: string): void {
    const t = trees.value.find((x) => x.treeId === treeId);
    if (!t) return;
    autoLayout(t);
    formattedTrees.add(treeId);
  }

  /**
   * 编辑态校验:软规则(孤儿、绑定未填、类不存在等)一律 warning。
   * 硬规则(未注册节点、Root 唯一/子数量、子容量违反、常量转换失败等)仍是 error。
   * 面板/画布上编辑过程中不会被红字轰炸,但仍能在问题面板看到黄字提示。
   */
  function validate(): Issue[] {
    const t = currentTree.value;
    if (!t) {
      issues.value = [];
      return [];
    }
    issues.value = validator.validate(t, {
      mode: t.mode,
      blackboards: visibleBlackboards(t.treeId),
      catalogs: catalogBundle(),
      phase: "editing",
    });
    return issues.value;
  }

  /** 校验所有树(editing phase),汇总问题(每条带 treeName/treeId)。 */
  function validateAll(): (Issue & { treeName: string; treeId: string })[] {
    const out: (Issue & { treeName: string; treeId: string })[] = [];
    for (const t of trees.value) {
      const found = validator.validate(t, {
        mode: t.mode,
        blackboards: visibleBlackboards(t.treeId),
        catalogs: catalogBundle(),
        phase: "editing",
      });
      for (const i of found) out.push({ ...i, treeName: t.displayName, treeId: t.treeId });
    }
    allIssues.value = out;
    return out;
  }

  /**
   * 导出前置闸:**用 export phase 校验**,所有软规则升 error,保证导出物完整。
   * 同时把当前树的 issues 用 export 结果覆盖,让画布上原本 warning 的孤儿/未填此刻暴红,
   * 用户一眼看到"再补哪几处才能导出"。
   */
  function exportBlockers(): (Issue & { treeName: string; treeId: string })[] {
    const out: (Issue & { treeName: string; treeId: string })[] = [];
    for (const t of trees.value) {
      const found = validator.validate(t, {
        mode: t.mode,
        blackboards: visibleBlackboards(t.treeId),
        catalogs: catalogBundle(),
        phase: "export",
      });
      for (const i of found) out.push({ ...i, treeName: t.displayName, treeId: t.treeId });
    }
    allIssues.value = out;
    // 同步当前树 issues(画布红框 + 属性面板) —— 用 export 结果,让 soft 规则暴红。
    const t = currentTree.value;
    if (t) issues.value = out.filter((i) => i.treeId === t.treeId);
    return out.filter((i) => i.level === "error");
  }

  /**
   * 代码生成前置闸:只校验类型空间(类/方法/成员/枚举/结构),不校验行为树完整性。
   * 生成的 C++ 工程仅基于 catalog,行为树 XML 是字符串拷进 behaviors/,即便树未完成也不影响编译。
   * 类型空间问题(如类无方法/方法签名缺字段)直接走 generator 自身的容错(空类生成 INTERFACE 库)。
   * 故此函数总是返回空数组——代码生成不阻断;真要校验类型空间在面板里另做。
   */
  function codegenBlockers(): (Issue & { treeName: string; treeId: string })[] {
    return [];
  }

  const errorCount = computed(() => issues.value.filter((i) => i.level === "error").length);
  const warningCount = computed(() => issues.value.filter((i) => i.level === "warning").length);
  const allErrorCount = computed(() => allIssues.value.filter((i) => i.level === "error").length);
  const allWarningCount = computed(() => allIssues.value.filter((i) => i.level === "warning").length);
  /**
   * "可导出"按钮启用状态:仅表示当前有树可导。
   * 校验不再实时(用户按需),真正阻断在 `exportCurrent` 内部由 pipeline.precheck(phase=export) 兜底。
   * 这样用户不需要先手动"校验"再"导出" —— 直接点导出,失败时 issues 会被刷新暴红。
   */
  const canExport = computed(() => !!currentTree.value);

  function exportCurrent() {
    const t = currentTree.value;
    if (!t) return { ok: false, issues: [] as Issue[], error: "无当前树" };
    const res = exporter.exportAll({
      doc: { tree: t, dirty: false },
      blackboards: visibleBlackboards(t.treeId),
      catalogs: catalogBundle(),
    });
    // res.issues 是 export phase 校验的结果;不管成败都把它塞进 issues 让画布/问题面板暴红。
    issues.value = res.issues;
    if (res.ok) console.success("export", `导出成功 ${t.treeName}`, { relatedAssetId: t.treeId });
    else console.error("export", `导出阻断 ${t.treeName}: ${res.error}`, { relatedAssetId: t.treeId });
    return res;
  }

  // --- 真实模型目录解析(R1):*.cmp -> 真实类/方法目录 ---
  function loadModelClasses(root: string, contents: string[]): { classes: number; functions: number } {
    const { classes: cls, functions } = parseCmpFiles(contents);
    modelRoot.value = root;
    // 真实模型类标记 source=model;去重合并
    for (const c of cls) {
      const idx = classes.value.findIndex((x) => x.className === c.className);
      if (idx >= 0) classes.value[idx] = c;
      else classes.value.push(c);
    }
    // 替换该类的函数(以模型为准)
    const modelClassNames = new Set(cls.map((c) => c.className));
    functionCatalog.value.functions = functionCatalog.value.functions.filter(
      (f) => !modelClassNames.has(f.ownerClass ?? ""),
    );
    functionCatalog.value.functions.push(...functions);
    reconcileAllBindings();
    bump();
    console.success("import", `加载模型目录:${cls.length} 类 · ${functions.length} 方法`, { detail: root });
    return { classes: cls.length, functions: functions.length };
  }

  /** 解析模型目录到"原始模型"层(不进入类型空间)。供模型类型抽取模块使用。 */
  function parseModelDir(root: string, contents: string[]): { classes: number; functions: number } {
    const { classes: cls, functions } = parseCmpFiles(contents);
    modelRoot.value = root;
    modelRawClasses.value = cls;
    modelRawFunctions.value = functions;
    bump();
    console.success("import", `解析模型目录:${cls.length} 类 · ${functions.length} 方法(待抽取)`, { detail: root });
    return { classes: cls.length, functions: functions.length };
  }

  /**
   * 老版分支:.cmp + .mui 配对解析(按 baseName 匹配)。
   * - cmpFiles / muiFiles 由 Tauri scan_model_cmp 返回(含 path)
   * - 同名 baseName 的 .cmp/.mui 合并;.mui 提供 className/displayName,.cmp 提供函数签名
   * - 空 Inputs/Outputs 的函数也登记(老 Cognition 默认全部空参)
   */
  function parseModelDirPaired(
    root: string,
    cmpFiles: { path: string; content: string }[],
    muiFiles: { path: string; content: string }[],
  ): { classes: number; functions: number } {
    const baseOf = (p: string): string => {
      const stem = p.split(/[\\/]/).pop() ?? p;
      return stem.replace(/\.(cmp|mui)$/i, "");
    };
    const map = new Map<string, { baseName: string; cmp?: string; mui?: string }>();
    for (const f of cmpFiles) {
      const b = baseOf(f.path);
      const cur = map.get(b) ?? { baseName: b };
      cur.cmp = f.content;
      map.set(b, cur);
    }
    for (const f of muiFiles) {
      const b = baseOf(f.path);
      const cur = map.get(b) ?? { baseName: b };
      cur.mui = f.content;
      map.set(b, cur);
    }
    const { classes: cls, functions } = parseCmpMuiPairs([...map.values()]);
    modelRoot.value = root;
    modelRawClasses.value = cls;
    modelRawFunctions.value = functions;
    bump();
    console.success(
      "import",
      `配对解析(老版).cmp+.mui:${cls.length} 类 · ${functions.length} 方法(待抽取)`,
      { detail: root },
    );
    return { classes: cls.length, functions: functions.length };
  }

  /** 把选中的原始模型类(及其方法)抽取进类型空间(解耦:只取需要的)。 */
  function extractToTypeSpace(classNames: string[]): { classes: number; functions: number } {
    const want = new Set(classNames);
    let nc = 0;
    let nf = 0;
    for (const c of modelRawClasses.value) {
      if (!want.has(c.className)) continue;
      const idx = classes.value.findIndex((x) => x.className === c.className);
      if (idx >= 0) classes.value[idx] = c;
      else { classes.value.push(c); nc++; }
      // 该类方法:先清掉旧的同类函数,再加入
      functionCatalog.value.functions = functionCatalog.value.functions.filter((f) => (f.ownerClass ?? "") !== c.className);
      const fns = modelRawFunctions.value.filter((f) => (f.ownerClass ?? "") === c.className);
      functionCatalog.value.functions.push(...fns);
      nf += fns.length;
    }
    reconcileAllBindings();
    bump();
    console.success("import", `抽取到类型空间:${classNames.length} 类 · ${nf} 方法`);
    return { classes: nc, functions: nf };
  }

  // --- 类型系统(meta.xml) / 工作空间(workspace.xml) / C++ 代码生成 ---
  function exportMetaXml(): string {
    return serializeMetaXml(catalogBundle());
  }
  function exportWorkspaceXml(name = workspaceName.value || "bt-studio-workspace", treeIds?: string[]): string {
    const wanted = treeIds && treeIds.length ? new Set(treeIds) : null;
    const filteredTrees = wanted ? trees.value.filter((t) => wanted.has(t.treeId)) : trees.value;
    return serializeWorkspaceXml({
      name,
      language: language.value,
      config: {
        modelRoot: modelRoot.value || undefined,
        exportCodeDir: exportCodeDir.value || undefined,
        exportXmlDir: exportXmlDir.value || undefined,
        cppNamespace: cppNamespace.value || undefined,
        engineSrcDir: engineSrcDir.value || undefined,
        workspaceFilePath: workspaceFilePath.value || undefined,
      },
      trees: filteredTrees,
      globalBlackboards: globalBlackboards.value,
      catalog: catalogBundle(),
    });
  }
  function exportCppFiles(): CppFile[] {
    return generateCpp(catalogBundle());
  }

  /** 每棵树的运行 XML(BT→FOSim bt.xml;FSM→fsm.xml)。可选 treeIds 过滤(导出选择)。 */
  function behaviorXmls(treeIds?: string[]): { name: string; xml: string; kind: "behavior_tree" | "state_machine" }[] {
    const out: { name: string; xml: string; kind: "behavior_tree" | "state_machine" }[] = [];
    const wanted = treeIds && treeIds.length ? new Set(treeIds) : null;
    for (const t of trees.value) {
      if (wanted && !wanted.has(t.treeId)) continue;
      try {
        if ((t.projectKind ?? "behavior_tree") === "state_machine") {
          out.push({ name: t.treeName, xml: serializeFsmXml(t), kind: "state_machine" });
        } else {
          out.push({ name: t.treeName, xml: serializeBehaviorTreeXml(toBehaviorTreeDef(t, { blackboards: visibleBlackboards(t.treeId) })), kind: "behavior_tree" });
        }
      } catch {
        /* 跳过导出失败的树 */
      }
    }
    return out;
  }

  /** 生成完整可编译工程文件集(R7):用户类 + main + CMake + 行为树。可选 treeIds 过滤。 */
  function generateProjectFiles(treeIds?: string[]): CppFile[] {
    return generateProject({
      workspaceName: workspaceName.value,
      namespace: cppNamespace.value,
      catalog: catalogBundle(),
      behaviors: behaviorXmls(treeIds),
    });
  }
  /** 解析 meta.xml 并合并进目录(同名 className/函数去重)。 */
  function applyMetaXml(xml: string): { classes: number; functions: number; enums: number } {
    const parsed = parseMetaXml(xml);
    for (const c of parsed.classes ?? []) {
      if (!classes.value.find((x) => x.className === c.className)) classes.value.push(c);
    }
    for (const m of parsed.members ?? []) members.value.push(m);
    for (const f of parsed.functionCatalog?.functions ?? []) {
      if (!functionCatalog.value.functions.find((x) => x.name === f.name && x.ownerClass === f.ownerClass)) {
        functionCatalog.value.functions.push(f);
      }
    }
    for (const e of parsed.enums ?? []) {
      if (!enums.value.find((x) => x.name === e.name)) enums.value.push(e);
    }
    for (const s of parsed.structs ?? []) {
      if (!structs.value.find((x) => x.name === s.name)) structs.value.push(s);
    }
    bump();
    console.success("import", `应用 meta.xml:类 ${parsed.classes?.length ?? 0}、函数 ${parsed.functionCatalog?.functions?.length ?? 0}、枚举 ${parsed.enums?.length ?? 0}`);
    return {
      classes: parsed.classes?.length ?? 0,
      functions: parsed.functionCatalog?.functions?.length ?? 0,
      enums: parsed.enums?.length ?? 0,
    };
  }

  /** 导入 *.workspace.xml:还原全局黑板 + 类型目录 + 行为树。 */
  function importWorkspaceXml(xml: string): void {
    const res = parseWorkspaceXml(xml);
    // 恢复工作空间配置(名称/语言/模型目录/导出目录/命名空间)
    workspaceName.value = res.name || workspaceName.value;
    if (res.language) language.value = res.language as "cpp" | "cs";
    if (res.config.modelRoot) modelRoot.value = res.config.modelRoot;
    if (res.config.exportCodeDir) exportCodeDir.value = res.config.exportCodeDir;
    if (res.config.exportXmlDir) exportXmlDir.value = res.config.exportXmlDir;
    if (res.config.cppNamespace) cppNamespace.value = res.config.cppNamespace;
    if (res.config.engineSrcDir) engineSrcDir.value = res.config.engineSrcDir;
    if (res.config.workspaceFilePath) workspaceFilePath.value = res.config.workspaceFilePath;
    // 合并目录
    for (const cls of res.catalog.classes ?? []) {
      if (!classes.value.find((x) => x.className === cls.className)) classes.value.push(cls);
    }
    for (const m of res.catalog.members ?? []) members.value.push(m);
    for (const f of res.catalog.functionCatalog?.functions ?? []) {
      if (!functionCatalog.value.functions.find((x) => x.name === f.name && x.ownerClass === f.ownerClass)) {
        functionCatalog.value.functions.push(f);
      }
    }
    for (const e of res.catalog.enums ?? []) if (!enums.value.find((x) => x.name === e.name)) enums.value.push(e);
    for (const s of res.catalog.structs ?? []) if (!structs.value.find((x) => x.name === s.name)) structs.value.push(s);
    // 全局黑板
    for (const bb of res.globalBlackboards) {
      if (!globalBlackboards.value.find((x) => x.blackboardId === bb.blackboardId)) globalBlackboards.value.push(bb);
    }
    // 行为树 + 状态机(parseWorkspaceXml 已合并为 DesignTree)
    // 每个 tree 的输入/输出绑定里的 blackboardKey 若落到某个全局黑板 → 自动 link,
    // 否则 visibleBlackboards() 只看得到本地板,varIndex 里没有 global 变量,
    // 校验会误报"输入 xxx 绑定的黑板变量缺失"(工作空间 XML 本身不落 linkedGlobalIds)。
    const globalIds = new Set(res.globalBlackboards.map((b) => b.blackboardId));
    let firstTreeId = "";
    let btCount = 0;
    let fsmCount = 0;
    for (const t of res.behaviorTrees) {
      registerTree(t, createBlackboard(`${t.treeName}-本地板`, "tree", { blackboardId: t.localBlackboardId }));
      const usedGlobals = new Set<string>();
      for (const n of Object.values(t.nodes)) {
        for (const b of n.inputBindings) if (b.blackboardId && globalIds.has(b.blackboardId)) usedGlobals.add(b.blackboardId);
        for (const b of n.outputBindings) if (b.blackboardId && globalIds.has(b.blackboardId)) usedGlobals.add(b.blackboardId);
      }
      for (const gid of usedGlobals) {
        if (!t.linkedGlobalBlackboardIds.includes(gid)) t.linkedGlobalBlackboardIds.push(gid);
      }
      if ((t.projectKind ?? "behavior_tree") === "state_machine") fsmCount++;
      else btCount++;
      if (!firstTreeId) firstTreeId = t.treeId;
    }
    // 通过 switchTree 切换:触发首次进入树的 autoLayout(导入的运行 XML 无 nodeLayouts,
    // 否则节点全堆在 (200,200))。
    if (firstTreeId) switchTree(firstTreeId);
    // 目录就绪后重建所有节点绑定(补齐入参 + 默认值),修复重开不显示参数。
    reconcileAllBindings();
    // 重建后对所有树执行布局,确保切换其它树也已布局过。
    for (const t of trees.value) layoutTree(t.treeId);
    bump();
    validate();
    console.success("import", `导入工程 ${res.name}:行为树 ${btCount}、状态机 ${fsmCount}、类 ${res.catalog.classes?.length ?? 0}`);
  }

  /** 当前工程是否状态机。 */
  const isStateMachine = computed(() => (currentTree.value?.projectKind ?? "behavior_tree") === "state_machine");

  /** 导出状态机为 behaviac 式 FSM XML。 */
  function exportFsmCurrent(): { ok: boolean; xml?: string; error?: string } {
    const t = currentTree.value;
    if (!t) return { ok: false, error: "无当前工程" };
    // 校验闸:有错误不可导出
    const errs = validate().filter((i) => i.level === "error");
    if (errs.length) {
      const msg = `存在 ${errs.length} 个错误,修正后再导出:${errs[0]!.message}`;
      console.error("export", `状态机导出阻断 ${t.treeName}: ${msg}`, { relatedAssetId: t.treeId });
      return { ok: false, error: msg };
    }
    try {
      const xml = serializeFsmXml(t);
      console.success("export", `状态机导出成功 ${t.treeName}`, { relatedAssetId: t.treeId });
      return { ok: true, xml };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("export", `状态机导出失败 ${t.treeName}: ${msg}`, { relatedAssetId: t.treeId });
      return { ok: false, error: msg };
    }
  }

  function importXml(xml: string): void {
    const result = importer.importRuntimeXml(xml);
    const tree = result.tree;
    tree.mode = mode.value;
    registerTree(tree, result.localBlackboard);
    for (const g of result.globalBlackboards) {
      if (!globalBlackboards.value.find((b) => b.blackboardId === g.blackboardId)) {
        globalBlackboards.value.push(g);
      }
      if (!tree.linkedGlobalBlackboardIds.includes(g.blackboardId)) {
        tree.linkedGlobalBlackboardIds.push(g.blackboardId);
      }
    }
    switchTree(tree.treeId);
    // 依据目录重建绑定:运行 XML 不含完整入参时,补齐参数(带默认值)以便面板渲染与导出。
    reconcileAllBindings();
    console.success("import", `导入 XML 完成,未解决映射 ${result.report.unresolvedCount} 项`, {
      relatedAssetId: tree.treeId,
    });
    bump();
    validate();
  }

  function deleteTrees(ids: string[]): void {
    for (const id of ids) {
      buses.delete(id);
      delete localBlackboards.value[id];
    }
    trees.value = trees.value.filter((t) => !ids.includes(t.treeId));
    if (!trees.value.find((t) => t.treeId === currentTreeId.value)) {
      currentTreeId.value = trees.value[0]?.treeId ?? "";
    }
    console.warning("workspace", `批量删除 ${ids.length} 棵树`);
    bump();
  }

  // --- 最近工作空间(localStorage 持久化:刷新/重启后保留近 8 个;每条带名+时间+完整 XML)---
  const RECENT_KEY = "bt-studio:recent-workspaces";
  const RECENT_LIMIT = 8;
  type RecentEntry = { name: string; savedAt: number; xml: string; sizeKB: number };
  const recentWorkspaces = ref<RecentEntry[]>([]);

  function loadRecentFromStorage(): void {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return;
      const list = JSON.parse(raw) as RecentEntry[];
      if (Array.isArray(list)) recentWorkspaces.value = list;
    } catch {
      /* 忽略损坏的本地存储 */
    }
  }

  function saveRecentToStorage(): void {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentWorkspaces.value));
    } catch {
      /* 配额溢出/隐私模式:忽略 */
    }
  }

  /** 记入最近工作空间(同名覆盖,按时间倒序,超出 limit 截断)。导出 XML 与打开 XML 时调用。 */
  function rememberRecent(name: string, xml: string): void {
    const now = Date.now();
    const sizeKB = Math.round(xml.length / 1024);
    const next = recentWorkspaces.value.filter((r) => r.name !== name);
    next.unshift({ name, savedAt: now, xml, sizeKB });
    recentWorkspaces.value = next.slice(0, RECENT_LIMIT);
    saveRecentToStorage();
  }

  /** 从最近列表加载第 idx 项(还原工作空间)。 */
  function loadRecent(idx: number): boolean {
    const entry = recentWorkspaces.value[idx];
    if (!entry) return false;
    importWorkspaceXml(entry.xml);
    return true;
  }

  /** 从最近列表移除第 idx 项。 */
  function removeRecent(idx: number): void {
    recentWorkspaces.value = recentWorkspaces.value.filter((_, i) => i !== idx);
    saveRecentToStorage();
  }

  loadRecentFromStorage();
  watch(recentWorkspaces, saveRecentToStorage, { deep: true });

  return {
    mode,
    workspaceName,
    modelRoot,
    exportCodeDir,
    exportXmlDir,
    language,
    cppNamespace,
    engineSrcDir,
    workspaceFilePath,
    loadModelClasses,
    modelRawClasses,
    modelRawFunctions,
    parseModelDir,
    parseModelDirPaired,
    extractToTypeSpace,
    newWorkspace,
    reconcileAllBindings,
    behaviorXmls,
    generateProjectFiles,
    trees,
    buses,
    localBlackboards,
    currentTreeId,
    selectedNodeId,
    clipboard,
    issues,
    allIssues,
    allErrorCount,
    allWarningCount,
    validateAll,
    exportBlockers,
    codegenBlockers,
    rev,
    functionCatalog,
    globalBlackboards,
    enums,
    types,
    classes,
    members,
    structs,
    currentTree,
    currentBus,
    selectedNode,
    errorCount,
    warningCount,
    canExport,
    isStateMachine,
    exportFsmCurrent,
    exportMetaXml,
    exportWorkspaceXml,
    exportCppFiles,
    applyMetaXml,
    importWorkspaceXml,
    catalogBundle,
    visibleBlackboards,
    newTree,
    switchTree,
    run,
    runBatch,
    undo,
    redo,
    layout,
    layoutTree,
    validate,
    exportCurrent,
    importXml,
    deleteTrees,
    registerTree,
    bump,
    recentWorkspaces,
    rememberRecent,
    loadRecent,
    removeRecent,
    triggerRefHack: () => triggerRef(trees),
  };
});
