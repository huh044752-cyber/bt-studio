#include "modules/extern/agent.h"
#include "core/logging/runtime_summary_log.h"
#include "core/inter/fz_public_decision_inter_router_impl.h"
#include "models/equipment/fz_equipment_impl.h"
#include "modules/manager/fz_concrete_entity_manager_impl.h"
#include "modules/manager/fz_entity_manager_impl.h"
#include "modules/simulation/fz_entity_sim_impl.h"
#include "modules/unit/fz_unit_impl.h"
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

        bool ModelTypeMatches(FZMountModelImpl* model, const std::string& modelType)
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

        bool MatchesModelSelector(FZMountModelImpl* model, const ModelSelector& selector)
        {
            if (!model)
            {
                return false;
            }
            if (!selector.componentId.empty() && model->GetComponentUUID() != selector.componentId)
            {
                return false;
            }
            const auto& componentType = SelectorComponentType(selector);
            const auto& componentName = SelectorComponentName(selector);
            const auto& componentClass = SelectorComponentClass(selector);
            if (!ModelTypeMatches(model, componentType))
            {
                return false;
            }
            // componentId 是 Unit 内装配实例的稳定身份。新格式 XML 可同时带
            // mdataName 作为显示/旧工具字段；当 componentId 已命中时，不再用
            // mdataName 继续过滤，避免“模板显示名”和“运行态装配名”不一致导致误拒。
            if (selector.componentId.empty() &&
                !componentName.empty() &&
                !EqualsCString(model->GetEntityName(), componentName) &&
                model->GetAliasName() != componentName)
            {
                return false;
            }
            if (!componentClass.empty() &&
                !EqualsCString(model->GetClassName(), componentClass) &&
                model->IsClass(componentClass) != FZ_TRUE &&
                model->SupportsInterface(componentClass) != FZ_TRUE)
            {
                return false;
            }
            return true;
        }
    }

    Agent::Agent(FZSimulateGlobalPtr sim_global, IFZUnit* unit_)
        : sim_global_(sim_global)
        , unit(unit_)
        , shared_mal_(std::make_shared<FZMalImpl>())
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

    IFZUnit* Agent::GetUnit()
    {
        return unit;
    }

    FZSimulateGlobalPtr Agent::GetSimGlobal() const
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

    FZDFMPFRC Agent::GetCurrentStatus() const
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

        auto* unit_impl = dynamic_cast<FZUnitImpl*>(unit);
        const auto cognition_snapshot = unit_impl ? std::vector<FZCognitionImpl*>() : unit->GetCognitionList();
        const auto equipment_snapshot = unit_impl ? std::vector<FZEquipmentImpl*>() : unit->GetEquipmentList();
        const auto& cognitions = unit_impl ? unit_impl->GetCognitionRefs() : cognition_snapshot;
        const auto& equipments = unit_impl ? unit_impl->GetEquipmentRefs() : equipment_snapshot;
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
            std::vector<MountModel*> matches;
            if (sim_global_ && sim_global_->concrete_mgr_ && unit)
            {
                if (!selector.componentId.empty())
                {
                    if (auto* model = sim_global_->concrete_mgr_->GetMountedModelByComponentUUID(unit, selector.componentId))
                    {
                        if (MatchesModelSelector(model, selector))
                        {
                            matches.push_back(model);
                        }
                    }
                    return matches;
                }
                const auto& componentName = SelectorComponentName(selector);
                const auto& componentClass = SelectorComponentClass(selector);
            const auto& componentType = SelectorComponentType(selector);
            if (!componentName.empty())
            {
                // 名称在 unit 内通常唯一，优先利用 concrete manager 索引加速。
                if (auto* model = sim_global_->concrete_mgr_->GetMountedModelByName(unit, componentName))
                {
                    if (MatchesModelSelector(model, selector))
                    {
                        matches.push_back(model);
                    }
                }
                return matches;
            }
            if (!componentClass.empty())
            {
                // 类名可能匹配多个组件实例，需要继续按 selector 精确过滤。
                auto classMatches = sim_global_->concrete_mgr_->GetMountedModelsByClass(unit, componentClass, componentType);
                for (auto* model : classMatches)
                {
                    if (MatchesModelSelector(model, selector))
                    {
                        matches.push_back(model);
                    }
                }
                return matches;
            }
        }
        for (auto* model : GetMountedModels())
        {
            if (MatchesModelSelector(model, selector))
            {
                matches.push_back(model);
            }
        }
        return matches;
    }

    FZDFMPFRC Agent::SycExecFZDecisionFunc(FZDecisionProprity* decision, FZMountModelImpl* model)
    {
        if (model && decision && decision->func_ptr)
        {
            return (model->*CastTo(decision->func_ptr))(decision->mal, shared_mal_.get());
        }
        return FZ_DFMPFRC_UNKNOWN;
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
