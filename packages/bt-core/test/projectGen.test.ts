import { describe, it, expect } from "vitest";
import { generateProject, type CatalogBundle } from "../src/index.js";

function catalog(): CatalogBundle {
  return {
    functionCatalog: {
      functions: [
        {
          functionId: "f1",
          name: "DoThing",
          category: "action",
          bindingTarget: "MyAgent.DoThing",
          ownerClass: "MyAgent",
          returnType: "CyberDFMPFRC",
          version: "DOTHING",
          intendedCmd: "DO_THING",
          params: [
            { paramId: "p", name: "TARGET_ID", direction: "input", displayType: "int", malType: "CYBER_MARGTYPE_INTEGER", valueFormat: "literal", required: true, originalType: "CyberIntegerType" },
            { paramId: "p2", name: "RESULT", direction: "output", displayType: "float", malType: "CYBER_MARGTYPE_REAL", valueFormat: "literal", required: false, originalType: "CyberRealType" },
          ],
        },
      ],
    },
    globalBlackboards: [], enums: [], structs: [], types: [],
    classes: [
      { classId: "c1", className: "MyAgent", displayName: "MyAgent", category: "user", hostModule: "", source: "user" },
      { classId: "c2", className: "FZAirFighter", displayName: "战机", category: "RuleDecision", hostModule: "", source: "model" },
    ],
    members: [{ memberId: "m1", ownerClassId: "c1", memberName: "count", valueType: "int", accessMode: "readwrite", bindingPath: "" }],
  };
}

describe("完整工程生成:依赖库 runtime + 类型实现 types", () => {
  it("两部分清晰拆分,且 cpp 方法体读写 MAL(非空实现)", () => {
    const files = generateProject({
      workspaceName: "demo_proj",
      namespace: "btproj",
      catalog: catalog(),
      behaviors: [{ name: "main_tree", xml: "<?xml version='1.0'?>\n<Root id=\"1\" projectType=\"行为树\"/>" }],
    });
    const paths = files.map((f) => f.path);

    // ① 依赖库 runtime/
    expect(paths).toContain("runtime/include/fosim/cyber_types.h");
    expect(paths).toContain("runtime/include/fosim/bt_runtime.h");
    expect(paths).toContain("runtime/src/bt_runtime.cpp");
    expect(paths).toContain("runtime/CMakeLists.txt");
    // ② 类型实现 types/
    expect(paths).toContain("types/include/btproj/types.h");
    expect(paths).toContain("types/include/btproj/MyAgent.h");
    expect(paths).toContain("types/src/MyAgent.cpp");
    expect(paths).toContain("types/CMakeLists.txt");
    // app + 顶层
    expect(paths).toContain("app/main.cpp");
    expect(paths).toContain("CMakeLists.txt");
    expect(paths).toContain("behaviors/main_tree.bt.xml");
    // 模型类不生成
    expect(paths).not.toContain("types/include/btproj/FZAirFighter.h");

    // 类头
    const h = files.find((f) => f.path === "types/include/btproj/MyAgent.h")!.content;
    expect(h).toContain("class MyAgent : public CyberDecisionAgentBase");
    expect(h).toContain("CyberDFMPFRC DoThing(CyberMalImpl* in_mal, CyberMalImpl* out_mal)");
    expect(h).toContain("RegisterFunctions");

    // 类实现:注册 + 真实方法体(读 in_mal / 写 out_mal)
    const cpp = files.find((f) => f.path === "types/src/MyAgent.cpp")!.content;
    expect(cpp).toContain("RegisterDecisionFunction(\"DO_THING\", \"DoThing\"");
    expect(cpp).toContain("(ProcessDecisionFunctionPtr)&MyAgent::DoThing");
    expect(cpp).toContain('in_mal->GetInteger("TARGET_ID")'); // 输入参数读取
    expect(cpp).toContain('out_mal->AddReal("RESULT", RESULT)'); // 输出参数写回
    expect(cpp).toContain("BEGIN WRITING YOUR CODE DoThing"); // 保留区
    expect(cpp).toContain("return CYBER_DFMPFRC_SINGLE;");

    // 依赖库:MAL 完整 Get/Add API + 注册类型
    const fz = files.find((f) => f.path === "runtime/include/fosim/cyber_types.h")!.content;
    expect(fz).toContain("enum CyberDFMPFRC");
    expect(fz).toContain("ProcessDecisionFunctionPtr");
    expect(fz).toContain("GetInteger");
    expect(fz).toContain("AddReal");

    // runtime CMake:工程内相对路径,构建为库
    const rt = files.find((f) => f.path === "runtime/CMakeLists.txt")!.content;
    expect(rt).toContain("add_library(fosim_bt_runtime");
    expect(rt).toContain("${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp");
    expect(rt).not.toContain("FOSimEngine");

    // types CMake:依赖 runtime
    const tcm = files.find((f) => f.path === "types/CMakeLists.txt")!.content;
    expect(tcm).toContain("add_library(btproj_types");
    expect(tcm).toContain("fosim_bt_runtime");
    expect(tcm).toContain("src/MyAgent.cpp");

    // 顶层 CMake:两个子目录 + 链接两库
    const cmake = files.find((f) => f.path === "CMakeLists.txt")!.content;
    expect(cmake).toContain("add_subdirectory(runtime)");
    expect(cmake).toContain("add_subdirectory(types)");
    expect(cmake).toContain("btproj_types");

    // main:加载 + 绑定 + 并行驱动(多 BT + 多 FSM 同时 tick)
    const main = files.find((f) => f.path === "app/main.cpp")!.content;
    expect(main).toContain("BT::BTXmlLoader");
    expect(main).toContain("LoadFromContent");
    expect(main).toContain("behaviors/main_tree.bt.xml");
    expect(main).toContain("btPaths"); // 编译期清单
    expect(main).toContain("fsmPaths");
    expect(main).toContain("ticked in parallel"); // 单帧循环并行 tick 的输出

    // 无写死外部引擎绝对路径
    for (const f of files) expect(f.content).not.toContain("F:/FOSim");

    // Runtime 对齐引擎 modules/extern:BTNodeKind 全量枚举 + 递归下降解析 + 每 kind 独立 Task + 观察者。
    const rth = files.find((f) => f.path === "runtime/include/fosim/bt_runtime.h")!.content;
    expect(rth).toContain("enum class BTNodeKind");
    expect(rth).toContain("Sequence");
    expect(rth).toContain("Selector");
    expect(rth).toContain("Parallel");
    expect(rth).toContain("IfElse");
    expect(rth).toContain("Loop");
    expect(rth).toContain("Invert");
    expect(rth).toContain("SuccessUntil");
    expect(rth).toContain("BTTraceEvent");     // 观察者事件结构
    expect(rth).toContain("SetTraceSink");     // 观察者注入点
    expect(rth).toContain("BTNodeDef");        // 静态定义(对齐 bt_node_def.h)
    expect(rth).toContain("BlackboardDef");    // 黑板定义
    const rtc = files.find((f) => f.path === "runtime/src/bt_runtime.cpp")!.content;
    expect(rtc).toContain("FOSIM_BT_TRACE");   // env var 控制观察者输出
    expect(rtc).toContain("[BT_TRACE]");       // 默认 stdout sink 前缀
    expect(rtc).toContain("SequenceTask");
    expect(rtc).toContain("SelectorTask");
    expect(rtc).toContain("ParallelTask");
    expect(rtc).toContain("IfElseTask");
    expect(rtc).toContain("LoopTask");
    expect(rtc).toContain("KindFromName");     // 对齐引擎 NodeKindFromName
    expect(rtc).toContain("IsMetadataNode");   // 跳过 Blackboards/ReferencedBehaviorTrees
    // Leaf 真调用注册的成员函数指针(否则 Action 里的断点永远不进)
    expect(rtc).toContain("ResolveAgent");
    expect(rtc).toContain("FindFunction");
    expect(rtc).toContain("InvokeDecisionFunction");
    // 决策函数指针求值助手 + FindFunction 声明在 cyber_types.h
    expect(fz).toContain("FindFunction");
    expect(fz).toContain("InvokeDecisionFunction");

    // 关键编译修复:决策函数指针用未定义类(最通用成员函数指针表示,避免 MSVC C4407)
    const fz0 = files.find((f) => f.path === "runtime/include/fosim/cyber_types.h")!.content;
    expect(fz0).toContain("class __UnexistingClass;");
    expect(fz0).toContain("__UnexistingClass::*ProcessDecisionFunctionPtr");

    // 自动化逻辑校验:tick_check.cpp 存在,加进 ctest,遍历 behaviors/*.bt.xml
    expect(paths).toContain("tests/tick_check.cpp");
    const tc = files.find((f) => f.path === "tests/tick_check.cpp")!.content;
    expect(tc).toContain("BT::BTXmlLoader");
    expect(tc).toContain("behaviors/main_tree.bt.xml");
    expect(tc).toContain("CheckTree(");
    expect(cmake).toContain("enable_testing()");
    expect(cmake).toContain("add_executable(tick_check tests/tick_check.cpp)");
    expect(cmake).toContain("add_test(NAME logic_check");
    // 顶层 CMake 条件性接入 engine-core/(fetchBundledRuntime 提供)
    expect(cmake).toContain("engine-core/CMakeLists.txt");
  });

  it("状态机:生成 FSM 运行时(loader+task)、*.fsm.xml、main 选择 FSM 分支", () => {
    const files = generateProject({
      workspaceName: "fsm_proj",
      namespace: "btproj",
      catalog: catalog(),
      behaviors: [
        // 新版嵌套 FSM XML(<State> 内嵌 <ConditionTransform>,与 exporter/fsmXml.ts 输出对齐)
        { name: "air_fsm", kind: "state_machine", xml: "<?xml version='1.0'?>\n<Root id=\"1\" projectType=\"状态机\"><State id=\"1\" name=\"巡逻\" action=\"Patrol\"><ConditionTransform id=\"2\" name=\"SeeEnemy\" action=\"SeeEnemy\"><Goto id=\"1\"/></ConditionTransform></State></Root>" },
      ],
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain("runtime/include/fosim/fsm_runtime.h");
    expect(paths).toContain("runtime/src/fsm_runtime.cpp");
    expect(paths).toContain("behaviors/air_fsm.fsm.xml");
    const fsm = files.find((f) => f.path === "runtime/src/fsm_runtime.cpp")!.content;
    expect(fsm).toContain("StateMachineLoader::LoadFromContent");
    // 新版 loader:嵌套 <State>+<ConditionTransform>+<Goto>,不再走老扁平格式
    expect(fsm).toContain("ConditionTransform");
    expect(fsm).toContain("Goto");
    expect(fsm).toContain("StateMachineTask::Tick");
    const main = files.find((f) => f.path === "app/main.cpp")!.content;
    expect(main).toContain("FSM::StateMachineLoader");
    expect(main).toContain("FSM::CreateStateMachineTask");
    expect(main).toContain("behaviors/air_fsm.fsm.xml");
  });

  it("可编译性:静态成员用 inline static;无用户类时 types 库为 INTERFACE(避免 CMake 无源报错)", () => {
    // 含静态成员的用户类 → inline static(否则 C++ 类内初始化非法)
    const catWithStatic: CatalogBundle = {
      functionCatalog: { functions: [] },
      globalBlackboards: [], enums: [], structs: [], types: [],
      classes: [{ classId: "c1", className: "A", displayName: "A", category: "user", hostModule: "", source: "user" }],
      members: [{ memberId: "m", ownerClassId: "c1", memberName: "g", valueType: "CyberIntegerType", accessMode: "readwrite", bindingPath: "", static: true }],
    };
    const f1 = generateProject({ workspaceName: "p", namespace: "ns", catalog: catWithStatic, behaviors: [] });
    const ah = f1.find((f) => f.path === "types/include/ns/A.h")!;
    expect(ah.content).toContain("inline static CyberIntegerType g");

    // 无用户类 → INTERFACE 库
    const empty: CatalogBundle = { functionCatalog: { functions: [] }, globalBlackboards: [], enums: [], structs: [], types: [], classes: [], members: [] };
    const f2 = generateProject({ workspaceName: "p", namespace: "ns", catalog: empty, behaviors: [] });
    const tcm = f2.find((f) => f.path === "types/CMakeLists.txt")!.content;
    expect(tcm).toContain("add_library(ns_types INTERFACE)");
    expect(tcm).not.toContain("STATIC\n)"); // 不应出现无源 STATIC 库
    const top = f2.find((f) => f.path === "CMakeLists.txt")!.content;
    expect(top).toContain("target_link_libraries(${PROJECT_NAME} PRIVATE ns_types fosim_bt_runtime)");
  });

  it("抽取来的模型类(source=model)只要含方法,也导出完整 .h/.cpp(类型实现)", () => {
    const cat: CatalogBundle = {
      functionCatalog: {
        functions: [
          { functionId: "e1", name: "Engage", category: "action", bindingTarget: "FZAirFighter.Engage", ownerClass: "FZAirFighter", returnType: "CyberDFMPFRC", intendedCmd: "ENGAGE", params: [{ paramId: "t", name: "TARGET_ID", direction: "input", displayType: "int", malType: "CYBER_MARGTYPE_INTEGER", valueFormat: "literal", required: true, originalType: "CyberIntegerType" }] },
        ],
      },
      globalBlackboards: [], enums: [], structs: [], types: [],
      classes: [{ classId: "c2", className: "FZAirFighter", displayName: "战机", category: "RuleDecision", hostModule: "", source: "model" }],
      members: [],
    };
    const files = generateProject({ workspaceName: "demo", namespace: "btproj", catalog: cat, behaviors: [{ name: "t", xml: "<Root id=\"1\"/>" }] });
    const paths = files.map((f) => f.path);
    expect(paths).toContain("types/include/btproj/FZAirFighter.h");
    expect(paths).toContain("types/src/FZAirFighter.cpp");
    const cpp = files.find((f) => f.path === "types/src/FZAirFighter.cpp")!.content;
    expect(cpp).toContain('RegisterDecisionFunction("ENGAGE", "Engage"');
    expect(cpp).toContain('in_mal->GetInteger("TARGET_ID")');
    const h = files.find((f) => f.path === "types/include/btproj/FZAirFighter.h")!.content;
    expect(h).toContain("class FZAirFighter : public CyberDecisionAgentBase");
  });
});
