#pragma once

#include "modules/extern/state_machine_def.h"
#include "pugi/pugixml.hpp"

namespace BT
{
    class StateMachineLoader
    {
    public:
        StateMachineDefPtr LoadFromContent(const std::string& content, std::string* error = nullptr);
        StateMachineDefPtr LoadFromRoot(const pugi::xml_node& root, std::string* error = nullptr);

    private:
        bool LoadBlackboards(const pugi::xml_node& root, StateMachineDef& def, std::string* error);
        StateDefPtr LoadState(const pugi::xml_node& stateNode, StateMachineDef& def, std::string* error, int depth);
        bool LoadInputs(const pugi::xml_node& parent, std::vector<InputBinding>& inputs, std::string* error);
        bool LoadOutputs(const pugi::xml_node& parent, const StateMachineDef& def, std::vector<OutputBinding>& outputs, std::string* error);
        bool Validate(const StateMachineDef& def, std::string* error);
    };
}
