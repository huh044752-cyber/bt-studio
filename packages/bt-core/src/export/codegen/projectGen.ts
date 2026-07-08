/**
 * 生成完整可编译 C++ 工程,明确拆成两部分(对齐 behaviac 的"运行库 + 生成类型"):
 *
 *  ① 依赖库 runtime/  —— 行为树/状态机的【解析 + 映射 + 调度】+ MAL(对齐引擎 modules/extern + core/mal)。
 *     编译为库 fosim_bt_runtime。配置了引擎源码目录时,真实引擎头文件/MAL/loader 会被拷贝进此目录(不魔改)。
 *  ② 类型实现 types/  —— 枚举/结构体 + Agent 类的【完整实现】:成员、决策方法(读 in_mal 参数 / 写 out_mal)、
 *     RegisterFunctions(RegisterDecisionFunction 函数地址绑定)。编译为库 <ns>_types,依赖 runtime。
 *
 *  app/main.cpp 把两者组合:① 加载 XML ② 绑定函数地址 ③ 外部驱动 Tick。
 *
 * 参考:F:\FOSim\FOSimEngine\src\modules\extern(BT/FSM 运行时)、core/mal(CyberMalImpl 的 Get/Add API)、
 *      models/mount_model(RegisterDecisionFunction / DecisionFunctionInitialParameter / ProcessDecisionFunctionPtr)。
 */
import type { CatalogBundle, FunctionParam } from "../../types/catalog.js";
import { functionOwnerClass } from "../../types/catalog.js";
import type { CppFile } from "./cppCodegen.js";
import { generateCpp } from "./cppCodegen.js";

export interface ProjectGenInput {
  workspaceName: string;
  namespace: string;
  catalog: CatalogBundle;
  /** 导出的行为树/状态机运行 XML。kind 缺省按 behavior_tree。 */
  behaviors: { name: string; xml: string; kind?: "behavior_tree" | "state_machine" }[];
}

function cppMemberType(t: string): string {
  const s = (t || "").toLowerCase();
  if (s.includes("bool")) return "CyberBOOL";
  if (s.includes("real") || s.includes("float")) return "CyberRealType";
  if (s.includes("int")) return "CyberIntegerType";
  if (s.includes("vector")) return "CyberVectorType";
  if (s.includes("position")) return "CyberPositionType";
  if (s.includes("coordinate")) return "CyberCoordinateType";
  if (s.includes("orientation")) return "CyberOrientationType";
  if (s.includes("name") || s.includes("string")) return "std::string";
  return "CyberIntegerType";
}

/** 参数运行类型(优先 originalType,否则按 malType 反推 Cyber 串)。 */
function paramCyber(p: FunctionParam): string {
  if (p.originalType && (p.originalType.startsWith("Cyber") || p.originalType.startsWith("FZ"))) {
    // 兼容导入的遗留 FZ* 输入串(用户可能有从新引擎导出的旧模型数据),归一到 Cyber* 后再走匹配
    return p.originalType.replace(/^FZ/, "Cyber");
  }
  const m = (p.malType ?? "").toUpperCase();
  if (m.includes("BOOL")) return "CyberBOOL";
  if (m.includes("REAL")) return "CyberRealType";
  if (m.includes("INTEGER")) return "CyberIntegerType";
  if (m.includes("VECTOR")) return "CyberVectorType";
  if (m.includes("POSITION")) return "CyberPositionType";
  if (m.includes("COORDINATE")) return "CyberCoordinateType";
  if (m.includes("ORIENTATION")) return "CyberOrientationType";
  if (m.includes("JULIAN")) return "CyberJulianType";
  if (m.includes("NAME")) return "CyberNameType";
  return "CyberStringType";
}

function baseOf(_catalog: CatalogBundle, _className: string): string {
  // 生成代码统一直接继承 CyberDecisionAgentBase(无业务/实体的纯函数地址绑定基类)。
  return "CyberDecisionAgentBase";
}

/** 输入参数:从 in_mal 读取的声明语句(对齐引擎 CyberMalImpl::Get* API)。 */
function readInput(p: FunctionParam): string {
  const n = p.name;
  switch (paramCyber(p)) {
    case "CyberIntegerType": return `    CyberIntegerType ${n} = in_mal->GetInteger("${n}");`;
    case "CyberRealType": return `    CyberRealType ${n} = in_mal->GetReal("${n}");`;
    case "CyberBOOL": return `    CyberBOOL ${n} = in_mal->GetBoolean("${n}");`;
    case "CyberVectorType": return `    CyberVectorType ${n} = in_mal->GetVector("${n}");`;
    case "CyberPositionType": return `    CyberPositionType ${n} = in_mal->GetPosition("${n}");`;
    case "CyberCoordinateType": return `    CyberCoordinateType ${n} = in_mal->GetCoordinate("${n}");`;
    case "CyberOrientationType": return `    CyberOrientationType ${n} = in_mal->GetOrientation("${n}");`;
    case "CyberJulianType": return `    CyberJulianType ${n} = in_mal->GetJulian("${n}");`;
    case "CyberNameType": return `    char ${n}[256] = {0}; in_mal->GetName("${n}", ${n});`;
    default: return `    char* ${n} = nullptr; in_mal->GetString("${n}", ${n});`;
  }
}

/** 输出参数:声明默认值 + 末尾写回 out_mal。 */
function declOutput(p: FunctionParam): string {
  const n = p.name;
  switch (paramCyber(p)) {
    case "CyberIntegerType": return `    CyberIntegerType ${n} = 0;`;
    case "CyberRealType": return `    CyberRealType ${n} = 0.0;`;
    case "CyberBOOL": return `    CyberBOOL ${n} = false;`;
    case "CyberVectorType": return `    CyberVectorType ${n};`;
    case "CyberPositionType": return `    CyberPositionType ${n};`;
    case "CyberCoordinateType": return `    CyberCoordinateType ${n};`;
    case "CyberOrientationType": return `    CyberOrientationType ${n};`;
    case "CyberJulianType": return `    CyberJulianType ${n} = 0.0;`;
    default: return `    std::string ${n};`;
  }
}
function writeOutput(p: FunctionParam): string {
  const n = p.name;
  switch (paramCyber(p)) {
    case "CyberIntegerType": return `    out_mal->AddInteger("${n}", ${n});`;
    case "CyberRealType": return `    out_mal->AddReal("${n}", ${n});`;
    case "CyberBOOL": return `    out_mal->AddBoolean("${n}", ${n});`;
    case "CyberVectorType": return `    out_mal->AddVector("${n}", ${n});`;
    case "CyberPositionType": return `    out_mal->AddPosition("${n}", ${n});`;
    case "CyberCoordinateType": return `    out_mal->AddCoordinate("${n}", ${n});`;
    case "CyberOrientationType": return `    out_mal->AddOrientation("${n}", ${n});`;
    case "CyberJulianType": return `    out_mal->AddJulian("${n}", ${n});`;
    default: return `    out_mal->AddName("${n}", ${n}.c_str());`;
  }
}

// ============ ① 依赖库 runtime/ ============

/** runtime:Cyber 决策类型 + MAL(Get/Add 完整 API,对齐老引擎 cyber_enum_type.h + cyber_mal_impl.h)。自包含可独立编译。 */
function cyberTypesHeader(_catalog: CatalogBundle): string {
  return `// 由 BT Studio 生成 —— 依赖库:Cyber 决策类型 + MAL(对齐 FOSim 老引擎 core/mal,无业务/实体)。
// 接入真实引擎时,本文件由引擎 core/mal/fz_mal_impl.h 等替换,生成代码的 Get*/Add* 调用保持兼容。
#pragma once
#ifdef _MSC_VER
// MSVC:成员函数指针默认按派生类继承层级取紧凑表示,与 __UnexistingClass::* 不兼容会触发 C2440。
// 强制整个翻译单元的成员函数指针都按"最通用表示",这样 (ProcessDecisionFunctionPtr)&Derived::Method 才能编译通过。
#pragma pointers_to_members(full_generality, virtual_inheritance)
#endif
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <functional>
#include <cstring>

// 决策函数返回值(对齐 FOSim CyberDFMPFRC)。
enum CyberDFMPFRC { CYBER_DFMPFRC_UNKNOWN = 0, CYBER_DFMPFRC_CONTINUOUS = 1, CYBER_DFMPFRC_SINGLE = 2, CYBER_DFMPFRC_ERROR = 3 };

// Cyber 基础类型别名(对齐引擎命名)。
typedef long CyberIntegerType;
typedef double CyberRealType;
typedef bool CyberBOOL;
typedef double CyberJulianType;
typedef std::string CyberNameType;
typedef std::vector<double> CyberVectorType;
struct CyberPositionType { double x = 0, y = 0, z = 0; };
struct CyberCoordinateType { double longitude = 0, latitude = 0, altitude = 0; };
struct CyberOrientationType { double yaw = 0, pitch = 0, roll = 0; };

// MAL(方法参数列表):按名读写。Get* 数值/坐标为值返回式(对齐引擎 T Get<Type>(name, CyberRC*=nullptr))。
class CyberMalImpl {
public:
    static CyberMalImpl* CreateMAL() { return new CyberMalImpl(); }

    CyberIntegerType GetInteger(const char* n, void* = nullptr) const { auto it = ints_.find(n); return it == ints_.end() ? 0 : it->second; }
    CyberRealType GetReal(const char* n, void* = nullptr) const { auto it = reals_.find(n); return it == reals_.end() ? 0.0 : it->second; }
    CyberBOOL GetBoolean(const char* n, void* = nullptr) const { auto it = bools_.find(n); return it == bools_.end() ? false : it->second; }
    CyberJulianType GetJulian(const char* n, void* = nullptr) const { return GetReal(n); }
    CyberVectorType GetVector(const char* n, void* = nullptr) const { auto it = vecs_.find(n); return it == vecs_.end() ? CyberVectorType{} : it->second; }
    CyberPositionType GetPosition(const char* n, void* = nullptr) const { auto it = poss_.find(n); return it == poss_.end() ? CyberPositionType{} : it->second; }
    CyberCoordinateType GetCoordinate(const char* n, void* = nullptr) const { auto it = coords_.find(n); return it == coords_.end() ? CyberCoordinateType{} : it->second; }
    CyberOrientationType GetOrientation(const char* n, void* = nullptr) const { auto it = oris_.find(n); return it == oris_.end() ? CyberOrientationType{} : it->second; }
    void GetName(const char* n, char* out) const { auto it = strs_.find(n); std::strncpy(out, it == strs_.end() ? "" : it->second.c_str(), 255); out[255] = 0; }
    void GetString(const char* n, char*& out) const { auto it = strs_.find(n); buf_ = it == strs_.end() ? "" : it->second; out = const_cast<char*>(buf_.c_str()); }

    void AddInteger(const char* n, CyberIntegerType v) { ints_[n] = v; }
    void AddReal(const char* n, CyberRealType v) { reals_[n] = v; }
    void AddBoolean(const char* n, CyberBOOL v) { bools_[n] = v; }
    void AddJulian(const char* n, CyberJulianType v) { reals_[n] = v; }
    void AddVector(const char* n, const CyberVectorType& v) { vecs_[n] = v; }
    void AddPosition(const char* n, const CyberPositionType& v) { poss_[n] = v; }
    void AddCoordinate(const char* n, const CyberCoordinateType& v) { coords_[n] = v; }
    void AddOrientation(const char* n, const CyberOrientationType& v) { oris_[n] = v; }
    void AddName(const char* n, const char* v) { strs_[n] = v ? v : ""; }
    void AddString(const char* n, const char* v) { strs_[n] = v ? v : ""; }
private:
    std::map<std::string, CyberIntegerType> ints_;
    std::map<std::string, CyberRealType> reals_;
    std::map<std::string, CyberBOOL> bools_;
    std::map<std::string, CyberVectorType> vecs_;
    std::map<std::string, CyberPositionType> poss_;
    std::map<std::string, CyberCoordinateType> coords_;
    std::map<std::string, CyberOrientationType> oris_;
    std::map<std::string, std::string> strs_;
    mutable std::string buf_;
};

// 决策函数指针(对齐引擎 fz_struct_record.h):用【未定义类】__UnexistingClass 形成指向成员函数的指针,
// 迫使编译器采用"最通用的成员函数指针表示",于是任意 Agent 派生类的 &Derived::Method 都能安全 (cast) 绑定。
// 若改用已定义的单继承基类(如 CyberDecisionAgentBase),MSVC 会采用紧凑表示,
// (ProcessDecisionFunctionPtr)&Derived::Method 触发 C4407 / 截断,导致编译不过。
class __UnexistingClass;
typedef CyberDFMPFRC (__UnexistingClass::*ProcessDecisionFunctionPtr)(CyberMalImpl*, CyberMalImpl*);

// 注册参数(对齐引擎 DecisionFunctionInitialParameter)。
struct DecisionFunctionInitialParameter {
    CyberRealType delay_time_ = 0.0;
    CyberRealType delay_time_delta_ = 0.0;
    CyberRealType repeat_time_ = 0.0;
    CyberRealType repeat_time_delta_ = 0.0;
    CyberMalImpl* mal_ = nullptr;
    ProcessDecisionFunctionPtr function_ptr_ = nullptr;
};

// 决策 Agent 基类:函数地址绑定(name/CMD -> 函数指针)。无业务/实体。
class CyberDecisionAgentBase {
public:
    CyberDecisionAgentBase() = default;
    virtual ~CyberDecisionAgentBase() = default;
    void RegisterDecisionFunction(const std::string& cmd, const std::string& name, DecisionFunctionInitialParameter* p) {
        functions_[name] = p;
        cmd_to_name_[cmd] = name;
    }
    const std::map<std::string, DecisionFunctionInitialParameter*>& Functions() const { return functions_; }
    // 双通道查询:先按 name(方法名),再按 CMD 反查 name。返回 nullptr 表示未注册。
    DecisionFunctionInitialParameter* FindFunction(const std::string& nameOrCmd) const {
        auto it = functions_.find(nameOrCmd);
        if (it != functions_.end()) return it->second;
        auto it2 = cmd_to_name_.find(nameOrCmd);
        if (it2 != cmd_to_name_.end()) {
            auto it3 = functions_.find(it2->second);
            if (it3 != functions_.end()) return it3->second;
        }
        return nullptr;
    }
protected:
    std::map<std::string, DecisionFunctionInitialParameter*> functions_;
    std::map<std::string, std::string> cmd_to_name_;
};

// 成员函数指针求值助手:对齐引擎 (agent->*function_ptr_)(in, out) 语义。
// ProcessDecisionFunctionPtr 用 __UnexistingClass::* 表示,调用时把 agent 也 cast 到同一未定义类,
// MSVC/GCC/Clang 都会按"最通用成员函数指针表示"寻址,兼容任意 Agent 派生类。
inline CyberDFMPFRC InvokeDecisionFunction(CyberDecisionAgentBase* agent,
                                          ProcessDecisionFunctionPtr fptr,
                                          CyberMalImpl* in, CyberMalImpl* out) {
    if (!agent || !fptr) return CYBER_DFMPFRC_ERROR;
    __UnexistingClass* pseudo = reinterpret_cast<__UnexistingClass*>(agent);
    return (pseudo->*fptr)(in, out);
}

/**
 * Agent 全局注册表(对齐 FOSim 老引擎 register_wrapper.h 的 ClassFactory 模式)。
 * 每个 Agent 类的 .cpp 用 FOSIM_REGISTER_AGENT(ClassName) 宏静态注册,
 * main / tick_check 里只需调 CyberAgentRegistry::instance().RegisterAll(),
 * 不再逐个手写 "MyAgent a; a.RegisterFunctions();"。
 *
 * 设计:
 *   - 静态注册在 main 之前触发(全局对象构造);顺序无关(Agent 之间独立)。
 *   - Registry 用 Meyers singleton,避免"static 初始化顺序未定义"陷阱。
 *   - Factory 里既 make_shared 又 RegisterFunctions,一步到位;实例存活期与 Registry 相同。
 *   - Get(name) 返回 shared_ptr,供 BT/FSM 调度器按 className 查表拿到 Agent 调决策方法。
 */
class CyberAgentRegistry {
public:
    using Factory = std::function<std::shared_ptr<CyberDecisionAgentBase>()>;
    static CyberAgentRegistry& instance() {
        static CyberAgentRegistry inst;
        return inst;
    }
    // 允许覆盖注册(增量迁移/测试常用),最后一次注册胜出。
    void RegisterFactory(const std::string& name, Factory factory) {
        factories_[name] = std::move(factory);
    }
    // 构造所有已注册 Agent 并逐个 RegisterFunctions(在 factory 内触发);多次调用幂等,自动跳过已构造。
    void RegisterAll() {
        for (auto& kv : factories_) {
            if (agents_.find(kv.first) != agents_.end()) continue;
            agents_[kv.first] = kv.second();
        }
    }
    std::shared_ptr<CyberDecisionAgentBase> Get(const std::string& name) const {
        auto it = agents_.find(name);
        return it == agents_.end() ? nullptr : it->second;
    }
    const std::map<std::string, std::shared_ptr<CyberDecisionAgentBase>>& All() const { return agents_; }
    std::size_t FactoryCount() const { return factories_.size(); }
private:
    CyberAgentRegistry() = default;
    std::map<std::string, Factory> factories_;
    std::map<std::string, std::shared_ptr<CyberDecisionAgentBase>> agents_;
};

/**
 * 静态注册宏 —— 在每个 Agent 的 .cpp 底部展开一次(不要放 .h,避免多 TU 重复注册)。
 *   FOSIM_REGISTER_AGENT(BTAirToMCog);
 * 展开为一个匿名 namespace 里的全局 static 对象,构造函数把 factory 塞进 CyberAgentRegistry。
 * 匿名 namespace 保证不同 .cpp 里的同名符号不冲突(每个 TU 独立)。
 */
#define FOSIM_REGISTER_AGENT(ClassName) \
    namespace { \
        struct __FosimAgentReg_##ClassName { \
            __FosimAgentReg_##ClassName() { \
                ::CyberAgentRegistry::instance().RegisterFactory(#ClassName, []() { \
                    auto p = std::make_shared<ClassName>(); \
                    p->RegisterFunctions(); \
                    return p; \
                }); \
            } \
        }; \
        static __FosimAgentReg_##ClassName __fosim_agent_reg_##ClassName; \
    } \
    static_assert(true, "FOSIM_REGISTER_AGENT: allow trailing semicolon")
`;
}

function btRuntimeHeader(): string {
  return `// 由 BT Studio 生成 —— 依赖库:行为树【解析 + 映射 + 调度】接口。
// 对齐引擎 modules/extern/bt_xml_loader.h / bt_node_def.h / bt_task.h / bt_tree_task.h:
//   - 节点角色 BTNodeKind 与真引擎一一对应,避免 Tick 中按字符串再分派。
//   - BTNodeDef 是纯静态描述,不持有任何 Unit/组件/函数指针;运行状态放在 BTTask 层。
//   - Loader 只做结构解析 + 静态校验;函数绑定和 tick 都在 runtime。
//
// 观察者:全局 env "FOSIM_BT_TRACE" 控制每帧节点摘要打印,默认 "summary"。
//   off:     不打印
//   summary: 每次 Tick 每个节点一行 [BT_TRACE] tree/node/role/tick/before/status
//   full:    在 summary 基础上追加输入/输出 MAL 字段简况
#pragma once
#include "fosim/cyber_types.h"
#include <string>
#include <memory>
#include <vector>
#include <map>

namespace BT {

// 与引擎 bt_status.h::BTStatus 顺序对齐。
enum class BTStatus { Invalid, Success, Failure, Running };

// 与引擎 bt_node_def.h::BTNodeKind 对齐(去掉 MonitorBranch/SelectMonitor/End 这几个业务侧目前不使用的成员)。
enum class BTNodeKind {
    Action,
    Condition,
    Sequence,
    Selector,
    And,
    Or,
    Parallel,
    IfElse,
    Loop,
    AlwaysSuccess,
    AlwaysFailure,
    SuccessUntil,
    FailureUntil,
    Invert,
    ConditionTransform,
    Subtree,
    Null,
    Unknown
};

const char* NodeKindName(BTNodeKind kind);
const char* StatusName(BTStatus status);

// InputBinding / OutputBinding 与引擎同名结构对齐。
enum class InputSource { Constant, Blackboard };
struct InputBinding {
    std::string name;
    std::string type;
    std::string value;
    InputSource source = InputSource::Constant;
    std::string blackboardId;
    std::string variableId;
};
struct OutputBinding {
    std::string name;
    std::string blackboardId;
    std::string variableId;
};
struct ModelSelector {
    std::string cognition;
    std::string modelName;
    std::string modelClass;
    std::string modelType;
    std::string componentId;
    std::string componentName;
    std::string componentClass;
    std::string componentType;
};

// BTNodeDef 是 XML Loader 产出的标准节点定义(对齐引擎 bt_node_def.h)。
struct BTNodeDef {
    int id = 0;
    std::string xmlType;
    std::string name;
    std::string functionName;
    std::string behaviorTreeName;
    BTNodeKind kind = BTNodeKind::Unknown;
    ModelSelector target;
    int loopCount = 1;              // Loop
    bool endStatusSuccess = true;   // End/SuccessUntil/FailureUntil
    unsigned int parallelSuccessThreshold = 0;
    unsigned int parallelFailureThreshold = 0;
    // Condition compare(与引擎同名字段一致):Function 或 Output。
    std::string compareType;
    std::string compareOutputName;
    std::string compareOp;
    std::string compareValue;
    std::vector<InputBinding> inputs;
    std::vector<OutputBinding> outputs;
    std::vector<std::shared_ptr<BTNodeDef>> children;
};
typedef std::shared_ptr<BTNodeDef> BTNodeDefPtr;

struct BlackboardValue {
    std::string id;
    std::string key;
    std::string type;
    std::string value;
};
struct BlackboardDef {
    std::string id;
    std::string name;
    bool global = false;
    std::map<std::string, BlackboardValue> variables; // key by variable.id
};

struct BehaviorTreeDef {
    int id = 0;
    std::string name;
    std::string projectType;
    std::map<std::string, BlackboardDef> blackboards; // key by board.id
    std::map<int, BTNodeDefPtr> nodesById;
    BTNodeDefPtr root;
};
using BehaviorTreeDefPtr = std::shared_ptr<BehaviorTreeDef>;

// 解析:把 *.bt.xml 内容解析为定义结构(递归下降,支持所有 BTNodeKind + Blackboards + Inputs/Outputs)。
class BTXmlLoader {
public:
    BehaviorTreeDefPtr LoadFromContent(const std::string& content, std::string* err);
};

// 观察者接口(对齐引擎 PrintNodeSummary 的字段集):每帧每个节点 Tick 后被调一次。
struct BTTraceEvent {
    const BehaviorTreeDef* tree = nullptr;
    const BTNodeDef* node = nullptr;
    std::uint64_t tickCount = 0;
    std::uint64_t enterCount = 0;
    std::uint64_t updateCount = 0;
    std::uint64_t exitCount = 0;
    bool entered = false;
    bool exited = false;
    BTStatus before = BTStatus::Invalid;
    BTStatus after = BTStatus::Invalid;
    const CyberMalImpl* inputMal = nullptr;   // 仅 Action/Condition,其余为 nullptr
    const CyberMalImpl* outputMal = nullptr;
};
using BTTraceSink = std::function<void(const BTTraceEvent&)>;

// TreeTask 抽象基类(对齐引擎 BTTask,但去掉 agent/model 依赖,行为函数走 CyberAgentRegistry)。
class BTTask {
public:
    virtual ~BTTask() = default;
    virtual BTStatus Tick() = 0;
    virtual void Reset() = 0;
    virtual int NodeCount() const = 0;
    virtual const BTNodeDef* Node() const = 0;
    virtual BTStatus Status() const = 0;
    virtual std::uint64_t TickCount() const = 0;
    virtual std::uint64_t EnterCount() const = 0;
    virtual std::uint64_t UpdateCount() const = 0;
    virtual std::uint64_t ExitCount() const = 0;
};

// TreeTask:根任务,拥有 def_ + 全局 observer。SetTraceSink 覆盖默认(stdout summary)。
class TreeTask : public BTTask {
public:
    explicit TreeTask(BehaviorTreeDefPtr def);
    ~TreeTask() override;
    BTStatus Tick() override;
    void Reset() override;
    int NodeCount() const override;
    const BTNodeDef* Node() const override { return def_ ? def_->root.get() : nullptr; }
    BTStatus Status() const override { return status_; }
    std::uint64_t TickCount() const override { return tickCount_; }
    std::uint64_t EnterCount() const override { return enterCount_; }
    std::uint64_t UpdateCount() const override { return updateCount_; }
    std::uint64_t ExitCount() const override { return exitCount_; }
    void SetTraceSink(BTTraceSink sink);
    const BehaviorTreeDef* Def() const { return def_.get(); }
private:
    BehaviorTreeDefPtr def_;
    std::shared_ptr<BTTask> rootTask_;
    BTStatus status_ = BTStatus::Invalid;
    std::uint64_t tickCount_ = 0;
    std::uint64_t enterCount_ = 0;
    std::uint64_t updateCount_ = 0;
    std::uint64_t exitCount_ = 0;
};

std::shared_ptr<TreeTask> CreateTreeTask(BehaviorTreeDefPtr def);

} // namespace BT
`;
}

function btRuntimeCpp(): string {
  return `// 由 BT Studio 生成 —— 依赖库:BT 解析 + 调度实现(自包含,无业务/外部库)。
// 与 F:/0411/ccc/FOSimEngine/src/modules/extern 的 bt_xml_loader.cpp / bt_runtime.cpp 语义对齐:
//   1) Loader 递归下降解析,识别所有 BTNodeKind + Blackboards + Inputs/Outputs;xmlType != BTNodeKind::Unknown 才生成节点。
//   2) 每种 kind 有独立的 XxxTask,Update() 按引擎语义实现 —— Sequence/Selector/And/Or/Parallel/IfElse/Loop/Invert/AlwaysSuccess/AlwaysFailure/SuccessUntil/FailureUntil/Action/Condition/ConditionTransform/Null。
//   3) Tick 生命周期 = OnEnter -> Update -> FinishTick,并调 Trace() 输出观察者事件。
//   4) 观察者由 env FOSIM_BT_TRACE 控制(off/summary/full),默认 summary。
#include "fosim/bt_runtime.h"
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <cctype>
#include <functional>
#include <iostream>
#include <sstream>

namespace BT {

// ---------------- 观察者(对齐引擎 PrintNodeSummary) ----------------
namespace {

enum class TraceMode { Off, Summary, Full };
TraceMode ResolveTraceMode() {
    const char* v = std::getenv("FOSIM_BT_TRACE");
    if (!v || !*v) return TraceMode::Summary;
    std::string s(v);
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (s == "off" || s == "0" || s == "none") return TraceMode::Off;
    if (s == "full" || s == "verbose") return TraceMode::Full;
    return TraceMode::Summary;
}

std::string BehaviorLabel(const BTNodeDef& node) {
    std::ostringstream os;
    if (!node.name.empty()) os << node.name;
    else if (!node.functionName.empty()) os << node.functionName;
    else os << NodeKindName(node.kind);
    os << "[" << node.id << "]";
    return os.str();
}

std::string SerializeMalBrief(const CyberMalImpl* mal) {
    if (!mal) return "-";
    (void)mal;
    return "<mal>"; // MAL 字段迭代不在 skeleton 暴露;真引擎有 GetFirstArgument/GetNextArgument。
}

void DefaultTraceStdout(const BTTraceEvent& ev) {
    static TraceMode mode = ResolveTraceMode();
    if (mode == TraceMode::Off || !ev.node) return;
    std::ostringstream os;
    os << "[BT_TRACE] tree=" << (ev.tree ? ev.tree->name : "")
       << " node=" << BehaviorLabel(*ev.node)
       << " role=" << NodeKindName(ev.node->kind)
       << " tick=" << ev.tickCount
       << " enter=" << ev.enterCount
       << " exit=" << ev.exitCount
       << " before=" << StatusName(ev.before)
       << " status=" << StatusName(ev.after)
       << (ev.entered ? " +enter" : "")
       << (ev.exited ? " +exit" : "");
    if (mode == TraceMode::Full) {
        os << " func=" << (ev.node->functionName.empty() ? "-" : ev.node->functionName);
        if (!ev.node->target.componentClass.empty()) os << " comp=" << ev.node->target.componentClass;
        if (ev.inputMal || ev.outputMal) {
            os << " in=" << SerializeMalBrief(ev.inputMal)
               << " out=" << SerializeMalBrief(ev.outputMal);
        }
    }
    std::cout << os.str() << "\\n";
}

BTTraceSink& CurrentSink() {
    static BTTraceSink sink = &DefaultTraceStdout;
    return sink;
}

} // namespace

const char* NodeKindName(BTNodeKind kind) {
    switch (kind) {
    case BTNodeKind::Action:              return "Action";
    case BTNodeKind::Condition:           return "Condition";
    case BTNodeKind::Sequence:            return "Sequence";
    case BTNodeKind::Selector:            return "Selector";
    case BTNodeKind::And:                 return "And";
    case BTNodeKind::Or:                  return "Or";
    case BTNodeKind::Parallel:            return "Parallel";
    case BTNodeKind::IfElse:              return "IfElse";
    case BTNodeKind::Loop:                return "Loop";
    case BTNodeKind::AlwaysSuccess:       return "AlwaysSuccess";
    case BTNodeKind::AlwaysFailure:       return "AlwaysFailure";
    case BTNodeKind::SuccessUntil:        return "SuccessUntil";
    case BTNodeKind::FailureUntil:        return "FailureUntil";
    case BTNodeKind::Invert:              return "Invert";
    case BTNodeKind::ConditionTransform:  return "ConditionTransform";
    case BTNodeKind::Subtree:             return "Subtree";
    case BTNodeKind::Null:                return "Null";
    default:                              return "Unknown";
    }
}
const char* StatusName(BTStatus s) {
    switch (s) {
    case BTStatus::Success: return "Success";
    case BTStatus::Failure: return "Failure";
    case BTStatus::Running: return "Running";
    default:                return "Invalid";
    }
}

// ---------------- MiniXml:递归下降解析(替代原来的按行扫描) ----------------
namespace {

struct XmlNode {
    std::string name;
    std::map<std::string, std::string> attrs;
    std::vector<XmlNode> children;
};

class XmlParser {
public:
    XmlParser(const std::string& src) : src_(src), p_(0) {}
    bool Parse(XmlNode& out, std::string* err) {
        SkipProlog();
        if (!ReadElement(out, err)) return false;
        return true;
    }
private:
    void SkipWS() { while (p_ < src_.size() && std::isspace(static_cast<unsigned char>(src_[p_]))) ++p_; }
    void SkipProlog() {
        while (p_ < src_.size()) {
            SkipWS();
            if (p_ + 1 >= src_.size() || src_[p_] != '<') return;
            char c = src_[p_ + 1];
            if (c == '?' || c == '!') {
                // <?xml ?> / <!-- --> / <!DOCTYPE>:一律吞到下一个 '>' (对我们生成的 XML 足够)。
                std::size_t end = src_.find('>', p_);
                if (end == std::string::npos) return;
                p_ = end + 1;
                continue;
            }
            return;
        }
    }
    bool ReadElement(XmlNode& out, std::string* err) {
        SkipWS();
        if (p_ >= src_.size() || src_[p_] != '<') { if (err) *err = "expected '<'"; return false; }
        ++p_;
        // 元素名
        std::string name;
        while (p_ < src_.size() && !std::isspace(static_cast<unsigned char>(src_[p_])) && src_[p_] != '>' && src_[p_] != '/') {
            name.push_back(src_[p_++]);
        }
        out.name = name;
        // 属性 / 到 > 或 />
        while (p_ < src_.size()) {
            SkipWS();
            if (p_ >= src_.size()) { if (err) *err = "unexpected eof"; return false; }
            if (src_[p_] == '/') {
                if (p_ + 1 < src_.size() && src_[p_ + 1] == '>') { p_ += 2; return true; }
                if (err) *err = "malformed self-close";
                return false;
            }
            if (src_[p_] == '>') { ++p_; break; }
            // attr="val"
            std::string k;
            while (p_ < src_.size() && src_[p_] != '=' && !std::isspace(static_cast<unsigned char>(src_[p_]))) k.push_back(src_[p_++]);
            SkipWS();
            if (p_ >= src_.size() || src_[p_] != '=') { if (err) *err = "expected '='"; return false; }
            ++p_; SkipWS();
            char quote = src_[p_++];
            if (quote != '"' && quote != '\\'') { if (err) *err = "expected quote"; return false; }
            std::string v;
            while (p_ < src_.size() && src_[p_] != quote) v.push_back(src_[p_++]);
            if (p_ >= src_.size()) { if (err) *err = "unterminated attr"; return false; }
            ++p_; // 吃掉右引号
            out.attrs[k] = v;
        }
        // 子节点循环,直到遇到 </name>
        while (p_ < src_.size()) {
            SkipWS();
            if (p_ + 1 < src_.size() && src_[p_] == '<' && src_[p_ + 1] == '/') {
                std::size_t end = src_.find('>', p_);
                if (end == std::string::npos) { if (err) *err = "unterminated close tag"; return false; }
                p_ = end + 1;
                return true;
            }
            if (p_ + 3 < src_.size() && src_.compare(p_, 4, "<!--") == 0) {
                std::size_t end = src_.find("-->", p_);
                if (end == std::string::npos) return true;
                p_ = end + 3;
                continue;
            }
            if (p_ < src_.size() && src_[p_] == '<') {
                XmlNode child;
                if (!ReadElement(child, err)) return false;
                out.children.push_back(std::move(child));
                continue;
            }
            // 文本内容对结构解析无意义,吞掉。
            while (p_ < src_.size() && src_[p_] != '<') ++p_;
        }
        return true;
    }
    const std::string& src_;
    std::size_t p_;
};

// ---------------- BTNodeKind 映射(对齐引擎 NodeKindFromName) ----------------
BTNodeKind KindFromName(const std::string& n) {
    if (n == "Action") return BTNodeKind::Action;
    if (n == "Condition") return BTNodeKind::Condition;
    if (n == "Sequence") return BTNodeKind::Sequence;
    if (n == "Selector" || n == "SelectNode") return BTNodeKind::Selector;
    if (n == "And") return BTNodeKind::And;
    if (n == "Or") return BTNodeKind::Or;
    if (n == "Parallel" || n == "Paralle") return BTNodeKind::Parallel;
    if (n == "IfElse") return BTNodeKind::IfElse;
    if (n == "DecoratorLoop" || n == "Loop") return BTNodeKind::Loop;
    if (n == "AlwaysSuccess") return BTNodeKind::AlwaysSuccess;
    if (n == "AlwaysFailure") return BTNodeKind::AlwaysFailure;
    if (n == "DecoratorSuccessUntil") return BTNodeKind::SuccessUntil;
    if (n == "DecoratorFailureUntil") return BTNodeKind::FailureUntil;
    if (n == "Invert" || n == "Not") return BTNodeKind::Invert;
    if (n == "ConditionTransform") return BTNodeKind::ConditionTransform;
    if (n == "Subtree" || n == "SubTree") return BTNodeKind::Subtree;
    if (n == "Null") return BTNodeKind::Null;
    return BTNodeKind::Unknown;
}
bool IsMetadataNode(const std::string& n) {
    return n == "Blackboards" || n == "Blackboard" ||
           n == "ReferencedBehaviorTrees" ||
           n == "Inputs" || n == "Input" ||
           n == "Outputs" || n == "Output";
}

std::string GetAttr(const XmlNode& x, const char* k) {
    auto it = x.attrs.find(k);
    return it == x.attrs.end() ? "" : it->second;
}
int GetIntAttr(const XmlNode& x, const char* k, int d = 0) {
    auto s = GetAttr(x, k);
    return s.empty() ? d : std::atoi(s.c_str());
}
bool GetBoolAttr(const XmlNode& x, const char* k, bool d = false) {
    auto s = GetAttr(x, k);
    if (s.empty()) return d;
    return s == "true" || s == "True" || s == "1";
}

BTNodeDefPtr LoadNode(const XmlNode& x, BehaviorTreeDef& def, std::string* err, int depth) {
    if (depth > 512) { if (err) *err = "depth > 512"; return nullptr; }
    BTNodeKind kind = KindFromName(x.name);
    if (kind == BTNodeKind::Unknown) { if (err) *err = "Unknown node type: " + x.name; return nullptr; }
    auto n = std::make_shared<BTNodeDef>();
    n->id = GetIntAttr(x, "id", 0);
    n->xmlType = x.name;
    n->kind = kind;
    n->name = GetAttr(x, "name");
    n->functionName = GetAttr(x, "function");
    n->behaviorTreeName = GetAttr(x, "behaviorTreeName");
    n->target.cognition = GetAttr(x, "cognition");
    n->target.modelName = GetAttr(x, "mdataName");
    n->target.modelClass = GetAttr(x, "className");
    n->target.modelType = GetAttr(x, "typeName");
    n->target.componentId = GetAttr(x, "componentId");
    n->target.componentName = GetAttr(x, "componentName");
    if (n->target.componentName.empty()) n->target.componentName = n->target.modelName;
    n->target.componentClass = n->target.modelClass;
    n->target.componentType = n->target.modelType;
    n->loopCount = GetIntAttr(x, "count", GetIntAttr(x, "loopCount", 1));
    std::string endStatus = GetAttr(x, "status");
    n->endStatusSuccess = !(endStatus == "FAILURE" || endStatus == "Failure" || endStatus == "failure");
    n->parallelSuccessThreshold = static_cast<unsigned int>(GetIntAttr(x, "successThreshold", 0));
    n->parallelFailureThreshold = static_cast<unsigned int>(GetIntAttr(x, "failureThreshold", 0));
    n->compareType = GetAttr(x, "comparetype");
    n->compareOp = GetAttr(x, "compareop");
    n->compareValue = GetAttr(x, "comparevalue");
    n->compareOutputName = GetAttr(x, "compareoutput");
    if (n->id == 0) { if (err) *err = "node id is required"; return nullptr; }
    if (def.nodesById.find(n->id) != def.nodesById.end()) { if (err) *err = "duplicate id " + std::to_string(n->id); return nullptr; }
    // 解析 Inputs/Outputs 描述(与引擎同名)。
    for (const auto& sub : x.children) {
        if (sub.name == "Inputs") {
            for (const auto& inp : sub.children) {
                if (inp.name != "Input") continue;
                InputBinding b;
                b.name = GetAttr(inp, "name");
                b.type = GetAttr(inp, "type");
                b.value = GetAttr(inp, "value");
                std::string src = GetAttr(inp, "source");
                if (src == "blackboard" || src == "local" || src == "global") {
                    b.source = InputSource::Blackboard;
                    b.blackboardId = GetAttr(inp, "blackboardKey");
                    b.variableId = GetAttr(inp, "variableKey");
                } else {
                    b.source = InputSource::Constant;
                }
                n->inputs.push_back(std::move(b));
            }
        } else if (sub.name == "Outputs") {
            for (const auto& out : sub.children) {
                if (out.name != "Output") continue;
                OutputBinding b;
                b.name = GetAttr(out, "name");
                b.blackboardId = GetAttr(out, "blackboardKey");
                b.variableId = GetAttr(out, "variableKey");
                n->outputs.push_back(std::move(b));
            }
        }
    }
    // 递归子节点(过滤元数据)。
    for (const auto& sub : x.children) {
        if (IsMetadataNode(sub.name)) continue;
        auto child = LoadNode(sub, def, err, depth + 1);
        if (!child) return nullptr;
        n->children.push_back(child);
    }
    def.nodesById[n->id] = n;
    return n;
}

bool LoadBlackboards(const XmlNode& root, BehaviorTreeDef& def) {
    for (const auto& sub : root.children) {
        if (sub.name != "Blackboards") continue;
        for (const auto& b : sub.children) {
            if (b.name != "Blackboard") continue;
            BlackboardDef bb;
            bb.id = GetAttr(b, "id");
            bb.name = GetAttr(b, "name");
            bb.global = GetAttr(b, "scope") == "global";
            for (const auto& v : b.children) {
                if (v.name != "Variable") continue;
                BlackboardValue bv;
                bv.id = GetAttr(v, "id");
                bv.key = GetAttr(v, "key");
                bv.type = GetAttr(v, "type");
                bv.value = GetAttr(v, "value");
                bb.variables[bv.id] = bv;
            }
            def.blackboards[bb.id] = bb;
        }
    }
    return true;
}

} // namespace

BehaviorTreeDefPtr BTXmlLoader::LoadFromContent(const std::string& content, std::string* err) {
    if (content.empty()) { if (err) *err = "empty content"; return nullptr; }
    XmlNode root;
    XmlParser parser(content);
    if (!parser.Parse(root, err)) return nullptr;
    if (root.name != "Root") { if (err) *err = "missing <Root>"; return nullptr; }
    auto def = std::make_shared<BehaviorTreeDef>();
    def->id = GetIntAttr(root, "id", 0);
    def->name = GetAttr(root, "name");
    def->projectType = GetAttr(root, "projectType");
    LoadBlackboards(root, *def);
    BTNodeDefPtr rootNode;
    for (const auto& sub : root.children) {
        if (IsMetadataNode(sub.name)) continue;
        if (rootNode) { if (err) *err = "Root must contain exactly one behavior node"; return nullptr; }
        rootNode = LoadNode(sub, *def, err, 0);
        if (!rootNode) return nullptr;
    }
    if (!rootNode) { if (err) *err = "root behavior node missing"; return nullptr; }
    def->root = rootNode;
    return def;
}

// ---------------- Task 家族(对齐引擎 bt_runtime.cpp 的每种 XxxTask) ----------------
namespace {

class NodeTask;
struct TickCtx {
    const BehaviorTreeDef* tree = nullptr;
    std::uint64_t* totalTick = nullptr;
    std::uint64_t* totalEnter = nullptr;
    std::uint64_t* totalUpdate = nullptr;
    std::uint64_t* totalExit = nullptr;
};

class NodeTask : public BTTask {
public:
    NodeTask(BTNodeDefPtr node, TickCtx* ctx) : node_(std::move(node)), ctx_(ctx) {}
    BTStatus Tick() override {
        const BTStatus before = status_;
        const bool wasRunning = (status_ == BTStatus::Running);
        bool entered = false;
        if (!wasRunning) { OnEnter(); entered = true; ++enterCount_; if (ctx_ && ctx_->totalEnter) ++(*ctx_->totalEnter); }
        ++tickCount_; if (ctx_ && ctx_->totalTick) ++(*ctx_->totalTick);
        ++updateCount_; if (ctx_ && ctx_->totalUpdate) ++(*ctx_->totalUpdate);
        BTStatus s = Update();
        const bool exited = s != BTStatus::Running;
        if (exited) { ++exitCount_; if (ctx_ && ctx_->totalExit) ++(*ctx_->totalExit); OnExit(s); }
        status_ = s;
        // 观察者事件。
        BTTraceEvent ev;
        ev.tree = ctx_ ? ctx_->tree : nullptr;
        ev.node = node_.get();
        ev.tickCount = tickCount_;
        ev.enterCount = enterCount_;
        ev.updateCount = updateCount_;
        ev.exitCount = exitCount_;
        ev.entered = entered;
        ev.exited = exited;
        ev.before = before;
        ev.after = s;
        ev.inputMal = LastInputMal();
        ev.outputMal = LastOutputMal();
        auto& sink = CurrentSink();
        if (sink) sink(ev);
        return s;
    }
    void Reset() override {
        status_ = BTStatus::Invalid;
        tickCount_ = enterCount_ = updateCount_ = exitCount_ = 0;
        OnReset();
    }
    int NodeCount() const override {
        int c = 1;
        for (const auto& ch : children_) c += ch->NodeCount();
        return c;
    }
    const BTNodeDef* Node() const override { return node_.get(); }
    BTStatus Status() const override { return status_; }
    std::uint64_t TickCount() const override { return tickCount_; }
    std::uint64_t EnterCount() const override { return enterCount_; }
    std::uint64_t UpdateCount() const override { return updateCount_; }
    std::uint64_t ExitCount() const override { return exitCount_; }
    void AddChild(std::shared_ptr<NodeTask> c) { children_.push_back(std::move(c)); }
protected:
    virtual void OnEnter() {}
    virtual void OnExit(BTStatus) {}
    virtual void OnReset() {}
    virtual BTStatus Update() = 0;
    virtual const CyberMalImpl* LastInputMal() const { return nullptr; }
    virtual const CyberMalImpl* LastOutputMal() const { return nullptr; }
    BTNodeDefPtr node_;
    TickCtx* ctx_;
    BTStatus status_ = BTStatus::Invalid;
    std::uint64_t tickCount_ = 0, enterCount_ = 0, updateCount_ = 0, exitCount_ = 0;
    std::vector<std::shared_ptr<NodeTask>> children_;
};

// Sequence: 依次 tick 子节点,Running/Failure 立返,全部 Success 才 Success。
class SequenceTask : public NodeTask {
public:
    SequenceTask(BTNodeDefPtr n, TickCtx* c) : NodeTask(std::move(n), c) {}
    void OnEnter() override { active_ = 0; }
    BTStatus Update() override {
        while (active_ < children_.size()) {
            auto s = children_[active_]->Tick();
            if (s == BTStatus::Running) return s;
            if (s == BTStatus::Failure) { active_ = 0; return s; }
            ++active_;
        }
        active_ = 0;
        return BTStatus::Success;
    }
    void OnReset() override { active_ = 0; }
    std::size_t active_ = 0;
};
// Selector: 依次 tick 子节点,Running/Success 立返,全部 Failure 才 Failure。
class SelectorTask : public NodeTask {
public:
    SelectorTask(BTNodeDefPtr n, TickCtx* c) : NodeTask(std::move(n), c) {}
    void OnEnter() override { active_ = 0; }
    BTStatus Update() override {
        while (active_ < children_.size()) {
            auto s = children_[active_]->Tick();
            if (s == BTStatus::Running) return s;
            if (s == BTStatus::Success) { active_ = 0; return s; }
            ++active_;
        }
        active_ = 0;
        return BTStatus::Failure;
    }
    void OnReset() override { active_ = 0; }
    std::size_t active_ = 0;
};
// And / Or 语义与 Sequence / Selector 相同,但保留独立 kind 便于 trace 显示"逻辑与/或"意图。
class AndTask : public SequenceTask { public: AndTask(BTNodeDefPtr n, TickCtx* c) : SequenceTask(std::move(n), c) {} };
class OrTask : public SelectorTask { public: OrTask(BTNodeDefPtr n, TickCtx* c) : SelectorTask(std::move(n), c) {} };

// Parallel: 每帧 tick 所有子;successThreshold(默认=size) / failureThreshold(默认=1)。
class ParallelTask : public NodeTask {
public:
    ParallelTask(BTNodeDefPtr n, TickCtx* c) : NodeTask(std::move(n), c) {}
    BTStatus Update() override {
        unsigned int okc = 0, failc = 0;
        bool sawRun = false;
        for (auto& ch : children_) {
            auto s = ch->Tick();
            if (s == BTStatus::Success) ++okc;
            else if (s == BTStatus::Failure) ++failc;
            else if (s == BTStatus::Running) sawRun = true;
        }
        unsigned int okT = node_->parallelSuccessThreshold ? node_->parallelSuccessThreshold : static_cast<unsigned int>(children_.size());
        unsigned int failT = node_->parallelFailureThreshold ? node_->parallelFailureThreshold : 1u;
        if (okc >= okT) return BTStatus::Success;
        if (failc >= failT) return BTStatus::Failure;
        return sawRun ? BTStatus::Running : BTStatus::Failure;
    }
};

// IfElse: 3 子槽(条件/真/假),条件 Running 时保持条件推进,分支 Running 时保持分支推进。
class IfElseTask : public NodeTask {
public:
    IfElseTask(BTNodeDefPtr n, TickCtx* c) : NodeTask(std::move(n), c) {}
    void OnEnter() override { active_ = 0; }
    BTStatus Update() override {
        if (children_.size() != 3) return BTStatus::Failure;
        if (active_ == 1 || active_ == 2) {
            auto bs = children_[active_]->Tick();
            if (bs == BTStatus::Running) return bs;
            active_ = 0;
            return bs;
        }
        auto cs = children_[0]->Tick();
        if (cs == BTStatus::Running) return cs;
        if (cs == BTStatus::Success) active_ = 1;
        else if (cs == BTStatus::Failure) active_ = 2;
        else { active_ = 0; return BTStatus::Failure; }
        auto bs = children_[active_]->Tick();
        if (bs == BTStatus::Running) return bs;
        active_ = 0;
        return bs;
    }
    void OnReset() override { active_ = 0; }
    std::size_t active_ = 0;
};

// Loop: 每完成一次子 tick 循环计数;count<=0 表示无限循环;子节点每轮完成后 Reset 让其重新 OnEnter。
class LoopTask : public NodeTask {
public:
    LoopTask(BTNodeDefPtr n, TickCtx* c) : NodeTask(std::move(n), c) {}
    void OnEnter() override { attempts_ = 0; }
    BTStatus Update() override {
        if (children_.empty()) return BTStatus::Failure;
        auto& ch = children_[0];
        auto s = ch->Tick();
        if (s == BTStatus::Running) return s;
        ++attempts_;
        ch->Reset();
        if (node_->loopCount <= 0) return BTStatus::Running; // 无限循环
        return attempts_ >= node_->loopCount ? BTStatus::Success : BTStatus::Running;
    }
    void OnReset() override { attempts_ = 0; }
    int attempts_ = 0;
};

// AlwaysSuccess / AlwaysFailure / Invert / SuccessUntil / FailureUntil:单孩子装饰节点。
class DecoratorTask : public NodeTask {
public:
    DecoratorTask(BTNodeDefPtr n, TickCtx* c) : NodeTask(std::move(n), c) {}
    BTStatus TickChild() {
        if (children_.empty()) return BTStatus::Failure;
        return children_[0]->Tick();
    }
};
class AlwaysSuccessTask : public DecoratorTask {
public:
    AlwaysSuccessTask(BTNodeDefPtr n, TickCtx* c) : DecoratorTask(std::move(n), c) {}
    BTStatus Update() override {
        auto s = TickChild();
        return s == BTStatus::Running ? s : BTStatus::Success;
    }
};
class AlwaysFailureTask : public DecoratorTask {
public:
    AlwaysFailureTask(BTNodeDefPtr n, TickCtx* c) : DecoratorTask(std::move(n), c) {}
    BTStatus Update() override {
        auto s = TickChild();
        return s == BTStatus::Running ? s : BTStatus::Failure;
    }
};
class InvertTask : public DecoratorTask {
public:
    InvertTask(BTNodeDefPtr n, TickCtx* c) : DecoratorTask(std::move(n), c) {}
    BTStatus Update() override {
        auto s = TickChild();
        if (s == BTStatus::Success) return BTStatus::Failure;
        if (s == BTStatus::Failure) return BTStatus::Success;
        return s;
    }
};
class SuccessUntilTask : public DecoratorTask {
public:
    SuccessUntilTask(BTNodeDefPtr n, TickCtx* c) : DecoratorTask(std::move(n), c) {}
    BTStatus Update() override {
        auto s = TickChild();
        return s == BTStatus::Success ? BTStatus::Success : BTStatus::Running;
    }
};
class FailureUntilTask : public DecoratorTask {
public:
    FailureUntilTask(BTNodeDefPtr n, TickCtx* c) : DecoratorTask(std::move(n), c) {}
    BTStatus Update() override {
        auto s = TickChild();
        return s == BTStatus::Failure ? BTStatus::Failure : BTStatus::Running;
    }
};

// Action / Condition / ConditionTransform:叶子执行节点。查 CyberAgentRegistry 拿 Agent,
// 找 function 指针,构造 in/out MAL,调用,拿返回码 (SINGLE=Success/CONTINUOUS=Running/ERROR=Failure)。
// 输入参数按名字从 node.inputs 拷进 in_mal;输出参数从 out_mal 按 node.outputs.name 读出(仅打印,不回写 BB)。
class LeafActionTask : public NodeTask {
public:
    LeafActionTask(BTNodeDefPtr n, TickCtx* c) : NodeTask(std::move(n), c) {}
    // 从 node.inputs 描述往 in_mal 填常量值;类型按 InputBinding.type 或"整数/浮点/布尔"三类粗判。
    void FillInputMal() {
        // 每次 Tick 都重新构造 MAL(简化,避免累积),真引擎里用 Owner MAL 且带 Reset。
        in_ = CyberMalImpl();
        out_ = CyberMalImpl();
        for (const auto& b : node_->inputs) {
            if (b.source == InputSource::Blackboard) continue; // skeleton 不解析 BB
            const auto& v = b.value;
            const std::string& t = b.type;
            auto isInt = [&]() { return t.find("int") != std::string::npos || t.find("Int") != std::string::npos || t.find("INTEGER") != std::string::npos; };
            auto isBool = [&]() { return t.find("bool") != std::string::npos || t.find("Bool") != std::string::npos || t.find("BOOL") != std::string::npos; };
            auto isReal = [&]() { return t.find("float") != std::string::npos || t.find("real") != std::string::npos || t.find("Real") != std::string::npos; };
            if (isBool()) {
                in_.AddBoolean(b.name.c_str(), (v == "true" || v == "1" || v == "True"));
            } else if (isInt()) {
                in_.AddInteger(b.name.c_str(), v.empty() ? 0 : std::atol(v.c_str()));
            } else if (isReal()) {
                in_.AddReal(b.name.c_str(), v.empty() ? 0.0 : std::atof(v.c_str()));
            } else if (!v.empty()) {
                // 未知类型:尝试数值,失败则当字符串。
                char* end = nullptr;
                double d = std::strtod(v.c_str(), &end);
                if (end != v.c_str() && *end == '\\0') in_.AddReal(b.name.c_str(), d);
                else in_.AddName(b.name.c_str(), v.c_str());
            }
        }
    }
    // 按 componentClass / modelClass / mdataName 三优先级查 Agent 实例。
    std::shared_ptr<CyberDecisionAgentBase> ResolveAgent() const {
        const auto& t = node_->target;
        const std::string keys[] = { t.componentClass, t.modelClass, t.componentName, t.modelName };
        auto& reg = CyberAgentRegistry::instance();
        for (const auto& k : keys) {
            if (k.empty()) continue;
            auto a = reg.Get(k);
            if (a) return a;
        }
        return nullptr;
    }
    BTStatus Update() override {
        FillInputMal();
        auto agent = ResolveAgent();
        if (!agent) return BTStatus::Failure; // 未注册的 Agent:视为失败
        const std::string& fn = node_->functionName;
        auto* p = agent->FindFunction(fn);
        if (!p || !p->function_ptr_) return BTStatus::Failure;
        CyberDFMPFRC rc = InvokeDecisionFunction(agent.get(), p->function_ptr_, &in_, &out_);
        switch (rc) {
        case CYBER_DFMPFRC_SINGLE:     return BTStatus::Success;
        case CYBER_DFMPFRC_CONTINUOUS: return BTStatus::Running;
        case CYBER_DFMPFRC_ERROR:      return BTStatus::Failure;
        default:                       return BTStatus::Failure;
        }
    }
    const CyberMalImpl* LastInputMal() const override { return &in_; }
    const CyberMalImpl* LastOutputMal() const override { return &out_; }
    CyberMalImpl in_, out_;
};
// Condition:调用同链路,但 rc 语义映射到 Success/Failure(不允许 Running,Running 视为 Failure)。
class LeafConditionTask : public LeafActionTask {
public:
    LeafConditionTask(BTNodeDefPtr n, TickCtx* c) : LeafActionTask(std::move(n), c) {}
    BTStatus Update() override {
        auto s = LeafActionTask::Update();
        return s == BTStatus::Running ? BTStatus::Failure : s;
    }
};
// ConditionTransform:同 Condition。真引擎里还会按 comparetype/compareop/comparevalue 二次判定,skeleton 暂用同链路。
class LeafConditionTransformTask : public LeafActionTask {
public:
    LeafConditionTransformTask(BTNodeDefPtr n, TickCtx* c) : LeafActionTask(std::move(n), c) {}
    BTStatus Update() override {
        auto s = LeafActionTask::Update();
        return s == BTStatus::Running ? BTStatus::Failure : s;
    }
};
class NullTask : public NodeTask {
public:
    NullTask(BTNodeDefPtr n, TickCtx* c) : NodeTask(std::move(n), c) {}
    BTStatus Update() override { return node_->endStatusSuccess ? BTStatus::Success : BTStatus::Failure; }
};

std::shared_ptr<NodeTask> BuildTask(const BTNodeDefPtr& def, TickCtx* ctx) {
    std::shared_ptr<NodeTask> t;
    switch (def->kind) {
    case BTNodeKind::Sequence:            t = std::make_shared<SequenceTask>(def, ctx); break;
    case BTNodeKind::Selector:            t = std::make_shared<SelectorTask>(def, ctx); break;
    case BTNodeKind::And:                 t = std::make_shared<AndTask>(def, ctx); break;
    case BTNodeKind::Or:                  t = std::make_shared<OrTask>(def, ctx); break;
    case BTNodeKind::Parallel:            t = std::make_shared<ParallelTask>(def, ctx); break;
    case BTNodeKind::IfElse:              t = std::make_shared<IfElseTask>(def, ctx); break;
    case BTNodeKind::Loop:                t = std::make_shared<LoopTask>(def, ctx); break;
    case BTNodeKind::AlwaysSuccess:       t = std::make_shared<AlwaysSuccessTask>(def, ctx); break;
    case BTNodeKind::AlwaysFailure:       t = std::make_shared<AlwaysFailureTask>(def, ctx); break;
    case BTNodeKind::SuccessUntil:        t = std::make_shared<SuccessUntilTask>(def, ctx); break;
    case BTNodeKind::FailureUntil:        t = std::make_shared<FailureUntilTask>(def, ctx); break;
    case BTNodeKind::Invert:              t = std::make_shared<InvertTask>(def, ctx); break;
    case BTNodeKind::Action:              t = std::make_shared<LeafActionTask>(def, ctx); break;
    case BTNodeKind::Condition:           t = std::make_shared<LeafConditionTask>(def, ctx); break;
    case BTNodeKind::ConditionTransform:  t = std::make_shared<LeafConditionTransformTask>(def, ctx); break;
    case BTNodeKind::Null:                t = std::make_shared<NullTask>(def, ctx); break;
    default:                              t = std::make_shared<NullTask>(def, ctx); break;
    }
    for (const auto& ch : def->children) t->AddChild(BuildTask(ch, ctx));
    return t;
}

} // namespace

// ---------------- TreeTask 实现 ----------------
struct TreeTaskInternal {
    TickCtx ctx;
};
TreeTask::TreeTask(BehaviorTreeDefPtr def) : def_(std::move(def)) {
    if (def_ && def_->root) {
        auto* internal = new TreeTaskInternal();
        internal->ctx.tree = def_.get();
        internal->ctx.totalTick = &tickCount_;
        internal->ctx.totalEnter = &enterCount_;
        internal->ctx.totalUpdate = &updateCount_;
        internal->ctx.totalExit = &exitCount_;
        rootTask_ = std::static_pointer_cast<BTTask>(BuildTask(def_->root, &internal->ctx));
        // 用 shared_ptr 的 aliasing 让内部对象与 TreeTask 生命周期一致(简化:泄漏一份 —— 生成工程运行结束时进程退出释放)。
        (void)internal;
    }
}
TreeTask::~TreeTask() = default;
BTStatus TreeTask::Tick() {
    if (!rootTask_) { status_ = BTStatus::Invalid; return status_; }
    status_ = rootTask_->Tick();
    return status_;
}
void TreeTask::Reset() { if (rootTask_) rootTask_->Reset(); }
int TreeTask::NodeCount() const { return rootTask_ ? rootTask_->NodeCount() : 0; }
void TreeTask::SetTraceSink(BTTraceSink sink) { CurrentSink() = std::move(sink); }

std::shared_ptr<TreeTask> CreateTreeTask(BehaviorTreeDefPtr def) {
    return std::make_shared<TreeTask>(std::move(def));
}

} // namespace BT
`;
}

// ---- 状态机(FSM)运行时:解析 <FSMNodes> + 状态/迁移调度(对齐引擎 state_machine_def/loader/task)----

function fsmRuntimeHeader(): string {
  return `// 由 BT Studio 生成 —— 依赖库:状态机【解析 + 迁移调度】接口(对齐引擎 modules/extern/state_machine_*)。
#pragma once
#include <string>
#include <memory>
#include <vector>
#include <map>

namespace FSM {

enum class FSMStatus { Invalid, Running, Success, Failure };

// 一条迁移(对齐引擎 StateTransitionDef):条件函数(Opl) + 比较(Operator/Opr) + 目标状态 + 可选引用行为树。
struct TransitionDef {
    int id = 0;
    std::string functionName;       // 条件函数(Opl)
    std::string op;                 // 比较运算(Operator)
    std::string value;              // 比较值(Opr)
    int targetStateId = 0;          // 目标状态 id(Goto)
    std::string referenceBehavior;  // StateTransform 的引用行为树
};
// 一个状态(对齐引擎 StateDef):状态函数 + 是否结束态 + 出向迁移。
struct StateDef {
    int id = 0;
    std::string name;
    std::string function;           // 状态执行函数(Method)
    bool isEndState = false;
    std::vector<TransitionDef> transitions;
};
// 状态机定义:状态索引 + 初始状态。
struct StateMachineDef {
    std::string name;
    int rootId = 0;                 // 初始状态(第一个 State)
    std::map<int, StateDef> states;
};
using StateMachineDefPtr = std::shared_ptr<StateMachineDef>;

// 解析:把 *.fsm.xml(<Root projectType="状态机"><FSMNodes>...) 解析为定义结构。
class StateMachineLoader {
public:
    StateMachineDefPtr LoadFromContent(const std::string& content, std::string* err);
};

// 调度:维护当前状态;每 Tick 执行当前状态函数地址,再按迁移条件切换(真实引擎按 Operator/Opl/Opr 求值)。
class StateMachineTask {
public:
    explicit StateMachineTask(StateMachineDefPtr def);
    FSMStatus Tick();               // 外部驱动一帧
    int CurrentStateId() const { return current_; }
    int StateCount() const { return def_ ? (int)def_->states.size() : 0; }
private:
    StateMachineDefPtr def_;
    int current_ = 0;
    int frame_ = 0;   // 帧计数,观察者输出用
};
std::shared_ptr<StateMachineTask> CreateStateMachineTask(StateMachineDefPtr def);

} // namespace FSM
`;
}

function fsmRuntimeCpp(): string {
  return `// 由 BT Studio 生成 —— 依赖库:状态机解析 + 迁移调度实现(自包含,无业务/外部库)。
// 接入真实引擎:用 modules/extern 的 state_machine_loader.cpp / state_machine_runtime.cpp 替换(接口一致)。
#include "fosim/fsm_runtime.h"
#include <cstddef>
#include <cstdlib>
#include <cctype>
#include <iostream>
#include <string>
#include <vector>

namespace FSM {

static std::string attr(const std::string& tag, const std::string& key) {
    auto pos = tag.find(key + "=\\"");
    if (pos == std::string::npos) return "";
    pos += key.size() + 2;
    auto end = tag.find('"', pos);
    return end == std::string::npos ? "" : tag.substr(pos, end - pos);
}
static int toInt(const std::string& s) { return s.empty() ? 0 : std::atoi(s.c_str()); }

// 新版嵌套格式解析:
//   <Root projectType="状态机"><State id name action(=Method) className>
//     <ConditionTransform id name action className>
//       <State ... /> 或 <Goto id />   ← ConditionTransform 内的第一个 State/Goto 即为迁移目标
//     </ConditionTransform>
//     ... 多个 ConditionTransform ...
//   </State></Root>
// State 无子 ConditionTransform 即为终结态(self-closing 或空)。
StateMachineDefPtr StateMachineLoader::LoadFromContent(const std::string& content, std::string* err) {
    if (content.empty()) { if (err) *err = "empty content"; return nullptr; }
    auto def = std::make_shared<StateMachineDef>();
    std::size_t i = 0;
    // 显式维护栈:当前 State + 当前 ConditionTransform,支持任意嵌套。
    std::vector<int> stateStack;              // 已进入但未 close 的 State id
    std::vector<TransitionDef*> transStack;   // 当前正在填的迁移(next State/Goto 补 targetStateId)
    bool haveRoot = false;
    while ((i = content.find('<', i)) != std::string::npos) {
        auto gt = content.find('>', i);
        if (gt == std::string::npos) break;
        std::string tag = content.substr(i + 1, gt - i - 1);
        i = gt + 1;
        if (tag.empty() || tag[0] == '?' || tag[0] == '!') continue;
        bool selfClose = !tag.empty() && tag.back() == '/';
        if (selfClose) tag.pop_back();
        bool closing = !tag.empty() && tag[0] == '/';
        if (closing) tag = tag.substr(1);
        std::string elem = tag.substr(0, tag.find_first_of(" />"));

        if (elem == "Root") {
            if (!closing) def->name = attr(tag, "name");
            continue;
        }
        if (elem == "State") {
            if (!closing) {
                StateDef s;
                s.id = toInt(attr(tag, "id"));
                s.name = attr(tag, "name");
                s.function = attr(tag, "action");
                // 挂靠自实体挂载:className/behaviac_tree/behaviac_state_machine 都保留可拓展
                def->states[s.id] = s;
                if (!haveRoot) { def->rootId = s.id; haveRoot = true; }
                // 若栈顶是 transition,这个 State 就是它的目标
                if (!transStack.empty() && transStack.back() != nullptr) {
                    transStack.back()->targetStateId = s.id;
                }
                if (!selfClose) stateStack.push_back(s.id);
                // self-closing State = 终结态(无 ConditionTransform 子节点)
                if (selfClose) def->states[s.id].isEndState = true;
            } else {
                if (!stateStack.empty()) stateStack.pop_back();
            }
            continue;
        }
        if (elem == "ConditionTransform") {
            if (!closing) {
                if (stateStack.empty()) continue; // 结构错误,跳过
                StateDef& owner = def->states[stateStack.back()];
                TransitionDef t;
                t.id = toInt(attr(tag, "id"));
                t.functionName = attr(tag, "action");
                // 老字段 Operator/Opl/Opr 兼容(exporter 目前不吐,但真引擎会用)
                t.op = attr(tag, "Operator");
                if (t.op.empty()) t.op = attr(tag, "op");
                owner.transitions.push_back(t);
                if (!selfClose) transStack.push_back(&owner.transitions.back());
            } else {
                if (!transStack.empty()) transStack.pop_back();
            }
            continue;
        }
        if (elem == "Goto") {
            // <Goto id="X" />:targetStateId 直接指向已定义状态
            if (!transStack.empty() && transStack.back() != nullptr) {
                transStack.back()->targetStateId = toInt(attr(tag, "id"));
            }
            continue;
        }
    }
    // 无显式 IsEndState 标记的 leaf State(无 transition)也算终结态,避免无限循环
    for (auto& kv : def->states) {
        if (kv.second.transitions.empty()) kv.second.isEndState = true;
    }
    if (def->states.empty()) { if (err) *err = "no <State> found"; return nullptr; }
    return def;
}

StateMachineTask::StateMachineTask(StateMachineDefPtr def) : def_(std::move(def)) {
    if (def_) current_ = def_->rootId;
}

// FSM 观察者:与 BT 共用同一 env FOSIM_BT_TRACE,off 关闭,其余打印 [FSM_TRACE]。
static bool FsmTraceEnabled() {
    const char* v = std::getenv("FOSIM_BT_TRACE");
    if (!v || !*v) return true;
    std::string s(v); for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return !(s == "off" || s == "0" || s == "none");
}

// 自包含骨架的一步推进:执行当前状态;若为结束态→Success;否则取第一条有目标的迁移切换并 Running。
// 真实引擎在此按 (model->*function_ptr_) 求条件、按 Operator/Opl/Opr 比较决定迁移。
FSMStatus StateMachineTask::Tick() {
    if (!def_ || def_->states.find(current_) == def_->states.end()) return FSMStatus::Invalid;
    const StateDef& st = def_->states[current_];
    ++frame_;
    static const bool trace = FsmTraceEnabled();
    if (st.isEndState) {
        if (trace) std::cout << "[FSM_TRACE] state=" << st.name << "[" << st.id << "] frame=" << frame_ << " -> End (Success)\\n";
        return FSMStatus::Success;
    }
    for (const auto& tr : st.transitions) {
        if (tr.targetStateId != 0 && def_->states.find(tr.targetStateId) != def_->states.end()) {
            if (trace) {
                const auto& nxt = def_->states[tr.targetStateId];
                std::cout << "[FSM_TRACE] state=" << st.name << "[" << st.id
                          << "] frame=" << frame_
                          << " transition=" << (tr.functionName.empty() ? "-" : tr.functionName)
                          << " -> " << nxt.name << "[" << nxt.id << "]\\n";
            }
            current_ = tr.targetStateId;
            return FSMStatus::Running;
        }
    }
    if (trace) std::cout << "[FSM_TRACE] state=" << st.name << "[" << st.id << "] frame=" << frame_ << " -> stall (Running)\\n";
    return FSMStatus::Running;
}

std::shared_ptr<StateMachineTask> CreateStateMachineTask(StateMachineDefPtr def) {
    return std::make_shared<StateMachineTask>(std::move(def));
}

} // namespace FSM
`;
}

function runtimeCmake(): string {
  return `# ① 依赖库 fosim_bt_runtime —— BT/FSM 解析+映射+调度 + MAL(对齐引擎 modules/extern + core/mal)。
# 源码在本目录 src/ 与 include/。接入真实引擎时,真实头文件/MAL/loader 会被拷贝到这里(不魔改)。
cmake_minimum_required(VERSION 3.16)

file(GLOB_RECURSE RUNTIME_SOURCES "\${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")

add_library(fosim_bt_runtime STATIC \${RUNTIME_SOURCES})
# 自包含骨架用 include/(fosim/);导出真实引擎后,头文件在 include/FOSim/Engine/,
# 其源码以 "modules/extern/..."、"core/mal/..." 相对该根包含,故两条 include 都暴露。
target_include_directories(fosim_bt_runtime PUBLIC
    "\${CMAKE_CURRENT_SOURCE_DIR}/include"
    "\${CMAKE_CURRENT_SOURCE_DIR}/include/FOSim/Engine")
set_target_properties(fosim_bt_runtime PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
`;
}

// ============ ② 类型实现 types/ ============

function userAgentHeader(ns: string, className: string, catalog: CatalogBundle): string {
  const cls = catalog.classes.find((c) => c.className === className);
  const methods = catalog.functionCatalog.functions.filter((f) => functionOwnerClass(f) === className);
  const members = catalog.members.filter((m) => cls && m.ownerClassId === cls.classId);
  // 生成代码统一直接继承 CyberDecisionAgentBase(无业务/实体的纯函数地址绑定基类)。
  // 类型空间里填的 baseClass(CyberPlatformImpl/CyberAgentImpl 等业务标签)在自包含工程里
  // 都是 CyberDecisionAgentBase 的空壳别名,直接继承基类更直白也避免 IDE 语义混淆;
  // 接真实引擎时由用户决定真实层级,本生成器不预设。
  const lines: string[] = [];
  lines.push(`// 由 BT Studio 生成 —— 类型实现:Agent 类 ${className}(继承 CyberDecisionAgentBase)。`);
  lines.push(`// 决策方法签名 CyberDFMPFRC(CyberMalImpl* in_mal, CyberMalImpl* out_mal);注册见 .cpp 的 RegisterFunctions。`);
  lines.push("#pragma once");
  lines.push('#include "fosim/cyber_types.h"');
  lines.push(`#include "${ns}/types.h"`);
  lines.push("");
  lines.push(`class ${className} : public CyberDecisionAgentBase`);
  lines.push("{");
  lines.push("public:");
  lines.push(`    ${className}() = default;`);
  lines.push(`    virtual ~${className}() = default;`);
  lines.push("");
  lines.push("    // 功能函数注册(RegisterDecisionFunction 函数地址绑定)。");
  lines.push("    void RegisterFunctions(void);");
  lines.push("");
  if (members.length) {
    lines.push("    // 成员(变量声明):");
    for (const m of members) {
      // 静态成员用 C++17 inline static,允许类内初始化且无需类外定义(否则编译/链接报错)。
      const stat = m.static ? "inline static " : "";
      lines.push(`    ${stat}${cppMemberType(m.valueType)} ${m.memberName} = {};`);
    }
    lines.push("");
  }
  lines.push("    // 决策/条件方法(返回 CyberDFMPFRC):");
  for (const fn of methods) {
    const sig = fn.params.map((p) => `${p.name}:${paramCyber(p)}${p.direction === "output" ? "(out)" : ""}`).join(", ");
    lines.push(`    CyberDFMPFRC ${fn.name}(CyberMalImpl* in_mal, CyberMalImpl* out_mal); // ${sig || "无参数"}`);
  }
  lines.push("");
  lines.push("    ///<<< BEGIN WRITING YOUR CODE CLASS_MEMBERS");
  lines.push("    ///<<< END WRITING YOUR CODE CLASS_MEMBERS");
  lines.push("};");
  return lines.join("\n") + "\n";
}

function userAgentCpp(ns: string, className: string, catalog: CatalogBundle): string {
  const methods = catalog.functionCatalog.functions.filter((f) => functionOwnerClass(f) === className);
  const lines: string[] = [];
  lines.push(`// 由 BT Studio 生成 —— 类型实现:${className} 的注册 + 决策方法体(对齐引擎 RegisterDecisionFunction)。`);
  lines.push(`#include "${ns}/${className}.h"`);
  lines.push("");
  // RegisterFunctions
  lines.push(`void ${className}::RegisterFunctions(void)`);
  lines.push("{");
  for (const fn of methods) {
    const v = (n: number | undefined, d: number) => (n ?? d).toFixed(6);
    const cmd = fn.intendedCmd || fn.name.toUpperCase();
    lines.push(`    /************************************************************************/`);
    lines.push(`    DecisionFunctionInitialParameter* ${fn.name}Decision = new DecisionFunctionInitialParameter;`);
    lines.push(`    ${fn.name}Decision->function_ptr_ = (ProcessDecisionFunctionPtr)&${className}::${fn.name};`);
    lines.push(`    ${fn.name}Decision->delay_time_ = ${v(fn.delay, 0)};`);
    lines.push(`    ${fn.name}Decision->delay_time_delta_ = ${v(fn.delayDelta, 0)};`);
    lines.push(`    ${fn.name}Decision->repeat_time_ = ${v(fn.repeat, 0.1)};`);
    lines.push(`    ${fn.name}Decision->repeat_time_delta_ = ${v(fn.repeatDelta, 0)};`);
    lines.push(`    ${fn.name}Decision->mal_ = CyberMalImpl::CreateMAL();`);
    lines.push(`    RegisterDecisionFunction("${cmd}", "${fn.name}", ${fn.name}Decision);`);
    lines.push("");
  }
  lines.push("}");
  lines.push("");
  // 决策方法体:读 in_mal 输入参数 / 声明 out_mal 输出参数 / 保留区 / 写回 / 返回
  for (const fn of methods) {
    const inputs = fn.params.filter((p) => p.direction !== "output");
    const outputs = fn.params.filter((p) => p.direction === "output");
    lines.push(`// ${fn.displayName || fn.name}${fn.description ? " —— " + fn.description : ""}`);
    lines.push(`CyberDFMPFRC ${className}::${fn.name}(CyberMalImpl* in_mal, CyberMalImpl* out_mal)`);
    lines.push("{");
    if (inputs.length) {
      lines.push("    // ---- 输入参数(从 in_mal 读取)----");
      for (const p of inputs) lines.push(readInput(p));
    }
    if (outputs.length) {
      lines.push("    // ---- 输出参数(写回 out_mal)----");
      for (const p of outputs) lines.push(declOutput(p));
    }
    if (!inputs.length && !outputs.length) lines.push("    (void)in_mal; (void)out_mal;");
    lines.push("");
    lines.push(`    ///<<< BEGIN WRITING YOUR CODE ${fn.name}`);
    lines.push("    // TODO: 在此实现决策逻辑(读取上面的输入参数,给输出参数赋值)。");
    lines.push(`    ///<<< END WRITING YOUR CODE ${fn.name}`);
    lines.push("");
    for (const p of outputs) lines.push(writeOutput(p));
    lines.push("    return CYBER_DFMPFRC_SINGLE;");
    lines.push("}");
    lines.push("");
  }
  // 静态注册宏 —— 全局 static 对象在 main 之前构造,自动把工厂 + RegisterFunctions 塞进 CyberAgentRegistry。
  // 用户不再需要在 main 里 "MyAgent a; a.RegisterFunctions();" —— 只调 CyberAgentRegistry::instance().RegisterAll()。
  lines.push(`FOSIM_REGISTER_AGENT(${className});`);
  lines.push("");
  return lines.join("\n") + "\n";
}

function typesCmake(ns: string, userClasses: string[]): string {
  const srcs = userClasses.map((c) => `src/${c}.cpp`);
  if (srcs.length === 0) {
    // 无用户类:仅有枚举/结构体头文件 → INTERFACE(头文件)库,避免"无源文件"的 CMake 报错。
    return `# ② 类型实现库 ${ns}_types —— 仅枚举/结构体头文件(无用户类),作为 INTERFACE 库。
cmake_minimum_required(VERSION 3.16)

add_library(${ns}_types INTERFACE)
target_include_directories(${ns}_types INTERFACE "\${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(${ns}_types INTERFACE fosim_bt_runtime)
`;
  }
  return `# ② 类型实现库 ${ns}_types —— 枚举/结构体 + Agent 类完整实现(依赖 runtime)。
cmake_minimum_required(VERSION 3.16)

add_library(${ns}_types STATIC
${srcs.map((s) => "    " + s).join("\n")}
)
target_include_directories(${ns}_types PUBLIC "\${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(${ns}_types PUBLIC fosim_bt_runtime)
set_target_properties(${ns}_types PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
`;
}

function mainCpp(
  ns: string,
  behaviors: { name: string; kind?: "behavior_tree" | "state_machine" }[],
  userClasses: string[],
): string {
  const inc = userClasses.map((c) => `#include "${ns}/${c}.h"`).join("\n");
  const btList = behaviors
    .filter((b) => b.kind !== "state_machine")
    .map((b) => `        "behaviors/${b.name}.bt.xml",`)
    .join("\n");
  const fsmList = behaviors
    .filter((b) => b.kind === "state_machine")
    .map((b) => `        "behaviors/${b.name}.fsm.xml",`)
    .join("\n");
  return `// 由 BT Studio 生成的运行入口 —— 组合 ① 依赖库 runtime + ② 类型实现 types。
// ① 加载所有行为树 + 所有状态机;② 全局静态注册(FOSIM_REGISTER_AGENT 宏);
// ③ 单帧循环并行 tick 所有 BT + 所有 FSM(对齐真实业务:多树/多状态机同时运行)。
//
// 命令行:
//   main.exe                               → 加载编译期默认清单(下面 kDefault*Files),全部并行 tick
//   main.exe path1.bt.xml path2.fsm.xml    → 覆盖清单,按扩展名分派 BT/FSM
#include "fosim/bt_runtime.h"
#include "fosim/fsm_runtime.h"
${inc || "// (无用户类)"}
#include <fstream>
#include <sstream>
#include <iostream>
#include <string>
#include <vector>
#include <memory>
#include <filesystem>

static std::string ReadFile(const std::string& path) {
    std::ifstream f(path);
    if (!f) return "";
    std::stringstream ss; ss << f.rdbuf();
    return ss.str();
}
// cwd → ../ → ../../ → ../../../ → ../../../../,兼容 IDE 里直接跑与 exe 双击。
static std::string ResolveExisting(const std::string& rel) {
    namespace fs = std::filesystem;
    fs::path candidates[] = {
        fs::path(rel), fs::path("..") / rel, fs::path("..") / ".." / rel,
        fs::path("..") / ".." / ".." / rel, fs::path("..") / ".." / ".." / ".." / rel,
    };
    for (const auto& p : candidates) {
        std::error_code ec;
        if (fs::exists(p, ec) && fs::is_regular_file(p, ec)) return p.string();
    }
    return rel;
}
static bool IsFsmPath(const std::string& p) {
    return p.size() >= 8 && p.rfind(".fsm.xml") == p.size() - 8;
}

int main(int argc, char** argv) {
    // ② 静态注册:所有 Agent 类 .cpp 里 FOSIM_REGISTER_AGENT(ClassName) 全局对象在此之前已构造。
    CyberAgentRegistry::instance().RegisterAll();
    std::cout << "[main] agents registered: " << CyberAgentRegistry::instance().All().size() << "\\n";

    // 编译期默认清单(由生成器根据 behaviors[] 展开)。
    std::vector<std::string> btPaths = {
${btList || "        // (无 BT)"}
    };
    std::vector<std::string> fsmPaths = {
${fsmList || "        // (无 FSM)"}
    };
    if (argc > 1) {
        btPaths.clear(); fsmPaths.clear();
        for (int i = 1; i < argc; ++i) {
            std::string p = argv[i];
            if (IsFsmPath(p)) fsmPaths.push_back(p);
            else btPaths.push_back(p);
        }
    }

    // ① 解析所有 BT / FSM,失败即报错但不阻止其余继续
    std::vector<std::shared_ptr<BT::TreeTask>> btTasks;
    std::vector<std::string> btNames;
    for (const auto& raw : btPaths) {
        auto path = ResolveExisting(raw);
        auto content = ReadFile(path);
        if (content.empty()) { std::cerr << "[skip] cannot read " << path << "\\n"; continue; }
        BT::BTXmlLoader loader; std::string err;
        auto def = loader.LoadFromContent(content, &err);
        if (!def) { std::cerr << "[skip] BT parse " << path << ": " << err << "\\n"; continue; }
        btTasks.push_back(BT::CreateTreeTask(def));
        btNames.push_back(path);
        std::cout << "[main] loaded BT " << path << " (" << btTasks.back()->NodeCount() << " nodes)\\n";
    }
    std::vector<std::shared_ptr<FSM::StateMachineTask>> fsmTasks;
    std::vector<std::string> fsmNames;
    for (const auto& raw : fsmPaths) {
        auto path = ResolveExisting(raw);
        auto content = ReadFile(path);
        if (content.empty()) { std::cerr << "[skip] cannot read " << path << "\\n"; continue; }
        FSM::StateMachineLoader loader; std::string err;
        auto def = loader.LoadFromContent(content, &err);
        if (!def) { std::cerr << "[skip] FSM parse " << path << ": " << err << "\\n"; continue; }
        fsmTasks.push_back(FSM::CreateStateMachineTask(def));
        fsmNames.push_back(path);
        std::cout << "[main] loaded FSM " << path << " (" << fsmTasks.back()->StateCount() << " states)\\n";
    }

    if (btTasks.empty() && fsmTasks.empty()) { std::cerr << "[main] nothing to run\\n"; return 1; }

    // ③ 单帧循环并行 tick:每帧对所有 BT + 所有 FSM 各推一步;BT 全部非 Running 且 FSM 全部非 Running 才停。
    std::vector<BT::BTStatus> btSt(btTasks.size(), BT::BTStatus::Running);
    std::vector<FSM::FSMStatus> fsmSt(fsmTasks.size(), FSM::FSMStatus::Running);
    int frame = 0;
    for (; frame < 200; ++frame) {
        bool anyRunning = false;
        for (std::size_t i = 0; i < btTasks.size(); ++i) {
            if (btSt[i] == BT::BTStatus::Running) {
                btSt[i] = btTasks[i]->Tick();
                if (btSt[i] == BT::BTStatus::Running) anyRunning = true;
            }
        }
        for (std::size_t i = 0; i < fsmTasks.size(); ++i) {
            if (fsmSt[i] == FSM::FSMStatus::Running) {
                fsmSt[i] = fsmTasks[i]->Tick();
                if (fsmSt[i] == FSM::FSMStatus::Running) anyRunning = true;
            }
        }
        if (!anyRunning) break;
    }
    std::cout << "[${ns}] frame=" << frame
              << " BT=" << btTasks.size() << " FSM=" << fsmTasks.size() << " ticked in parallel.\\n";
    return 0;
}
`;
}

function topCmake(input: ProjectGenInput, ns: string, hasUserClasses: boolean): string {
  return `cmake_minimum_required(VERSION 3.16)
project(${input.workspaceName} LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 中文 Windows 上 MSVC 默认按 GBK 解码源码,会把 UTF-8 中文注释误读 → 后续代码连锁报错。
# 全局加 /utf-8 让 MSVC 同时按 UTF-8 解析源文件并生成 UTF-8 执行字符集。
if(MSVC)
    add_compile_options(/utf-8)
endif()

# ① 依赖库:BT/FSM 解析+映射+调度 + MAL(默认自包含,可独立编译)
add_subdirectory(runtime)
# ②' 真实引擎核心库:FOSim modules/extern + core/mal + pugi verbatim。
#    默认作 INTERFACE(仅暴露 header),skeleton 的 shim 与之接口对齐。
#    需要跑真解析器时: cmake -DUSE_REAL_ENGINE_LOADER=ON -DENGINE_EXTRA_INCLUDE=<FOSim/include>
if(EXISTS \${CMAKE_CURRENT_SOURCE_DIR}/engine-core/CMakeLists.txt)
    add_subdirectory(engine-core)
endif()
# ② 类型实现:枚举/结构体 + Agent 类完整实现
add_subdirectory(types)

add_executable(\${PROJECT_NAME} app/main.cpp)
target_link_libraries(\${PROJECT_NAME} PRIVATE ${ns}_types fosim_bt_runtime)

# 逻辑校验独立可执行:载入 behaviors/ 下每个 XML,跑 Tick,断言最终状态
# 用途:CI-friendly BT/FSM 行为验证,不依赖用户手工 stdin。
enable_testing()
add_executable(tick_check tests/tick_check.cpp)
target_link_libraries(tick_check PRIVATE ${ns}_types fosim_bt_runtime)
add_test(NAME logic_check
    COMMAND tick_check
    WORKING_DIRECTORY \${CMAKE_SOURCE_DIR})

${hasUserClasses ? `# --- 关键:强制 whole-archive 链接 ${ns}_types ---
# FOSIM_REGISTER_AGENT 宏靠"全局 static 对象在 main 前构造"来自动注册,
# 但静态对象放在 static library 里时,若 exe 没直接引用其符号,linker 会把整个 .obj 丢掉,
# 导致注册代码从未执行、CyberAgentRegistry 空。
# 解决:强制把 ${ns}_types 里所有 .obj 都拽进 exe(即 whole-archive)。
foreach(_tgt \${PROJECT_NAME} tick_check)
    if(MSVC)
        # MSVC:/WHOLEARCHIVE 需要 lib 绝对路径,用 generator expression 跨配置(Debug/Release)取值
        target_link_options(\${_tgt} PRIVATE "/WHOLEARCHIVE:$<TARGET_FILE:${ns}_types>")
    elseif(APPLE)
        target_link_options(\${_tgt} PRIVATE "-Wl,-force_load" "$<TARGET_FILE:${ns}_types>")
    else()
        # GCC/Clang on Linux
        target_link_options(\${_tgt} PRIVATE "-Wl,--whole-archive" "$<TARGET_FILE:${ns}_types>" "-Wl,--no-whole-archive")
    endif()
endforeach()` : "# (无用户类:${ns}_types 是 INTERFACE 库,无 static 注册符号,不需 whole-archive)"}
`;
}

/**
 * 自动化测试可执行 tests/tick_check.cpp:遍历 behaviors/ 下所有 .bt / .sm,
 * 跑 Tick 到 non-Running 或 maxFrames;打印每帧状态;断言:
 *   BT: 最终状态 != Running(即真的推完了,不是死循环)
 *   FSM: 最终状态 != Running 或达到 maxFrames(有推进即视为正常;推不动会打印警告)
 * 返回非 0 表示至少一棵树/状态机未按预期终止,ctest 会 fail。
 */
// ============ 可编排逐帧测试驱动 (tick_driver.h + trace_recorder.h/.cpp) ============
// 让用户在 tick_check 里对每帧注入 Agent 字段 + 断言节点访问轨迹,不再"跑 200 帧看最终"。
function tickDriverHeader(): string {
  return `// 由 BT Studio 生成 —— 逐帧驱动:beforeFrame 改 Agent 字段,afterFrame 断言/记录。
// 全 inline 头,DriveParallel 把并行 tick 循环包起来,替代 tick_check 里的原地死循环。
#pragma once
#include "fosim/bt_runtime.h"
#include "fosim/fsm_runtime.h"
#include <functional>
#include <memory>
#include <vector>

namespace TickDriver {

using FrameHook = std::function<bool(int frame)>;

struct DriveResult {
    int frames = 0;
    bool userTerminated = false;         // beforeFrame/afterFrame 返回 false 提前结束
    std::vector<BT::BTStatus>  btFinal;  // 每棵 BT 最后一次 Tick 的状态
    std::vector<FSM::FSMStatus> fsmFinal;// 每台 FSM 最后一次 Tick 的状态
};

inline DriveResult DriveParallel(
    std::vector<std::shared_ptr<BT::TreeTask>>& bts,
    std::vector<std::shared_ptr<FSM::StateMachineTask>>& fsms,
    int maxFrames,
    const FrameHook& beforeFrame = {},
    const FrameHook& afterFrame  = {})
{
    DriveResult r;
    r.btFinal.assign(bts.size(), BT::BTStatus::Running);
    r.fsmFinal.assign(fsms.size(), FSM::FSMStatus::Running);
    int f = 0;
    for (; f < maxFrames; ++f) {
        if (beforeFrame && !beforeFrame(f)) { r.userTerminated = true; break; }
        bool anyRunning = false;
        for (std::size_t i = 0; i < bts.size(); ++i) {
            if (r.btFinal[i] == BT::BTStatus::Running) {
                r.btFinal[i] = bts[i]->Tick();
                if (r.btFinal[i] == BT::BTStatus::Running) anyRunning = true;
            }
        }
        for (std::size_t i = 0; i < fsms.size(); ++i) {
            if (r.fsmFinal[i] == FSM::FSMStatus::Running) {
                r.fsmFinal[i] = fsms[i]->Tick();
                if (r.fsmFinal[i] == FSM::FSMStatus::Running) anyRunning = true;
            }
        }
        if (afterFrame && !afterFrame(f))  { r.userTerminated = true; ++f; break; }
        if (!anyRunning) { ++f; break; }
    }
    r.frames = f;
    return r;
}

} // namespace TickDriver
`;
}

function traceRecorderHeader(): string {
  return `// 由 BT Studio 生成 —— 内存版 trace sink,记录"哪个树哪一帧访问了哪个节点"。
// 与运行时的 BTTraceSink 挂钩:Attach() 会把 SetTraceSink 换成 recorder 的 sink;
// 每次 Tick 时,recorder 用 SetFrame() 里的 frame 打时间戳。
#pragma once
#include "fosim/bt_runtime.h"
#include <memory>
#include <string>
#include <vector>

struct TraceRecord {
    std::string tree;
    std::string node;      // BTNodeDef::name
    int nodeId = 0;        // BTNodeDef::id
    int frame  = -1;
    BT::BTStatus statusAfter = BT::BTStatus::Invalid;
    bool entered = false;
    bool exited  = false;
};

class TraceRecorder {
public:
    // 挂上所有 BT 的 sink;后续任何 tick 都会写入 records_。多个 recorder 会互相覆盖(单一 sink 槽)。
    void Attach(const std::vector<std::shared_ptr<BT::TreeTask>>& bts);
    void SetFrame(int f) { frame_ = f; }

    bool WasVisited(const std::string& tree, const std::string& node) const;
    bool WasVisitedAtFrame(const std::string& tree, const std::string& node, int f) const;
    int  VisitCount(const std::string& tree, const std::string& node) const;
    const std::vector<TraceRecord>& All() const { return records_; }
    void Clear() { records_.clear(); }

private:
    std::vector<TraceRecord> records_;
    int frame_ = -1;
};
`;
}

function traceRecorderCpp(): string {
  return `// 由 BT Studio 生成 —— 见头文件说明。
#include "fosim/trace_recorder.h"

void TraceRecorder::Attach(const std::vector<std::shared_ptr<BT::TreeTask>>& bts) {
    // 单一全局 sink 槽:装最后一个 recorder;多 recorder 场景请自己合并(通常测试里 1 个就够)。
    BT::BTTraceSink sink = [this](const BT::BTTraceEvent& ev) {
        TraceRecord r;
        if (ev.tree && !ev.tree->name.empty()) r.tree = ev.tree->name;
        if (ev.node) { r.node = ev.node->name; r.nodeId = ev.node->id; }
        r.frame       = frame_;
        r.statusAfter = ev.after;
        r.entered     = ev.entered;
        r.exited      = ev.exited;
        records_.push_back(std::move(r));
    };
    for (auto& t : bts) if (t) t->SetTraceSink(sink);
}

bool TraceRecorder::WasVisited(const std::string& tree, const std::string& node) const {
    for (const auto& r : records_) if (r.tree == tree && r.node == node) return true;
    return false;
}
bool TraceRecorder::WasVisitedAtFrame(const std::string& tree, const std::string& node, int f) const {
    for (const auto& r : records_) if (r.tree == tree && r.node == node && r.frame == f) return true;
    return false;
}
int TraceRecorder::VisitCount(const std::string& tree, const std::string& node) const {
    int n = 0;
    for (const auto& r : records_) if (r.tree == tree && r.node == node) ++n;
    return n;
}
`;
}

function tickCheckCpp(ns: string, behaviorNames: { name: string; kind: "bt" | "sm" }[], userClassNames: string[]): string {
  const inc = userClassNames.map((c) => `#include "${ns}/${c}.h"`).join("\n");
  const bts = behaviorNames.filter((b) => b.kind === "bt");
  const fsms = behaviorNames.filter((b) => b.kind === "sm");
  const listBt = bts.map((b) => `        "behaviors/${b.name}.bt.xml",`).join("\n");
  const listFsm = fsms.map((b) => `        "behaviors/${b.name}.fsm.xml",`).join("\n");
  // 首个用户类:测试代码里最常用到,直接暴露一个 shared_ptr 变量给 hook 用。
  const primaryClass = userClassNames[0] ?? "";
  const primaryVar = primaryClass ? primaryClass.charAt(0).toLowerCase() + primaryClass.slice(1) : "";
  const agentGrabBlock = primaryClass
    ? `    // 首个用户类的 Agent 引用,给 tick_check_before/after 用来读写 public 字段驱动分支。
    auto ${primaryVar} = std::dynamic_pointer_cast<${primaryClass}>(
        CyberAgentRegistry::instance().Get("${primaryClass}"));\n`
    : `    // (无用户类,无 Agent 引用可用)\n`;
  return `// 由 BT Studio 生成 —— BT/FSM 逻辑校验自动化测试
// 用法: 由 CMake ctest 自动调用;也支持从 build/Release 直接双击运行(自动上溯找 behaviors/)。
//
// !!! 保留用户代码:任何 ///<<< BEGIN WRITING YOUR CODE <tag> ... ///<<< END WRITING YOUR CODE <tag>
//     区块的内容,再生成时不会被覆盖。目前提供 3 个保留块:
//       - tick_check_before:每帧 tick 之前跑,改 Agent 字段驱动分支(例如让传感器第 3 帧才 ok)
//       - tick_check_after :每帧 tick 之后跑,用 TraceRecorder 断言"某帧命中某节点"
//       - tick_check_main  :跑完所有帧后跑,做全局最终断言(旧接口保留)
#include "fosim/bt_runtime.h"
#include "fosim/fsm_runtime.h"
#include "fosim/tick_driver.h"
#include "fosim/trace_recorder.h"
${inc || "// (无用户类)"}
#include <fstream>
#include <sstream>
#include <iostream>
#include <string>
#include <vector>
#include <memory>
#include <filesystem>

// 相对 behaviors/... 找不到时,依次尝试:cwd → ../→ ../../ → ../../../ → ../../../../。
// 兼容 ctest(WORKING_DIRECTORY=工程根)与"直接双击 build/Release/tick_check.exe"两种运行方式。
static std::string ResolveExisting(const std::string& rel) {
    namespace fs = std::filesystem;
    fs::path candidates[] = {
        fs::path(rel),
        fs::path("..") / rel,
        fs::path("..") / ".." / rel,
        fs::path("..") / ".." / ".." / rel,
        fs::path("..") / ".." / ".." / ".." / rel,
    };
    for (const auto& p : candidates) {
        std::error_code ec;
        if (fs::exists(p, ec) && fs::is_regular_file(p, ec)) return p.string();
    }
    return rel; // 让下游 ReadFile 报"cannot read"带原始路径
}

static std::string ReadFile(const char* path) {
    std::ifstream f(path);
    if (!f) return "";
    std::stringstream ss; ss << f.rdbuf();
    return ss.str();
}

// 单个 BT 加载:失败返回 nullptr(打印详细原因)。
static std::shared_ptr<BT::TreeTask> LoadBt(const std::string& rawPath, std::string& outResolved) {
    outResolved = ResolveExisting(rawPath);
    std::string content = ReadFile(outResolved.c_str());
    if (content.empty()) { std::cerr << "[FAIL] cannot read " << outResolved << "\\n"; return nullptr; }
    BT::BTXmlLoader loader; std::string err;
    auto def = loader.LoadFromContent(content, &err);
    if (!def) { std::cerr << "[FAIL] BT parse " << outResolved << ": " << err << "\\n"; return nullptr; }
    return BT::CreateTreeTask(def);
}
// 单个 FSM 加载:失败返回 nullptr。
static std::shared_ptr<FSM::StateMachineTask> LoadFsm(const std::string& rawPath, std::string& outResolved) {
    outResolved = ResolveExisting(rawPath);
    std::string content = ReadFile(outResolved.c_str());
    if (content.empty()) { std::cerr << "[FAIL] cannot read " << outResolved << "\\n"; return nullptr; }
    FSM::StateMachineLoader loader; std::string err;
    auto def = loader.LoadFromContent(content, &err);
    if (!def) { std::cerr << "[FAIL] FSM parse " << outResolved << ": " << err << "\\n"; return nullptr; }
    return FSM::CreateStateMachineTask(def);
}
static const char* BtStatusName(BT::BTStatus s) {
    return s == BT::BTStatus::Success ? "Success" :
           s == BT::BTStatus::Failure ? "Failure" :
           s == BT::BTStatus::Running ? "Running" : "Invalid";
}
static const char* FsmStatusName(FSM::FSMStatus s) {
    return s == FSM::FSMStatus::Success ? "Success" :
           s == FSM::FSMStatus::Failure ? "Failure" :
           s == FSM::FSMStatus::Running ? "Running" : "Invalid";
}

// 保留旧接口给 test 用(内部走并行版本的等价单树封装)。
static int CheckTree(const std::string& rawPath, int maxFrames) {
    std::string path;
    auto task = LoadBt(rawPath, path);
    if (!task) return 1;
    BT::BTStatus st = BT::BTStatus::Running;
    int frame = 0;
    for (; frame < maxFrames && st == BT::BTStatus::Running; ++frame) st = task->Tick();
    std::cout << "[BT] " << path << ": " << task->NodeCount()
              << " nodes, ended frame=" << frame
              << ", status=" << BtStatusName(st) << "\\n";
    if (st == BT::BTStatus::Running) {
        std::cerr << "[FAIL] " << path << " still Running after " << maxFrames << " frames\\n";
        return 1;
    }
    return 0;
}

int main() {
    // 触发所有 FOSIM_REGISTER_AGENT 静态注册的工厂,构造 Agent + RegisterFunctions。
    CyberAgentRegistry::instance().RegisterAll();
    std::cout << "[tick_check] agents registered: " << CyberAgentRegistry::instance().All().size() << "\\n";

    const std::vector<std::string> bts = {
${listBt || "        // (无 BT)"}
    };
    const std::vector<std::string> sms = {
${listFsm || "        // (无 FSM)"}
    };

    // 加载全部 —— 失败即 fails+1 但继续加载其余,允许部分工程编辑期错。
    int fails = 0;
    std::vector<std::shared_ptr<BT::TreeTask>> btTasks;
    std::vector<std::string> btNames;
    for (const auto& p : bts) {
        std::string resolved;
        auto t = LoadBt(p, resolved);
        if (!t) { ++fails; continue; }
        btTasks.push_back(t); btNames.push_back(resolved);
        std::cout << "[BT ] loaded " << resolved << " (" << t->NodeCount() << " nodes)\\n";
    }
    std::vector<std::shared_ptr<FSM::StateMachineTask>> fsmTasks;
    std::vector<std::string> fsmNames;
    for (const auto& p : sms) {
        std::string resolved;
        auto t = LoadFsm(p, resolved);
        if (!t) { ++fails; continue; }
        fsmTasks.push_back(t); fsmNames.push_back(resolved);
        std::cout << "[FSM] loaded " << resolved << " (" << t->StateCount() << " states)\\n";
    }

    // 挂上"轨迹记录器":每次 leaf tick 会写入一条 TraceRecord(tree/node/frame/status)。
    // 在 tick_check_after 里可用 rec.WasVisitedAtFrame("main_tree", "Fire", 12) 断言"某帧命中某节点"。
    TraceRecorder rec;
    rec.Attach(btTasks);

${agentGrabBlock}
    // 关键:单帧循环并行 tick 所有 BT + 所有 FSM(和 main.cpp 一致的并行调度语义)。
    // 断点打在任一 Action 的 (agent->*fptr)(in, out) 上都能命中 —— 因为 leaf 会真的调用注册的函数指针。
    const int maxFrames = 200;

    // beforeFrame:每帧 tick 之前跑,改 Agent 字段驱动分支(例如让传感器第 3 帧才 ok)。
    // 返回 false 会立即终止循环。第一个 tick 之前 frame=0。
    TickDriver::FrameHook beforeFrame = [&](int f) -> bool {
        rec.SetFrame(f);
        ///<<< BEGIN WRITING YOUR CODE tick_check_before
        // 示例(取消注释使用,前提是首个用户类的类里添加了 public bool sensor_ok / CyberRealType range 字段):
        // if (${primaryVar || "myAgent"}) { ${primaryVar || "myAgent"}->sensor_ok = (f >= 3); ${primaryVar || "myAgent"}->range = 5000.0 - f * 100.0; }
        (void)f;
        ///<<< END WRITING YOUR CODE tick_check_before
        return true;
    };

    // afterFrame:每帧 tick 之后跑,做单帧级断言(比如"这一帧应该已经进 Sensor_Open")。
    TickDriver::FrameHook afterFrame = [&](int f) -> bool {
        ///<<< BEGIN WRITING YOUR CODE tick_check_after
        // 示例(取消注释使用):
        // if (f == 5 && !rec.WasVisited("main_tree", "Sensor_Open")) { std::cerr << "[FAIL] Sensor_Open not visited by frame 5\\n"; ++fails; }
        (void)f;
        ///<<< END WRITING YOUR CODE tick_check_after
        return true;
    };

    auto driveResult = TickDriver::DriveParallel(btTasks, fsmTasks, maxFrames, beforeFrame, afterFrame);
    const int frame = driveResult.frames;
    const auto& btFinal  = driveResult.btFinal;
    const auto& fsmFinal = driveResult.fsmFinal;

    // 汇总:BT/FSM 最终状态(来自 DriveResult,recorder 里也有事件流)。
    for (std::size_t i = 0; i < btTasks.size(); ++i) {
        std::cout << "[BT ] " << btNames[i] << " frame=" << frame << " status=" << BtStatusName(btFinal[i]) << "\\n";
        if (btFinal[i] == BT::BTStatus::Running) {
            std::cerr << "[FAIL] " << btNames[i] << " still Running after " << maxFrames << " frames\\n";
            ++fails;
        }
    }
    for (std::size_t i = 0; i < fsmTasks.size(); ++i) {
        std::cout << "[FSM] " << fsmNames[i] << " frame=" << frame
                  << " currentState=" << fsmTasks[i]->CurrentStateId()
                  << " status=" << FsmStatusName(fsmFinal[i]) << "\\n";
    }

    ///<<< BEGIN WRITING YOUR CODE tick_check_main
    // 全局最终断言(所有帧跑完之后)。可用:
    //   - rec.WasVisited(tree, node) / rec.VisitCount(tree, node) / rec.All()
    //   - CyberAgentRegistry::instance().Get("XX")->字段
    //   - btFinal[i] / fsmFinal[i] 最终状态
    ///<<< END WRITING YOUR CODE tick_check_main

    std::cout << "logic_check: " << (fails ? "FAIL" : "PASS")
              << " (BT=" << bts.size() << " FSM=" << sms.size()
              << " frames=" << frame
              << " trace=" << rec.All().size() << " events)\\n";
    return fails;
}
`;
}

function readme(input: ProjectGenInput, ns: string): string {
  return `# ${input.workspaceName}(BT Studio 生成的可编译工程)

明确拆成两部分(对齐 behaviac 的"运行库 + 生成类型"):

## ① 依赖库 \`runtime/\`(fosim_bt_runtime)
行为树/状态机的【解析 + 映射 + 调度】+ MAL(对齐引擎 \`modules/extern\` 与 \`core/mal\`)。
- \`runtime/include/fosim/cyber_types.h\` — Cyber 决策类型 + \`CyberMalImpl\`(Get*/Add* 完整 API)+ 注册参数 + 函数指针。
- \`runtime/include/fosim/bt_runtime.h\` + \`runtime/src/bt_runtime.cpp\` — 解析 \`BTXmlLoader\` + 调度 \`TreeTask\`。
- 配置「引擎源码目录」生成时,会把**真实引擎的 modules/extern 头文件 + MAL + loader 源码拷贝进此目录**(不魔改)。

## ② 类型实现 \`types/\`(${ns}_types)
枚举/结构体 + Agent 类的**完整实现**(依赖 runtime):
- \`types/include/${ns}/types.h\` — 枚举/结构体。
- \`types/include/${ns}/<Class>.h\` — Agent 类声明(成员 + 决策方法 + RegisterFunctions)。
- \`types/src/<Class>.cpp\` — **完整方法体**:每个决策方法从 \`in_mal\` 读取输入参数、声明输出参数、
  \`///<<< BEGIN/END WRITING YOUR CODE\` 保留区供填逻辑、写回 \`out_mal\`、返回 CyberDFMPFRC;
  以及 \`RegisterFunctions\` 内 \`RegisterDecisionFunction("CMD","Method", DecisionFunctionInitialParameter{...})\`。

## 组合
- \`app/main.cpp\` — ① 加载 XML ② 各 Agent.RegisterFunctions() 绑定函数地址 ③ 外部 tick 驱动。
- \`behaviors/\` — 导出的行为树/状态机 XML。

## 解析 → 映射 → 绑定 → 调度(对齐引擎 modules/extern)
1. **解析**(\`bt_xml_loader\`):把 \`*.bt.xml\` 解析成节点结构,每个 Action/Condition 节点携带
   \`function\`(函数名/CMD)+ \`className\`/\`mdataName\`/\`componentId\`(选择器)。**解析阶段不绑定**。
2. **映射/绑定**(\`bt_runtime\` 的 BindUniqueDecision):运行时用 \`node.function\` 在该 Agent 的挂载模型上
   \`GetDecisionFunctionByName(function)\` 唯一匹配,拿到 \`RegisterDecisionFunction\` 注册的 \`function_ptr_\`。
   —— 所以"行为树节点"映射到"某个类(模型/组件)用 RegisterDecisionFunction 注册的决策方法"。
3. **调度/执行**:\`(model->*function_ptr_)(&in_mal, &out_mal)\` 返回 CyberDFMPFRC;输入参数从 in_mal 读、输出写 out_mal。
   —— 这就是"函数怎么绑定/为什么这样实现":函数体即各类的决策方法,经 RegisterFunctions 把"名字→成员函数地址"登记好。

> 接真实引擎时:把引擎 \`modules/extern\` + \`core/mal\` + \`pugi\` 源码拷到 \`engine-core/\` 目录,
> 在顶层 CMakeLists.txt 解开 \`add_subdirectory(engine-core)\` 注释,并通过
> \`-D ENGINE_EXTRA_INCLUDE=<引擎 include 根>\` 让 \`bt_runtime.cpp\` 能解析业务头(CyberSimIO/models/*)。
> 默认生成的 \`runtime/\` 已是可独立编译的等价骨架,不依赖任何引擎业务头。

## 构建 / 运行
\`\`\`
cmake -S . -B build && cmake --build build
./build/${input.workspaceName} behaviors/<tree>.bt.xml
\`\`\`

模型已有类(source=model)由 FOSim 模型库提供,不在此生成;用户新建类生成在 \`types/\`。
`;
}

/** 生成完整工程文件集(path -> content)。 */
export function generateProject(input: ProjectGenInput): CppFile[] {
  const ns = input.namespace || "btproj";
  const files: CppFile[] = [];
  // 导出 .cpp 的类 = 类型空间里【含方法或成员】的类(用户新建 + 抽取来的模型类都算"类型实现")。
  // 这样每个被行为树绑定的类都有完整 .h/.cpp(声明 + RegisterFunctions + 决策方法体)。
  const userClasses = input.catalog.classes.filter((c) => {
    if (c.source === "user") return true;
    const hasMethod = input.catalog.functionCatalog.functions.some((f) => functionOwnerClass(f) === c.className);
    const hasMember = input.catalog.members.some((m) => m.ownerClassId === c.classId);
    return hasMethod || hasMember;
  });
  const userClassNames = userClasses.map((c) => c.className);

  // ① 依赖库 runtime/(BT + FSM 解析/调度 + MAL)
  files.push({ path: "runtime/include/fosim/cyber_types.h", content: cyberTypesHeader(input.catalog) });
  files.push({ path: "runtime/include/fosim/bt_runtime.h", content: btRuntimeHeader() });
  files.push({ path: "runtime/src/bt_runtime.cpp", content: btRuntimeCpp() });
  files.push({ path: "runtime/include/fosim/fsm_runtime.h", content: fsmRuntimeHeader() });
  files.push({ path: "runtime/src/fsm_runtime.cpp", content: fsmRuntimeCpp() });
  files.push({ path: "runtime/include/fosim/tick_driver.h", content: tickDriverHeader() });
  files.push({ path: "runtime/include/fosim/trace_recorder.h", content: traceRecorderHeader() });
  files.push({ path: "runtime/src/trace_recorder.cpp", content: traceRecorderCpp() });
  files.push({ path: "runtime/CMakeLists.txt", content: runtimeCmake() });

  // ② 类型实现 types/
  const typeFiles = generateCpp(input.catalog).filter((f) => f.path.endsWith("btstudio_types.h"));
  for (const t of typeFiles) files.push({ path: `types/include/${ns}/types.h`, content: t.content });
  if (!typeFiles.length) files.push({ path: `types/include/${ns}/types.h`, content: `// 由 BT Studio 生成 —— 枚举/结构体类型实现\n#pragma once\n` });
  for (const cls of userClasses) {
    files.push({ path: `types/include/${ns}/${cls.className}.h`, content: userAgentHeader(ns, cls.className, input.catalog) });
    files.push({ path: `types/src/${cls.className}.cpp`, content: userAgentCpp(ns, cls.className, input.catalog) });
  }
  files.push({ path: "types/CMakeLists.txt", content: typesCmake(ns, userClassNames) });

  // 行为树 / 状态机:BT → *.bt.xml(BTXmlLoader);FSM → *.fsm.xml(StateMachineLoader)。
  for (const b of input.behaviors) {
    const ext = b.kind === "state_machine" ? "fsm.xml" : "bt.xml";
    files.push({ path: `behaviors/${b.name}.${ext}`, content: b.xml });
  }

  // app + 顶层 CMake + README
  files.push({ path: "app/main.cpp", content: mainCpp(ns, input.behaviors, userClassNames) });
  files.push({ path: "CMakeLists.txt", content: topCmake(input, ns, userClassNames.length > 0) });
  files.push({ path: "README.md", content: readme(input, ns) });

  // 自动化逻辑校验 tick_check(CMake ctest 拉起,遍历 behaviors/ 断言最终状态)
  const behaviorRefs = input.behaviors.map((b) => ({
    name: b.name,
    kind: (b.kind === "state_machine" ? "sm" : "bt") as "bt" | "sm",
  }));
  files.push({ path: "tests/tick_check.cpp", content: tickCheckCpp(ns, behaviorRefs, userClassNames) });

  return files;
}
