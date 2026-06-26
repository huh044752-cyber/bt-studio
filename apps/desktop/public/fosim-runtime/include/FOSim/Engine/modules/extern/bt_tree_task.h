#pragma once

#include "modules/extern/bt_task.h"
#include <memory>

namespace BT
{
    // BehaviorTreeTask 是“一棵树在一个 unit 上的一次运行态实例”。
    // 它和静态定义 BehaviorTreeDef 分离，负责：
    // - 持有 rootTask_ 运行态
    // - 持有 local blackboard
    // - 在 Tick 中把 Agent 上下文传给根任务
    //
    // 同一份 BehaviorTreeDef 可以被多个 unit 共享；
    // 但每个 unit 都必须拥有自己独立的 BehaviorTreeTask，避免 Running 状态和局部黑板互相污染。
    class BehaviorTreeTask
    {
    public:
        explicit BehaviorTreeTask(BehaviorTreeDefPtr def, BlackboardStore* globalBlackboards = nullptr);
        // Initialize 负责把静态定义编译成可运行的根任务树，并准备局部黑板。
        bool Initialize();
        // Tick 是行为树每帧唯一主入口。
        BTStatus Tick(AgentPtr agent);
        // Reset 清理 running 状态，但不销毁静态定义。
        void Reset();
        void Abort(AgentPtr agent, BTStatus status);
        BlackboardStore& LocalBlackboards();
        const BlackboardStore& LocalBlackboards() const;
        // 行为树节点输入/输出和 observer 都通过统一黑板查询入口访问值。
        const BlackboardValue* FindBlackboardValue(const std::string& boardId, const std::string& variableId) const;
        bool SetBlackboardValue(const std::string& boardId, const std::string& variableId, const std::string& value);
        std::vector<BlackboardValueView> GetAllBlackboardValueViews() const;
        // 主要用于调试、测试和 observer，查看当前仍处于 Running 的任务链。
        std::vector<const BTTask*> GetRunningNodes() const;
        BehaviorTreeDefPtr GetDef() const;

    private:
        // def_ 是静态定义，可共享；rootTask_ 是当前实例的运行态根任务。
        BehaviorTreeDefPtr def_;
        std::unique_ptr<BTTask> rootTask_;
        BlackboardStore localBlackboards_;
        // globalBlackboards_ 由外部上下文 owner 持有，这里只借用。
        BlackboardStore* globalBlackboards_;
    };
}
