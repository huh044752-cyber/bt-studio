// btsdk/mal_bridge.h
// BT Studio 运行时 SDK —— MAL 桥接接口(C++17,接口骨架)。
//
// 设计原则(对应总设计文档 §6.0.2):
//  - 前端/编辑器不直接操作 FZMalImpl;所有 MAL 构造、读取、序列化都放在此桥接层之后。
//  - 接入真实 FOSim 时,在 .cpp 中包含 fz_enum_type.h / fz_mal_impl.h 并实现本接口,
//    优先复用 BT::AddValueToMal(FZMalImpl&, name, type, value);复杂类型再调用具体 FZMalImpl::AddXxx。
//  - 读取调试值时复用 BT::MargToString / BT::SerializeMal。
//
// 本头文件不依赖 FOSimEngine,可被独立插件与 FOSim 内部工程共同引用,避免两套类型漂移。
#pragma once

#include <string>
#include <cstdint>

namespace btsdk {

// 与 FOSim FZMARGType 对齐的子集(完整集合见 fz_enum_type.h)。
// 这里只声明编辑器/运行时绑定需要的稳定标识,不复制引擎内部数值。
enum class MalType : std::int32_t {
    Invalid = 0,
    Bool,
    Name,
    UnitId,
    EquipmentId,
    EntityId,
    TrackId,
    InterId,
    FeatureId,
    Record,
    Coordinate,
    Julian,
    Real,
    Integer,
    Position,
    Vector,
    Orientation,
    Mal,
    String,
    TaskIdList,
};

// MAL 参数包桥接。实现类在内部持有 FZMalImpl。
class IMalBridge {
public:
    virtual ~IMalBridge() = default;

    // 按 (name, type, valueLiteral) 追加一个 MAL 字段。
    // valueLiteral 是设计态保存的字符串值(valueFormat=literal),由实现转换为对应 MAL 值。
    // 返回 false 表示转换失败(类型不匹配 / 值非法),调用方应阻断运行。
    virtual bool addValue(const std::string& name, MalType type, const std::string& valueLiteral) = 0;

    // 读取输出 MAL 中某字段并序列化为字符串(用于调试展示与比较)。
    // 字段不存在时返回 false。
    virtual bool readField(const std::string& name, std::string& outSerialized) const = 0;

    // 整个 MAL 序列化为可读字符串(调试用)。
    virtual std::string serialize() const = 0;

    // 清空。
    virtual void clear() = 0;
};

}  // namespace btsdk
