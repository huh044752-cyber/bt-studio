#pragma once

#include "modules/extern/bt_node_def.h"
#include <map>
#include <memory>
#include <string>

namespace BT
{
    struct BehaviorTreeDef
    {
        int id = 0;
        std::string name;
        std::string projectType;
        std::string behaviorTreeTemplateId;
        std::string modelId;
        std::string cognition;
        BlackboardStore blackboards;
        BTNodeDefPtr root;
        std::map<int, BTNodeDefPtr> nodesById;
        std::map<std::string, std::string> referencedBehaviorTreesById;
    };

    typedef std::shared_ptr<BehaviorTreeDef> BehaviorTreeDefPtr;
}
