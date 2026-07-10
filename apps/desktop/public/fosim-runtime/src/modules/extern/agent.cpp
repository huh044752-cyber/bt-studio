#include "modules/extern/agent.h"
#include "core/logging/runtime_summary_log.h"
#include "core/inter/cyber_public_decision_inter_router_impl.h"
#include "models/equipment/cyber_equipment_impl.h"
#include "modules/manager/cyber_concrete_entity_manager_impl.h"
#include "modules/manager/cyber_entity_manager_impl.h"
#include "modules/simulation/cyber_entity_sim_impl.h"
#include "modules/unit/cyber_unit_impl.h"
#include <cstdio>
#include <sstream>

namespace BT
{
    namespace
    {
        const char* AgentTypeName(int agent_type)
        {
            switch (agent_type)
            {
            case FZ_BEHAVIOR_AGENT_TYPE_TREE:
                return "BehaviorTree";
            case FZ_BEHAVIOR_AGENT_TYPE_STATE_MACHINE:
                return "StateMachine";
            default:
                return "Unknown";
            }
        }

        // 选择器里混合 C 字符串和 std::string，这里集中处理空指针与等值判断。
        bool EqualsCString(const char* lhs, const std::string& rhs)
        {
            return lhs != nullptr && rhs == lhs;
        }

        bool ModelTypeMatches(CyberMountModelImpl* model, const std::string& modelType)
        {
            if (!model || modelType.empty())
            {
                return true;
            }

            const auto type = model->GetEntityType();
            if (modelType == "Cognition")
            {
                return type.isCognition();
            }
            if (modelType == "Equipment")
            {
                return type.isEquipment();
            }
            if (modelType == "Jammer" || modelType == "Jammers")
            {
                return type.data() == FOSimEntityType::EQUIPMENT_JAMMER;
            }
            if (modelType == "Sensor" || modelType == "Sensors")
            {
                return type.data() == FOSimEntityType::EQUIPMENT_SENSOR;
            }
            if (modelType == "ComDevice" || modelType == "ComDevices")
            {
                return type.data() == FOSimEntityType::EQUIPMENT_COMDEVICE;
            }
            if (modelType == "WeaponSystem" || modelType == "WeaponSystems")
            {
                return type.data() == FOSimEntityType::EQUIPMENT_WEAPONSYSTEM;
            }
            if (modelType == "Platform" || modelType == "Platforms")
            {
                return type.data() == FOSimEntityType::EQUIPMENT_PLATFORM;
            }
            if (modelType == "Munition" || modelType == "Munitions")
            {
                return type.data() == FOSimEntityType::EQUIPMENT_MUNITION;
            }
            if (modelType == "DataProcessor" || modelType == "DataProcessors")
            {
                return type.data() == FOSimEntityType::EQUIPMENT_DATAPROCESSOR;
            }
            if (modelType == "SubSystem" || modelType == "SubSystems")
            {
                return type.data() == FOSimEntityType::EQUIPMENT_SUBSYSTEM;
            }
            return false;
        }

        const std::string& SelectorComponentName(const ModelSelector& selector)
        {
            return selector.componentName.empty() ? selector.modelName : selector.componentName;
        }

        const std::string& SelectorComponentClass(const ModelSelector& selector)
        {
            return selector.componentClass.empty() ? selector.modelClass : selector.componentClass;
        }

        const std::string& SelectorComponentType(const ModelSelector& selector)
        {
            return selector.componentType.empty() ? selector.modelType : selector.componentType;
        }

        bool MatchesModelSelector(CyberMountModelImpl* model, const ModelSelector& selector)
        {
            if (!model)
            {
                return false;
            }
            // 旧版无 GetComponentUUID，componentId 维度无法精确匹配，按其它维度过滤。
            const auto& componentType = SelectorComponentType(selector);
            const auto& componentName = SelectorComponentName(selector);
            const auto& componentClass = SelectorComponentClass(selector);
            if (!ModelTypeMatches(model, componentType))
            {
                return false;
            }
            if (!componentName.empty() &&
                !EqualsCString(model->GetEntityName(), componentName) &&
                model->GetAliasName() != componentName)
            {
                return false;
            }
            if (!componentClass.empty() &&
                !EqualsCString(model->GetClassName(), componentClass) &&
                model->IsClass(componentClass) != CYBER_TRUE &&
                model->SupportsInterface(componentClass) != CYBER_TRUE)
            {
                return false;
            }
            return true;
        }
    }

    Agent::Agent(CyberSimulateGlobalPtr sim_global, ICyberUnit* unit_)
        : sim_global_(sim_global)
        , unit(unit_)
        , shared_mal_(std::make_shared<CyberMalImpl>())
    {
    }

    Agent::~Agent() = default;

    void Agent::SetName(const std::string& name_)
    {
        name = name_;
    }

    std::string Agent::GetName()
    {
        return name;
    }

    ICyberUnit* Agent::GetUnit()
    {
        return unit;
    }

    CyberSimulateGlobalPtr Agent::GetSimGlobal() const
    {
        return sim_global_;
    }

    void Agent::LogError(const char* msg)
    {
        if (!msg)
        {
            return;
        }
        FOSIM_LOG_ERROR("BehaviorTree", "BT_AGENT_ERROR", [&]() {
            return std::string(" agent=") + name + " detail=" + msg;
        });
    }

    void Agent::SetMask(uint32_t mask_)
    {
        mask = mask_;
    }

    int Agent::GetMask()
    {
        return mask;
    }

    CyberDFMPFRC Agent::GetCurrentStatus() const
    {
        return current_status;
    }

    void Agent::SetModel(MountModel* cogination)
    {
        cogination_ = cogination;
    }

    MountModel* Agent::GetModel()
    {
        return cogination_;
    }

    std::string& Agent::GetCogName()
    {
        return cognition_name;
    }

    Cognition* Agent::EmployCog(const char* cognition_name_)
    {
        if (!cognition_name_ || !unit)
        {
            return nullptr;
        }
        auto cog = unit->GetCognitionByName(cognition_name_);
        if (cog)
        {
            return cog;
        }
        if (!sim_global_ || !sim_global_->component_mgr_)
        {
            return nullptr;
        }
        auto* component = sim_global_->component_mgr_->GetComponentByClassNameAndType(cognition_name_, "Cognition");
        if (!component)
        {
            return nullptr;
        }
        CyberEntityImpl* model = component->CloneEntity(unit);
        if (!model)
        {
            return nullptr;
        }
        this->cognition_name = cognition_name_;
        model->SetSimulationGlobal(sim_global_);
        model->SetEntityName(cognition_name_);
        if (!unit->EmployModel(dynamic_cast<CyberMountModelImpl*>(model), false))
        {
            delete model;
            return nullptr;
        }
        return dynamic_cast<Cognition*>(model);
    }

    MalPtr Agent::GetSharedMalPtr()
    {
        return shared_mal_;
    }

    std::vector<MountModel*> Agent::GetMountedModels() const
    {
        std::vector<MountModel*> models;
        if (!unit)
        {
            return models;
        }

        // 旧版 SafeVector 不提供 begin/end，统一用 get() 拿底层 std::vector 再遍历。
        auto& cognitions = unit->GetCognitionList().get();
        auto& equipments = unit->GetEquipmentList().get();
        models.reserve(cognitions.size() + equipments.size());
        for (auto* cognition : cognitions)
        {
            if (cognition)
            {
                models.push_back(cognition);
            }
        }

        for (auto* equipment : equipments)
        {
            if (auto* model = dynamic_cast<MountModel*>(equipment))
            {
                models.push_back(model);
            }
        }
        return models;
    }

        std::vector<MountModel*> Agent::GetMountedModels(const ModelSelector& selector) const
        {
            // 旧版 concrete manager 无 ByComponentUUID/ByName/ByClass 索引接口，
            // 统一退回全量装配快照 + selector 过滤的慢路径。
            std::vector<MountModel*> matches;
            for (auto* model : GetMountedModels())
            {
                if (MatchesModelSelector(model, selector))
                {
                    matches.push_back(model);
                }
            }
            return matches;
        }

    CyberDFMPFRC Agent::SycExecFZDecisionFunc(FZDecisionProprity* decision, CyberMountModelImpl* model)
    {
        if (model && decision && decision->func_ptr)
        {
            return (model->*CastTo(decision->func_ptr))(decision->mal, shared_mal_.get());
        }
        return CYBER_DFMPFRC_UNKNOWN;
    }

void Agent::NotifyBehavior(const std::string& id, const std::string& entity_name, int type)
{
    NotifyBehaviorDetail(id, entity_name, type, "", "");
}

bool Agent::HasBehaviorObserver() const
{
    return sim_global_ && sim_global_->concrete_mgr_ && sim_global_->concrete_mgr_->GetBehaviorOberver();
}

void Agent::NotifyBehaviorDetail(const std::string& id,
                                 const std::string& entity_name,
                                 int type,
                                     const std::string& phase_name,
                                     const std::string& detail)
    {
        // observer 载荷统一在这里收口，保证行为事件和黑板快照走同一稳定出口。
        agent_data.agent_type = agent_type;
        agent_data.node_type = type;
        snprintf(agent_data.unit_name, sizeof(agent_data.unit_name), "%s", unit ? unit->GetUnitName().c_str() : "");
        snprintf(agent_data._entity_name, sizeof(agent_data._entity_name), "%s", entity_name.c_str());
        snprintf(agent_data.node_name, sizeof(agent_data.node_name), "%s", id.c_str());
        snprintf(agent_data.root_name, sizeof(agent_data.root_name), "%s", name.c_str());
        snprintf(agent_data.phase_name, sizeof(agent_data.phase_name), "%s", phase_name.c_str());
        snprintf(agent_data.detail, sizeof(agent_data.detail), "%s", detail.c_str());

        if (sim_global_ && fosim::runtime::HasRuntimeLogFile())
        {
            std::ostringstream trace;
            if (agent_data.phase_name[0] != 0)
            {
                trace << "[BehaviorBlackboard]"
                      << " time=" << sim_global_->master_time_
                      << ", runtime=" << AgentTypeName(agent_data.agent_type)
                      << ", unit=" << agent_data.unit_name
                      << ", root=" << agent_data.root_name
                      << ", cognition=" << agent_data._entity_name
                      << ", node=" << agent_data.node_name
                      << ", phase=" << agent_data.phase_name
                      << ", detail=" << agent_data.detail;
            }
            else
            {
                trace << "[Behavior]"
                      << " time=" << sim_global_->master_time_
                      << ", runtime=" << AgentTypeName(agent_data.agent_type)
                      << ", unit=" << agent_data.unit_name
                      << ", root=" << agent_data.root_name
                      << ", cognition=" << agent_data._entity_name
                      << ", node=" << agent_data.node_name
                      << ", eventType=" << agent_data.node_type;
            }
            FOSIM_LOG_DEBUG("BehaviorTree", "BEHAVIOR_TRACE", [&]() {
                return trace.str();
            });
        }

        if (!sim_global_ || !sim_global_->concrete_mgr_)
        {
            return;
        }
        if (auto obs = sim_global_->concrete_mgr_->GetBehaviorOberver())
        {
            obs->NotifyBehavior(sim_global_->master_time_, &agent_data, sizeof(agent_data));
        }
    }
}
