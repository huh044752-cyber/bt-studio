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

    // main:加载 + 绑定 + 驱动
    const main = files.find((f) => f.path === "app/main.cpp")!.content;
    expect(main).toContain("BT::BTXmlLoader");
    expect(main).toContain("LoadFromContent");
    expect(main).toContain("behaviors/main_tree.bt.xml");
    expect(main).toContain("RegisterFunctions()");

    // 无写死外部引擎绝对路径
    for (const f of files) expect(f.content).not.toContain("F:/FOSim");

    // 关键编译修复:决策函数指针用未定义类(最通用成员函数指针表示,避免 MSVC C4407)
    const fz0 = files.find((f) => f.path === "runtime/include/fosim/cyber_types.h")!.content;
    expect(fz0).toContain("class __UnexistingClass;");
    expect(fz0).toContain("__UnexistingClass::*ProcessDecisionFunctionPtr");
  });

  it("状态机:生成 FSM 运行时(loader+task)、*.fsm.xml、main 选择 FSM 分支", () => {
    const files = generateProject({
      workspaceName: "fsm_proj",
      namespace: "btproj",
      catalog: catalog(),
      behaviors: [
        { name: "air_fsm", kind: "state_machine", xml: "<?xml version='1.0'?>\n<Root id=\"1\" projectType=\"状态机\"><FSMNodes><Node Class=\"State\" Id=\"1\" Name=\"巡逻\" Method=\"Patrol\"><Attachment Class=\"TransitionCondition\" Id=\"2\" TargetFSMNodeId=\"1\" Opl=\"SeeEnemy\"/></Node></FSMNodes></Root>" },
      ],
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain("runtime/include/fosim/fsm_runtime.h");
    expect(paths).toContain("runtime/src/fsm_runtime.cpp");
    expect(paths).toContain("behaviors/air_fsm.fsm.xml");
    const fsm = files.find((f) => f.path === "runtime/src/fsm_runtime.cpp")!.content;
    expect(fsm).toContain("StateMachineLoader::LoadFromContent");
    expect(fsm).toContain("TargetFSMNodeId");
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
