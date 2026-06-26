#pragma once

#include "FOSim/Engine/IFZBehaviorOberver.h"
#include "core/logging/runtime_summary_log.h"
#include "FOSim/Engine/fz_engine_type.h"
#include "core/mal/fz_mal_impl.h"
#include "models/cognition/fz_cognition_impl.h"
#include "models/mount_model/fz_mount_model_impl.h"
#include "modules/extern/bt_node_def.h"
#include "modules/manager/fz_simulate_global.h"
#include "modules/structs/model_function.h"
#include "pugi/pugixml.hpp"
#include <memory>
#include <string>
#include <vector>

namespace BT
{
    class Agent;
    class BehaviorNodeAgent;
    class StateMachineAgent;

    using AgentPtr = std::shared_ptr<Agent>;
    using BehaviacAgentPtr = std::shared_ptr<BehaviorNodeAgent>;
    using MalPtr = std::shared_ptr<FZMalImpl>;
    using MountModel = FZMountModelImpl;

    // Agent 是行为树和状态机共享的运行时宿主。
    // 它不是具体决策逻辑本身，而是给 BT / SM runtime 提供统一的：
    // - unit 上下文
    // - sim_global 访问
    // - 组件解析入口
    // - observer/log 输出
    // - 共享 MAL
    //
    // 可以把它理解成“决策系统眼中的当前单位执行上下文”。
    class Agent : public std::enable_shared_from_this<Agent>
    {
        friend class BehaviorNodeAgent;
        friend class StateMachineAgent;

    protected:
        // 定长 observer 载荷，保证 Demo/回归侧可以稳定解析，不依赖复杂对象跨边界传递。
        // 这里刻意不直接跨边界传递复杂运行时对象，避免观察链意外持有内部裸指针。
        struct AgentData
        {
            char unit_name[64];
            int agent_type;
            char root_name[64];
            char _entity_name[64];
            char node_name[64];
            int node_type;
            char phase_name[32];
            char detail[4096];

            AgentData()
            {
                memset(this, 0, sizeof(AgentData));
            }
        };

        FZSimulateGlobalPtr sim_global_ = nullptr;
        IFZUnit* unit = nullptr;
        pugi::xml_node node_;
        std::string name;
        uint32_t mask = 0;
        AgentData agent_data;
        int agent_type = 0;
        FZDFMPFRC current_status = FZ_DFMPFRC_CONTINUOUS;
        std::string cognition_name;
        MountModel* cogination_ = nullptr;
        MalPtr shared_mal_;

    public:
        Agent(FZSimulateGlobalPtr sim_global, IFZUnit* unit_);
        virtual ~Agent();

        // 运行时上下文访问。
        IFZUnit* GetUnit();
        FZSimulateGlobalPtr GetSimGlobal() const;
        void LogError(const char* msg);

        // 基本标识和调度状态。
        std::string GetName();
        void SetName(const std::string& name_);
        int GetMask();
        void SetMask(uint32_t mask_);
        FZDFMPFRC GetCurrentStatus() const;

        // 默认认知模型与共享 MAL 访问。
        std::string& GetCogName();
        virtual MountModel* GetModel();
        void SetModel(MountModel* cogination);
        MalPtr GetSharedMalPtr();

        // 返回当前 Unit 已装配的全部行为树/状态机可调用组件快照。
        std::vector<MountModel*> GetMountedModels() const;
        // 按 componentId / mdataName / className / typeName 查询当前 Unit 的已装配组件。
        std::vector<MountModel*> GetMountedModels(const ModelSelector& selector) const;
        FZDFMPFRC SycExecFZDecisionFunc(FZDecisionProprity* decision, FZMountModelImpl* model);
        // NotifyBehavior 发轻量事件；NotifyBehaviorDetail 追加黑板与 MAL 快照细节。
        bool HasBehaviorObserver() const;
        bool HasBehaviorTraceSink() const
        {
            return HasBehaviorObserver() || fosim::runtime::HasRuntimeLogFile();
        }
        void NotifyBehavior(const std::string& id, const std::string& entity_name, int type);
        void NotifyBehaviorDetail(const std::string& id,
                                  const std::string& entity_name,
                                  int type,
                                  const std::string& phase_name,
                                  const std::string& detail);

        virtual bool LoadByContent(const std::string& content) = 0;
        virtual bool LoadByNode(const pugi::xml_node& node) = 0;
    };
}
