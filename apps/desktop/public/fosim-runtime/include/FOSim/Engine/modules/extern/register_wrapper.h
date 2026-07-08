#pragma once

#include "FOSim/Engine/cyber_engine_type.h"
// 旧版各 inter 实现历来通过本头间接获得 CastTo / RandomInteger 等仿真工具，
// 这里保持该传递依赖，避免 18 个 inter 源文件逐个补 include。
#include "modules/simulation/cyber_entity_sim_impl.h"
#include <functional>
#include <map>
#include <string>

// Inter 注册工厂使用统一的“类名 -> 创建函数”映射。
// 这里不负责对象生命周期，创建出来的对象由调用方接管并释放。
typedef void* (*PTRCreateObject)(void);

class FOSIMENGINE_API ClassFactory
{
private:
    ClassFactory() = default;

public:
    void* getClassByName(const std::string& className);
    void registClass(const std::string& name, PTRCreateObject method);
    static ClassFactory& getInstance();
};

class FOSIMENGINE_API Register
{
public:
    Register(const std::string& className, PTRCreateObject ptrCreateFn);
};

// 统一的 Inter 注册宏。
// 所有实现文件都采用同一布局：
// 1. include
// 2. REGISTERINTER(ClassName)
// 3. static const / namespace helper
// 4. 类实现
#define REGISTERINTER_NAMED(className, registeredName)                               \
    namespace                                                                        \
    {                                                                                \
        className* CreateRegisteredInter_##className()                               \
        {                                                                            \
            return new className();                                                  \
        }                                                                            \
        const Register g_register_inter_##className(                                 \
            registeredName,                                                          \
            reinterpret_cast<PTRCreateObject>(CreateRegisteredInter_##className));   \
    }

#define REGISTERINTER(className) REGISTERINTER_NAMED(className, #className)
