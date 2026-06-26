// btsdk/runtime.h
// BT Studio 运行时 SDK —— 行为树运行适配接口(C++17,接口骨架)。
//
// 对应总设计文档 §10.7 Runtime Adapter。实现时:
//  - loadTree 复用 BT::BTXmlLoader::LoadFromContent 生成 BT::BehaviorTreeDef。
//  - createContext 内部构造 BT::BlackboardStore。
//  - registerAction/registerCondition 注册宿主 handler。
//  - buildInputMal 是所有 Action/Condition 调用前构造输入 MAL 的唯一入口。
//  - readOutputMal 是所有输出回写与比较逻辑的唯一入口。
//  - tick 推进一帧,产出携带 nodeId 的 trace 事件,使调试日志可跳回设计节点。
#pragma once

#include "mal_bridge.h"
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace btsdk {

enum class Status : std::int32_t { Invalid = 0, Success, Failure, Running };

using TreeHandle = std::uint64_t;
using ContextHandle = std::uint64_t;

// 宿主 Action/Condition handler:读入输入 MAL,写出输出 MAL,返回状态。
using ActionHandler = std::function<Status(const IMalBridge& input, IMalBridge& output)>;
using ConditionHandler = std::function<Status(const IMalBridge& input, IMalBridge& output)>;

struct TraceEvent {
    std::uint64_t tickIndex = 0;
    std::string treeName;
    std::string nodeId;     // 运行态 id 对应设计态稳定 nodeId,用于跳回设计节点
    std::string nodeKind;
    std::string functionName;
    std::string phase;      // "enter" | "exit"
    Status status = Status::Invalid;
    std::string inputMalSummary;
    std::string outputMalSummary;
};

struct LoadResult {
    bool ok = false;
    TreeHandle tree = 0;
    std::string message;
};

class IBehaviorTreeRuntime {
public:
    virtual ~IBehaviorTreeRuntime() = default;

    // 加载行为树 XML(BTXmlLoader 兼容)。
    virtual LoadResult loadTree(const std::string& xmlContent) = 0;

    // 创建运行上下文(初始黑板:key -> literal value)。
    virtual ContextHandle createContext(TreeHandle tree) = 0;

    // 注册宿主函数。
    virtual void registerAction(const std::string& name, ActionHandler handler) = 0;
    virtual void registerCondition(const std::string& name, ConditionHandler handler) = 0;

    // 黑板读写(按 MAL 类型)。
    virtual bool setBlackboardValue(ContextHandle ctx, const std::string& key, MalType type,
                                    const std::string& valueLiteral) = 0;
    virtual bool getBlackboardValue(ContextHandle ctx, const std::string& key,
                                    std::string& outSerialized) const = 0;

    // 推进一帧;追加 trace 到 outEvents,返回该帧根状态。
    virtual Status tick(TreeHandle tree, ContextHandle ctx, std::vector<TraceEvent>& outEvents) = 0;

    // 重置上下文到初值。
    virtual void resetContext(ContextHandle ctx) = 0;
};

// 工厂:默认返回内置 stub 实现(不接引擎);接入 FOSim 时替换。
IBehaviorTreeRuntime* createDefaultRuntime();
void destroyRuntime(IBehaviorTreeRuntime* runtime);

}  // namespace btsdk
