# bt-runtime-sdk

BT Studio 运行时 SDK —— C++17 接口骨架,定义独立插件与 FOSim 引擎之间的最小契约。

## 目标

- 只包含 POD/轻量结构、枚举与 loader/runtime 必需接口。
- **不依赖**完整 FOSimEngine、Agent、Unit、模型库、场景系统。
- FOSim 内部工程与独立编辑器都依赖这个 SDK,避免两套类型漂移(总设计文档 §6.0)。

## 头文件

| 头文件 | 内容 |
| --- | --- |
| `include/btsdk/mal_bridge.h` | `MalType` 枚举 + `IMalBridge`(MAL 构造/读取/序列化桥接) |
| `include/btsdk/runtime.h` | `IBehaviorTreeRuntime`(加载/上下文/注册/Tick/Trace)、`Status`、`TraceEvent` |

## 接入真实 FOSim 引擎

1. 新建实现 `.cpp`,包含 FOSimEngine 头文件:
   - `bt_xml_loader.h`(`BT::BTXmlLoader::LoadFromContent`)
   - `bt_tree_def.h` / `bt_node_def.h` / `bt_blackboard.h`
   - `fz_enum_type.h` / `fz_mal_impl.h`
2. 在 `IMalBridge::addValue` 中优先调用 `BT::AddValueToMal(FZMalImpl&, name, type, value)`,
   复杂类型再调用具体 `FZMalImpl::AddXxx`。
3. 在 `IBehaviorTreeRuntime::loadTree` 中调用 `BTXmlLoader::LoadFromContent`,
   `tick` 中按 `enter -> update -> exit` 产出 `TraceEvent`(必须携带 `nodeId`)。
4. 把 `MalType` 映射到 `FZMARGType`(见 `bt-core` 的 `src/types/mal.ts` 与本头文件枚举注释)。

## 边界

- 可导出:类名/组件名/成员名/函数名/参数名/displayType/malType/默认值/绑定目标/说明/版本。
- 不导出:C++ 类定义源码、对象实例内存、成员真实地址、函数指针、编译产物。
