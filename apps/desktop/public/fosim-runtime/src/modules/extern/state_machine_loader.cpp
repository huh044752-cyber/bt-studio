#include "modules/extern/state_machine_loader.h"

#include <sstream>

namespace BT
{
    namespace
    {
        bool AttributeBool(const pugi::xml_node& node, const char* name, bool defaultValue)
        {
            if (!node.attribute(name))
            {
                return defaultValue;
            }
            const std::string value = node.attribute(name).as_string();
            return value == "true" || value == "True" || value == "1";
        }

        void SetError(std::string* error, const std::string& value)
        {
            if (error)
            {
                *error = value;
            }
        }

        bool IsMetadataNode(const std::string& name)
        {
            // 这些节点是状态机 Root/State 的元数据容器，不参与状态节点计数。
            // ReferencedBehaviorTrees 只保存实例引用树，不能被当作 State 解析。
            return name == "Inputs" || name == "Outputs" || name == "Blackboards" || name == "Blackboard" || name == "ReferencedBehaviorTrees";
        }

        std::string SerializeXmlNode(const pugi::xml_node& node)
        {
            if (!node)
            {
                return {};
            }
            std::ostringstream output;
            node.print(output, "  ", pugi::format_default, pugi::encoding_utf8);
            return output.str();
        }
    }

    StateMachineDefPtr StateMachineLoader::LoadFromContent(const std::string& content, std::string* error)
    {
        pugi::xml_document doc;
        auto result = doc.load_string(content.c_str());
        if (!result)
        {
            SetError(error, std::string("Failed to parse state machine XML: ") + result.description());
            return StateMachineDefPtr();
        }
        return LoadFromRoot(doc.child("Root"), error);
    }

    StateMachineDefPtr StateMachineLoader::LoadFromRoot(const pugi::xml_node& root, std::string* error)
    {
        if (root.empty() || std::string(root.name()) != "Root")
        {
            SetError(error, "Missing Root node.");
            return StateMachineDefPtr();
        }

        const std::string project_type = root.attribute("projectType").as_string();
        if (!project_type.empty() && project_type != "状态机")
        {
            SetError(error, "Unsupported Root projectType. Only state machine XML is supported.");
            return StateMachineDefPtr();
        }

        StateMachineDefPtr def(new StateMachineDef());
        def->id = root.attribute("id").as_int(0);
        def->name = root.attribute("name").as_string();
        def->projectType = project_type.empty() ? "状态机" : project_type;
        def->stateMachineTemplateId = root.attribute("smTemplateId").as_string(root.attribute("templateId").as_string());
        def->modelId = root.attribute("modelId").as_string();
        if (!LoadBlackboards(root, *def, error))
        {
            return StateMachineDefPtr();
        }
        for (const auto& ref_node : root.child("ReferencedBehaviorTrees").children("ReferencedBehaviorTree"))
        {
            const std::string id = ref_node.attribute("id").as_string();
            const auto ref_root = ref_node.child("Root");
            if (id.empty() || ref_root.empty())
            {
                SetError(error, "ReferencedBehaviorTree requires id and Root.");
                return StateMachineDefPtr();
            }
            def->referencedBehaviorTreesById[id] = SerializeXmlNode(ref_root);
        }

        for (const auto& child : root.children())
        {
            if (child.type() != pugi::node_element)
            {
                continue;
            }

            const std::string child_name = child.name();
            if (IsMetadataNode(child_name))
            {
                continue;
            }
            if (child_name != "State")
            {
                SetError(error, "Root must contain exactly one State node.");
                return StateMachineDefPtr();
            }
            if (def->root)
            {
                SetError(error, "Root must contain exactly one State node.");
                return StateMachineDefPtr();
            }
            def->root = LoadState(child, *def, error, 0);
            if (!def->root)
            {
                return StateMachineDefPtr();
            }
        }

        if (!def->root)
        {
            SetError(error, "State machine root state is missing.");
            return StateMachineDefPtr();
        }
        if (!Validate(*def, error))
        {
            return StateMachineDefPtr();
        }
        return def;
    }

    bool StateMachineLoader::LoadBlackboards(const pugi::xml_node& root, StateMachineDef& def, std::string* error)
    {
        const auto blackboards = root.child("Blackboards");
        if (blackboards.empty())
        {
            return true;
        }

        for (const auto& board_node : blackboards.children("Blackboard"))
        {
            BlackboardDef board;
            board.id = board_node.attribute("id").as_string();
            board.name = board_node.attribute("name").as_string();
            const std::string scope = board_node.attribute("scope").as_string();
            board.scope = scope == "global" ? BlackboardScope::Global : BlackboardScope::Local;
            board.linked = AttributeBool(board_node, "linked", false);
            if (board.id.empty())
            {
                SetError(error, "Blackboard id is required.");
                return false;
            }

            for (const auto& variable_node : board_node.children("Variable"))
            {
                BlackboardValue value;
                value.id = variable_node.attribute("id").as_string();
                value.key = variable_node.attribute("key").as_string();
                value.type = variable_node.attribute("type").as_string();
                value.value = variable_node.attribute("value").as_string();
                if (value.id.empty() || value.key.empty())
                {
                    SetError(error, "Blackboard Variable id and key are required.");
                    return false;
                }
                board.variables[value.id] = value;
            }
            def.blackboards.AddBlackboard(board);
        }
        return true;
    }

    StateDefPtr StateMachineLoader::LoadState(const pugi::xml_node& stateNode, StateMachineDef& def, std::string* error, int depth)
    {
        if (depth > 512)
        {
            SetError(error, "State machine depth exceeds 512.");
            return StateDefPtr();
        }
        if (std::string(stateNode.name()) != "State")
        {
            SetError(error, "Expected State node.");
            return StateDefPtr();
        }

        StateDefPtr state(new StateDef());
        state->id = stateNode.attribute("id").as_int(0);
        state->functionName = stateNode.attribute("action").as_string();
        if (state->functionName.empty())
        {
            state->functionName = stateNode.attribute("function").as_string();
        }
        state->behaviorTreeName = stateNode.attribute("behaviac_tree").as_string();
        state->behaviorTreeTemplateId = stateNode.attribute("btTemplateId").as_string();
        state->behaviorTreeInstanceId = stateNode.attribute("btInstanceId").as_string();
        state->paramStates = stateNode.attribute("paramStates").as_string();
        if (state->behaviorTreeName.empty() && !state->behaviorTreeInstanceId.empty() && state->behaviorTreeInstanceId != "0")
        {
            const auto ref_iter = def.referencedBehaviorTreesById.find(state->behaviorTreeInstanceId);
            if (ref_iter != def.referencedBehaviorTreesById.end())
            {
                state->behaviorTreeName = ref_iter->second;
            }
        }
        state->target.cognition = stateNode.attribute("cognition").as_string();
        state->target.modelName = stateNode.attribute("modelName").as_string();
        if (state->target.modelName.empty())
        {
            state->target.modelName = stateNode.attribute("mdataName").as_string();
        }
        state->target.modelClass = stateNode.attribute("modelClass").as_string();
        if (state->target.modelClass.empty())
        {
            state->target.modelClass = stateNode.attribute("className").as_string();
        }
        state->target.modelType = stateNode.attribute("modelType").as_string();
        state->target.componentId = stateNode.attribute("componentId").as_string();
        state->target.componentName = stateNode.attribute("componentName").as_string();
        state->target.componentClass = stateNode.attribute("componentClass").as_string();
        state->target.componentType = stateNode.attribute("componentType").as_string();
        if (state->target.componentName.empty())
        {
            state->target.componentName = state->target.modelName;
        }
        if (state->target.componentClass.empty())
        {
            state->target.componentClass = state->target.modelClass;
        }
        if (state->target.componentType.empty())
        {
            state->target.componentType = state->target.modelType;
        }

        if (state->id == 0)
        {
            SetError(error, "State id is required.");
            return StateDefPtr();
        }
        if (state->functionName.empty() && state->behaviorTreeName.empty())
        {
            SetError(error, "State function is required. State id: " + std::to_string(state->id));
            return StateDefPtr();
        }
        if (def.statesById.find(state->id) != def.statesById.end())
        {
            SetError(error, "Duplicate state id: " + std::to_string(state->id));
            return StateDefPtr();
        }
        if (!LoadInputs(stateNode, state->inputs, error))
        {
            return StateDefPtr();
        }
        if (!LoadOutputs(stateNode, def, state->outputs, error))
        {
            return StateDefPtr();
        }

        def.statesById[state->id] = state;

        for (const auto& child : stateNode.children())
        {
            if (child.type() != pugi::node_element)
            {
                continue;
            }

            const std::string child_name = child.name();
            if (IsMetadataNode(child_name))
            {
                continue;
            }
            if (child_name != "ConditionTransform" && child_name != "StateTransform")
            {
                SetError(error, "Unsupported state machine child node: " + child_name);
                return StateDefPtr();
            }

            StateTransitionDef transition;
            transition.id = child.attribute("id").as_int(0);
            transition.functionName = child.attribute("action").as_string();
            if (transition.functionName.empty())
            {
                transition.functionName = child.attribute("function").as_string();
            }
            transition.executeType = child.attribute("executeType").as_string();
            transition.behaviorTreeTemplateId = child.attribute("btTemplateId").as_string();
            transition.behaviorTreeInstanceId = child.attribute("btInstanceId").as_string();
            transition.paramStates = child.attribute("paramStates").as_string();
            transition.behaviorTreeName = child.attribute("behaviac_tree").as_string();
            if ((transition.executeType == "BehaviorTree" || transition.behaviorTreeName.empty()) &&
                !transition.behaviorTreeInstanceId.empty() && transition.behaviorTreeInstanceId != "0")
            {
                const auto ref_iter = def.referencedBehaviorTreesById.find(transition.behaviorTreeInstanceId);
                if (ref_iter != def.referencedBehaviorTreesById.end())
                {
                    transition.behaviorTreeName = ref_iter->second;
                }
            }
            transition.target.cognition = child.attribute("cognition").as_string();
            transition.target.modelName = child.attribute("modelName").as_string();
            if (transition.target.modelName.empty())
            {
                transition.target.modelName = child.attribute("mdataName").as_string();
            }
            transition.target.modelClass = child.attribute("modelClass").as_string();
            if (transition.target.modelClass.empty())
            {
                transition.target.modelClass = child.attribute("className").as_string();
            }
            transition.target.modelType = child.attribute("modelType").as_string();
            transition.target.componentId = child.attribute("componentId").as_string();
            transition.target.componentName = child.attribute("componentName").as_string();
            transition.target.componentClass = child.attribute("componentClass").as_string();
            transition.target.componentType = child.attribute("componentType").as_string();
            if (transition.target.componentName.empty())
            {
                transition.target.componentName = transition.target.modelName;
            }
            if (transition.target.componentClass.empty())
            {
                transition.target.componentClass = transition.target.modelClass;
            }
            if (transition.target.componentType.empty())
            {
                transition.target.componentType = transition.target.modelType;
            }
            if (transition.id == 0)
            {
                SetError(error, "ConditionTransform id is required. State id: " + std::to_string(state->id));
                return StateDefPtr();
            }
            if (transition.functionName.empty() &&
                transition.behaviorTreeName.empty())
            {
                SetError(error, "ConditionTransform function is required. Transform id: " + std::to_string(transition.id));
                return StateDefPtr();
            }
            if (!LoadInputs(child, transition.inputs, error))
            {
                return StateDefPtr();
            }
            if (!LoadOutputs(child, def, transition.outputs, error))
            {
                return StateDefPtr();
            }

            pugi::xml_node target_node;
            for (const auto& transition_child : child.children())
            {
                if (transition_child.type() != pugi::node_element)
                {
                    continue;
                }
                const std::string transition_child_name = transition_child.name();
                if (IsMetadataNode(transition_child_name))
                {
                    continue;
                }
                if (target_node)
                {
                    SetError(error, "ConditionTransform must contain exactly one State or Goto child.");
                    return StateDefPtr();
                }
                target_node = transition_child;
            }
            if (!target_node)
            {
                SetError(error, "ConditionTransform target is missing.");
                return StateDefPtr();
            }

            const std::string target_name = target_node.name();
            if (target_name == "State")
            {
                StateDefPtr target_state = LoadState(target_node, def, error, depth + 1);
                if (!target_state)
                {
                    return StateDefPtr();
                }
                transition.targetStateId = target_state->id;
            }
            else if (target_name == "Goto")
            {
                transition.targetStateId = target_node.attribute("id").as_int(0);
                transition.targetIsGoto = true;
                if (transition.targetStateId == 0)
                {
                    SetError(error, "Goto target id is required.");
                    return StateDefPtr();
                }
            }
            else
            {
                SetError(error, "ConditionTransform target must be State or Goto.");
                return StateDefPtr();
            }

            state->transitions.push_back(transition);
        }

        return state;
    }

    bool StateMachineLoader::LoadInputs(const pugi::xml_node& parent, std::vector<InputBinding>& inputs, std::string* error)
    {
        const auto inputs_node = parent.child("Inputs");
        for (const auto& input_node : inputs_node.children("Input"))
        {
            InputBinding input;
            input.name = input_node.attribute("name").as_string();
            input.type = input_node.attribute("type").as_string();
            input.value = input_node.attribute("value").as_string();
            const std::string source = input_node.attribute("source").as_string();
            // 三态 source(对齐新引擎 c4095297):blackboard=legacy / local / global。
            // 状态机层暂不接入 globalBlackboards 注入(与新引擎同当前状态),
            // 故 global 也在 def.blackboards 里 resolve;后续如需接 sim 全局黑板,再补 SetGlobalBlackboards。
            if (source == "blackboard" || source == "local" || source == "global")
            {
                input.source = InputSource::Blackboard;
                input.blackboardId = input_node.attribute("blackboardKey").as_string();
                input.variableId = input_node.attribute("variableKey").as_string();
                if (input.blackboardId.empty() || input.variableId.empty())
                {
                    SetError(error, "StateMachine blackboard input binding requires blackboardKey and variableKey.");
                    return false;
                }
            }
            if (input.name.empty())
            {
                SetError(error, "Input name is required.");
                return false;
            }
            inputs.push_back(input);
        }
        return true;
    }

    bool StateMachineLoader::LoadOutputs(const pugi::xml_node& parent,
                                         const StateMachineDef& def,
                                         std::vector<OutputBinding>& outputs,
                                         std::string* error)
    {
        const auto outputs_node = parent.child("Outputs");
        for (const auto& output_node : outputs_node.children("Output"))
        {
            OutputBinding output;
            output.name = output_node.attribute("name").as_string();
            output.blackboardId = output_node.attribute("blackboardKey").as_string();
            output.variableId = output_node.attribute("variableKey").as_string();
            // Output 也接受 source=local/global(与 Input 三态对齐)。
            (void)output_node.attribute("source"); // 不额外做 store 路由,与 Input 保持同一策略。
            if (output.name.empty() || output.blackboardId.empty() || output.variableId.empty())
            {
                SetError(error, "StateMachine Output requires name/blackboardKey/variableKey.");
                return false;
            }
            if (!def.blackboards.Find(output.blackboardId, output.variableId))
            {
                SetError(error, "StateMachine output blackboard binding is invalid.");
                return false;
            }
            outputs.push_back(output);
        }
        return true;
    }

    bool StateMachineLoader::Validate(const StateMachineDef& def, std::string* error)
    {
        for (const auto& item : def.statesById)
        {
            for (const auto& transition : item.second->transitions)
            {
                if (def.statesById.find(transition.targetStateId) == def.statesById.end())
                {
                    SetError(error,
                             "Transition target state does not exist. Transform id: " + std::to_string(transition.id) +
                             ", target state id: " + std::to_string(transition.targetStateId));
                    return false;
                }
            }
        }
        return true;
    }
}
