#pragma once

#include "modules/extern/bt_tree_task.h"
#include "modules/extern/state_machine_def.h"
#include <map>
#include <memory>

namespace BT
{
        // StateMachineTask 封装状态机运行态：当前状态和挂接子树运行对象。
    class StateMachineTask
    {
    public:
        explicit StateMachineTask(StateMachineDefPtr def);

        void Reset();
        StateMachineStepResult Tick(AgentPtr agent);
        StateMachineDefPtr GetDef() const;
        StateDefPtr GetCurrentState() const;
        void EnsureBlackboardsInitialized(AgentPtr agent);
        const BlackboardValue* FindBlackboardValue(const std::string& boardId, const std::string& variableId) const;
        bool SetBlackboardValue(const std::string& boardId, const std::string& variableId, const std::string& value);

    private:
        // Enter/子树加载/决策执行分别拆开，避免 Tick 主流程里堆积太多绑定细节。
        bool EnsureEnteredState(AgentPtr agent);
        bool LoadBehaviorTreeForState(const StateDef& state, AgentPtr agent);
        bool LoadBehaviorTreeForTransition(const StateTransitionDef& transition, AgentPtr agent);
        // ExecuteDecision 同时服务状态函数和 transition 条件执行。
        FZDecisionResult ExecuteDecision(AgentPtr agent,
                                         const std::string& functionName,
                                         const ModelSelector& target,
                                         const std::vector<InputBinding>& inputs,
                                         const std::vector<OutputBinding>& outputs,
                                         const std::string& errorPrefix);
        std::string MakeStateLabel(const StateDef& state) const;
        std::string MakeTransitionLabel(const StateTransitionDef& transition) const;

    private:
        StateMachineDefPtr def_;
        StateDefPtr currentState_;
        bool enteredCurrentState_ = false;
        std::map<int, BehaviorTreeDefPtr> treeDefsByStateId_;
        std::map<int, std::unique_ptr<BehaviorTreeTask>> treeTasksByStateId_;
        std::map<int, BehaviorTreeDefPtr> treeDefsByTransitionId_;
        std::map<int, std::unique_ptr<BehaviorTreeTask>> treeTasksByTransitionId_;
        BlackboardStore localBlackboards_;
        BlackboardStore* globalBlackboards_ = nullptr;
        bool blackboardsInitialized_ = false;
    };
}
