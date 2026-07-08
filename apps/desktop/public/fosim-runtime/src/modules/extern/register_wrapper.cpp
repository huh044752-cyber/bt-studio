#include "modules/extern/register_wrapper.h"

namespace
{
    // 全局注册表只存放构造函数，不保存对象实例。
    std::map<std::string, PTRCreateObject>& GetClassMap()
    {
        static std::map<std::string, PTRCreateObject> classMap;
        return classMap;
    }
}

void ClassFactory::registClass(const std::string& name, PTRCreateObject method)
{
    // 同名注册采用覆盖语义。
    // 这样测试和增量迁移都可以用最后一次注册结果作为当前实现。
    if (!name.empty() && method)
    {
        GetClassMap()[name] = method;
    }
}

ClassFactory& ClassFactory::getInstance()
{
    static ClassFactory factory;
    return factory;
}

void* ClassFactory::getClassByName(const std::string& className)
{
    auto iter = GetClassMap().find(className);
    return iter == GetClassMap().end() ? nullptr : iter->second();
}

Register::Register(const std::string& className, PTRCreateObject ptrCreateFn)
{
    ClassFactory::getInstance().registClass(className, ptrCreateFn);
}
