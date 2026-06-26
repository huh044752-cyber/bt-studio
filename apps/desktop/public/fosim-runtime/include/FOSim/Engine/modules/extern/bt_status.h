#pragma once

#include "FOSim/Engine/fz_engine_type.h"

namespace BT
{
    enum class BTStatus
    {
        Invalid,
        Success,
        Failure,
        Running
    };

    // 行为树内部统一消费强类型决策结果，不再在运行时到处直接判断旧 FZDFMPFRC 枚举。
    inline BTStatus ToBTStatus(FZDecisionResult status)
    {
        switch (status)
        {
        case FZDecisionResult::Success:
            return BTStatus::Success;
        case FZDecisionResult::Running:
            return BTStatus::Running;
        case FZDecisionResult::Failure:
        case FZDecisionResult::Error:
        default:
            return BTStatus::Failure;
        }
    }

    // BTStatus 与决策层结果之间的双向转换在这里集中维护。
    inline FZDecisionResult ToDecisionResult(BTStatus status)
    {
        switch (status)
        {
        case BTStatus::Success:
            return FZDecisionResult::Success;
        case BTStatus::Running:
            return FZDecisionResult::Running;
        case BTStatus::Failure:
            return FZDecisionResult::Failure;
        case BTStatus::Invalid:
        default:
            return FZDecisionResult::Error;
        }
    }

    inline BTStatus ToBTStatus(FZDFMPFRC status)
    {
        return ToBTStatus(ToDecisionResult(status));
    }

    // Agent 边界仍使用旧 FZDFMPFRC，因此保留一层显式回写转换。
    inline FZDFMPFRC ToFZStatus(BTStatus status)
    {
        return status == BTStatus::Success ? FZ_DFMPFRC_SINGLE
             : status == BTStatus::Running ? FZ_DFMPFRC_CONTINUOUS
             : status == BTStatus::Failure ? FZ_DFMPFRC_ERROR
             : FZ_DFMPFRC_UNKNOWN;
    }
}
