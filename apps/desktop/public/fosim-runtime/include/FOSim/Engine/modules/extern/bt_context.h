#pragma once

#include "modules/extern/agent.h"
#include "modules/extern/bt_tree_def.h"

namespace BT
{
    class BehaviorTreeTask;

    struct BTContext
    {
        AgentPtr agent;
        BehaviorTreeTask* treeTask = nullptr;
        BehaviorTreeDefPtr treeDef;
        std::string currentNodeLabel;
    };
}
