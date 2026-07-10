#pragma once

#include "modules/extern/bt_tree_def.h"
#include "pugi/pugixml.hpp"
#include <string>

namespace BT
{
    class BTXmlLoader
    {
    public:
        // 由外部(如 sim 全局)注入的全局黑板 store。BT XML 里 <Input source="global"> 或 <Output source="global">
        // 会 resolve 到这里,而 local/blackboard 走 def.blackboards。
        // 对齐新引擎 F:\FOSim\FOSimEngine 提交 c4095297 的新 API。
        void SetGlobalBlackboards(const BlackboardStore* globalBlackboards);
        BehaviorTreeDefPtr LoadFromContent(const std::string& content, std::string* error = nullptr);
        BehaviorTreeDefPtr LoadFromRoot(const pugi::xml_node& root, std::string* error = nullptr);

    private:
        bool LoadBlackboards(const pugi::xml_node& root, BehaviorTreeDef& def, std::string* error);
        BTNodeDefPtr LoadNode(const pugi::xml_node& xmlNode, BehaviorTreeDef& def, std::string* error, int depth);

        const BlackboardStore* globalBlackboards_ = nullptr;
    };
}
