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
 * 参考:F:\FOSim\FOSimEngine\src\modules\extern(BT/FSM 运行时)、core/mal(FZMalImpl 的 Get/Add API)、
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
    // 兼容遗留 FZ* 串
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
  // 生成代码统一直接继承 FZDecisionAgentBase(无业务/实体的纯函数地址绑定基类)。
  return "FZDecisionAgentBase";
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

/** runtime:FZ 决策类型 + MAL(Get/Add 完整 API,对齐引擎 fz_mal_impl.h)。自包含可独立编译。 */
function fzTypesHeader(_catalog: CatalogBundle): string {
  return `// 由 BT Studio 生成 —— 依赖库:FZ 决策类型 + MAL(对齐 FOSim 引擎 core/mal,无业务/实体)。
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
#include <cstring>

// 决策函数返回值(对齐 FOSim CyberDFMPFRC)。
enum CyberDFMPFRC { FZ_DFMPFRC_UNKNOWN = 0, FZ_DFMPFRC_CONTINUOUS = 1, FZ_DFMPFRC_SINGLE = 2, FZ_DFMPFRC_ERROR = 3 };

// FZ 基础类型别名(对齐引擎命名)。
typedef long CyberIntegerType;
typedef double CyberRealType;
typedef bool CyberBOOL;
typedef double CyberJulianType;
typedef std::string CyberNameType;
typedef std::vector<double> CyberVectorType;
struct CyberPositionType { double x = 0, y = 0, z = 0; };
struct CyberCoordinateType { double longitude = 0, latitude = 0, altitude = 0; };
struct CyberOrientationType { double yaw = 0, pitch = 0, roll = 0; };

// MAL(方法参数列表):按名读写。Get* 数值/坐标为值返回式(对齐引擎 T Get<Type>(name, FZRC*=nullptr))。
class FZMalImpl {
public:
    static FZMalImpl* CreateMAL() { return new FZMalImpl(); }

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
// 若改用已定义的单继承基类(如 FZDecisionAgentBase),MSVC 会采用紧凑表示,
// (ProcessDecisionFunctionPtr)&Derived::Method 触发 C4407 / 截断,导致编译不过。
class __UnexistingClass;
typedef CyberDFMPFRC (__UnexistingClass::*ProcessDecisionFunctionPtr)(FZMalImpl*, FZMalImpl*);

// 注册参数(对齐引擎 DecisionFunctionInitialParameter)。
struct DecisionFunctionInitialParameter {
    CyberRealType delay_time_ = 0.0;
    CyberRealType delay_time_delta_ = 0.0;
    CyberRealType repeat_time_ = 0.0;
    CyberRealType repeat_time_delta_ = 0.0;
    FZMalImpl* mal_ = nullptr;
    ProcessDecisionFunctionPtr function_ptr_ = nullptr;
};

// 决策 Agent 基类:函数地址绑定(name/CMD -> 函数指针)。无业务/实体。
class FZDecisionAgentBase {
public:
    FZDecisionAgentBase() = default;
    virtual ~FZDecisionAgentBase() = default;
    void RegisterDecisionFunction(const std::string& cmd, const std::string& name, DecisionFunctionInitialParameter* p) {
        functions_[name] = p;
        cmd_to_name_[cmd] = name;
    }
    const std::map<std::string, DecisionFunctionInitialParameter*>& Functions() const { return functions_; }
protected:
    std::map<std::string, DecisionFunctionInitialParameter*> functions_;
    std::map<std::string, std::string> cmd_to_name_;
};
`;
}

function btRuntimeHeader(): string {
  return `// 由 BT Studio 生成 —— 依赖库:行为树/状态机【解析 + 映射 + 调度】接口(对齐引擎 modules/extern)。
#pragma once
#include <string>
#include <memory>
#include <vector>

namespace BT {

enum class BTStatus { Invalid, Success, Failure, Running };

struct BehaviorNodeDef {
    std::string nodeType;
    std::string id;
    std::string className;   // 绑定的类
    std::string function;    // 绑定的函数/CMD
    std::vector<BehaviorNodeDef> children;
};
struct BehaviorTreeDef {
    std::string name;
    BehaviorNodeDef root;
};
using BehaviorTreeDefPtr = std::shared_ptr<BehaviorTreeDef>;

// 解析:把 *.bt.xml 内容解析为定义结构。
class BTXmlLoader {
public:
    BehaviorTreeDefPtr LoadFromContent(const std::string& content, std::string* err);
};

// 调度:外部按帧推进(真实调度按 enter->update->exit 调用绑定的函数地址)。
class TreeTask {
public:
    explicit TreeTask(BehaviorTreeDefPtr def) : def_(std::move(def)) {}
    BTStatus Tick();
    int NodeCount() const;
private:
    BehaviorTreeDefPtr def_;
};
std::shared_ptr<TreeTask> CreateTreeTask(BehaviorTreeDefPtr def);

} // namespace BT
`;
}

function btRuntimeCpp(): string {
  return `// 由 BT Studio 生成 —— 依赖库:BT/FSM 解析 + 调度实现(自包含,无业务/外部库)。
// 接入真实引擎:用 modules/extern 的 bt_xml_loader.cpp / bt_runtime.cpp 等替换本文件(接口一致)。
#include "fosim/bt_runtime.h"
#include <cstddef>

namespace BT {

static std::string attr(const std::string& tag, const std::string& key) {
    auto pos = tag.find(key + "=\\"");
    if (pos == std::string::npos) return "";
    pos += key.size() + 2;
    auto end = tag.find('"', pos);
    return end == std::string::npos ? "" : tag.substr(pos, end - pos);
}

// 极简结构扫描:按文档序解析所有带 id 的节点为一棵扁平树(根 + children)。
BehaviorTreeDefPtr BTXmlLoader::LoadFromContent(const std::string& content, std::string* err) {
    if (content.empty()) { if (err) *err = "empty content"; return nullptr; }
    auto def = std::make_shared<BehaviorTreeDef>();
    std::size_t i = 0;
    bool first = true;
    while ((i = content.find('<', i)) != std::string::npos) {
        auto gt = content.find('>', i);
        if (gt == std::string::npos) break;
        std::string tag = content.substr(i + 1, gt - i - 1);
        i = gt + 1;
        if (tag.empty() || tag[0] == '?' || tag[0] == '!' || tag[0] == '/') continue;
        std::string id = attr(tag, "id");
        if (id.empty()) continue;
        BehaviorNodeDef node;
        node.id = id;
        node.nodeType = tag.substr(0, tag.find_first_of(" />"));
        node.className = attr(tag, "className");
        node.function = attr(tag, "function");
        if (first) { def->root = node; def->name = attr(tag, "name"); first = false; }
        else { def->root.children.push_back(node); }
    }
    return def;
}

int TreeTask::NodeCount() const { return def_ ? 1 + (int)def_->root.children.size() : 0; }

BTStatus TreeTask::Tick() {
    return def_ ? BTStatus::Success : BTStatus::Invalid;
}

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

namespace FSM {

static std::string attr(const std::string& tag, const std::string& key) {
    auto pos = tag.find(key + "=\\"");
    if (pos == std::string::npos) return "";
    pos += key.size() + 2;
    auto end = tag.find('"', pos);
    return end == std::string::npos ? "" : tag.substr(pos, end - pos);
}
static int toInt(const std::string& s) { return s.empty() ? 0 : std::atoi(s.c_str()); }

// 扫描 <Node Class="State" ...> 与其内 <Attachment Class="TransitionCondition/StateTransform" ...>。
StateMachineDefPtr StateMachineLoader::LoadFromContent(const std::string& content, std::string* err) {
    if (content.empty()) { if (err) *err = "empty content"; return nullptr; }
    auto def = std::make_shared<StateMachineDef>();
    std::size_t i = 0;
    StateDef* cur = nullptr;
    bool firstState = true;
    while ((i = content.find('<', i)) != std::string::npos) {
        auto gt = content.find('>', i);
        if (gt == std::string::npos) break;
        std::string tag = content.substr(i + 1, gt - i - 1);
        i = gt + 1;
        if (tag.empty() || tag[0] == '?' || tag[0] == '!') continue;
        if (tag[0] == '/') { continue; }
        std::string elem = tag.substr(0, tag.find_first_of(" />"));
        if (elem == "Root") { def->name = attr(tag, "name"); continue; }
        if (elem == "Node" && attr(tag, "Class") == "State") {
            StateDef s;
            s.id = toInt(attr(tag, "Id"));
            s.name = attr(tag, "Name");
            s.function = attr(tag, "Method");
            s.isEndState = attr(tag, "IsEndState") == "true";
            def->states[s.id] = s;
            cur = &def->states[s.id];
            if (firstState) { def->rootId = s.id; firstState = false; }
        } else if (elem == "Attachment" && cur) {
            TransitionDef t;
            t.id = toInt(attr(tag, "Id"));
            t.targetStateId = toInt(attr(tag, "TargetFSMNodeId"));
            t.op = attr(tag, "Operator");
            t.functionName = attr(tag, "Opl");
            t.value = attr(tag, "Opr");
            t.referenceBehavior = attr(tag, "ReferenceBehavior");
            cur->transitions.push_back(t);
        }
    }
    if (def->states.empty()) { if (err) *err = "no <Node Class=\\"State\\"> found"; return nullptr; }
    return def;
}

StateMachineTask::StateMachineTask(StateMachineDefPtr def) : def_(std::move(def)) {
    if (def_) current_ = def_->rootId;
}

// 自包含骨架的一步推进:执行当前状态;若为结束态→Success;否则取第一条有目标的迁移切换并 Running。
// 真实引擎在此按 (model->*function_ptr_) 求条件、按 Operator/Opl/Opr 比较决定迁移。
FSMStatus StateMachineTask::Tick() {
    if (!def_ || def_->states.find(current_) == def_->states.end()) return FSMStatus::Invalid;
    const StateDef& st = def_->states[current_];
    if (st.isEndState) return FSMStatus::Success;
    for (const auto& tr : st.transitions) {
        if (tr.targetStateId != 0 && def_->states.find(tr.targetStateId) != def_->states.end()) {
            current_ = tr.targetStateId;
            return FSMStatus::Running;
        }
    }
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
  // 生成代码统一直接继承 FZDecisionAgentBase(无业务/实体的纯函数地址绑定基类)。
  // 类型空间里填的 baseClass(FZPlatformImpl/FZAgentImpl 等业务标签)在自包含工程里
  // 都是 FZDecisionAgentBase 的空壳别名,直接继承基类更直白也避免 IDE 语义混淆;
  // 接真实引擎时由用户决定真实层级,本生成器不预设。
  const lines: string[] = [];
  lines.push(`// 由 BT Studio 生成 —— 类型实现:Agent 类 ${className}(继承 FZDecisionAgentBase)。`);
  lines.push(`// 决策方法签名 CyberDFMPFRC(FZMalImpl* in_mal, FZMalImpl* out_mal);注册见 .cpp 的 RegisterFunctions。`);
  lines.push("#pragma once");
  lines.push('#include "fosim/fz_types.h"');
  lines.push(`#include "${ns}/types.h"`);
  lines.push("");
  lines.push(`class ${className} : public FZDecisionAgentBase`);
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
    lines.push(`    CyberDFMPFRC ${fn.name}(FZMalImpl* in_mal, FZMalImpl* out_mal); // ${sig || "无参数"}`);
  }
  lines.push("");
  lines.push("    ///<<< BEGIN WRITING YOUR CODE CLASS_MEMBERS");
  lines.push("    ///<<< END WRITING YOUR CODE");
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
    lines.push(`    ${fn.name}Decision->mal_ = FZMalImpl::CreateMAL();`);
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
    lines.push(`CyberDFMPFRC ${className}::${fn.name}(FZMalImpl* in_mal, FZMalImpl* out_mal)`);
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
    lines.push("    ///<<< END WRITING YOUR CODE");
    lines.push("");
    for (const p of outputs) lines.push(writeOutput(p));
    lines.push("    return FZ_DFMPFRC_SINGLE;");
    lines.push("}");
    lines.push("");
  }
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
  firstBehavior: { name: string; kind?: "behavior_tree" | "state_machine" } | undefined,
  userClasses: string[],
): string {
  const defFile = firstBehavior
    ? `behaviors/${firstBehavior.name}.${firstBehavior.kind === "state_machine" ? "fsm" : "bt"}.xml`
    : "behaviors/your_tree.bt.xml";
  const inc = userClasses.map((c) => `#include "${ns}/${c}.h"`).join("\n");
  const reg = userClasses
    .map((c) => `    ${c} ${c.toLowerCase()}; ${c.toLowerCase()}.RegisterFunctions(); // 绑定函数地址(name -> &${c}::Method)`)
    .join("\n");
  return `// 由 BT Studio 生成的运行入口 —— 组合 ① 依赖库 runtime + ② 类型实现 types。
// ① 加载行为树/状态机 XML;② 绑定函数地址(RegisterFunctions);③ 外部驱动 Tick。
// 行为树 → BT::BTXmlLoader / TreeTask;状态机(projectType="状态机" / *.fsm.xml)→ FSM::StateMachineLoader / StateMachineTask。
#include "fosim/bt_runtime.h"
#include "fosim/fsm_runtime.h"
${inc || "// (无用户类)"}
#include <fstream>
#include <sstream>
#include <iostream>

static std::string ReadFile(const char* path) {
    std::ifstream f(path);
    std::stringstream ss; ss << f.rdbuf();
    return ss.str();
}
static bool IsStateMachine(const std::string& path, const std::string& content) {
    if (path.size() >= 8 && path.rfind(".fsm.xml") == path.size() - 8) return true;
    return content.find("projectType=\\"\\xe7\\x8a\\xb6\\xe6\\x80\\x81\\xe6\\x9c\\xba\\"") != std::string::npos // "状态机" UTF-8
        || content.find("<FSMNodes>") != std::string::npos;
}

int main(int argc, char** argv) {
    const char* path = argc > 1 ? argv[1] : "${defFile}";
    std::string content = ReadFile(path);

    // ② 函数地址绑定(类型实现 types):BT 与 FSM 均用同一套 RegisterDecisionFunction 绑定。
${reg || "    // (无用户类:函数由真实模型库提供,或在此手动注册函数指针)"}

    // ① 解析 + ③ 外部驱动(依赖库 runtime 调度)。按工程类型选择 BT / FSM 运行时。
    std::string err;
    if (IsStateMachine(path, content)) {
        FSM::StateMachineLoader loader;
        auto def = loader.LoadFromContent(content, &err);
        if (!def) { std::cerr << "fsm load failed: " << err << "\\n"; return 1; }
        auto task = FSM::CreateStateMachineTask(def);
        FSM::FSMStatus st = FSM::FSMStatus::Running;
        for (int frame = 0; frame < 100 && st == FSM::FSMStatus::Running; ++frame) st = task->Tick();
        std::cout << "[${ns}] FSM loaded " << task->StateCount() << " states, ended at state " << task->CurrentStateId() << ".\\n";
        return 0;
    }

    BT::BTXmlLoader loader;
    auto def = loader.LoadFromContent(content, &err);
    if (!def) { std::cerr << "bt load failed: " << err << "\\n"; return 1; }
    auto task = BT::CreateTreeTask(def);
    for (int frame = 0; frame < 100; ++frame) {
        BT::BTStatus s = task->Tick();
        if (s != BT::BTStatus::Running) break;
    }
    std::cout << "[${ns}] BT loaded " << task->NodeCount() << " nodes, functions bound & ticked.\\n";
    return 0;
}
`;
}

function topCmake(input: ProjectGenInput, ns: string): string {
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
# ②' 真实引擎核心库:从 FOSim modules/extern 抽取的【真实】解析(bt_xml_loader)+调度(bt_runtime)+MAL+pugi。
#    需引擎业务头才能完整编译,故默认不构建;接真实引擎时取消下行注释并设 ENGINE_EXTRA_INCLUDE。
# add_subdirectory(engine-core)
# ② 类型实现:枚举/结构体 + Agent 类完整实现
add_subdirectory(types)

add_executable(\${PROJECT_NAME} app/main.cpp)
target_link_libraries(\${PROJECT_NAME} PRIVATE ${ns}_types fosim_bt_runtime)
`;
}

function readme(input: ProjectGenInput, ns: string): string {
  return `# ${input.workspaceName}(BT Studio 生成的可编译工程)

明确拆成两部分(对齐 behaviac 的"运行库 + 生成类型"):

## ① 依赖库 \`runtime/\`(fosim_bt_runtime)
行为树/状态机的【解析 + 映射 + 调度】+ MAL(对齐引擎 \`modules/extern\` 与 \`core/mal\`)。
- \`runtime/include/fosim/fz_types.h\` — FZ 决策类型 + \`FZMalImpl\`(Get*/Add* 完整 API)+ 注册参数 + 函数指针。
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
> \`-D ENGINE_EXTRA_INCLUDE=<引擎 include 根>\` 让 \`bt_runtime.cpp\` 能解析业务头(FZSimIO/models/*)。
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
  files.push({ path: "runtime/include/fosim/fz_types.h", content: fzTypesHeader(input.catalog) });
  files.push({ path: "runtime/include/fosim/bt_runtime.h", content: btRuntimeHeader() });
  files.push({ path: "runtime/src/bt_runtime.cpp", content: btRuntimeCpp() });
  files.push({ path: "runtime/include/fosim/fsm_runtime.h", content: fsmRuntimeHeader() });
  files.push({ path: "runtime/src/fsm_runtime.cpp", content: fsmRuntimeCpp() });
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
  files.push({ path: "app/main.cpp", content: mainCpp(ns, input.behaviors[0], userClassNames) });
  files.push({ path: "CMakeLists.txt", content: topCmake(input, ns) });
  files.push({ path: "README.md", content: readme(input, ns) });

  return files;
}
