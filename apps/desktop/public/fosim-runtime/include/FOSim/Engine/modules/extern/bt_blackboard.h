#pragma once

#include "FOSim/Engine/cyber_enum_type.h"
#include "core/mal/cyber_mal_impl.h"
#include "pugi/pugixml.hpp"
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

    bool AddValueToMal(CyberMalImpl& mal, const std::string& name, const std::string& type, const std::string& value);

    // 通用黑板 XML 加载器(对齐新引擎 c4095297)。
    // - LoadBlackboardsFromXmlNode:从任意 <Blackboards><Blackboard...>...</Blackboard></Blackboards> 结构灌入 store。
    //   defaultScope 决定未标 scope 属性时按 Local 还是 Global 归属。
    // - LoadBlackboardsFromXmlContent:从字符串解析后走 XmlNode 路径,用于 scenario 层 global_black_boards.xml。
    // - ResolveBlackboardBinding:按 (scope, blackboardId, variableId) 在 store 里找绑定;
    //   给 loader 用于 <Input source="local|global"> / <Output source="local|global"> 的一致 resolve。
    bool LoadBlackboardsFromXmlNode(const pugi::xml_node& root,
                                    BlackboardStore& store,
                                    BlackboardScope defaultScope,
                                    const std::string& generatedLocalBoardId,
                                    const std::string& generatedLocalBoardName,
                                    std::string* error = nullptr);
    bool LoadBlackboardsFromXmlContent(const std::string& content,
                                       BlackboardStore& store,
                                       BlackboardScope defaultScope,
                                       std::string* error = nullptr);
    const BlackboardValue* ResolveBlackboardBinding(const BlackboardStore& store,
                                                    BlackboardScope scope,
                                                    std::string& blackboardId,
                                                    const std::string& variableId,
                                                    std::string* error = nullptr);
    std::string MargToString(CyberMargBaseImpl* marg);
    std::string SerializeBlackboardViews(const std::vector<BlackboardValueView>& views);
    std::string SerializeMal(CyberMalImpl& mal);
}
