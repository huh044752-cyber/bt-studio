#include "modules/extern/behavior_node_agent.h"
#include "modules/extern/bt_xml_loader.h"

namespace BT
{
    namespace
    {
        CyberDFMPFRC ToAgentFZStatus(BTStatus status)
        {
            // 行为树根节点的 Failure 只是“本轮没有选中成功路径”，不是运行时错误。
            // 只有空任务、解析失败等 Agent 显式设置的状态才进入 CYBER_DFMPFRC_ERROR。
            switch (status)
            {
            case BTStatus::Success:
            case BTStatus::Failure:
                return CYBER_DFMPFRC_SINGLE;
            case BTStatus::Running:
                return CYBER_DFMPFRC_CONTINUOUS;
            case BTStatus::Invalid:
            default:
                return CYBER_DFMPFRC_ERROR;
            }
        }
    }

    BehaviorNodeAgent::BehaviorNodeAgent(CyberSimulateGlobalPtr sim_global, ICyberUnit* unit_)
        : Agent(sim_global, unit_)
    {
        agent_type = FZ_BEHAVIOR_AGENT_TYPE_TREE;
    }

    BehaviorNodeAgent::~BehaviorNodeAgent()
    {
        tree_task_.reset();
        tree_def_.reset();
        current_status = CYBER_DFMPFRC_ERROR;
        sim_global_ = nullptr;
        shared_mal_.reset();
    }

    bool BehaviorNodeAgent::LoadBT()
    {
        return tree_task_ && tree_task_->Initialize();
    }

    void BehaviorNodeAgent::ExecNode()
    {
        if (mask)
        {
            return;
        }

        if (current_status != CYBER_DFMPFRC_CONTINUOUS)
        {
            return;
        }

        if (!tree_task_)
        {
            current_status = CYBER_DFMPFRC_ERROR;
            return;
        }
        const EngineTimeStamp current_master_time = sim_global_ ? sim_global_->master_time_ : 0;
        if (has_last_exec_master_time_ && last_exec_master_time_ == current_master_time)
        {
            return;
        }
        has_last_exec_master_time_ = true;
        last_exec_master_time_ = current_master_time;

        // Agent 层只负责把当前 unit 上下文交给行为树运行时。
        // 节点生命周期、running 路径恢复、黑板读写和 observer 通知都在 BehaviorTreeTask / BTTask 内部完成。
        current_status = ToAgentFZStatus(tree_task_->Tick(shared_from_this()));
    }

    void BehaviorNodeAgent::Reset()
    {
        current_status = CYBER_DFMPFRC_CONTINUOUS;
        has_last_exec_master_time_ = false;
        last_exec_master_time_ = 0;
        if (tree_task_)
        {
            tree_task_->Reset();
        }
    }

    void BehaviorNodeAgent::Pause()
    {
        mask = true;
    }

    bool BehaviorNodeAgent::LoadByNode(const pugi::xml_node& node)
    {
        if (node.empty())
        {
            return false;
        }

        BTXmlLoader loader;
        std::string error;
        tree_def_ = loader.LoadFromRoot(node, &error);
        if (!tree_def_)
        {
            LogError(error.c_str());
            return false;
        }

        cognition_name = tree_def_->cognition;

        tree_task_.reset(new BehaviorTreeTask(tree_def_, sim_global_ ? &sim_global_->behavior_global_blackboards_ : nullptr));
        if (!tree_task_->Initialize())
        {
            LogError("Failed to initialize behavior tree task.");
            return false;
        }

        // 到这里为止，Agent 已经拥有静态定义和该 unit 独享的运行态任务。
        // 真正逐帧推进仍需等待仿真主循环里的 ExecNode() 周期性调用。
        node_ = node;
        current_status = CYBER_DFMPFRC_CONTINUOUS;
        has_last_exec_master_time_ = false;
        last_exec_master_time_ = 0;
        return true;
    }

    bool BehaviorNodeAgent::Load()
    {
        return LoadBT();
    }

    bool BehaviorNodeAgent::LoadByContent(const std::string& content)
    {
        if (content.empty())
        {
            return false;
        }

        pugi::xml_document doc;
        auto result = doc.load_string(content.c_str());
        if (!result)
        {
            LogError(("Failed to load behavior tree XML: " + std::string(result.description())).c_str());
            return false;
        }
        return LoadByNode(doc.child("Root"));
    }

    std::vector<const BTTask*> BehaviorNodeAgent::GetRunningNodes() const
    {
        return tree_task_ ? tree_task_->GetRunningNodes() : std::vector<const BTTask*>();
    }
}
