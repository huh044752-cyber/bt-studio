#pragma once

#include "FOSim/Engine/fz_engine_type.h"
#include "core/mal/fz_mal_impl.h"
#include <map>
#include <string>
#include <vector>

namespace BT
{
    enum class BlackboardScope
    {
        Global,
        Local
    };

    struct BlackboardValue
    {
        std::string id;
        std::string key;
        std::string type;
        std::string value;
    };

    struct BlackboardValueView
    {
        std::string scope;
        std::string boardId;
        std::string boardName;
        std::string variableId;
        std::string variableKey;
        std::string variableType;
        std::string value;
    };

    struct BlackboardDef
    {
        std::string id;
        std::string name;
        BlackboardScope scope = BlackboardScope::Local;
        bool linked = false;
        std::map<std::string, BlackboardValue> variables;
    };

    class BlackboardStore
    {
    public:
        void AddBlackboard(const BlackboardDef& board);
        bool HasBlackboard(const std::string& boardId) const;
        const BlackboardDef* FindBlackboard(const std::string& boardId) const;
        const BlackboardValue* Find(const std::string& boardId, const std::string& variableId) const;
        BlackboardValue* FindMutable(const std::string& boardId, const std::string& variableId);
        bool SetRawValue(const std::string& boardId, const std::string& variableId, const std::string& value);
        std::vector<std::string> GetBoardIds() const;
        std::vector<BlackboardValueView> GetValueViews() const;

    private:
        std::map<std::string, BlackboardDef> boards_;
    };

    bool AddValueToMal(FZMalImpl& mal, const std::string& name, const std::string& type, const std::string& value);
    std::string MargToString(FZMargBaseImpl* marg);
    std::string SerializeBlackboardViews(const std::vector<BlackboardValueView>& views);
    std::string SerializeMal(FZMalImpl& mal);
}
