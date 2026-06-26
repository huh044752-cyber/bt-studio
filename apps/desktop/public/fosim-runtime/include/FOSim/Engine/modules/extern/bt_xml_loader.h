#pragma once

#include "modules/extern/bt_tree_def.h"
#include "pugi/pugixml.hpp"
#include <string>

namespace BT
{
    class BTXmlLoader
    {
    public:
        BehaviorTreeDefPtr LoadFromContent(const std::string& content, std::string* error = nullptr);
        BehaviorTreeDefPtr LoadFromRoot(const pugi::xml_node& root, std::string* error = nullptr);

    private:
        bool LoadBlackboards(const pugi::xml_node& root, BehaviorTreeDef& def, std::string* error);
        BTNodeDefPtr LoadNode(const pugi::xml_node& xmlNode, BehaviorTreeDef& def, std::string* error, int depth);
    };
}
