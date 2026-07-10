#include "modules/extern/bt_tree_task.h"
#include "core/logging/runtime_summary_log.h"

#include "FZSimIO/FZSimDatabaseIO/IFZSimDatabaseIO.h"
#include "FZSimIO/FZSimDatabaseIO/IFZSimDatabaseExtentionIO.h"
#include "FZSimIO/FZSimDatabaseExtentionIO/IFZSimDecisionEditorManagerIO.h"
#include "FZSimIO/FZSimScenarioIO/IFZSimScenarioIO.h"
#include "core/mal/cyber_marg_base_impl.h"
#include "models/equipment/cyber_equipment_impl.h"
#include "models/mount_model/cyber_mount_model_impl.h"
#include "modules/extern/behavior_node_agent.h"
#include "modules/extern/bt_compare_rules.h"
#include "modules/simulation/cyber_entity_sim_impl.h"
#include "modules/unit/cyber_unit_impl.h"
#include <cstring>
#include <cstdlib>
#include <sstream>

namespace BT
{
    /*
     * Behavior tree runtime contract
     * 行为树运行时契约：
     *
     * 1. BTXmlLoader 只生成 BehaviorTreeDef/BTNodeDef；本文件负责把定义实例化为 BTTask 树，
     *    并在每个仿真 tick 中推进节点状态。
     *
     * 2. 每个节点只有四种状态：Invalid / Running / Success / Failure。
     *    Running 表示本帧未结束，下一 tick 继续同一个 BTTask 实例，不重新 OnEnter。
     *    Success/Failure 表示节点本次执行结束，FinishTick 会触发 OnExit。
     *
     * 3. Reset 只重置运行态（状态、计数、当前子节点等），不修改 BTNodeDef 静态定义。
     *    Loop/Until 等装饰节点在一次迭代完成后会显式 Reset 子节点，确保下一轮重新 OnEnter。
     *
     * 4. 模型函数绑定在运行时完成：
     *    节点 selector 指向已装配组件；没有 selector 时先查 root model，再查 mounted models。
     *    绑定必须唯一，避免行为树函数名重复时随机调用错误组件。
     *
     * 5. Condition 有两种正式判定方式：
     *    Function：函数/脚本返回值直接决定条件结果。
     *    Output：函数必须 Success，然后比较输出 MAL 字段；字段缺失或比较失败都返回 Failure。
     */
    namespace
    {
        enum class BlackboardLogMode
        {
            Off,
            EventOnly,
            Summary,
            FullState
        };

        BlackboardLogMode ResolveBlackboardLogMode()
        {
            const char* mode = std::getenv("FOSIM_BEHAVIOR_BLACKBOARD_MODE");
            if (mode == nullptr || *mode == 0)
            {
                return BlackboardLogMode::FullState;
            }
            const std::string value(mode);
            if (value == "Off" || value == "off" || value == "OFF")
            {
                return BlackboardLogMode::Off;
            }
            if (value == "EventOnly" || value == "eventonly" || value == "EVENTONLY")
            {
                return BlackboardLogMode::EventOnly;
            }
            if (value == "Summary" || value == "summary" || value == "SUMMARY")
            {
                return BlackboardLogMode::Summary;
            }
            return BlackboardLogMode::FullState;
        }

        size_t CountMalFields(CyberMalImpl* mal)
        {
            if (mal == nullptr)
            {
                return 0;
            }
            size_t count = 0;
            for (CyberMargBaseImpl* marg = mal->GetFirstArgument(); marg; marg = mal->GetNextArgument(marg))
            {
                ++count;
            }
            return count;
        }

        std::string BehaviorLabel(const BTNodeDef& node)
        {
            if (!node.name.empty())
            {
                return node.name + "[" + std::to_string(node.id) + "]";
            }
            if (!node.functionName.empty())
            {
                return node.functionName + "[" + std::to_string(node.id) + "]";
            }
            return std::to_string(node.id);
        }

        std::string BehaviorCognitionName(const BTContext& context, const BTNodeDef& node)
        {
            if (!node.target.cognition.empty())
            {
                return node.target.cognition;
            }
            if (context.treeDef && !context.treeDef->cognition.empty())
            {
                return context.treeDef->cognition;
            }
            if (context.agent)
            {
                const auto& cognitionName = context.agent->GetCogName();
                if (!cognitionName.empty())
                {
                    return cognitionName;
                }
            }
            return "-";
        }

        const char* NodeRoleName(BTNodeKind kind)
        {
            switch (kind)
            {
            case BTNodeKind::Action:
                return "Action";
            case BTNodeKind::Condition:
                return "Predicate";
            case BTNodeKind::Sequence:
                return "Sequence";
            case BTNodeKind::Selector:
                return "Selector";
            case BTNodeKind::And:
                return "And";
            case BTNodeKind::Or:
                return "Or";
            case BTNodeKind::Parallel:
                return "Parallel";
            case BTNodeKind::IfElse:
                return "IfElse";
            case BTNodeKind::MonitorBranch:
                return "MonitorBranch";
            case BTNodeKind::SelectMonitor:
                return "SelectMonitor";
            case BTNodeKind::Loop:
                return "Loop";
            case BTNodeKind::End:
                return "End";
            case BTNodeKind::AlwaysSuccess:
                return "AlwaysSuccess";
            case BTNodeKind::AlwaysFailure:
                return "AlwaysFailure";
            case BTNodeKind::SuccessUntil:
                return "SuccessUntil";
            case BTNodeKind::FailureUntil:
                return "FailureUntil";
            case BTNodeKind::Invert:
                return "Invert";
            case BTNodeKind::ConditionTransform:
                return "ConditionTransform";
            case BTNodeKind::Subtree:
                return "Subtree";
            case BTNodeKind::Null:
                return "Null";
            case BTNodeKind::Unknown:
            default:
                return "Unknown";
            }
        }

        const char* StatusName(BTStatus status)
        {
            switch (status)
            {
            case BTStatus::Success:
                return "Success";
            case BTStatus::Failure:
                return "Failure";
            case BTStatus::Running:
                return "Running";
            case BTStatus::Invalid:
            default:
                return "Invalid";
            }
        }

        const char* FZDecisionStatusName(CyberDFMPFRC status)
        {
            switch (status)
            {
            case CYBER_DFMPFRC_SINGLE:
                return "SINGLE";
            case CYBER_DFMPFRC_CONTINUOUS:
                return "CONTINUOUS";
            case CYBER_DFMPFRC_ERROR:
                return "ERROR";
            case CYBER_DFMPFRC_UNKNOWN:
            default:
                return "UNKNOWN";
            }
        }

        const std::string& FirstNonEmpty(const std::string& primary, const std::string& fallback)
        {
            return primary.empty() ? fallback : primary;
        }

        std::string FieldOrDash(const std::string& value)
        {
            return value.empty() ? "-" : value;
        }

        bool HasExplicitSelector(const ModelSelector& selector);

        bool HasExecutableBinding(const BTNodeDef& node)
        {
            return !node.functionName.empty();
        }

        std::string BindingModeName(const BTNodeDef& node)
        {
            if (node.kind == BTNodeKind::Subtree || !node.behaviorTreeName.empty())
            {
                return "subtree";
            }
            if (!node.functionName.empty())
            {
                return HasExplicitSelector(node.target) ? "component-function" : "function-search";
            }
            return "control-node";
        }

        std::string BindingStatusName(const BTNodeDef& node)
        {
            return HasExecutableBinding(node) || node.kind == BTNodeKind::Subtree
                ? "resolved-by-runtime"
                : "not-applicable";
        }

        std::string ActionLabel(const BTNodeDef& node)
        {
            if (!node.functionName.empty())
            {
                return node.functionName;
            }
            if (!node.behaviorTreeName.empty())
            {
                return node.behaviorTreeName.find("<Root") == 0 ? "inline-subtree" : node.behaviorTreeName;
            }
            return "-";
        }

        void NotifyNodeLifecycle(BTContext& context, const BTNodeDef& node, int eventType, BTStatus status)
        {
            if (!context.agent)
            {
                return;
            }
            if (!context.agent->HasBehaviorTraceSink())
            {
                return;
            }

            std::ostringstream detail;
            detail << "nodeRole=" << NodeRoleName(node.kind)
                   << ", xmlType=" << FieldOrDash(node.xmlType)
                   << ", function=" << FieldOrDash(node.functionName)
                   << ", componentId=" << FieldOrDash(node.target.componentId)
                   << ", componentName=" << FieldOrDash(FirstNonEmpty(node.target.componentName, node.target.modelName))
                   << ", componentClass=" << FieldOrDash(FirstNonEmpty(node.target.componentClass, node.target.modelClass))
                   << ", componentType=" << FieldOrDash(FirstNonEmpty(node.target.componentType, node.target.modelType))
                   << ", action=" << ActionLabel(node)
                   << ", bindingMode=" << BindingModeName(node)
                   << ", bindingStatus=" << BindingStatusName(node)
                   << ", status=" << StatusName(status);
            context.agent->NotifyBehaviorDetail(BehaviorLabel(node),
                                                BehaviorCognitionName(context, node),
                                                eventType,
                                                eventType == FZ_BEHAVIOR_EVENT_TREE_ENTER ? "Enter" : "Exit",
                                                detail.str());
        }

        void PrintNodeSummary(const BTContext& context,
                              const BTNodeDef& node,
                              std::uint64_t tickCount,
                              std::uint64_t enterCount,
                              std::uint64_t updateCount,
                              std::uint64_t exitCount,
                              bool entered,
                              bool exited,
                              BTStatus beforeStatus,
                              BTStatus afterStatus)
        {
            const char* unitName = "";
            if (context.agent && context.agent->GetUnit())
            {
                unitName = context.agent->GetUnit()->GetUnitNameCString();
            }
            FOSIM_LOG_INFO("BehaviorTree", "BT_NODE_SUMMARY", [&]() {
                std::ostringstream summary;
                fosim::runtime::AppendLogField(summary, "tree", context.treeDef ? context.treeDef->name : "");
                fosim::runtime::AppendLogField(summary, "unit", unitName);
                fosim::runtime::AppendLogField(summary, "node", BehaviorLabel(node));
                fosim::runtime::AppendLogField(summary, "role", NodeRoleName(node.kind));
                fosim::runtime::AppendLogField(summary, "function", FieldOrDash(node.functionName));
                fosim::runtime::AppendLogField(summary, "component_id", FieldOrDash(node.target.componentId));
                fosim::runtime::AppendLogField(summary, "component_name", FieldOrDash(FirstNonEmpty(node.target.componentName, node.target.modelName)));
                fosim::runtime::AppendLogField(summary, "component_class", FieldOrDash(FirstNonEmpty(node.target.componentClass, node.target.modelClass)));
                fosim::runtime::AppendLogField(summary, "component_type", FieldOrDash(FirstNonEmpty(node.target.componentType, node.target.modelType)));
                fosim::runtime::AppendLogField(summary, "binding_mode", BindingModeName(node));
                fosim::runtime::AppendLogField(summary, "binding_status", BindingStatusName(node));
                fosim::runtime::AppendLogField(summary, "tick_count", tickCount);
                fosim::runtime::AppendLogField(summary, "enter_count", enterCount);
                fosim::runtime::AppendLogField(summary, "update_count", updateCount);
                fosim::runtime::AppendLogField(summary, "exit_count", exitCount);
                fosim::runtime::AppendLogField(summary, "entered", entered);
                fosim::runtime::AppendLogField(summary, "updated", true);
                fosim::runtime::AppendLogField(summary, "exited", exited);
                fosim::runtime::AppendLogField(summary, "before", StatusName(beforeStatus));
                fosim::runtime::AppendLogField(summary, "status", StatusName(afterStatus));
                return summary.str();
            });
        }

        void PrintFunctionSummary(const BTContext& context,
                                  const BTNodeDef& node,
                                  const std::string& executor,
                                  const std::string& rawReturn,
                                  BTStatus finalStatus,
                                  CyberMalImpl* inputMal,
                                  CyberMalImpl* outputMal)
        {
            const char* unitName = "";
            if (context.agent && context.agent->GetUnit())
            {
                unitName = context.agent->GetUnit()->GetUnitNameCString();
            }
            FOSIM_LOG_INFO("BehaviorTree", "BT_FUNCTION_SUMMARY", [&]() {
                std::ostringstream summary;
                fosim::runtime::AppendLogField(summary, "tree", context.treeDef ? context.treeDef->name : "");
                fosim::runtime::AppendLogField(summary, "unit", unitName);
                fosim::runtime::AppendLogField(summary, "node", BehaviorLabel(node));
                fosim::runtime::AppendLogField(summary, "role", NodeRoleName(node.kind));
                fosim::runtime::AppendLogField(summary, "executor", executor);
                fosim::runtime::AppendLogField(summary, "function", FieldOrDash(node.functionName));
                fosim::runtime::AppendLogField(summary, "component_id", FieldOrDash(node.target.componentId));
                fosim::runtime::AppendLogField(summary, "component_name", FieldOrDash(FirstNonEmpty(node.target.componentName, node.target.modelName)));
                fosim::runtime::AppendLogField(summary, "component_class", FieldOrDash(FirstNonEmpty(node.target.componentClass, node.target.modelClass)));
                fosim::runtime::AppendLogField(summary, "binding_mode", BindingModeName(node));
                fosim::runtime::AppendLogField(summary, "inputMal", inputMal ? SerializeMal(*inputMal) : "[]");
                fosim::runtime::AppendLogField(summary, "outputMal", outputMal ? SerializeMal(*outputMal) : "[]");
                fosim::runtime::AppendLogField(summary, "raw_return", rawReturn);
                fosim::runtime::AppendLogField(summary, "status", StatusName(finalStatus));
                return summary.str();
            });
        }

        void PrintUntilSummary(const BTContext& context,
                               const BTNodeDef& node,
                               int attempt,
                               bool infinite,
                               BTStatus childStatus,
                               BTStatus finalStatus,
                               bool exhausted)
        {
            const char* unitName = "";
            if (context.agent && context.agent->GetUnit())
            {
                unitName = context.agent->GetUnit()->GetUnitNameCString();
            }
            FOSIM_LOG_INFO("BehaviorTree", "BT_UNTIL_SUMMARY", [&]() {
                std::ostringstream summary;
                fosim::runtime::AppendLogField(summary, "tree", context.treeDef ? context.treeDef->name : "");
                fosim::runtime::AppendLogField(summary, "unit", unitName);
                fosim::runtime::AppendLogField(summary, "node", BehaviorLabel(node));
                fosim::runtime::AppendLogField(summary, "role", NodeRoleName(node.kind));
                fosim::runtime::AppendLogField(summary, "attempt", attempt);
                fosim::runtime::AppendLogField(summary, "count", node.loopCount);
                fosim::runtime::AppendLogField(summary, "infinite", infinite);
                fosim::runtime::AppendLogField(summary, "child_status", StatusName(childStatus));
                fosim::runtime::AppendLogField(summary, "final_status", StatusName(finalStatus));
                fosim::runtime::AppendLogField(summary, "exhausted", exhausted);
                return summary.str();
            });
        }

        bool IsTrueString(const std::string& value)
        {
            return value == "true" || value == "True" || value == "TRUE" || value == "1";
        }

        bool TryParseDoublePair(const std::string& value, double& a, double& b)
        {
            const size_t comma = value.find(',');
            if (comma == std::string::npos)
            {
                return false;
            }
            char* endA = nullptr;
            char* endB = nullptr;
            a = std::strtod(value.substr(0, comma).c_str(), &endA);
            b = std::strtod(value.substr(comma + 1).c_str(), &endB);
            return endA && *endA == 0 && endB && *endB == 0;
        }

        bool TryParseDoubleTriple(const std::string& value, double& x, double& y, double& z)
        {
            std::stringstream ss(value);
            std::string part;
            std::vector<double> values;
            while (std::getline(ss, part, ','))
            {
                char* end = nullptr;
                const double raw = std::strtod(part.c_str(), &end);
                if (!end || *end != 0)
                {
                    return false;
                }
                values.push_back(raw);
            }
            if (values.size() != 3)
            {
                return false;
            }
            x = values[0];
            y = values[1];
            z = values[2];
            return true;
        }

        bool IsStringType(const std::string& type)
        {
            return type == "LineEditor" || type == "String" || type == "FZString" || type == "FZStringType";
        }

        bool IsCharsetType(const std::string& type)
        {
            return type == "Charset";
        }

        bool TryParseIntegerValue(const std::string& value, CyberIntegerType& parsed)
        {
            if (value.empty())
            {
                return false;
            }
            char* end = nullptr;
            const long raw = std::strtol(value.c_str(), &end, 10);
            if (!end || *end != 0)
            {
                return false;
            }
            parsed = static_cast<CyberIntegerType>(raw);
            return true;
        }

        bool TryParseRealValue(const std::string& value, CyberRealType& parsed)
        {
            if (value.empty())
            {
                return false;
            }
            char* end = nullptr;
            const double raw = std::strtod(value.c_str(), &end);
            if (!end || *end != 0)
            {
                return false;
            }
            parsed = static_cast<CyberRealType>(raw);
            return true;
        }

        bool IsNameType(const std::string& type)
        {
            return type == "Name" || type == "CyberNameType";
        }

        bool IsIntegerType(const std::string& type)
        {
            return type == "SpinBox" || type == "Integer" || type == "Int" || type == "FZInteger" || type == "CyberIntegerType";
        }

        bool IsRealType(const std::string& type)
        {
            return type == "DoubleSpinBox" || type == "Real" || type == "Double" || type == "FZReal" || type == "CyberRealType";
        }

        bool IsComboType(const std::string& type)
        {
            return type == "ComboBox";
        }

        bool IsJulianType(const std::string& type)
        {
            return type == "Julian";
        }

        bool IsBoolType(const std::string& type)
        {
            return type == "CheckBox" || type == "Bool" || type == "Boolean" || type == "CyberBOOL";
        }

        bool IsCoordinateType(const std::string& type)
        {
            return type == "Coordinate" || type == "FZCoordinate" || type == "CyberCoordinateType";
        }

        bool IsVectorType(const std::string& type)
        {
            return type == "Vector" || type == "FZVector" || type == "CyberVectorType";
        }

        const BlackboardValue* ResolveInputValue(const InputBinding& input, const BehaviorTreeTask* treeTask)
        {
            if (input.source == InputSource::Blackboard)
            {
                return treeTask ? treeTask->FindBlackboardValue(input.blackboardId, input.variableId) : nullptr;
            }
            return nullptr;
        }

        std::string EffectiveInputValue(const InputBinding& input, const BehaviorTreeTask* treeTask)
        {
            if (const BlackboardValue* value = ResolveInputValue(input, treeTask))
            {
                return value->value;
            }
            return input.value;
        }

        std::string EffectiveInputType(const InputBinding& input, const BehaviorTreeTask* treeTask)
        {
            if (!input.type.empty())
            {
                return input.type;
            }
            if (const BlackboardValue* value = ResolveInputValue(input, treeTask))
            {
                return value->type;
            }
            return input.type;
        }

        bool BuildInputMal(const BTNodeDef& node, const BehaviorTreeTask* treeTask, CyberMalImpl& mal)
        {
            // 每次执行 Action/Condition 前构造输入 MAL。
            // 默认每 tick 重新读取黑板，保证黑板变化能立刻影响条件；
            // 对 captureInputOnEnter 的 Action，则在 OnEnter 时冻结输入，Running 期间不再重新采样。
            for (const auto& input : node.inputs)
            {
                if (!AddValueToMal(mal, input.name, EffectiveInputType(input, treeTask), EffectiveInputValue(input, treeTask)))
                {
                    return false;
                }
            }
            return true;
        }

        bool HasMalValueNamed(CyberMalImpl& mal, const std::string& name)
        {
            for (CyberMargBaseImpl* marg = mal.GetFirstArgument(); marg; marg = mal.GetNextArgument(marg))
            {
                if (name == marg->GetName())
                {
                    return true;
                }
            }
            return false;
        }

        bool HasAnyMalValue(CyberMalImpl& mal)
        {
            return mal.GetFirstArgument() != nullptr;
        }

        CyberMalImpl* SelectEffectiveOutputMal(const BTNodeDef& node, CyberMalImpl& inputMal, CyberMalImpl& outputMal)
        {
            // 决策函数历史上有两类写法：
            // - 推荐写法：把输出写到 outputMal。
            // - 旧生成代码可能直接改 inputMal 或只返回若干字段。
            // 这里按节点 Outputs 中声明的字段优先选择真正含有输出字段的 MAL，
            // 只作为“运行时输出源选择”，不改变函数调用契约。
            for (const auto& output : node.outputs)
            {
                if (HasMalValueNamed(outputMal, output.name))
                {
                    return &outputMal;
                }
            }
            if (!node.outputs.empty())
            {
                for (const auto& output : node.outputs)
                {
                    if (HasMalValueNamed(inputMal, output.name))
                    {
                        return &inputMal;
                    }
                }
            }
            return HasAnyMalValue(outputMal) ? &outputMal : nullptr;
        }

        void EmitBlackboardPhase(BTContext& context,
                                 const BTNodeDef& node,
                                 const std::string& phase,
                                 CyberMalImpl* inputMal,
                                 CyberMalImpl* outputMal)
        {
            if (!context.agent || !context.treeTask)
            {
                return;
            }
            if (!context.agent->HasBehaviorTraceSink())
            {
                return;
            }

            const BlackboardLogMode mode = ResolveBlackboardLogMode();
            if (mode == BlackboardLogMode::Off || mode == BlackboardLogMode::EventOnly)
            {
                return;
            }

            std::ostringstream detail;
            if (mode == BlackboardLogMode::Summary)
            {
                const auto views = context.treeTask->GetAllBlackboardValueViews();
                detail << "blackboardCount=" << views.size()
                       << ", inputMalFields=" << CountMalFields(inputMal)
                       << ", outputMalFields=" << CountMalFields(outputMal);
            }
            else
            {
                detail << "blackboards=" << SerializeBlackboardViews(context.treeTask->GetAllBlackboardValueViews());
                if (inputMal != nullptr)
                {
                    detail << ", inputMal=" << SerializeMal(*inputMal);
                }
                if (outputMal != nullptr)
                {
                    detail << ", outputMal=" << SerializeMal(*outputMal);
                }
            }

            context.agent->NotifyBehaviorDetail(BehaviorLabel(node),
                                                BehaviorCognitionName(context, node),
                                                FZ_BEHAVIOR_EVENT_TREE_EXECUTE,
                                                phase,
                                                detail.str());
        }

        bool CopyOutputToSharedMal(BTContext& context, CyberMalImpl& outputMal)
        {
            if (!context.agent)
            {
                return false;
            }
            auto sharedMal = context.agent->GetSharedMalPtr();
            if (!sharedMal)
            {
                return false;
            }
            *sharedMal = outputMal;
            return true;
        }

        bool WriteOutputs(const BTNodeDef& node, CyberMalImpl& sourceMal, BehaviorTreeTask* treeTask, AgentPtr agent)
        {
            // Outputs 负责把函数输出字段写回黑板。
            // 写回失败是节点配置错误：函数没有产出声明字段，或 blackboardKey/variableKey 不存在。
            // 返回 false 只用于记录问题；节点最终状态仍由函数返回/条件比较决定，避免日志写回影响业务动作。
            bool ok = true;
            for (const auto& output : node.outputs)
            {
                bool found = false;
                CyberMargBaseImpl* marg = sourceMal.GetFirstArgument();
                for (; marg; marg = sourceMal.GetNextArgument(marg))
                {
                    if (output.name == marg->GetName())
                    {
                        found = true;
                        if (!treeTask || !treeTask->SetBlackboardValue(output.blackboardId, output.variableId, MargToString(marg)))
                        {
                            ok = false;
                            if (agent)
                            {
                                agent->LogError(("BehaviorTree output blackboard binding not found, node id: " + std::to_string(node.id)).c_str());
                            }
                        }
                        break;
                    }
                }
                if (!found)
                {
                    ok = false;
                    if (agent)
                    {
                        agent->LogError(("BehaviorTree output MAL field not found: " + output.name + ", node id: " + std::to_string(node.id)).c_str());
                    }
                }
            }
            return ok;
        }

        struct CompareResult
        {
            bool valid = false;
            bool matched = false;
            std::string detail;
        };

        CompareResult CompareValues(const std::string& lhs, const std::string& op, const std::string& rhs)
        {
            // Output 条件比较器采用强校验：
            // - eq/ne 按字符串比较，可用于枚举、名称、状态文本。
            // - gt/ge/lt/le 只允许数值比较，任一侧无法解析为数字则比较无效。
            // 比较无效会让条件返回 Failure，并通过 detail 字段说明原因。
            CompareResult result;
            const std::string normalizedOp = NormalizeCompareOp(op);
            if (normalizedOp.empty())
            {
                result.detail = "invalid_compare_op:" + op;
                return result;
            }

            if (normalizedOp == "eq")
            {
                result.valid = true;
                result.matched = lhs == rhs;
                result.detail = "string_eq";
                return result;
            }
            if (normalizedOp == "ne")
            {
                result.valid = true;
                result.matched = lhs != rhs;
                result.detail = "string_ne";
                return result;
            }

            CyberRealType l = 0.0;
            CyberRealType r = 0.0;
            if (!TryParseRealValue(lhs, l) || !TryParseRealValue(rhs, r))
            {
                result.detail = "numeric_compare_requires_number";
                return result;
            }
            result.valid = true;
            if (normalizedOp == "gt")
            {
                result.matched = l > r;
            }
            else if (normalizedOp == "ge")
            {
                result.matched = l >= r;
            }
            else if (normalizedOp == "lt")
            {
                result.matched = l < r;
            }
            else if (normalizedOp == "le")
            {
                result.matched = l <= r;
            }
            result.detail = "numeric_" + normalizedOp;
            return result;
        }

        void PrintConditionCompareSummary(const BTContext& context,
                                          const BTNodeDef& node,
                                          const std::string& compareType,
                                          const std::string& compareOp,
                                          const std::string& compareField,
                                          const std::string& lhs,
                                          const std::string& rhs,
                                          bool success,
                                          const std::string& detail)
        {
            const char* unitName = "";
            if (context.agent && context.agent->GetUnit())
            {
                unitName = context.agent->GetUnit()->GetUnitNameCString();
            }
            FOSIM_LOG_INFO("BehaviorTree", "BT_CONDITION_COMPARE_SUMMARY", [&]() {
                std::ostringstream summary;
                fosim::runtime::AppendLogField(summary, "tree", context.treeDef ? context.treeDef->name : "");
                fosim::runtime::AppendLogField(summary, "unit", unitName);
                fosim::runtime::AppendLogField(summary, "node", BehaviorLabel(node));
                fosim::runtime::AppendLogField(summary, "compare_type", compareType);
                fosim::runtime::AppendLogField(summary, "compare_op", compareOp);
                fosim::runtime::AppendLogField(summary, "compare_field", FieldOrDash(compareField));
                fosim::runtime::AppendLogField(summary, "lhs", lhs);
                fosim::runtime::AppendLogField(summary, "rhs", rhs);
                fosim::runtime::AppendLogField(summary, "compare_result", success);
                fosim::runtime::AppendLogField(summary, "detail", detail);
                return summary.str();
            });
        }

        BTStatus ResolveConditionStatus(BTContext& context,
                                        const BTNodeDef& node,
                                        BTStatus functionStatus,
                                        CyberMalImpl& inputMal,
                                        CyberMalImpl* effectiveOutputMal,
                                        CyberMalImpl& outputMal)
        {
            // Condition/ConditionTransform 的统一收口：
            // Running 必须透传，表示函数仍在执行或脚本未完成，父节点下一 tick 继续当前分支。
            // Function 模式直接使用函数状态；Output 模式必须先 Success 再做字段比较。
            if (functionStatus == BTStatus::Running)
            {
                return BTStatus::Running;
            }

            const std::string compareType = NormalizeCompareType(node.compareType);
            if (compareType.empty())
            {
                PrintConditionCompareSummary(context, node, node.compareType, node.compareOp, node.compareOutputName,
                                             "", node.compareValue, false, "invalid_compare_type");
                return BTStatus::Failure;
            }
            if (compareType == "Function")
            {
                PrintConditionCompareSummary(context, node, compareType, "", "", "", "",
                                             functionStatus == BTStatus::Success, "function_return");
                return functionStatus;
            }

            if (functionStatus != BTStatus::Success)
            {
                PrintConditionCompareSummary(context, node, compareType, node.compareOp, node.compareOutputName,
                                             "", node.compareValue, false, "function_not_success");
                return BTStatus::Failure;
            }
            if (node.compareOutputName.empty())
            {
                PrintConditionCompareSummary(context, node, compareType, node.compareOp, node.compareOutputName,
                                             "", node.compareValue, false, "missing_compare_output_name");
                return BTStatus::Failure;
            }

            CyberMalImpl* compareMal = effectiveOutputMal != nullptr ? effectiveOutputMal : (HasAnyMalValue(outputMal) ? &outputMal : &inputMal);
            for (CyberMargBaseImpl* marg = compareMal->GetFirstArgument(); marg; marg = compareMal->GetNextArgument(marg))
            {
                if (node.compareOutputName == marg->GetName())
                {
                    const std::string lhs = MargToString(marg);
                    const CompareResult compare = CompareValues(lhs, node.compareOp, node.compareValue);
                    PrintConditionCompareSummary(context, node, compareType, NormalizeCompareOp(node.compareOp),
                                                 node.compareOutputName, lhs, node.compareValue,
                                                 compare.valid && compare.matched, compare.detail);
                    return compare.valid && compare.matched ? BTStatus::Success : BTStatus::Failure;
                }
            }

            PrintConditionCompareSummary(context, node, compareType, node.compareOp, node.compareOutputName,
                                         "", node.compareValue, false, "compare_output_missing");
            return BTStatus::Failure;
        }

        bool HasExplicitSelector(const ModelSelector& selector)
        {
            return !selector.modelName.empty() ||
                   !selector.modelClass.empty() ||
                   !selector.modelType.empty() ||
                   !selector.componentId.empty() ||
                   !selector.componentName.empty() ||
                   !selector.componentClass.empty() ||
                   !selector.componentType.empty();
        }

        // 旧版决策函数只挂在 Cognition 上（GetDecisionFunctionByName 是 CyberCognitionImpl 的接口），
        // mounted models 里可能混有 Equipment，这里统一先下行转换再查找。
        FZDecisionProprity* FindDecisionFunction(CyberMountModelImpl* model, const char* functionName, std::string& launchName)
        {
            auto* cognition = dynamic_cast<CyberCognitionImpl*>(model);
            return cognition ? cognition->GetDecisionFunctionByName(functionName, launchName) : nullptr;
        }

        bool BindUniqueDecision(
            BTContext& context,
            const std::vector<CyberMountModelImpl*>& models,
            const std::string& functionName,
            const bool reportAmbiguous,
            DecisionRuntime& runtime)
        {
            // 函数绑定必须唯一。多个组件同时暴露同名函数时，如果 XML 没有 selector，
            // runtime 不会猜测调用哪个组件，而是失败并输出候选组件列表。
            CyberMountModelImpl* matchedModel = nullptr;
            FZDecisionProprity* matchedProprity = nullptr;
            std::string matchedLaunch;
            int matchCount = 0;
            std::string launchName;
            for (auto* model : models)
            {
                if (!model)
                {
                    continue;
                }
                if (auto* proprity = FindDecisionFunction(model, functionName.c_str(), launchName))
                {
                    matchedModel = model;
                    matchedProprity = proprity;
                    matchedLaunch = launchName;
                    ++matchCount;
                }
            }

            if (matchCount == 1)
            {
                runtime.model = matchedModel;
                runtime.proprity = matchedProprity;
                runtime.launchName = matchedLaunch;
                return true;
            }
            if (matchCount > 1 && reportAmbiguous && context.agent)
            {
                context.agent->LogError(("BehaviorTree function binding is ambiguous: " + functionName).c_str());
            }
            return false;
        }

        bool ResolveDecision(BTContext& context, const BTNodeDef& node, DecisionRuntime& runtime)
        {
            runtime = {};
            if (!context.agent)
            {
                return false;
            }

            // 绑定顺序：
            // 1. XML 明确给 componentId/name/class/type 时，只在 selector 命中的组件中查找。
            // 2. 没有 selector 时，先查当前认知/root model，保留“认知自身函数优先”的直觉。
            // 3. 再查 Unit 上其它 mounted models。必须唯一命中。
            if (HasExplicitSelector(node.target))
            {
                return BindUniqueDecision(context, context.agent->GetMountedModels(node.target), node.functionName, true, runtime);
            }

            if (auto* rootModel = context.agent->GetModel())
            {
                if (BindUniqueDecision(context, {rootModel}, node.functionName, false, runtime))
                {
                    return true;
                }
            }

            return BindUniqueDecision(context, context.agent->GetMountedModels(), node.functionName, true, runtime);
        }

        std::string LoadBehaviorTreeContent(CyberSimulateGlobalPtr sim_global, const std::string& behavior_tree_name, AgentPtr agent)
        {
            if (behavior_tree_name.empty())
            {
                return {};
            }
            if (behavior_tree_name.find("<Root") == 0)
            {
                return behavior_tree_name;
            }
            if (!sim_global || !sim_global->database_io_)
            {
                if (agent)
                {
                    agent->LogError(("BehaviorTree subtree cannot load content without database IO: " + behavior_tree_name).c_str());
                }
                return {};
            }

            auto decision_manager_io =
                dynamic_pointer_cast<IFZSimDecisionEditorManagerIO, IFZSimDatabaseExtentionIO>(
                    sim_global->database_io_->GetDatabaseExtentionIOByType("DecisionEditorManager"));
            if (!decision_manager_io)
            {
                if (agent)
                {
                    agent->LogError("BehaviorTree subtree cannot load content: DecisionEditorManager not found.");
                }
                return {};
            }
            return decision_manager_io->GetBeheviacTreeContent(behavior_tree_name);
        }

        BTStatus ExecuteDecision(BTContext& context, const BTNodeDef& node, DecisionRuntime& runtime, CyberMalImpl& inputMal, CyberMalImpl& outputMal)
        {
            // Action/Condition/ConditionTransform 都走这里执行实际业务。
            // 脚本节点和组件函数节点共用日志、黑板采样、返回值转换规则；
            // 这样行为树排障时可以只看 BT_FUNCTION_SUMMARY，不需要关心底层执行器类型。
            if (context.agent)
            {
                context.agent->NotifyBehavior(BehaviorLabel(node), BehaviorCognitionName(context, node), FZ_BEHAVIOR_EVENT_TREE_EXECUTE);
            }
            EmitBlackboardPhase(context, node, "BeforeExecute", &inputMal, nullptr);
            if (!ResolveDecision(context, node, runtime))
            {
                FOSIM_LOG_WARN("BehaviorTree", "BT_BIND_FAILED_DETAIL", [&]() {
                    const auto models = context.agent
                        ? (HasExplicitSelector(node.target) ? context.agent->GetMountedModels(node.target) : context.agent->GetMountedModels())
                        : std::vector<CyberMountModelImpl*>();
                    std::ostringstream detail;
                    const char* unitName = context.agent && context.agent->GetUnit()
                        ? context.agent->GetUnit()->GetUnitNameCString()
                        : "";
                    detail << " tree=" << FieldOrDash(context.treeDef ? context.treeDef->name : std::string())
                           << " unit=" << FieldOrDash(unitName)
                           << " node=" << BehaviorLabel(node)
                           << " function=" << FieldOrDash(node.functionName)
                           << " component_id=" << FieldOrDash(node.target.componentId)
                           << " component_class=" << FieldOrDash(FirstNonEmpty(node.target.componentClass, node.target.modelClass))
                           << " candidate_count=" << models.size();
                    for (size_t i = 0; i < models.size(); ++i)
                    {
                        if (!models[i])
                        {
                            continue;
                        }
                        std::string launchName;
                        auto* decision = FindDecisionFunction(models[i], node.functionName.c_str(), launchName);
                        detail << " candidate" << i << "=" << FieldOrDash(models[i]->GetEntityName())
                               << "/" << FieldOrDash(models[i]->GetClassName())
                               << "/" << (decision ? "has_function" : "missing_function");
                    }
                    if (models.empty() && context.agent)
                    {
                        const auto allModels = context.agent->GetMountedModels();
                        detail << " mounted_count=" << allModels.size();
                        for (size_t i = 0; i < allModels.size(); ++i)
                        {
                            if (!allModels[i])
                            {
                                continue;
                            }
                            std::string launchName;
                            auto* decision = FindDecisionFunction(allModels[i], node.functionName.c_str(), launchName);
                            detail << " mounted" << i << "=" << FieldOrDash(allModels[i]->GetEntityName())
                                   << "/" << FieldOrDash(allModels[i]->GetAliasName())
                                   << "/" << FieldOrDash(allModels[i]->GetClassName())
                                   << "/" << (decision ? "has_function" : "missing_function");
                        }
                    }
                    return detail.str();
                });
                if (context.agent)
                {
                    context.agent->LogError(("BehaviorTree cannot bind function: " + node.functionName).c_str());
                }
                PrintFunctionSummary(context,
                                     node,
                                     "component",
                                     "BIND_FAILED",
                                     BTStatus::Failure,
                                     &inputMal,
                                     nullptr);
                return BTStatus::Failure;
            }
            if (!runtime.model || !runtime.proprity || !runtime.proprity->func_ptr)
            {
                PrintFunctionSummary(context,
                                     node,
                                     "component",
                                     "FUNCTION_POINTER_MISSING",
                                     BTStatus::Failure,
                                     &inputMal,
                                     nullptr);
                return BTStatus::Failure;
            }

            CyberDFMPFRC ret = (runtime.model->*CastTo(runtime.proprity->func_ptr))(&inputMal, &outputMal);
            const BTStatus status = ToBTStatus(ret);
            PrintFunctionSummary(context,
                                 node,
                                 "component",
                                 FZDecisionStatusName(ret),
                                 status,
                                 &inputMal,
                                 &outputMal);
            return status;
        }

        class ActionTask : public BTTask
        {
        public:
            explicit ActionTask(BTNodeDefPtr node) : BTTask(node) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                if (!BTTask::OnEnter(context))
                {
                    return false;
                }
                if (node_->captureInputOnEnter)
                {
                    // inputCapture="onEnter" 用于长 Running 动作：
                    // 动作开始时锁定输入，后续 tick 不再被黑板变化打断，例如持续转向/持续攻击。
                    capturedInput_.reset(new CyberMalImpl());
                    if (!BuildInputMal(*node_, context.treeTask, *capturedInput_))
                    {
                        return false;
                    }
                }
                return true;
            }

            void OnExit(BTContext& context, BTStatus status) override
            {
                capturedInput_.reset();
                BTTask::OnExit(context, status);
            }

            BTStatus Update(BTContext& context) override
            {
                CyberMalImpl inputMal;
                CyberMalImpl* input = &inputMal;
                if (node_->captureInputOnEnter)
                {
                    input = capturedInput_.get();
                    if (!input)
                    {
                        return BTStatus::Failure;
                    }
                }
                else if (!BuildInputMal(*node_, context.treeTask, inputMal))
                {
                    return BTStatus::Failure;
                }

                CyberMalImpl outputMal;
                DecisionRuntime runtime;
                BTStatus status = ExecuteDecision(context, *node_, runtime, *input, outputMal);
                CyberMalImpl* effectiveOutputMal = SelectEffectiveOutputMal(*node_, *input, outputMal);
                if (effectiveOutputMal != nullptr)
                {
                    // 动作输出同时写两处：
                    // - shared MAL：给旧观察/调试链路读取最近一次输出。
                    // - blackboard：按 XML Outputs 显式写入可被后续节点引用的变量。
                    CopyOutputToSharedMal(context, *effectiveOutputMal);
                    WriteOutputs(*node_, *effectiveOutputMal, context.treeTask, context.agent);
                }
                EmitBlackboardPhase(context, *node_, "AfterExecute", input, effectiveOutputMal);
                return status;
            }

        private:
            std::unique_ptr<CyberMalImpl> capturedInput_;
        };

        class ConditionTask : public BTTask
        {
        public:
            explicit ConditionTask(BTNodeDefPtr node) : BTTask(node) {}

        protected:
            BTStatus Update(BTContext& context) override
            {
                // Condition 是叶子节点。它可以执行组件函数或脚本，
                // 但最终状态必须经过 ResolveConditionStatus 收口，保证 Function/Output 语义一致。
                CyberMalImpl inputMal;
                if (!BuildInputMal(*node_, context.treeTask, inputMal))
                {
                    return BTStatus::Failure;
                }

                CyberMalImpl outputMal;
                DecisionRuntime runtime;
                BTStatus status = ExecuteDecision(context, *node_, runtime, inputMal, outputMal);
                CyberMalImpl* effectiveOutputMal = SelectEffectiveOutputMal(*node_, inputMal, outputMal);
                if (effectiveOutputMal != nullptr)
                {
                    CopyOutputToSharedMal(context, *effectiveOutputMal);
                    WriteOutputs(*node_, *effectiveOutputMal, context.treeTask, context.agent);
                }
                EmitBlackboardPhase(context, *node_, "AfterExecute", &inputMal, effectiveOutputMal);
                return ResolveConditionStatus(context, *node_, status, inputMal, effectiveOutputMal, outputMal);
            }

        };

        class SequenceTask : public CompositeTask
        {
        public:
            explicit SequenceTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                activeChildIndex_ = 0;
                currentRunningTask_ = nullptr;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                // Sequence：从左到右执行。
                // 子节点 Running 时保存 activeChildIndex_，下一 tick 继续同一子节点；
                // 子节点 Failure 时立即失败；全部 Success 才 Success。
                while (activeChildIndex_ < children_.size())
                {
                    BTStatus status = children_[activeChildIndex_]->Tick(context);
                    if (status == BTStatus::Running)
                    {
                        currentRunningTask_ = children_[activeChildIndex_].get();
                        return status;
                    }
                    currentRunningTask_ = nullptr;
                    if (status == BTStatus::Failure)
                    {
                        activeChildIndex_ = 0;
                        return status;
                    }
                    ++activeChildIndex_;
                }
                activeChildIndex_ = 0;
                return BTStatus::Success;
            }
        };

        class SelectorTask : public CompositeTask
        {
        public:
            explicit SelectorTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                activeChildIndex_ = 0;
                currentRunningTask_ = nullptr;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                // Selector：从左到右选择第一个成功分支。
                // 子节点 Running 时保存当前位置；子节点 Success 时立即成功；
                // 所有子节点 Failure 才 Failure。
                while (activeChildIndex_ < children_.size())
                {
                    BTStatus status = children_[activeChildIndex_]->Tick(context);
                    if (status == BTStatus::Running)
                    {
                        currentRunningTask_ = children_[activeChildIndex_].get();
                        return status;
                    }
                    currentRunningTask_ = nullptr;
                    if (status == BTStatus::Success)
                    {
                        activeChildIndex_ = 0;
                        return status;
                    }
                    ++activeChildIndex_;
                }
                activeChildIndex_ = 0;
                return BTStatus::Failure;
            }
        };

        // And 保留为显式逻辑与节点，而不是直接把导出资源里的 And 当作 Sequence 的别名。
        // 这样资源作者、测试和 observer 都能明确看到“逻辑与”意图，后续再做统计/文档也不会丢语义。
        class AndTask : public CompositeTask
        {
        public:
            explicit AndTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                activeChildIndex_ = 0;
                currentRunningTask_ = nullptr;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                while (activeChildIndex_ < children_.size())
                {
                    BTStatus status = children_[activeChildIndex_]->Tick(context);
                    if (status == BTStatus::Running)
                    {
                        currentRunningTask_ = children_[activeChildIndex_].get();
                        return status;
                    }
                    currentRunningTask_ = nullptr;
                    if (status == BTStatus::Failure)
                    {
                        activeChildIndex_ = 0;
                        return status;
                    }
                    ++activeChildIndex_;
                }
                activeChildIndex_ = 0;
                return BTStatus::Success;
            }
        };

        // Or 保留为显式逻辑或节点，而不是简单复用 Selector 命名。
        // 运行时语义是“任一子节点成功即成功；全部失败才失败”。
        class OrTask : public CompositeTask
        {
        public:
            explicit OrTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                activeChildIndex_ = 0;
                currentRunningTask_ = nullptr;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                while (activeChildIndex_ < children_.size())
                {
                    BTStatus status = children_[activeChildIndex_]->Tick(context);
                    if (status == BTStatus::Running)
                    {
                        currentRunningTask_ = children_[activeChildIndex_].get();
                        return status;
                    }
                    currentRunningTask_ = nullptr;
                    if (status == BTStatus::Success)
                    {
                        activeChildIndex_ = 0;
                        return status;
                    }
                    ++activeChildIndex_;
                }
                activeChildIndex_ = 0;
                return BTStatus::Failure;
            }
        };

        class ParallelTask : public CompositeTask
        {
        public:
            explicit ParallelTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            BTStatus Update(BTContext& context) override
            {
                // Parallel 每 tick 都会 tick 所有子节点。
                // successThreshold/failureThreshold 由 XML 控制；默认全部成功才成功，任一失败即失败。
                // 注意：这里不保存“已完成子节点”状态，下一 tick 仍会重新 tick 所有孩子。
                unsigned int successCount = 0;
                unsigned int failureCount = 0;
                bool sawRunning = false;
                for (auto& child : children_)
                {
                    BTStatus status = child->Tick(context);
                    if (status == BTStatus::Success)
                    {
                        ++successCount;
                    }
                    else if (status == BTStatus::Failure)
                    {
                        ++failureCount;
                    }
                    else if (status == BTStatus::Running)
                    {
                        sawRunning = true;
                    }
                }
                unsigned int successThreshold = node_->parallelSuccessThreshold ? node_->parallelSuccessThreshold : static_cast<unsigned int>(children_.size());
                unsigned int failureThreshold = node_->parallelFailureThreshold ? node_->parallelFailureThreshold : 1;
                if (successCount >= successThreshold)
                {
                    return BTStatus::Success;
                }
                if (failureCount >= failureThreshold)
                {
                    return BTStatus::Failure;
                }
                return sawRunning ? BTStatus::Running : BTStatus::Failure;
            }
        };

        // IfElse 固定解释三个子槽位：
        // - child[0]：条件
        // - child[1]：真分支
        // - child[2]：假分支
        // 一旦真/假分支进入 Running，后续 tick 继续推进该分支，直到结束后再回到条件入口。
        class IfElseTask : public CompositeTask
        {
        public:
            explicit IfElseTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                activeChildIndex_ = 0;
                currentRunningTask_ = nullptr;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                if (children_.size() != 3)
                {
                    return BTStatus::Failure;
                }

                if (activeChildIndex_ == 1 || activeChildIndex_ == 2)
                {
                    BTStatus branch_status = children_[activeChildIndex_]->Tick(context);
                    if (branch_status == BTStatus::Running)
                    {
                        currentRunningTask_ = children_[activeChildIndex_].get();
                        return branch_status;
                    }
                    currentRunningTask_ = nullptr;
                    activeChildIndex_ = 0;
                    return branch_status;
                }

                BTStatus condition_status = children_[0]->Tick(context);
                if (condition_status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[0].get();
                    return condition_status;
                }
                currentRunningTask_ = nullptr;

                if (condition_status == BTStatus::Success)
                {
                    activeChildIndex_ = 1;
                }
                else if (condition_status == BTStatus::Failure)
                {
                    activeChildIndex_ = 2;
                }
                else
                {
                    activeChildIndex_ = 0;
                    return BTStatus::Failure;
                }

                BTStatus branch_status = children_[activeChildIndex_]->Tick(context);
                if (branch_status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[activeChildIndex_].get();
                    return branch_status;
                }
                currentRunningTask_ = nullptr;
                activeChildIndex_ = 0;
                return branch_status;
            }
        };

        // MonitorBranch 先看条件，再决定是否启动监视分支。
        // 和 IfElse 不同，它只有一个“条件成立后继续跑”的分支，条件失败时直接返回失败。
        class MonitorBranchTask : public CompositeTask
        {
        public:
            explicit MonitorBranchTask(BTNodeDefPtr node) : CompositeTask(node) {}

            BTStatus TickAsSwitchCase(BTContext& context)
            {
                const BTStatus beforeStatus = status_;
                const bool wasRunning = IsRunning();
                if (!BeginTick(context))
                {
                    return status_;
                }

                const bool entered = !wasRunning;
                ++tickCount_;
                ++updateCount_;
                const BTStatus next_status = UpdateAsSwitchCase(context);
                const BTStatus finished_status = FinishTick(context, next_status);
                const bool exited = finished_status != BTStatus::Running;
                if (node_)
                {
                    PrintNodeSummary(context,
                                     *node_,
                                     tickCount_,
                                     enterCount_,
                                     updateCount_,
                                     exitCount_,
                                     entered,
                                     exited,
                                     beforeStatus,
                                     finished_status);
                }
                return finished_status;
            }

            bool WasSwitchCaseMatched() const
            {
                return switchCaseMatched_;
            }

        protected:
            bool OnEnter(BTContext& context) override
            {
                activeChildIndex_ = 0;
                currentRunningTask_ = nullptr;
                switchCaseMatched_ = false;
                return CompositeTask::OnEnter(context);
            }

            BTStatus UpdateAsSwitchCase(BTContext& context)
            {
                if (children_.size() != 2)
                {
                    return BTStatus::Failure;
                }

                // 已命中的 case 如果动作 Running，下一 tick 继续动作，不重新检测条件。
                if (activeChildIndex_ == 1)
                {
                    switchCaseMatched_ = true;
                    BTStatus action_status = children_[1]->Tick(context);
                    if (action_status == BTStatus::Running)
                    {
                        currentRunningTask_ = children_[1].get();
                        return BTStatus::Running;
                    }
                    currentRunningTask_ = nullptr;
                    activeChildIndex_ = 0;
                    return action_status;
                }

                BTStatus condition_status = children_[0]->Tick(context);
                if (condition_status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[0].get();
                    return BTStatus::Running;
                }
                currentRunningTask_ = nullptr;

                // 在 SelectMonitor 中，条件 Failure 只表示“本 case 未命中”，不是整个 switch 失败。
                if (condition_status != BTStatus::Success)
                {
                    switchCaseMatched_ = false;
                    return condition_status;
                }

                switchCaseMatched_ = true;
                activeChildIndex_ = 1;
                BTStatus action_status = children_[1]->Tick(context);
                if (action_status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[1].get();
                    return BTStatus::Running;
                }
                currentRunningTask_ = nullptr;
                activeChildIndex_ = 0;
                return action_status;
            }

            BTStatus Update(BTContext& context) override
            {
                if (children_.size() != 2)
                {
                    return BTStatus::Failure;
                }

                if (activeChildIndex_ == 1)
                {
                    BTStatus branch_status = children_[1]->Tick(context);
                    if (branch_status == BTStatus::Running)
                    {
                        currentRunningTask_ = children_[1].get();
                        return branch_status;
                    }
                    currentRunningTask_ = nullptr;
                    activeChildIndex_ = 0;
                    return branch_status;
                }

                BTStatus condition_status = children_[0]->Tick(context);
                if (condition_status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[0].get();
                    return condition_status;
                }
                currentRunningTask_ = nullptr;
                if (condition_status != BTStatus::Success)
                {
                    return condition_status;
                }

                activeChildIndex_ = 1;
                BTStatus branch_status = children_[1]->Tick(context);
                if (branch_status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[1].get();
                    return branch_status;
                }
                currentRunningTask_ = nullptr;
                activeChildIndex_ = 0;
                return branch_status;
            }

        private:
            bool switchCaseMatched_ = false;
        };

        // SelectMonitor 的正式语义类似 switch/case：
        // 每个 MonitorBranch 是一条 case，第 1 个孩子是条件，第 2 个孩子是命中后动作。
        // 条件 Failure 表示“本 case 未命中”，继续检测下一条；条件 Success 后只执行该 case 动作，
        // 后续 case 不再进入。动作 Running 时保持当前 case，下一 tick 继续动作，不重新检测条件。
        class SelectMonitorTask : public CompositeTask
        {
        public:
            explicit SelectMonitorTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                activeChildIndex_ = 0;
                currentRunningTask_ = nullptr;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                size_t start_index = 0;
                if (activeChildIndex_ < children_.size())
                {
                    auto* active_branch = dynamic_cast<MonitorBranchTask*>(children_[activeChildIndex_].get());
                    if (active_branch && active_branch->GetStatus() == BTStatus::Running)
                    {
                        const size_t resumed_index = activeChildIndex_;
                        BTStatus active_status = active_branch->TickAsSwitchCase(context);
                        if (active_status == BTStatus::Running)
                        {
                            currentRunningTask_ = active_branch;
                            activeChildIndex_ = resumed_index;
                            return BTStatus::Running;
                        }
                        if (active_status != BTStatus::Failure || active_branch->WasSwitchCaseMatched())
                        {
                            currentRunningTask_ = nullptr;
                            activeChildIndex_ = 0;
                            return active_status;
                        }

                        // 条件节点上一帧 Running，当前帧变成 Failure 时，表示当前 case 未命中。
                        // switch 语义应继续检测后续 case，而不是把 SelectMonitor 整体置为 Failure。
                        currentRunningTask_ = nullptr;
                        activeChildIndex_ = 0;
                        start_index = resumed_index + 1;
                    }
                }

                for (size_t index = start_index; index < children_.size(); ++index)
                {
                    auto* monitor_branch = dynamic_cast<MonitorBranchTask*>(children_[index].get());
                    if (!monitor_branch)
                    {
                        currentRunningTask_ = nullptr;
                        activeChildIndex_ = 0;
                        return BTStatus::Failure;
                    }

                    BTStatus status = monitor_branch->TickAsSwitchCase(context);
                    if (status == BTStatus::Failure && !monitor_branch->WasSwitchCaseMatched())
                    {
                        continue;
                    }
                    if (status == BTStatus::Running)
                    {
                        currentRunningTask_ = monitor_branch;
                        activeChildIndex_ = index;
                        return BTStatus::Running;
                    }
                    currentRunningTask_ = nullptr;
                    activeChildIndex_ = 0;
                    return status;
                }

                activeChildIndex_ = 0;
                currentRunningTask_ = nullptr;
                return BTStatus::Failure;
            }
        };

        class LoopTask : public CompositeTask
        {
        public:
            explicit LoopTask(BTNodeDefPtr node) : CompositeTask(node), remaining_(0), infinite_(false) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                // count <= 0 是无限循环；count > 0 是固定迭代次数。
                // remaining_ 只在子节点结束时递减，Running 不消耗循环次数。
                remaining_ = node_->loopCount;
                infinite_ = remaining_ <= 0;
                activeChildIndex_ = 0;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                if (children_.empty())
                {
                    return BTStatus::Success;
                }

                if (!infinite_ && remaining_ == 0)
                {
                    return BTStatus::Success;
                }

                BTStatus status = children_[0]->Tick(context);
                if (status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[0].get();
                    return BTStatus::Running;
                }
                currentRunningTask_ = nullptr;
                // Loop 表示“重复执行子树”，不是“子树失败则循环失败”。
                // 子节点只要结束（Success 或 Failure）就算完成一次迭代，并重置后等待下一轮重新 OnEnter。
                children_[0]->Reset();
                if (!infinite_ && remaining_ > 0)
                {
                    --remaining_;
                }

                return !infinite_ && remaining_ == 0 ? BTStatus::Success : BTStatus::Running;
            }

        private:
            int remaining_;
            bool infinite_;
        };

        class EndTask : public BTTask
        {
        public:
            explicit EndTask(BTNodeDefPtr node) : BTTask(node) {}

        protected:
            BTStatus Update(BTContext& context) override
            {
                if (node_->endExternalTree && context.agent)
                {
                    context.agent->SetMask(1);
                }
                return node_->endStatusSuccess ? BTStatus::Success : BTStatus::Failure;
            }
        };

        class AlwaysSuccessTask : public CompositeTask
        {
        public:
            explicit AlwaysSuccessTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            BTStatus Update(BTContext& context) override
            {
                // AlwaysSuccess 是装饰器：子节点 Running 时保持 Running；
                // 子节点一旦结束，不管 Success/Failure，装饰器都返回 Success。
                if (!children_.empty())
                {
                    BTStatus status = children_[0]->Tick(context);
                    if (status == BTStatus::Running)
                    {
                        return status;
                    }
                }
                return BTStatus::Success;
            }
        };

        class AlwaysFailureTask : public CompositeTask
        {
        public:
            explicit AlwaysFailureTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            BTStatus Update(BTContext& context) override
            {
                // AlwaysFailure 与 AlwaysSuccess 对称：
                // Running 透传，结束后统一返回 Failure。
                if (!children_.empty())
                {
                    BTStatus status = children_[0]->Tick(context);
                    if (status == BTStatus::Running)
                    {
                        return status;
                    }
                }
                return BTStatus::Failure;
            }
        };

        class SuccessUntilTask : public CompositeTask
        {
        public:
            explicit SuccessUntilTask(BTNodeDefPtr node) : CompositeTask(node), attempts_(0), infinite_(false) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                attempts_ = 0;
                infinite_ = node_->loopCount <= 0;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                // SuccessUntil：反复执行子节点直到它 Success。
                // Failure 表示本次尝试失败，计数后 Reset 子节点再重试；
                // Running 不计数、不 Reset，下一 tick 继续当前尝试。
                if (children_.empty())
                {
                    return BTStatus::Success;
                }

                BTStatus status = children_[0]->Tick(context);
                if (status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[0].get();
                    return BTStatus::Running;
                }
                currentRunningTask_ = nullptr;

                ++attempts_;
                if (status == BTStatus::Success)
                {
                    PrintUntilSummary(context, *node_, attempts_, infinite_, status, BTStatus::Success, false);
                    return BTStatus::Success;
                }

                const bool exhausted = !infinite_ && attempts_ >= node_->loopCount;
                const BTStatus finalStatus = exhausted ? status : BTStatus::Running;
                PrintUntilSummary(context, *node_, attempts_, infinite_, status, finalStatus, exhausted);
                if (exhausted)
                {
                    return status;
                }
                children_[0]->Reset();
                return BTStatus::Running;
            }

        private:
            int attempts_;
            bool infinite_;
        };

        class FailureUntilTask : public CompositeTask
        {
        public:
            explicit FailureUntilTask(BTNodeDefPtr node) : CompositeTask(node), attempts_(0), infinite_(false) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                attempts_ = 0;
                infinite_ = node_->loopCount <= 0;
                return CompositeTask::OnEnter(context);
            }

            BTStatus Update(BTContext& context) override
            {
                // FailureUntil：反复执行子节点直到它 Failure。
                // Success 表示本次尝试未达到终止条件，计数后 Reset 子节点再重试；
                // Running 不计数、不 Reset。
                if (children_.empty())
                {
                    return BTStatus::Failure;
                }

                BTStatus status = children_[0]->Tick(context);
                if (status == BTStatus::Running)
                {
                    currentRunningTask_ = children_[0].get();
                    return BTStatus::Running;
                }
                currentRunningTask_ = nullptr;

                ++attempts_;
                if (status == BTStatus::Failure)
                {
                    PrintUntilSummary(context, *node_, attempts_, infinite_, status, BTStatus::Failure, false);
                    return BTStatus::Failure;
                }

                const bool exhausted = !infinite_ && attempts_ >= node_->loopCount;
                const BTStatus finalStatus = exhausted ? status : BTStatus::Running;
                PrintUntilSummary(context, *node_, attempts_, infinite_, status, finalStatus, exhausted);
                if (exhausted)
                {
                    return status;
                }
                children_[0]->Reset();
                return BTStatus::Running;
            }

        private:
            int attempts_;
            bool infinite_;
        };

        class InvertTask : public CompositeTask
        {
        public:
            explicit InvertTask(BTNodeDefPtr node) : CompositeTask(node) {}

        protected:
            BTStatus Update(BTContext& context) override
            {
                // Invert 只翻转最终态，不翻转 Running。
                // 这样异步/跨帧动作不会被装饰器提前结束。
                if (children_.empty())
                {
                    return BTStatus::Failure;
                }
                BTStatus status = children_[0]->Tick(context);
                if (status == BTStatus::Running)
                {
                    return status;
                }
                return status == BTStatus::Success ? BTStatus::Failure : BTStatus::Success;
            }
        };

        // ConditionTransform 和 Condition 一样会执行决策函数，
        // 但资源语义明确表示“这是一个经过输入变换后得到的条件节点”，
        // 所以保留独立节点类型，方便导出、排障和文档说明。
        class ConditionTransformTask : public BTTask
        {
        public:
            explicit ConditionTransformTask(BTNodeDefPtr node) : BTTask(node) {}

        protected:
            BTStatus Update(BTContext& context) override
            {
                CyberMalImpl inputMal;
                if (!BuildInputMal(*node_, context.treeTask, inputMal))
                {
                    return BTStatus::Failure;
                }

                CyberMalImpl outputMal;
                DecisionRuntime runtime;
                BTStatus status = ExecuteDecision(context, *node_, runtime, inputMal, outputMal);
                CyberMalImpl* effectiveOutputMal = SelectEffectiveOutputMal(*node_, inputMal, outputMal);
                if (effectiveOutputMal != nullptr)
                {
                    CopyOutputToSharedMal(context, *effectiveOutputMal);
                    WriteOutputs(*node_, *effectiveOutputMal, context.treeTask, context.agent);
                }
                EmitBlackboardPhase(context, *node_, "AfterExecute", &inputMal, effectiveOutputMal);
                return ResolveConditionStatus(context, *node_, status, inputMal, effectiveOutputMal, outputMal);
            }

        };

        // Null 节点显式表示“空行为，但返回成功”。
        // 它主要服务导出资源的占位语义，避免作者只能用 AlwaysSuccess 包一层空节点来表达。
        class NullTask : public BTTask
        {
        public:
            explicit NullTask(BTNodeDefPtr node) : BTTask(node) {}

        protected:
            BTStatus Update(BTContext& context) override
            {
                (void)context;
                return BTStatus::Success;
            }
        };

        // Subtree 在运行时加载另一棵行为树，并为其创建独立的 BehaviorNodeAgent。
        // 这样子树会拥有自己独立的 Running 链和局部黑板，而不是在解析期被简单展开。
        class SubtreeTask : public BTTask
        {
        public:
            explicit SubtreeTask(BTNodeDefPtr node) : BTTask(node) {}

        protected:
            bool OnEnter(BTContext& context) override
            {
                if (!BTTask::OnEnter(context))
                {
                    return false;
                }
                if (subtreeAgent_)
                {
                    subtreeAgent_->Reset();
                    return true;
                }
                if (!context.agent)
                {
                    return false;
                }

                const std::string content = LoadBehaviorTreeContent(context.agent->GetSimGlobal(), node_->behaviorTreeName, context.agent);
                if (content.empty())
                {
                    return false;
                }

                auto subtree = std::make_shared<BehaviorNodeAgent>(context.agent->GetSimGlobal(), context.agent->GetUnit());
                if (!subtree->LoadByContent(content))
                {
                    return false;
                }
                subtree->SetName(node_->behaviorTreeName);
                subtreeAgent_ = subtree;
                return true;
            }

            BTStatus Update(BTContext& context) override
            {
                (void)context;
                if (!subtreeAgent_)
                {
                    return BTStatus::Failure;
                }
                subtreeAgent_->ExecNode();
                return ToBTStatus(subtreeAgent_->GetCurrentStatus());
            }

        private:
            std::shared_ptr<BehaviorNodeAgent> subtreeAgent_;
        };
    }

    void BlackboardStore::AddBlackboard(const BlackboardDef& board)
    {
        boards_[board.id] = board;
    }

    bool BlackboardStore::HasBlackboard(const std::string& boardId) const
    {
        return boards_.find(boardId) != boards_.end();
    }

    const BlackboardDef* BlackboardStore::FindBlackboard(const std::string& boardId) const
    {
        auto iter = boards_.find(boardId);
        return iter == boards_.end() ? nullptr : &iter->second;
    }

    const BlackboardValue* BlackboardStore::Find(const std::string& boardId, const std::string& variableId) const
    {
        auto boardIt = boards_.find(boardId);
        if (boardIt == boards_.end())
        {
            return nullptr;
        }
        auto varIt = boardIt->second.variables.find(variableId);
        return varIt == boardIt->second.variables.end() ? nullptr : &varIt->second;
    }

    BlackboardValue* BlackboardStore::FindMutable(const std::string& boardId, const std::string& variableId)
    {
        auto boardIt = boards_.find(boardId);
        if (boardIt == boards_.end())
        {
            return nullptr;
        }
        auto varIt = boardIt->second.variables.find(variableId);
        return varIt == boardIt->second.variables.end() ? nullptr : &varIt->second;
    }

    bool BlackboardStore::SetRawValue(const std::string& boardId, const std::string& variableId, const std::string& value)
    {
        if (auto* variable = FindMutable(boardId, variableId))
        {
            variable->value = value;
            return true;
        }
        return false;
    }

    std::vector<std::string> BlackboardStore::GetBoardIds() const
    {
        std::vector<std::string> ids;
        for (const auto& item : boards_)
        {
            ids.push_back(item.first);
        }
        return ids;
    }

    std::vector<BlackboardValueView> BlackboardStore::GetValueViews() const
    {
        std::vector<BlackboardValueView> views;
        for (const auto& boardPair : boards_)
        {
            const auto& board = boardPair.second;
            for (const auto& variablePair : board.variables)
            {
                const auto& variable = variablePair.second;
                BlackboardValueView view;
                view.scope = board.scope == BlackboardScope::Global ? "global" : "local";
                view.boardId = board.id;
                view.boardName = board.name;
                view.variableId = variable.id;
                view.variableKey = variable.key;
                view.variableType = variable.type;
                view.value = variable.value;
                views.push_back(view);
            }
        }
        return views;
    }

    bool AddValueToMal(CyberMalImpl& mal, const std::string& name, const std::string& type, const std::string& value)
    {
        // XML 输入值统一以字符串保存，进入模型函数前在这里按 type 转成 MAL。
        // CyberNameType 在当前 MAL 实现中用 AddString 写入，是为了兼容工具生成代码的 GetName/GetString 读取链。
        // 数值解析失败会落到 0/0.0，这是资源默认值语义；需要“缺字段即失败”的逻辑应在模型函数内显式校验。
        if (name.empty())
        {
            return false;
        }
        if (IsBoolType(type))
        {
            return mal.AddBoolean(name.c_str(), IsTrueString(value) ? CYBER_TRUE : CYBER_FALSE) == CYBER_SUCCESS;
        }
        if (IsIntegerType(type))
        {
            CyberIntegerType parsed = 0;
            if (!TryParseIntegerValue(value, parsed))
            {
                parsed = 0;
            }
            return mal.AddInteger(name.c_str(), parsed) == CYBER_SUCCESS;
        }
        if (IsRealType(type))
        {
            CyberRealType parsed = 0.0;
            if (!TryParseRealValue(value, parsed))
            {
                parsed = 0.0;
            }
            return mal.AddReal(name.c_str(), parsed) == CYBER_SUCCESS;
        }
        if (IsComboType(type))
        {
            CyberIntegerType parsedInteger = 0;
            if (TryParseIntegerValue(value, parsedInteger))
            {
                return mal.AddInteger(name.c_str(), parsedInteger) == CYBER_SUCCESS;
            }
            CyberRealType parsedReal = 0.0;
            if (TryParseRealValue(value, parsedReal))
            {
                return mal.AddReal(name.c_str(), parsedReal) == CYBER_SUCCESS;
            }
            return mal.AddString(name.c_str(), value.c_str()) == CYBER_SUCCESS;
        }
        if (IsJulianType(type))
        {
            return mal.AddJulian(name.c_str(), static_cast<CyberJulianType>(std::atof(value.c_str()))) == CYBER_SUCCESS;
        }
        if (IsCoordinateType(type))
        {
            double lat = 0.0;
            double lon = 0.0;
            TryParseDoublePair(value, lat, lon);
            CyberCoordinateType coord(lat, lon);
            return mal.AddCoordinate(name.c_str(), coord) == CYBER_SUCCESS;
        }
        if (IsVectorType(type))
        {
            double x = 0.0;
            double y = 0.0;
            double z = 0.0;
            if (!TryParseDoubleTriple(value, x, y, z))
            {
                return false;
            }
            CyberVectorType vector_value(x, y, z);
            return mal.AddVector(name.c_str(), vector_value) == CYBER_SUCCESS;
        }
        if (IsCharsetType(type))
        {
            return mal.AddString(name.c_str(), value.c_str()) == CYBER_SUCCESS;
        }
        if (IsNameType(type))
        {
            return mal.AddString(name.c_str(), value.c_str()) == CYBER_SUCCESS;
        }
        if (IsStringType(type))
        {
            return mal.AddString(name.c_str(), value.c_str()) == CYBER_SUCCESS;
        }
        return mal.AddString(name.c_str(), value.c_str()) == CYBER_SUCCESS;
    }

    // ---- 通用黑板 XML 加载器(对齐新引擎 c4095297) ----
    // 语义:遍历顶层 <Blackboards><Blackboard...>,每个 <Blackboard> 灌一个 BlackboardDef 进 store;
    // 若某个 <Blackboard> 没写 scope 属性,按 defaultScope 归属;
    // 若整个文档就一坨 <Blackboard><Variable/>... 而没有 <Blackboards> 包装,
    // 则用调用方给的 generatedLocalBoardId / generatedLocalBoardName 合成一个 board(BT/FSM 局部黑板走此路径)。
    bool LoadBlackboardsFromXmlNode(const pugi::xml_node& root,
                                    BlackboardStore& store,
                                    BlackboardScope defaultScope,
                                    const std::string& generatedLocalBoardId,
                                    const std::string& generatedLocalBoardName,
                                    std::string* error)
    {
        // 优先走 <Blackboards> 包装(现代格式,含多板)。
        auto boards_container = root.child("Blackboards");
        if (!boards_container.empty())
        {
            for (const auto& board_node : boards_container.children("Blackboard"))
            {
                BlackboardDef board;
                board.id = board_node.attribute("id").as_string();
                board.name = board_node.attribute("name").as_string();
                const std::string scope_attr = board_node.attribute("scope").as_string();
                board.scope = scope_attr == "global" ? BlackboardScope::Global
                            : (scope_attr == "local" ? BlackboardScope::Local : defaultScope);
                board.linked = std::string(board_node.attribute("linked").as_string()) == "true";
                if (board.id.empty())
                {
                    if (error) *error = "Blackboard id is required.";
                    return false;
                }
                for (const auto& var_node : board_node.children("Variable"))
                {
                    BlackboardValue value;
                    value.id = var_node.attribute("id").as_string();
                    value.key = var_node.attribute("key").as_string();
                    value.type = var_node.attribute("type").as_string();
                    value.value = var_node.attribute("value").as_string();
                    if (value.id.empty() || value.key.empty())
                    {
                        if (error) *error = "Blackboard Variable id and key are required.";
                        return false;
                    }
                    board.variables[value.id] = value;
                }
                store.AddBlackboard(board);
            }
            return true;
        }

        // 兜底:根节点本身是 <Blackboards>(scenario 层 global_black_boards.xml 就是这种)。
        if (std::string(root.name()) == "Blackboards")
        {
            return LoadBlackboardsFromXmlNode(root.parent(), store, defaultScope, generatedLocalBoardId, generatedLocalBoardName, error)
                || [&]() {
                       // 双保险:直接把 root 当 blackboards_container 再来一次。
                       for (const auto& board_node : root.children("Blackboard"))
                       {
                           BlackboardDef board;
                           board.id = board_node.attribute("id").as_string();
                           board.name = board_node.attribute("name").as_string();
                           const std::string scope_attr = board_node.attribute("scope").as_string();
                           board.scope = scope_attr == "global" ? BlackboardScope::Global
                                       : (scope_attr == "local" ? BlackboardScope::Local : defaultScope);
                           if (board.id.empty()) continue;
                           for (const auto& var_node : board_node.children("Variable"))
                           {
                               BlackboardValue value;
                               value.id = var_node.attribute("id").as_string();
                               value.key = var_node.attribute("key").as_string();
                               value.type = var_node.attribute("type").as_string();
                               value.value = var_node.attribute("value").as_string();
                               if (value.id.empty() || value.key.empty()) continue;
                               board.variables[value.id] = value;
                           }
                           store.AddBlackboard(board);
                       }
                       return true;
                   }();
        }

        // 老格式兼容:根节点下直接有 <Blackboard><Variable/>...,没有 <Blackboards> 包装,
        // 合成一个 board 装载(BT/FSM 局部黑板走这条路)。
        auto legacy_boards = root.children("Blackboard");
        if (legacy_boards.begin() == legacy_boards.end())
        {
            return true; // 没有 <Blackboards>,也没有 <Blackboard>,视为空黑板集合,不当错误。
        }
        BlackboardDef board;
        board.id = generatedLocalBoardId;
        board.name = generatedLocalBoardName;
        board.scope = defaultScope;
        board.linked = false;
        for (const auto& board_node : legacy_boards)
        {
            for (const auto& var_node : board_node.children("Variable"))
            {
                BlackboardValue value;
                value.id = var_node.attribute("id").as_string();
                value.key = var_node.attribute("key").as_string();
                value.type = var_node.attribute("type").as_string();
                value.value = var_node.attribute("value").as_string();
                if (value.id.empty() || value.key.empty())
                {
                    if (error) *error = "Blackboard Variable id and key are required.";
                    return false;
                }
                board.variables[value.id] = value;
            }
        }
        if (!board.variables.empty())
        {
            store.AddBlackboard(board);
        }
        return true;
    }

    bool LoadBlackboardsFromXmlContent(const std::string& content,
                                       BlackboardStore& store,
                                       BlackboardScope defaultScope,
                                       std::string* error)
    {
        pugi::xml_document doc;
        const auto result = doc.load_buffer(content.data(), content.size());
        if (!result)
        {
            if (error) *error = std::string("Failed to parse blackboard XML: ") + result.description();
            return false;
        }
        // 顶层可能是 <Blackboards>(scenario 层 global_black_boards.xml 就是这样),
        // 也可能是任意包装(<Root>/<Workspace> 之类),这里直接把 document root 当入口交给 XmlNode 版。
        const std::string generatedId = "global_blackboards";
        const std::string generatedName = defaultScope == BlackboardScope::Global ? "全局黑板" : "局部黑板";
        return LoadBlackboardsFromXmlNode(doc, store, defaultScope, generatedId, generatedName, error);
    }

    const BlackboardValue* ResolveBlackboardBinding(const BlackboardStore& store,
                                                    BlackboardScope /*scope*/,
                                                    std::string& blackboardId,
                                                    const std::string& variableId,
                                                    std::string* error)
    {
        if (variableId.empty())
        {
            if (error) *error = "variableKey is empty";
            return nullptr;
        }
        // 若 blackboardId 明确,直接查;否则遍历 store 里所有 board 找同名 variableId 命中。
        if (!blackboardId.empty())
        {
            const auto* hit = store.Find(blackboardId, variableId);
            if (!hit && error) *error = "blackboard/variable not found: " + blackboardId + "/" + variableId;
            return hit;
        }
        for (const auto& bid : store.GetBoardIds())
        {
            const auto* hit = store.Find(bid, variableId);
            if (hit)
            {
                blackboardId = bid;
                return hit;
            }
        }
        if (error) *error = "variable not found in any board: " + variableId;
        return nullptr;
    }

    std::string SerializeBlackboardViews(const std::vector<BlackboardValueView>& views)
    {
        std::ostringstream out;
        out << "[";
        for (size_t index = 0; index < views.size(); ++index)
        {
            const auto& view = views[index];
            if (index != 0)
            {
                out << "; ";
            }
            out << "scope=" << view.scope
                << "|board=" << view.boardName
                << "|boardId=" << view.boardId
                << "|key=" << view.variableKey
                << "|varId=" << view.variableId
                << "|type=" << view.variableType
                << "|value=" << view.value;
        }
        out << "]";
        return out.str();
    }

    std::string SerializeMal(CyberMalImpl& mal)
    {
        std::ostringstream out;
        out << "[";
        bool first = true;
        for (CyberMargBaseImpl* marg = mal.GetFirstArgument(); marg; marg = mal.GetNextArgument(marg))
        {
            if (!first)
            {
                out << "; ";
            }
            first = false;
            const std::string value = MargToString(marg);
            out << "name=" << marg->GetName()
                << "|type=" << marg->GetType()
                << "|value=" << value
                << "|kv=" << marg->GetName() << "=" << value;
        }
        out << "]";
        return out.str();
    }

    std::string MargToString(CyberMargBaseImpl* marg)
    {
        if (!marg || !marg->GetValue())
        {
            return "";
        }

        std::ostringstream out;
        switch (marg->GetType())
        {
        case CYBER_MARGTYPE_BOOL:
            out << (*(static_cast<CyberBOOL*>(marg->GetValue())) == CYBER_TRUE ? "true" : "false");
            break;
        case CYBER_MARGTYPE_INTEGER:
            out << *(static_cast<CyberIntegerType*>(marg->GetValue()));
            break;
        case CYBER_MARGTYPE_REAL:
        case CYBER_MARGTYPE_JULIAN:
            out << *(static_cast<CyberRealType*>(marg->GetValue()));
            break;
        case CYBER_MARGTYPE_COORDINATE:
            {
                auto* coord = static_cast<CyberCoordinateType*>(marg->GetValue());
                out << coord->Lat << "," << coord->Lon;
            }
            break;
        case CYBER_MARGTYPE_NAME:
            {
                CyberNameType name;
                memset(name.data(), 0, sizeof(CyberNameType));
                memcpy(name.data(), marg->GetValue(), std::min(marg->GetSize(), sizeof(CyberNameType) - 1));
                out << name.data();
            }
            break;
        case CYBER_MARGTYPE_STRING:
        default:
            out << static_cast<const char*>(marg->GetValue());
            break;
        }
        return out.str();
    }

    BTTask::BTTask(BTNodeDefPtr node)
        : node_(node)
        , status_(BTStatus::Invalid)
        , parent_(nullptr)
    {
    }

    BTTask::~BTTask() = default;

    BTStatus BTTask::Tick(BTContext& context)
    {
        // Tick 是所有节点的统一生命周期入口：
        // 1. BeginTick：非 Running 节点触发 OnEnter；Running 节点跳过 OnEnter。
        // 2. Update：执行节点本帧逻辑。
        // 3. FinishTick：非 Running 触发 OnExit；Running 保持现场等待下一 tick。
        const BTStatus beforeStatus = status_;
        const bool wasRunning = IsRunning();
        if (!BeginTick(context))
        {
            return status_;
        }
        const bool entered = !wasRunning;
        ++tickCount_;
        ++updateCount_;
        const BTStatus nextStatus = Update(context);
        const BTStatus finishedStatus = FinishTick(context, nextStatus);
        const bool exited = finishedStatus != BTStatus::Running;
        if (node_)
        {
            PrintNodeSummary(context,
                             *node_,
                             tickCount_,
                             enterCount_,
                             updateCount_,
                             exitCount_,
                             entered,
                             exited,
                             beforeStatus,
                             finishedStatus);
        }
        return finishedStatus;
    }

    void BTTask::Reset()
    {
        // Reset 不调用 OnExit，也不做 Abort；它表示父节点准备让该子树从头开始。
        // Loop/Until 完成一次尝试后依赖这个行为让子节点下一轮重新 OnEnter。
        status_ = BTStatus::Invalid;
        tickCount_ = 0;
        enterCount_ = 0;
        updateCount_ = 0;
        exitCount_ = 0;
    }

    void BTTask::Abort(BTContext& context, BTStatus status)
    {
        if (IsRunning())
        {
            FinishTick(context, status);
            return;
        }
        status_ = status;
    }

    BTStatus BTTask::GetStatus() const
    {
        return status_;
    }

    BTNodeDefPtr BTTask::GetNode() const
    {
        return node_;
    }

    void BTTask::SetParent(BTTask* parent)
    {
        parent_ = parent;
    }

    BTTask* BTTask::GetParent() const
    {
        return parent_;
    }

    void BTTask::CollectRunning(std::vector<const BTTask*>& out) const
    {
        if (IsRunning())
        {
            out.push_back(this);
        }
    }

    bool BTTask::BeginTick(BTContext& context)
    {
        // Running 节点已经进入过，不重复 OnEnter。
        // 这条规则是行为树跨帧执行的核心：长动作不会每帧重新初始化输入/状态。
        if (IsRunning())
        {
            return true;
        }

        status_ = BTStatus::Invalid;
        if (!OnEnter(context))
        {
            FinishTick(context, BTStatus::Failure);
            return false;
        }
        return true;
    }

    BTStatus BTTask::FinishTick(BTContext& context, BTStatus nextStatus)
    {
        // 只有 Success/Failure 才退出节点。
        // Running 必须保留状态，父节点通过 activeChildIndex_/currentRunningTask_ 找回执行位置。
        status_ = nextStatus;
        if (!IsRunning())
        {
            OnExit(context, status_);
        }
        return status_;
    }

    bool BTTask::IsRunning() const
    {
        return status_ == BTStatus::Running;
    }

    bool BTTask::OnEnter(BTContext& context)
    {
        ++enterCount_;
        if (node_)
        {
            NotifyNodeLifecycle(context, *node_, FZ_BEHAVIOR_EVENT_TREE_ENTER, BTStatus::Running);
        }
        return true;
    }

    void BTTask::OnExit(BTContext& context, BTStatus status)
    {
        ++exitCount_;
        if (node_)
        {
            NotifyNodeLifecycle(context, *node_, FZ_BEHAVIOR_EVENT_TREE_EXIT, status);
        }
    }

    CompositeTask::CompositeTask(BTNodeDefPtr node)
        : BTTask(node)
        , activeChildIndex_(0)
        , currentRunningTask_(nullptr)
    {
    }

    void CompositeTask::AddChild(std::unique_ptr<BTTask> child)
    {
        if (child)
        {
            child->SetParent(this);
            children_.push_back(std::move(child));
        }
    }

    void CompositeTask::Reset()
    {
        // 复合节点 Reset 时必须递归 Reset 子节点，否则子节点可能保留上一轮 Running/计数状态，
        // 导致 Loop、Selector 重进时跳过 OnEnter 或从错误 childIndex 开始。
        BTTask::Reset();
        activeChildIndex_ = 0;
        currentRunningTask_ = nullptr;
        for (auto& child : children_)
        {
            child->Reset();
        }
    }

    void CompositeTask::Abort(BTContext& context, BTStatus status)
    {
        for (auto& child : children_)
        {
            child->Abort(context, status);
        }
        currentRunningTask_ = nullptr;
        BTTask::Abort(context, status);
    }

    void CompositeTask::CollectRunning(std::vector<const BTTask*>& out) const
    {
        BTTask::CollectRunning(out);
        for (const auto& child : children_)
        {
            child->CollectRunning(out);
        }
    }

    std::unique_ptr<BTTask> CreateTaskTree(BTNodeDefPtr node)
    {
        if (!node)
        {
            return std::unique_ptr<BTTask>();
        }

        std::unique_ptr<BTTask> task;
        switch (node->kind)
        {
        case BTNodeKind::Action:
            task.reset(new ActionTask(node));
            break;
        case BTNodeKind::Condition:
            task.reset(new ConditionTask(node));
            break;
        case BTNodeKind::Sequence:
            task.reset(new SequenceTask(node));
            break;
        case BTNodeKind::Selector:
            task.reset(new SelectorTask(node));
            break;
        case BTNodeKind::And:
            task.reset(new AndTask(node));
            break;
        case BTNodeKind::Or:
            task.reset(new OrTask(node));
            break;
        case BTNodeKind::Parallel:
            task.reset(new ParallelTask(node));
            break;
        case BTNodeKind::IfElse:
            task.reset(new IfElseTask(node));
            break;
        case BTNodeKind::MonitorBranch:
            task.reset(new MonitorBranchTask(node));
            break;
        case BTNodeKind::SelectMonitor:
            task.reset(new SelectMonitorTask(node));
            break;
        case BTNodeKind::Loop:
            task.reset(new LoopTask(node));
            break;
        case BTNodeKind::End:
            task.reset(new EndTask(node));
            break;
        case BTNodeKind::AlwaysSuccess:
            task.reset(new AlwaysSuccessTask(node));
            break;
        case BTNodeKind::AlwaysFailure:
            task.reset(new AlwaysFailureTask(node));
            break;
        case BTNodeKind::SuccessUntil:
            task.reset(new SuccessUntilTask(node));
            break;
        case BTNodeKind::FailureUntil:
            task.reset(new FailureUntilTask(node));
            break;
        case BTNodeKind::Invert:
            task.reset(new InvertTask(node));
            break;
        case BTNodeKind::ConditionTransform:
            task.reset(new ConditionTransformTask(node));
            break;
        case BTNodeKind::Subtree:
            task.reset(new SubtreeTask(node));
            break;
        case BTNodeKind::Null:
            task.reset(new NullTask(node));
            break;
        default:
            return std::unique_ptr<BTTask>();
        }

        if (auto* composite = dynamic_cast<CompositeTask*>(task.get()))
        {
            for (const auto& childDef : node->children)
            {
                composite->AddChild(CreateTaskTree(childDef));
            }
        }
        return task;
    }

    BehaviorTreeTask::BehaviorTreeTask(BehaviorTreeDefPtr def, BlackboardStore* globalBlackboards)
        : def_(def)
        , globalBlackboards_(globalBlackboards)
    {
        if (def_)
        {
            for (const auto& boardId : def_->blackboards.GetBoardIds())
            {
                const BlackboardDef* board = def_->blackboards.FindBlackboard(boardId);
                if (!board)
                {
                    continue;
                }
                if (board->scope == BlackboardScope::Global)
                {
                    if (globalBlackboards_ && !globalBlackboards_->HasBlackboard(board->id))
                    {
                        globalBlackboards_->AddBlackboard(*board);
                    }
                }
                else
                {
                    localBlackboards_.AddBlackboard(*board);
                }
            }
        }
    }

    bool BehaviorTreeTask::Initialize()
    {
        if (!def_ || !def_->root)
        {
            return false;
        }
        rootTask_ = CreateTaskTree(def_->root);
        return static_cast<bool>(rootTask_);
    }

    BTStatus BehaviorTreeTask::Tick(AgentPtr agent)
    {
        if (!rootTask_ && !Initialize())
        {
            return BTStatus::Failure;
        }
        BTContext context;
        context.agent = agent;
        context.treeTask = this;
        context.treeDef = def_;
        return rootTask_->Tick(context);
    }

    void BehaviorTreeTask::Reset()
    {
        if (rootTask_)
        {
            rootTask_->Reset();
        }
    }

    void BehaviorTreeTask::Abort(AgentPtr agent, BTStatus status)
    {
        if (!rootTask_)
        {
            return;
        }
        BTContext context;
        context.agent = agent;
        context.treeTask = this;
        context.treeDef = def_;
        rootTask_->Abort(context, status);
    }

    BlackboardStore& BehaviorTreeTask::LocalBlackboards()
    {
        return localBlackboards_;
    }

    const BlackboardStore& BehaviorTreeTask::LocalBlackboards() const
    {
        return localBlackboards_;
    }

    const BlackboardValue* BehaviorTreeTask::FindBlackboardValue(const std::string& boardId, const std::string& variableId) const
    {
        if (const BlackboardValue* value = localBlackboards_.Find(boardId, variableId))
        {
            return value;
        }
        return globalBlackboards_ ? globalBlackboards_->Find(boardId, variableId) : nullptr;
    }

    bool BehaviorTreeTask::SetBlackboardValue(const std::string& boardId, const std::string& variableId, const std::string& value)
    {
        if (localBlackboards_.SetRawValue(boardId, variableId, value))
        {
            return true;
        }
        return globalBlackboards_ ? globalBlackboards_->SetRawValue(boardId, variableId, value) : false;
    }

    std::vector<BlackboardValueView> BehaviorTreeTask::GetAllBlackboardValueViews() const
    {
        std::vector<BlackboardValueView> views = localBlackboards_.GetValueViews();
        if (globalBlackboards_ != nullptr)
        {
            std::vector<BlackboardValueView> globalViews = globalBlackboards_->GetValueViews();
            views.insert(views.end(), globalViews.begin(), globalViews.end());
        }
        return views;
    }

    std::vector<const BTTask*> BehaviorTreeTask::GetRunningNodes() const
    {
        std::vector<const BTTask*> nodes;
        if (rootTask_)
        {
            rootTask_->CollectRunning(nodes);
        }
        return nodes;
    }

    BehaviorTreeDefPtr BehaviorTreeTask::GetDef() const
    {
        return def_;
    }
}
