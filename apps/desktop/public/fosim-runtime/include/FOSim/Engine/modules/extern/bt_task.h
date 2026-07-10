#pragma once

#include "modules/extern/bt_context.h"
#include "modules/extern/bt_status.h"
#include "modules/structs/model_function.h"
#include <cstdint>
#include <memory>
#include <vector>

class CyberMountModelImpl;

namespace BT
{
    struct DecisionRuntime
    {
        CyberMountModelImpl* model = nullptr;
        FZDecisionProprity* proprity = nullptr;
        std::string launchName;
    };

    class BTTask
    {
    public:
        explicit BTTask(BTNodeDefPtr node);
        virtual ~BTTask();

        BTStatus Tick(BTContext& context);
        virtual void Reset();
        virtual void Abort(BTContext& context, BTStatus status);
        BTStatus GetStatus() const;
        BTNodeDefPtr GetNode() const;
        void SetParent(BTTask* parent);
        BTTask* GetParent() const;
        virtual void CollectRunning(std::vector<const BTTask*>& out) const;

    protected:
        // BeginTick/FinishTick 统一封装 OnEnter/Update/OnExit 公共生命周期，减少派生节点重复代码。
        bool BeginTick(BTContext& context);
        BTStatus FinishTick(BTContext& context, BTStatus nextStatus);
        bool IsRunning() const;
        virtual bool OnEnter(BTContext& context);
        virtual BTStatus Update(BTContext& context) = 0;
        virtual void OnExit(BTContext& context, BTStatus status);

        BTNodeDefPtr node_;
        BTStatus status_;
        BTTask* parent_;
        std::uint64_t tickCount_ = 0;
        std::uint64_t enterCount_ = 0;
        std::uint64_t updateCount_ = 0;
        std::uint64_t exitCount_ = 0;
    };

    class CompositeTask : public BTTask
    {
    public:
        explicit CompositeTask(BTNodeDefPtr node);
        // CompositeTask 负责持有子节点树，并在 Reset/Abort 时把控制流递归向下传播。
        void AddChild(std::unique_ptr<BTTask> child);
        void Reset() override;
        void Abort(BTContext& context, BTStatus status) override;
        void CollectRunning(std::vector<const BTTask*>& out) const override;

    protected:
        std::vector<std::unique_ptr<BTTask>> children_;
        size_t activeChildIndex_;
        BTTask* currentRunningTask_;
    };

    std::unique_ptr<BTTask> CreateTaskTree(BTNodeDefPtr node);
}
