#include "modules/extern/bt_xml_loader.h"

#include "modules/extern/bt_compare_rules.h"
#include <sstream>
#include <set>

namespace BT
{
    /*
     * Behavior tree XML loader contract
     * 行为树 XML 装载契约：
     *
     * 1. Loader 只做“结构解析 + 静态校验 + DTO 填充”，不执行任何模型函数。
     *    Runtime binding happens later in bt_runtime.cpp, because only runtime has Unit/component context.
     *
     * 2. 新版行为树 XML 以 <Root projectType="行为树"> 为唯一入口。
     *    Root 下允许出现元数据节点（Blackboards / ReferencedBehaviorTrees / Inputs / Outputs），
     *    这些节点描述黑板、子树引用或参数映射，不是可执行节点，必须跳过。
     *
     * 3. Loader 对语义采用“失败即报错”的策略：未知节点、重复 id、非法 comparetype/op、
     *    缺少必需子节点都会让整棵树加载失败。这样错误能在想定加载阶段暴露，
     *    而不是在仿真推进到某一帧时才隐式失败。
     *
     * 4. XML 比较符固定使用 eq/ne/gt/ge/lt/le；不再接受 ==、>=、<= 这类符号写法。
     *    这样资源文件和日志保持平台无关、也避免 XML 特殊字符转义带来的误读。
     */
    namespace
    {
        BTNodeKind NodeKindFromName(const std::string& name)
        {
            if (name == "Action")
            {
                return BTNodeKind::Action;
            }
            if (name == "Condition")
            {
                return BTNodeKind::Condition;
            }
            if (name == "Sequence")
            {
                return BTNodeKind::Sequence;
            }
            if (name == "Selector" || name == "SelectNode")
            {
                return BTNodeKind::Selector;
            }
            if (name == "And")
            {
                return BTNodeKind::And;
            }
            if (name == "Or")
            {
                return BTNodeKind::Or;
            }
            if (name == "Parallel" || name == "Paralle")
            {
                return BTNodeKind::Parallel;
            }
            if (name == "IfElse")
            {
                return BTNodeKind::IfElse;
            }
            if (name == "MonitorBranch")
            {
                return BTNodeKind::MonitorBranch;
            }
            if (name == "SelectMonitor")
            {
                return BTNodeKind::SelectMonitor;
            }
            if (name == "DecoratorLoop" || name == "Loop")
            {
                return BTNodeKind::Loop;
            }
            if (name == "End")
            {
                return BTNodeKind::End;
            }
            if (name == "AlwaysSuccess")
            {
                return BTNodeKind::AlwaysSuccess;
            }
            if (name == "AlwaysFailure")
            {
                return BTNodeKind::AlwaysFailure;
            }
            if (name == "DecoratorSuccessUntil")
            {
                return BTNodeKind::SuccessUntil;
            }
            if (name == "DecoratorFailureUntil")
            {
                return BTNodeKind::FailureUntil;
            }
            if (name == "Invert" || name == "Not")
            {
                return BTNodeKind::Invert;
            }
            if (name == "ConditionTransform")
            {
                return BTNodeKind::ConditionTransform;
            }
            if (name == "Subtree" || name == "SubTree")
            {
                return BTNodeKind::Subtree;
            }
            if (name == "Null")
            {
                return BTNodeKind::Null;
            }
            return BTNodeKind::Unknown;
        }

        bool IsMetadataNode(const std::string& name)
        {
            // Root 下的这些节点只描述黑板、引用树或参数映射，不是可执行 BT 节点。
            // 特别是 ReferencedBehaviorTrees 在新版 sdata/模板里会长期存在，
            // loader 必须跳过它，否则会把引用表误判成 Unknown 行为节点。
            return name == "Blackboards" ||
                   name == "ReferencedBehaviorTrees" ||
                   name == "Inputs" ||
                   name == "Outputs" ||
                   name == "Output";
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

        bool RequiresChildren(BTNodeKind kind)
        {
            return kind == BTNodeKind::Sequence ||
                   kind == BTNodeKind::Selector ||
                   kind == BTNodeKind::And ||
                   kind == BTNodeKind::Or ||
                   kind == BTNodeKind::Parallel ||
                   kind == BTNodeKind::IfElse ||
                   kind == BTNodeKind::MonitorBranch ||
                   kind == BTNodeKind::SelectMonitor ||
                   kind == BTNodeKind::Loop ||
                   kind == BTNodeKind::SuccessUntil ||
                   kind == BTNodeKind::FailureUntil ||
                   kind == BTNodeKind::AlwaysSuccess ||
                   kind == BTNodeKind::AlwaysFailure ||
                   kind == BTNodeKind::Invert;
        }

        bool IsDecorator(BTNodeKind kind)
        {
            return kind == BTNodeKind::Loop ||
                   kind == BTNodeKind::SuccessUntil ||
                   kind == BTNodeKind::FailureUntil ||
                   kind == BTNodeKind::AlwaysSuccess ||
                   kind == BTNodeKind::AlwaysFailure ||
                   kind == BTNodeKind::Invert;
        }

        void SetError(std::string* error, const std::string& value)
        {
            if (error)
            {
                *error = value;
            }
        }

        bool AttributeBool(const pugi::xml_node& node, const char* name, bool defaultValue)
        {
            if (!node.attribute(name))
            {
                return defaultValue;
            }
            std::string value = node.attribute(name).as_string();
            return value == "true" || value == "True" || value == "1";
        }

        bool HasUnsupportedBehaviorTreeAttributes(const pugi::xml_node& node)
        {
            return node.attribute("action") ||
                   node.attribute("componentClass") ||
                   node.attribute("componentType") ||
                   node.attribute("modelName") ||
                   node.attribute("modelClass") ||
                   node.attribute("modelType");
        }
    }

    BehaviorTreeDefPtr BTXmlLoader::LoadFromContent(const std::string& content, std::string* error)
    {
        pugi::xml_document doc;
        auto result = doc.load_string(content.c_str());
        if (!result)
        {
            SetError(error, std::string("Failed to parse behavior tree XML: ") + result.description());
            return BehaviorTreeDefPtr();
        }
        return LoadFromRoot(doc.child("Root"), error);
    }

    BehaviorTreeDefPtr BTXmlLoader::LoadFromRoot(const pugi::xml_node& root, std::string* error)
    {
        if (root.empty() || std::string(root.name()) != "Root")
        {
            SetError(error, "Missing Root node.");
            return BehaviorTreeDefPtr();
        }

        std::string projectType = root.attribute("projectType").as_string();
        if (projectType != "行为树")
        {
            SetError(error, "Unsupported Root projectType. Only new behavior tree XML is supported.");
            return BehaviorTreeDefPtr();
        }

        BehaviorTreeDefPtr def(new BehaviorTreeDef());
        def->id = root.attribute("id").as_int(0);
        def->name = root.attribute("name").as_string();
        def->projectType = projectType;
        def->behaviorTreeTemplateId = root.attribute("btTemplateId").as_string(root.attribute("templateId").as_string());
        def->modelId = root.attribute("modelId").as_string();
        // cognition 只作为根节点描述信息保留，不参与运行时装配或组件匹配。
        // 运行时真正绑定哪个认知/组件，只看节点上的 mdataName/className/componentId 等 selector，
        // 或由当前 Unit 的 mounted models 按 functionName 唯一匹配。
        def->cognition = root.attribute("cognition").as_string();

        if (!LoadBlackboards(root, *def, error))
        {
            return BehaviorTreeDefPtr();
        }
        for (const auto& refNode : root.child("ReferencedBehaviorTrees").children("ReferencedBehaviorTree"))
        {
            // 子树引用在 XML 中以内嵌 Root 保存。这里仅缓存原始 XML 文本，
            // Runtime 的 SubtreeTask 会在进入节点时再创建独立 BehaviorNodeAgent。
            const std::string id = refNode.attribute("id").as_string();
            const auto refRoot = refNode.child("Root");
            if (id.empty() || refRoot.empty())
            {
                SetError(error, "ReferencedBehaviorTree requires id and Root.");
                return BehaviorTreeDefPtr();
            }
            def->referencedBehaviorTreesById[id] = SerializeXmlNode(refRoot);
        }

        BTNodeDefPtr rootNode;
        for (const auto& child : root.children())
        {
            std::string childName = child.name();
            if (child.type() != pugi::node_element || IsMetadataNode(childName))
            {
                continue;
            }
            if (rootNode)
            {
                SetError(error, "Root must contain exactly one behavior node.");
                return BehaviorTreeDefPtr();
            }
            rootNode = LoadNode(child, *def, error, 0);
            if (!rootNode)
            {
                return BehaviorTreeDefPtr();
            }
        }

        if (!rootNode)
        {
            SetError(error, "Root behavior node is missing.");
            return BehaviorTreeDefPtr();
        }

        def->root = rootNode;
        return def;
    }

    bool BTXmlLoader::LoadBlackboards(const pugi::xml_node& root, BehaviorTreeDef& def, std::string* error)
    {
        auto blackboards = root.child("Blackboards");
        if (blackboards.empty())
        {
            SetError(error, "Blackboards node is required in new behavior tree XML.");
            return false;
        }

        for (const auto& boardNode : blackboards.children("Blackboard"))
        {
            // 黑板分 local/global 两类：
            // - local：每棵 BehaviorTreeTask 自己持有，子树/其它树不可直接共享。
            // - global：挂到 agent 级全局黑板，用于同一 Unit 下多个行为树共享状态。
            // loader 只保存定义，真正拷贝到 local/global store 在 BehaviorTreeTask 构造时完成。
            BlackboardDef board;
            board.id = boardNode.attribute("id").as_string();
            board.name = boardNode.attribute("name").as_string();
            std::string scope = boardNode.attribute("scope").as_string();
            board.scope = scope == "global" ? BlackboardScope::Global : BlackboardScope::Local;
            board.linked = AttributeBool(boardNode, "linked", false);
            if (board.id.empty())
            {
                SetError(error, "Blackboard id is required.");
                return false;
            }

            for (const auto& varNode : boardNode.children("Variable"))
            {
                BlackboardValue value;
                value.id = varNode.attribute("id").as_string();
                value.key = varNode.attribute("key").as_string();
                value.type = varNode.attribute("type").as_string();
                value.value = varNode.attribute("value").as_string();
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

    BTNodeDefPtr BTXmlLoader::LoadNode(const pugi::xml_node& xmlNode, BehaviorTreeDef& def, std::string* error, int depth)
    {
        if (depth > 512)
        {
            SetError(error, "Behavior tree depth exceeds 512.");
            return BTNodeDefPtr();
        }

        std::string type = xmlNode.name();
        BTNodeKind kind = NodeKindFromName(type);
        if (kind == BTNodeKind::Unknown)
        {
            SetError(error, "Unknown behavior tree node type: " + type);
            return BTNodeDefPtr();
        }
        if (HasUnsupportedBehaviorTreeAttributes(xmlNode))
        {
            SetError(error, "Only exported behavior tree attributes are supported. Use function/mdataName/className in new XML.");
            return BTNodeDefPtr();
        }

        BTNodeDefPtr node(new BTNodeDef());
        // BTNodeDef 是 runtime 的纯数据描述，不持有任何 Unit、组件或函数指针。
        // 这样同一棵树定义可以被多个 Unit 复用，运行状态全部放在 BTTask/BehaviorTreeTask 中。
        node->id = xmlNode.attribute("id").as_int(0);
        node->xmlType = type;
        node->kind = kind;
        node->name = xmlNode.attribute("name").as_string();
        node->functionName = xmlNode.attribute("function").as_string();
        node->behaviorTreeName = xmlNode.attribute("behaviorTreeName").as_string();
        node->behaviorTreeTemplateId = xmlNode.attribute("btTemplateId").as_string();
        node->behaviorTreeInstanceId = xmlNode.attribute("btInstanceId").as_string();
        node->paramStates = xmlNode.attribute("paramStates").as_string();
        if (kind == BTNodeKind::Subtree && node->behaviorTreeName.empty() && !node->behaviorTreeInstanceId.empty() && node->behaviorTreeInstanceId != "0")
        {
            // 导出资源常用 btInstanceId 指向 Root.ReferencedBehaviorTrees 中的子树。
            // 这里把 id 解析成子树 XML 文本；如果资源直接给 behaviorTreeName，则保持原值。
            const auto ref_iter = def.referencedBehaviorTreesById.find(node->behaviorTreeInstanceId);
            if (ref_iter != def.referencedBehaviorTreesById.end())
            {
                node->behaviorTreeName = ref_iter->second;
            }
        }
        node->script = xmlNode.attribute("script").as_string();
        node->scriptRef = xmlNode.attribute("scriptRef").as_string();
        node->target.cognition = xmlNode.attribute("cognition").as_string();
        node->target.modelName = xmlNode.attribute("mdataName").as_string();
        node->target.modelClass = xmlNode.attribute("className").as_string();
        node->target.modelType = xmlNode.attribute("typeName").as_string();
        node->target.componentId = xmlNode.attribute("componentId").as_string();
        node->target.componentName = xmlNode.attribute("componentName").as_string();
        if (node->target.componentName.empty())
        {
            node->target.componentName = node->target.modelName;
        }
        // modelName/modelClass/modelType 是旧编辑器字段名；运行时统一映射到 component* selector。
        // 注意这里只是 selector，不是绑定结果；真正匹配 mounted component 在 runtime 中完成。
        node->target.componentClass = node->target.modelClass;
        node->target.componentType = node->target.modelType;
        node->captureInputOnEnter = std::string(xmlNode.attribute("inputCapture").as_string()) == "onEnter";
        node->loopCount = xmlNode.attribute("count").as_int(xmlNode.attribute("loopCount").as_int(1));
        const std::string endStatus = xmlNode.attribute("status").as_string();
        node->endStatusSuccess = !(endStatus == "FAILURE" || endStatus == "Failure" || endStatus == "failure");
        node->endExternalTree = AttributeBool(xmlNode, "externalTree", false);
        node->parallelSuccessThreshold = xmlNode.attribute("successThreshold").as_uint(0);
        node->parallelFailureThreshold = xmlNode.attribute("failureThreshold").as_uint(0);
        node->compareType = NormalizeCompareType(xmlNode.attribute("comparetype").as_string());
        if (node->compareType.empty())
        {
            SetError(error, "Invalid Condition comparetype, expected Function or Output. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }

        if (node->id == 0)
        {
            SetError(error, "Behavior node id is required.");
            return BTNodeDefPtr();
        }
        if (def.nodesById.find(node->id) != def.nodesById.end())
        {
            SetError(error, "Duplicate behavior node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if ((kind == BTNodeKind::Action || kind == BTNodeKind::Condition) &&
            node->functionName.empty() && node->script.empty() && node->scriptRef.empty())
        {
            SetError(error, "Action/Condition function or script is required. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if (kind == BTNodeKind::ConditionTransform && node->functionName.empty())
        {
            SetError(error, "ConditionTransform function is required. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if (kind == BTNodeKind::Subtree &&
            node->behaviorTreeName.empty() &&
            node->behaviorTreeTemplateId.empty())
        {
            SetError(error, "SubTree btInstanceId/behaviorTreeName is required. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        auto inputsNode = xmlNode.child("Inputs");
        for (const auto& inputNode : inputsNode.children("Input"))
        {
            // Input 进入 runtime 后会被 BuildInputMal 转成 FZMalImpl。
            // source="blackboard" 表示运行时从黑板取最新值；否则使用 XML 固定 value。
            InputBinding input;
            input.name = inputNode.attribute("name").as_string();
            input.type = inputNode.attribute("type").as_string();
            input.value = inputNode.attribute("value").as_string();
            std::string source = inputNode.attribute("source").as_string();
            if (source == "blackboard")
            {
                input.source = InputSource::Blackboard;
                input.blackboardId = inputNode.attribute("blackboardKey").as_string();
                input.variableId = inputNode.attribute("variableKey").as_string();
                if (!def.blackboards.Find(input.blackboardId, input.variableId))
                {
                    SetError(error, "Invalid blackboard input binding in node id: " + std::to_string(node->id));
                    return BTNodeDefPtr();
                }
            }
            if (input.name.empty())
            {
                SetError(error, "Input name is required in node id: " + std::to_string(node->id));
                return BTNodeDefPtr();
            }
            node->inputs.push_back(input);
        }

        auto outputsNode = xmlNode.child("Outputs");
        for (const auto& outputNode : outputsNode.children("Output"))
        {
            // Outputs 是“函数输出字段 -> 黑板变量”的写回映射。
            // 它和下面 Condition 的单个 <Output op="..."> 不同：
            // 这里负责写黑板，Condition Output 负责条件比较。
            OutputBinding output;
            output.name = outputNode.attribute("name").as_string();
            output.blackboardId = outputNode.attribute("blackboardKey").as_string();
            output.variableId = outputNode.attribute("variableKey").as_string();
            if (output.name.empty() || !def.blackboards.Find(output.blackboardId, output.variableId))
            {
                SetError(error, "Invalid output binding in node id: " + std::to_string(node->id));
                return BTNodeDefPtr();
            }
            node->outputs.push_back(output);
        }

        auto outputNode = xmlNode.child("Output");
        if (!outputNode.empty())
        {
            // Condition comparetype="Output" 的比较配置：
            // 运行时先执行函数/脚本，只有函数返回 Success 才读取 compareOutputName 做比较。
            // 字段缺失、op 非法、数值比较无法解析都按 Failure 处理并写 BT_CONDITION_COMPARE_SUMMARY。
            node->compareOutputName = outputNode.attribute("name").as_string();
            node->compareOp = NormalizeCompareOp(outputNode.attribute("op").as_string());
            node->compareValue = outputNode.attribute("value").as_string();
            if (node->compareOutputName.empty() || node->compareOp.empty())
            {
                SetError(error, "Invalid Condition Output compare, expected name and op in eq/ne/gt/ge/lt/le. Node id: " + std::to_string(node->id));
                return BTNodeDefPtr();
            }
            if (node->compareType != "Output")
            {
                SetError(error, "Condition Output compare requires comparetype=\"Output\". Node id: " + std::to_string(node->id));
                return BTNodeDefPtr();
            }
        }
        if (node->compareType == "Output" && outputNode.empty())
        {
            SetError(error, "Condition comparetype=\"Output\" requires an <Output name=\"...\" op=\"eq/ne/gt/ge/lt/le\" value=\"...\" /> child. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }

        for (const auto& child : xmlNode.children())
        {
            // 子节点递归只处理可执行 BT 节点；Inputs/Outputs/Output 等元数据节点在这里跳过。
            std::string childName = child.name();
            if (child.type() != pugi::node_element || IsMetadataNode(childName))
            {
                continue;
            }
            BTNodeDefPtr childNode = LoadNode(child, def, error, depth + 1);
            if (!childNode)
            {
                return BTNodeDefPtr();
            }
            node->children.push_back(childNode);
        }

        if (RequiresChildren(kind) && node->children.empty())
        {
            SetError(error, "Composite/decorator node has no child. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if (IsDecorator(kind) && node->children.size() != 1)
        {
            SetError(error, "Decorator node must have exactly one child. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if (kind == BTNodeKind::Condition && !node->children.empty())
        {
            SetError(error, "Condition node must be a leaf in new behavior tree XML. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if (kind == BTNodeKind::End && !node->children.empty())
        {
            SetError(error, "End node must be a leaf in new behavior tree XML. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if (kind == BTNodeKind::Null && !node->children.empty())
        {
            SetError(error, "Null node must be a leaf in new behavior tree XML. Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if (kind == BTNodeKind::IfElse && node->children.size() != 3)
        {
            SetError(error, "IfElse node must have exactly three children (condition/then/else). Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }
        if (kind == BTNodeKind::MonitorBranch && node->children.size() != 2)
        {
            SetError(error, "MonitorBranch node must have exactly two children (condition/action). Node id: " + std::to_string(node->id));
            return BTNodeDefPtr();
        }

        def.nodesById[node->id] = node;
        return node;
    }
}
