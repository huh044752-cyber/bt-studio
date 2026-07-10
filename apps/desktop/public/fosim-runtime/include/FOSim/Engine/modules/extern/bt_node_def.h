#pragma once

#include "modules/extern/bt_blackboard.h"
#include <memory>
#include <string>
#include <vector>

namespace BT
{
    // 运行时节点角色，避免 Tick 过程中重复按 XML 字符串做分派。
    enum class BTNodeKind
    {
        Action,
        Condition,
        Sequence,
        Selector,
        // And/Or 保留为独立节点类型，而不是简单别名到 Sequence/Selector。
        // 这样文档、脚本和 trace 都可以直接表达“逻辑与/逻辑或”语义名。
        And,
        Or,
        Parallel,
        // IfElse/MonitorBranch/SelectMonitor 是条件驱动型控制节点。
        // 它们和普通 Sequence/Selector 的区别在于：
        // - 会固定解释子节点槽位含义
        // - 会在 Running 期间保留当前分支
        // - 会把“条件是否通过”作为控制流入口，而不是普通成功/失败组合
        IfElse,
        MonitorBranch,
        SelectMonitor,
        Loop,
        End,
        AlwaysSuccess,
        AlwaysFailure,
        SuccessUntil,
        FailureUntil,
        Invert,
        // ConditionTransform 仍然执行决策函数，但语义上明确是“条件型变换节点”。
        ConditionTransform,
        // Subtree 表示加载另一棵行为树作为子树执行。
        Subtree,
        // Null 是显式空节点，用于占位或在导出资源中表达恒定返回值。
        Null,
        Unknown
    };

    // 输入参数来源：常量直接写入，Blackboard 由运行时按 boardId/variableId 取值。
    enum class InputSource
    {
        Constant,
        Blackboard
    };

    // InputBinding 描述一个输入字段如何写入 MAL。
    struct InputBinding
    {
        std::string name;
        std::string type;
        std::string value;
        InputSource source = InputSource::Constant;
        std::string blackboardId;
        std::string variableId;
    };

    // OutputBinding 描述执行后需要同步回黑板的输出字段。
    struct OutputBinding
    {
        std::string name;
        std::string blackboardId;
        std::string variableId;
    };

    // ModelSelector 是行为树/状态机节点对“已装配组件”的选择条件。
    // cognition 仅保留为 XML 根/日志描述字段，不参与运行时克隆或匹配。
    struct ModelSelector
    {
        std::string cognition;
        std::string modelName;
        std::string modelClass;
        std::string modelType;
        std::string componentId;
        std::string componentName;
        std::string componentClass;
        std::string componentType;
    };

    // BTNodeDef 是 XML Loader 产出的标准节点定义，任务树直接消费这里的结构。
    struct BTNodeDef
    {
        int id = 0;
        std::string xmlType;
        std::string name;
        std::string functionName;
        std::string behaviorTreeName;
        std::string behaviorTreeTemplateId;
        std::string behaviorTreeInstanceId;
        std::string paramStates;
        BTNodeKind kind = BTNodeKind::Unknown;
        ModelSelector target;
        bool captureInputOnEnter = false;

        // loop/parallel 相关参数只对对应 kind 生效，其它节点保持默认值即可。
        // Loop/Until 的正式语义是每次根 tick 最多推进一次子节点；如果根返回 Running，
        // 后续尝试必须由下一帧再次驱动，不允许在同一帧内部自旋。
        int loopCount = 1;
        bool endStatusSuccess = true;
        bool endExternalTree = false;

        unsigned int parallelSuccessThreshold = 0;
        unsigned int parallelFailureThreshold = 0;

        // Condition compare:
        // - Function: 函数返回值直接决定条件真假。
        // - Output: 先要求函数执行成功，再用指定输出字段比较最终真假。
        //   输出字段不存在或比较符非法都必须失败，不能用默认 0 继续比较。
        std::string compareType;
        std::string compareOutputName;
        std::string compareOp;
        std::string compareValue;

        std::vector<InputBinding> inputs;
        std::vector<OutputBinding> outputs;
        std::vector<std::shared_ptr<BTNodeDef>> children;
    };

    typedef std::shared_ptr<BTNodeDef> BTNodeDefPtr;
}
