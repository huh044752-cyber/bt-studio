#pragma once

#include "modules/extern/agent.h"
#include "modules/extern/state_machine_task.h"

namespace BT
{
    // StateMachineAgent 把状态机任务接入旧 Agent 生命周期，并负责与旧状态枚举做边界映射。
    // 它是“状态机定义/任务”和“旧 Agent 执行框架”之间的薄适配层：
    // - LoadByNode/LoadByContent 只负责生成 StateMachineTask
    // - ExecNode 负责把 StateMachineStepResult 映射回旧 FZDecisionResult 体系
    class StateMachineAgent : public Agent
    {
    public:
        StateMachineAgent(FZSimulateGlobalPtr sim_global, IFZUnit* unit_);
        ~StateMachineAgent();
        StateMachineAgent() = delete;

        bool LoadByNode(const pugi::xml_node& node) override;
        bool LoadByContent(const std::string& content) override;
        void ExecNode();
        void Reset();
        void Pause();
        StateDefPtr GetCurrentState() const;

    private:
        StateMachineDefPtr state_machine_def_;
        std::unique_ptr<StateMachineTask> state_machine_task_;
        bool has_last_exec_master_time_ = false;
        EngineTimeStamp last_exec_master_time_ = 0;
    };

    typedef std::shared_ptr<StateMachineAgent> StateMachineAgentPtr;
}
