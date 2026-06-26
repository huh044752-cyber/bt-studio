#include "modules/extern/state_machine_agent.h"

#include "modules/extern/state_machine_loader.h"

namespace BT
{
    StateMachineAgent::StateMachineAgent(FZSimulateGlobalPtr sim_global, IFZUnit* unit_)
        : Agent(sim_global, unit_)
    {
        agent_type = FZ_BEHAVIOR_AGENT_TYPE_STATE_MACHINE;
    }

    StateMachineAgent::~StateMachineAgent()
    {
        state_machine_task_.reset();
        state_machine_def_.reset();
        current_status = FZ_DFMPFRC_ERROR;
        sim_global_ = nullptr;
        shared_mal_.reset();
    }

    bool StateMachineAgent::LoadByNode(const pugi::xml_node& node)
    {
        if (node.empty())
        {
            return false;
        }

        StateMachineLoader loader;
        std::string error;
        state_machine_def_ = loader.LoadFromRoot(node, &error);
        if (!state_machine_def_)
        {
            LogError(error.c_str());
            return false;
        }

        // 状态机与行为树一样采用 Def / Task 分离：
        // - Def 是静态定义
        // - Task 是当前 unit 独享的运行态
        state_machine_task_.reset(new StateMachineTask(state_machine_def_));
        node_ = node;
        current_status = FZ_DFMPFRC_CONTINUOUS;
        has_last_exec_master_time_ = false;
        last_exec_master_time_ = 0;
        return true;
    }

    bool StateMachineAgent::LoadByContent(const std::string& content)
    {
        if (content.empty())
        {
            return false;
        }

        pugi::xml_document doc;
        auto result = doc.load_string(content.c_str());
        if (!result)
        {
            LogError(("Failed to load state machine XML: " + std::string(result.description())).c_str());
            return false;
        }
        return LoadByNode(doc.child("Root"));
    }

    void StateMachineAgent::ExecNode()
    {
        if (mask)
        {
            return;
        }
        if (current_status != FZ_DFMPFRC_CONTINUOUS)
        {
            return;
        }
        if (!state_machine_task_)
        {
            current_status = FZ_DFMPFRC_ERROR;
            return;
        }
        const EngineTimeStamp current_master_time = sim_global_ ? sim_global_->master_time_ : 0;
        if (has_last_exec_master_time_ && last_exec_master_time_ == current_master_time)
        {
            return;
        }
        has_last_exec_master_time_ = true;
        last_exec_master_time_ = current_master_time;

        // StateMachineTask 内部会推进：
        // 1. 当前状态函数/脚本
        // 2. 挂接行为树
        // 3. 条件转移
        // Agent 层只负责把运行结果折回旧决策状态枚举。
        const StateMachineStepResult result = state_machine_task_->Tick(shared_from_this());
        switch (result.status)
        {
        case FZDecisionResult::Success:
            current_status = FZ_DFMPFRC_SINGLE;
            break;
        case FZDecisionResult::Running:
            current_status = FZ_DFMPFRC_CONTINUOUS;
            break;
        case FZDecisionResult::Failure:
        case FZDecisionResult::Error:
        default:
            current_status = FZ_DFMPFRC_ERROR;
            break;
        }
    }

    void StateMachineAgent::Reset()
    {
        current_status = FZ_DFMPFRC_CONTINUOUS;
        has_last_exec_master_time_ = false;
        last_exec_master_time_ = 0;
        if (state_machine_task_)
        {
            state_machine_task_->Reset();
        }
    }

    void StateMachineAgent::Pause()
    {
        mask = true;
    }

    StateDefPtr StateMachineAgent::GetCurrentState() const
    {
        return state_machine_task_ ? state_machine_task_->GetCurrentState() : StateDefPtr();
    }
}
