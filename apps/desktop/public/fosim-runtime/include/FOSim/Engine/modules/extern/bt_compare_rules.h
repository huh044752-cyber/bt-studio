#ifndef FOSIM_ENGINE_MODULES_EXTERN_BT_COMPARE_RULES_H
#define FOSIM_ENGINE_MODULES_EXTERN_BT_COMPARE_RULES_H

#include <algorithm>
#include <cctype>
#include <string>

namespace BT
{
namespace detail
{
inline std::string NormalizeCompareToken(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}
}

inline std::string NormalizeCompareType(const std::string& compareType)
{
    const std::string normalized = detail::NormalizeCompareToken(compareType);
    if (normalized.empty() || normalized == "function")
    {
        return "Function";
    }
    if (normalized == "output")
    {
        return "Output";
    }
    return {};
}

inline std::string NormalizeCompareOp(const std::string& op)
{
    const std::string normalized = detail::NormalizeCompareToken(op);
    if (normalized == "eq" || normalized == "ne" ||
        normalized == "gt" || normalized == "ge" ||
        normalized == "lt" || normalized == "le")
    {
        return normalized;
    }
    return {};
}
}

#endif
