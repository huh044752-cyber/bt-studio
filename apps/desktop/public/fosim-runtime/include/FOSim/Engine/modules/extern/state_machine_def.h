#pragma once

#include "modules/extern/bt_node_def.h"
#include "modules/extern/bt_tree_def.h"
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace BT
{
    // 对应一个 ConditionTransform，经 loader 规范化后只保留运行时真正需要的字段。
    struct StateTransitionDef
    {
        int id = 0;
        std::string functionName;
        std::string conditionScript;
        std::string scriptRef;
        std::string behaviorTreeName;
        std::string behaviorTreeTemplateId;
        std::string behaviorTreeInstanceId;
        std::string executeType;
        std::string paramStates;
        ModelSelector target;
        std::vector<InputBinding> inputs;
        std::vector<OutputBinding> outputs;
        int targetStateId = 0;
        bool targetIsGoto = false;
    };

    // StateDef 同时描述状态函数、状态输入、可选挂接子树以及状态内全部迁移规则。
    struct StateDef
    {
        int id = 0;
        std::string functionName;
        std::string functionScript;
        std::string scriptRef;
        std::string behaviorTreeName;
        std::string behaviorTreeTemplateId;
        std::string behaviorTreeInstanceId;
        std::string paramStates;
        ModelSelector target;
        std::vector<InputBinding> inputs;
        std::vector<OutputBinding> outputs;
        std::vector<StateTransitionDef> transitions;
    };

    typedef std::shared_ptr<StateDef> StateDefPtr;

    // 根定义与状态索引集中保存，便于运行时快速执行 goto/transition。
    struct StateMachineDef
    {
        int id = 0;
        std::string name;
        std::string projectType;
        std::string stateMachineTemplateId;
        std::string modelId;
        BlackboardStore blackboards;
        StateDefPtr root;
        std::map<int, StateDefPtr> statesById;
        std::map<std::string, std::string> referencedBehaviorTreesById;
    };

    typedef std::shared_ptr<StateMachineDef> StateMachineDefPtr;

    // 单步运行结果：只描述这一次 Tick 的推进状态，不承担长期状态持久化。
    struct StateMachineStepResult
    {
        FZDecisionResult status = FZDecisionResult::Error;
        bool changedState = false;
    };
}
