#include "modules/extern/state_machine_task.h"

#include "FZSimIO/FZSimDatabaseIO/IFZSimDatabaseExtentionIO.h"
#include "FZSimIO/FZSimDatabaseIO/IFZSimDatabaseIO.h"
#include "FZSimIO/FZSimDatabaseExtentionIO/IFZSimDecisionEditorManagerIO.h"
#include "FZSimIO/FZSimScenarioIO/IFZSimScenarioIO.h"
#include "core/mal/cyber_marg_base_impl.h"
#include "models/mount_model/cyber_mount_model_impl.h"
#include "modules/extern/bt_status.h"
#include "modules/extern/bt_xml_loader.h"
#include "modules/simulation/cyber_entity_sim_impl.h"
#include "modules/unit/cyber_unit_impl.h"

#include <algorithm>

namespace BT
{
    namespace
    {
        const BlackboardValue* ResolveInputValue(const InputBinding& input, const StateMachineTask& task)
        {
            if (input.source == InputSource::Blackboard)
            {
                return task.FindBlackboardValue(input.blackboardId, input.variableId);
            }
            return nullptr;
        }

        std::string EffectiveInputValue(const InputBinding& input, const StateMachineTask& task)
        {
            if (const BlackboardValue* value = ResolveInputValue(input, task))
            {
                return value->value;
            }
            return input.value;
        }

        std::string EffectiveInputType(const InputBinding& input, const StateMachineTask& task)
        {
            if (!input.type.empty())
            {
                return input.type;
            }
            if (const BlackboardValue* value = ResolveInputValue(input, task))
            {
                return value->type;
            }
            return input.type;
        }

        bool BuildInputMal(const std::vector<InputBinding>& inputs, const StateMachineTask& task, CyberMalImpl& mal)
        {
            for (const auto& input : inputs)
            {
                if (!AddValueToMal(mal, input.name, EffectiveInputType(input, task), EffectiveInputValue(input, task)))
                {
                    return false;
                }
            }
            return true;
        }

        bool HasMalValueNamed(CyberMalImpl& mal, const std::string& name)
        {
            for (auto* marg : mal.GetMargList())
            {
                if (marg && marg->GetName() && name == marg->GetName())
                {
                    return true;
                }
            }
            return false;
        }

        bool HasAnyMalValue(CyberMalImpl& mal)
        {
            return !mal.GetMargList().empty();
        }

        CyberMalImpl* SelectEffectiveOutputMal(const std::vector<OutputBinding>& outputs, CyberMalImpl& inputMal, CyberMalImpl& outputMal)
        {
            for (const auto& output : outputs)
            {
                if (HasMalValueNamed(outputMal, output.name))
                {
                    return &outputMal;
                }
            }
            if (!outputs.empty())
            {
                for (const auto& output : outputs)
                {
                    if (HasMalValueNamed(inputMal, output.name))
                    {
                        return &inputMal;
                    }
                }
            }
            return HasAnyMalValue(outputMal) ? &outputMal : nullptr;
        }

        bool WriteOutputs(const std::vector<OutputBinding>& outputs, CyberMalImpl& sourceMal, StateMachineTask& task, AgentPtr agent)
        {
            for (const auto& output : outputs)
            {
                bool found = false;
                for (auto* marg : sourceMal.GetMargList())
                {
                    if (marg && output.name == marg->GetName())
                    {
                        found = task.SetBlackboardValue(output.blackboardId, output.variableId, MargToString(marg));
                        if (!found && agent)
                        {
                            agent->LogError(("StateMachine output blackboard binding not found: " + output.name).c_str());
                        }
                        break;
                    }
                }
                if (!found && agent)
                {
                    agent->LogError(("StateMachine output MAL field not found: " + output.name).c_str());
                }
            }
            return true;
        }

        bool HasExplicitSelector(const ModelSelector& selector)
        {
            return !selector.componentId.empty() ||
                   !selector.modelName.empty() ||
                   !selector.modelClass.empty() ||
                   !selector.modelType.empty() ||
                   !selector.componentName.empty() ||
                   !selector.componentClass.empty() ||
                   !selector.componentType.empty();
        }

        std::string ComponentLabel(const ModelSelector& selector)
        {
            if (!selector.componentId.empty())
            {
                return selector.componentId;
            }
            if (!selector.componentName.empty())
            {
                return selector.componentName;
            }
            if (!selector.modelName.empty())
            {
                return selector.modelName;
            }
            if (!selector.componentClass.empty())
            {
                return selector.componentClass;
            }
            if (!selector.modelClass.empty())
            {
                return selector.modelClass;
            }
            return {};
        }

        // 旧版决策函数只挂在 Cognition 上，mounted models 里可能混有 Equipment，先下行转换再查找。
        FZDecisionProprity* FindDecisionFunction(CyberMountModelImpl* model, const char* functionName, std::string& launchName)
        {
            auto* cognition = dynamic_cast<CyberCognitionImpl*>(model);
            return cognition ? cognition->GetDecisionFunctionByName(functionName, launchName) : nullptr;
        }

        bool BindUniqueDecision(AgentPtr agent,
                                const std::vector<CyberMountModelImpl*>& models,
                                const std::string& functionName,
                                const bool reportAmbiguous,
                                DecisionRuntime& runtime)
        {
            CyberMountModelImpl* matched_model = nullptr;
            FZDecisionProprity* matched_proprity = nullptr;
            std::string matched_launch_name;
            int match_count = 0;
            std::string launch_name;
            for (auto* model : models)
            {
                if (!model)
                {
                    continue;
                }
                if (auto* proprity = FindDecisionFunction(model, functionName.c_str(), launch_name))
                {
                    matched_model = model;
                    matched_proprity = proprity;
                    matched_launch_name = launch_name;
                    ++match_count;
                }
            }

            if (match_count == 1)
            {
                runtime.model = matched_model;
                runtime.proprity = matched_proprity;
                runtime.launchName = matched_launch_name;
                return true;
            }
            // 多命中直接视为错误，避免状态机因为组件歧义变成非确定性执行。
            if (match_count > 1 && reportAmbiguous && agent)
            {
                agent->LogError(("StateMachine function binding is ambiguous: " + functionName).c_str());
            }
            return false;
        }

        bool ResolveDecision(AgentPtr agent,
                             const std::string& functionName,
                             const ModelSelector& target,
                             DecisionRuntime& runtime)
        {
            runtime = {};
            if (!agent)
            {
                return false;
            }
            if (HasExplicitSelector(target))
            {
                return BindUniqueDecision(agent, agent->GetMountedModels(target), functionName, true, runtime);
            }
            if (auto* root_model = agent->GetModel())
            {
                if (BindUniqueDecision(agent, {root_model}, functionName, false, runtime))
                {
                    return true;
                }
            }
            return BindUniqueDecision(agent, agent->GetMountedModels(), functionName, true, runtime);
        }

    }

    StateMachineTask::StateMachineTask(StateMachineDefPtr def)
        : def_(std::move(def))
        , currentState_(def_ ? def_->root : StateDefPtr())
    {
        if (def_)
        {
            for (const auto& boardId : def_->blackboards.GetBoardIds())
            {
                const BlackboardDef* board = def_->blackboards.FindBlackboard(boardId);
                if (board != nullptr && board->scope == BlackboardScope::Local)
                {
                    localBlackboards_.AddBlackboard(*board);
                }
            }
        }
    }

    void StateMachineTask::Reset()
    {
        currentState_ = def_ ? def_->root : StateDefPtr();
        enteredCurrentState_ = false;
        for (auto& item : treeTasksByStateId_)
        {
            if (item.second)
            {
                item.second->Reset();
            }
        }
        for (auto& item : treeTasksByTransitionId_)
        {
            if (item.second)
            {
                item.second->Reset();
            }
        }
    }

    StateMachineStepResult StateMachineTask::Tick(AgentPtr agent)
    {
        StateMachineStepResult result;
        if (!def_ || !currentState_)
        {
            result.status = FZDecisionResult::Error;
            return result;
        }
        EnsureBlackboardsInitialized(agent);
        if (!EnsureEnteredState(agent))
        {
            result.status = FZDecisionResult::Error;
            return result;
        }

        result.status = ExecuteDecision(agent,
                                        currentState_->functionName,
                                        currentState_->target,
                                        currentState_->inputs,
                                        currentState_->outputs,
                                        "StateMachine state execute failed");
        if (agent)
        {
            agent->NotifyBehavior(MakeStateLabel(*currentState_), ComponentLabel(currentState_->target), FZ_BEHAVIOR_EVENT_STATE_EXECUTE);
        }
        if (result.status == FZDecisionResult::Error)
        {
            return result;
        }

        if (!currentState_->behaviorTreeName.empty())
        {
            // 先执行挂接子树，再评估迁移条件，这样 transition 可以消费子树刚刚更新的共享状态。
            if (!LoadBehaviorTreeForState(*currentState_, agent))
            {
                result.status = FZDecisionResult::Error;
                return result;
            }

            auto tree_iter = treeTasksByStateId_.find(currentState_->id);
            if (tree_iter != treeTasksByStateId_.end() && tree_iter->second)
            {
                const BTStatus tree_status = tree_iter->second->Tick(agent);
                if (tree_status == BTStatus::Failure)
                {
                    result.status = FZDecisionResult::Error;
                    return result;
                }
            }
        }

        for (const auto& transition : currentState_->transitions)
        {
            FZDecisionResult transition_result = ExecuteDecision(agent,
                                                                transition.functionName,
                                                                transition.target,
                                                                transition.inputs,
                                                                transition.outputs,
                                                                "StateMachine transition execute failed");
            if (transition_result == FZDecisionResult::Success)
            {
                if (!transition.behaviorTreeName.empty())
                {
                    if (!LoadBehaviorTreeForTransition(transition, agent))
                    {
                        result.status = FZDecisionResult::Error;
                        return result;
                    }
                    auto transition_tree_iter = treeTasksByTransitionId_.find(transition.id);
                    if (transition_tree_iter != treeTasksByTransitionId_.end() && transition_tree_iter->second)
                    {
                        transition_tree_iter->second->Reset();
                        const BTStatus tree_status = transition_tree_iter->second->Tick(agent);
                        if (tree_status == BTStatus::Failure)
                        {
                            result.status = FZDecisionResult::Error;
                            return result;
                        }
                    }
                }
                if (agent)
                {
                    agent->NotifyBehavior(MakeTransitionLabel(transition),
                                           ComponentLabel(transition.target),
                                           transition.targetIsGoto ? FZ_BEHAVIOR_EVENT_GOTO : FZ_BEHAVIOR_EVENT_TRANSITION_HIT);
                }
                auto next_state_iter = def_->statesById.find(transition.targetStateId);
                if (next_state_iter == def_->statesById.end())
                {
                    result.status = FZDecisionResult::Error;
                    if (agent)
                    {
                        agent->LogError(("StateMachine target state not found: " + std::to_string(transition.targetStateId)).c_str());
                    }
                    return result;
                }

                if (!currentState_->behaviorTreeName.empty())
                {
                    auto tree_iter = treeTasksByStateId_.find(currentState_->id);
                    if (tree_iter != treeTasksByStateId_.end() && tree_iter->second)
                    {
                        tree_iter->second->Reset();
                    }
                }

                currentState_ = next_state_iter->second;
                enteredCurrentState_ = false;
                result.changedState = true;
                // 跳转后外层仍需继续 Tick，因此统一返回 Running。
                result.status = FZDecisionResult::Running;
                return result;
            }
            if (transition_result == FZDecisionResult::Error)
            {
                result.status = transition_result;
                return result;
            }
        }

        if (result.status == FZDecisionResult::Success)
        {
            result.status = FZDecisionResult::Running;
        }
        return result;
    }

    StateMachineDefPtr StateMachineTask::GetDef() const
    {
        return def_;
    }

    StateDefPtr StateMachineTask::GetCurrentState() const
    {
        return currentState_;
    }

    void StateMachineTask::EnsureBlackboardsInitialized(AgentPtr agent)
    {
        if (blackboardsInitialized_)
        {
            return;
        }
        blackboardsInitialized_ = true;
        auto* sim_global = agent ? agent->GetSimGlobal() : nullptr;
        globalBlackboards_ = sim_global ? &sim_global->behavior_global_blackboards_ : nullptr;
        if (!def_ || !globalBlackboards_)
        {
            return;
        }
        for (const auto& boardId : def_->blackboards.GetBoardIds())
        {
            const BlackboardDef* board = def_->blackboards.FindBlackboard(boardId);
            if (board != nullptr && board->scope == BlackboardScope::Global && !globalBlackboards_->HasBlackboard(board->id))
            {
                globalBlackboards_->AddBlackboard(*board);
            }
        }
    }

    const BlackboardValue* StateMachineTask::FindBlackboardValue(const std::string& boardId, const std::string& variableId) const
    {
        if (const BlackboardValue* value = localBlackboards_.Find(boardId, variableId))
        {
            return value;
        }
        return globalBlackboards_ ? globalBlackboards_->Find(boardId, variableId) : nullptr;
    }

    bool StateMachineTask::SetBlackboardValue(const std::string& boardId, const std::string& variableId, const std::string& value)
    {
        if (localBlackboards_.SetRawValue(boardId, variableId, value))
        {
            return true;
        }
        return globalBlackboards_ ? globalBlackboards_->SetRawValue(boardId, variableId, value) : false;
    }

    bool StateMachineTask::EnsureEnteredState(AgentPtr agent)
    {
        if (!currentState_)
        {
            return false;
        }
        if (enteredCurrentState_)
        {
            return true;
        }
        enteredCurrentState_ = true;
        if (agent)
        {
            agent->NotifyBehavior(MakeStateLabel(*currentState_), ComponentLabel(currentState_->target), FZ_BEHAVIOR_EVENT_STATE_ENTER);
        }
        return true;
    }

    bool StateMachineTask::LoadBehaviorTreeForState(const StateDef& state, AgentPtr agent)
    {
        auto existing_iter = treeTasksByStateId_.find(state.id);
        if (existing_iter != treeTasksByStateId_.end() && existing_iter->second)
        {
            return true;
        }

        if (!agent)
        {
            return false;
        }
        auto sim_global = agent->GetSimGlobal();
        if ((!sim_global || !sim_global->database_io_) && !(state.behaviorTreeName.find("<Root") == 0))
        {
            return false;
        }

        std::string content;
        if (!sim_global || !sim_global->database_io_)
        {
            content = state.behaviorTreeName;
        }
        else
        {
            auto decision_manager_io =
                dynamic_pointer_cast<IFZSimDecisionEditorManagerIO, IFZSimDatabaseExtentionIO>(
                    sim_global->database_io_->GetDatabaseExtentionIOByType("DecisionEditorManager"));
            if (!decision_manager_io)
            {
                if (!state.behaviorTreeName.empty() && state.behaviorTreeName.find("<Root") == 0)
                {
                    content = state.behaviorTreeName;
                }
                else
                {
                    agent->LogError("StateMachine cannot load behavior tree: DecisionEditorManager not found.");
                    return false;
                }
            }
            else
            {
                content = decision_manager_io->GetBeheviacTreeContent(state.behaviorTreeName);
            }
        }

        if (content.empty())
        {
            agent->LogError(("StateMachine behavior tree content is empty: " + state.behaviorTreeName).c_str());
            return false;
        }

        BTXmlLoader loader;
        std::string error;
        BehaviorTreeDefPtr tree_def = loader.LoadFromContent(content, &error);
        if (!tree_def)
        {
            agent->LogError(("StateMachine failed to parse behavior tree: " + state.behaviorTreeName + ", error=" + error).c_str());
            return false;
        }

        std::unique_ptr<BehaviorTreeTask> tree_task(new BehaviorTreeTask(tree_def, sim_global ? &sim_global->behavior_global_blackboards_ : nullptr));
        if (!tree_task->Initialize())
        {
            agent->LogError(("StateMachine failed to initialize behavior tree: " + state.behaviorTreeName).c_str());
            return false;
        }

        treeDefsByStateId_[state.id] = tree_def;
        treeTasksByStateId_[state.id] = std::move(tree_task);
        return true;
    }

    bool StateMachineTask::LoadBehaviorTreeForTransition(const StateTransitionDef& transition, AgentPtr agent)
    {
        auto existing_iter = treeTasksByTransitionId_.find(transition.id);
        if (existing_iter != treeTasksByTransitionId_.end() && existing_iter->second)
        {
            return true;
        }
        if (!agent)
        {
            return false;
        }
        auto sim_global = agent->GetSimGlobal();
        if ((!sim_global || !sim_global->database_io_) && !(transition.behaviorTreeName.find("<Root") == 0))
        {
            return false;
        }

        std::string content;
        if (!sim_global || !sim_global->database_io_)
        {
            content = transition.behaviorTreeName;
        }
        else
        {
            auto decision_manager_io =
                dynamic_pointer_cast<IFZSimDecisionEditorManagerIO, IFZSimDatabaseExtentionIO>(
                    sim_global->database_io_->GetDatabaseExtentionIOByType("DecisionEditorManager"));
            if (!decision_manager_io)
            {
                if (!transition.behaviorTreeName.empty() && transition.behaviorTreeName.find("<Root") == 0)
                {
                    content = transition.behaviorTreeName;
                }
                else
                {
                    agent->LogError("StateMachine cannot load transition behavior tree: DecisionEditorManager not found.");
                    return false;
                }
            }
            else
            {
                content = decision_manager_io->GetBeheviacTreeContent(transition.behaviorTreeName);
            }
        }

        if (content.empty())
        {
            agent->LogError(("StateMachine transition behavior tree content is empty: " + transition.behaviorTreeName).c_str());
            return false;
        }

        BTXmlLoader loader;
        std::string error;
        BehaviorTreeDefPtr tree_def = loader.LoadFromContent(content, &error);
        if (!tree_def)
        {
            agent->LogError(("StateMachine failed to parse transition behavior tree: " + transition.behaviorTreeName + ", error=" + error).c_str());
            return false;
        }

        std::unique_ptr<BehaviorTreeTask> tree_task(new BehaviorTreeTask(tree_def, sim_global ? &sim_global->behavior_global_blackboards_ : nullptr));
        if (!tree_task->Initialize())
        {
            agent->LogError(("StateMachine failed to initialize transition behavior tree: " + transition.behaviorTreeName).c_str());
            return false;
        }

        treeDefsByTransitionId_[transition.id] = tree_def;
        treeTasksByTransitionId_[transition.id] = std::move(tree_task);
        return true;
    }

    FZDecisionResult StateMachineTask::ExecuteDecision(AgentPtr agent,
                                                       const std::string& functionName,
                                                       const ModelSelector& target,
                                                       const std::vector<InputBinding>& inputs,
                                                       const std::vector<OutputBinding>& outputs,
                                                       const std::string& errorPrefix)
    {
        if (functionName.empty())
        {
            return FZDecisionResult::Error;
        }

        DecisionRuntime runtime;
        if (!ResolveDecision(agent, functionName, target, runtime))
        {
            if (agent)
            {
                agent->LogError((errorPrefix + ": cannot bind function=" + functionName).c_str());
            }
            return FZDecisionResult::Error;
        }
        if (!runtime.model || !runtime.proprity || !runtime.proprity->func_ptr)
        {
            return FZDecisionResult::Error;
        }

        CyberMalImpl input_mal;
        if (!BuildInputMal(inputs, *this, input_mal))
        {
            if (agent)
            {
                agent->LogError((errorPrefix + ": failed to build input MAL, function=" + functionName).c_str());
            }
            return FZDecisionResult::Error;
        }

        CyberMalImpl output_mal;
        const auto result = ToDecisionResult((runtime.model->*CastTo(runtime.proprity->func_ptr))(&input_mal, &output_mal));
        CyberMalImpl* effective_output_mal = SelectEffectiveOutputMal(outputs, input_mal, output_mal);
        if (effective_output_mal != nullptr)
        {
            WriteOutputs(outputs, *effective_output_mal, *this, agent);
        }
        if (agent)
        {
            auto shared_mal = agent->GetSharedMalPtr();
            if (shared_mal)
            {
                if (effective_output_mal != nullptr)
                {
                    *shared_mal = *effective_output_mal;
                }
                else
                {
                    *shared_mal = output_mal;
                }
            }
        }
        return result;
    }

    std::string StateMachineTask::MakeStateLabel(const StateDef& state) const
    {
        return state.functionName + "[" + std::to_string(state.id) + "]";
    }

    std::string StateMachineTask::MakeTransitionLabel(const StateTransitionDef& transition) const
    {
        return transition.functionName + "[" + std::to_string(transition.id) + "]->" + std::to_string(transition.targetStateId);
    }
}
