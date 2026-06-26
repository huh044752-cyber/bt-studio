#pragma once

#include "modules/extern/agent.h"
#include "modules/extern/bt_tree_task.h"

namespace BT
{
    // BehaviorNodeAgent 挂载一棵解析后的行为树，并把 Tick/Reset/Pause 生命周期映射到 Agent 体系。
    // 它本身不解释节点语义，真正的节点推进在 BehaviorTreeTask / BTTask 内部完成；
    // Agent 这一层主要负责：
    // - 持有当前 unit 上下文
    // - 装载 XML/内容得到静态定义
    // - 对外暴露统一的 ExecNode/Reset/Pause 入口
    class BehaviorNodeAgent : public Agent
    {
    public:
        BehaviorNodeAgent(FZSimulateGlobalPtr sim_global, IFZUnit* unit_);
        ~BehaviorNodeAgent();
        BehaviorNodeAgent() = delete;

        bool LoadByNode(const pugi::xml_node& node) override;
        bool LoadByContent(const std::string& content) override;
        // 初始化行为树任务。
        bool Load();
        bool LoadBT();
        void ExecNode();
        void Reset();
        void Pause();
        // 主要供测试和调试查看当前 Running 链路。
        std::vector<const BTTask*> GetRunningNodes() const;

    private:
        BehaviorTreeDefPtr tree_def_;
        std::shared_ptr<BehaviorTreeTask> tree_task_;
        bool has_last_exec_master_time_ = false;
        EngineTimeStamp last_exec_master_time_ = 0;
    };
}
