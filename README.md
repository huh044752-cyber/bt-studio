# BT Studio — 独立行为树插件与可视化编辑器

面向 FOSim 的独立行为树设计平台:可视化建树、MAL 感知绑定、校验、导出 **FOSim 兼容 `*.bt.xml`**、导入恢复、独立调试、场景挂接与回归。围绕行为树工具本身,**不**包含状态机 / 脚本桥接 / 通用业务平台。

## 技术栈

- 桌面端:**Tauri 2 + Vue 3 + TypeScript**
- 图编辑器:**AntV X6**
- 核心引擎:纯 TS 包 `@btstudio/bt-core`(数据模型 / Node Registry / Command Bus / Validation / MAL / Export / Import / Layout)
- 本地服务层:**Rust**(`apps/desktop/src-tauri`)
- 运行时插件接口:**C++17 SDK 骨架**(`packages/bt-runtime-sdk`)
- UI:深色专业控制台风格

## 目录结构

```
bt-studio/
├─ packages/
│  ├─ bt-core/              # 纯 TS 核心引擎(无 DOM/Tauri 依赖,vitest 覆盖)
│  └─ bt-runtime-sdk/       # C++17 运行时 SDK 接口骨架
├─ apps/
│  └─ desktop/              # Tauri 2 + Vue 3 前端
│     └─ src-tauri/         # Rust 本地服务层
├─ samples/                 # 样例资产 + 回归目录
└─ docs/                    # ARCHITECTURE / XML_FORMAT / DEVELOPMENT / BUILD
```

## 快速开始

```bash
# 1) 安装依赖(pnpm 9)
pnpm install

# 2) 运行核心引擎测试(文档要求的全部逻辑测试)
pnpm --filter @btstudio/bt-core test

# 3) 浏览器模式开发(无需 Rust,核心设计/校验/导出主链路可用)
pnpm --filter @btstudio/desktop dev      # http://localhost:5180

# 4) 桌面模式(需 Rust + Tauri 前置,见 docs/BUILD.md)
pnpm --filter @btstudio/desktop tauri dev
```

> 浏览器模式下,涉及磁盘的操作(导出落盘、打开文件、工作区扫描、场景写回)自动降级为浏览器实现(下载 / 文件选择 / mock),保证主链路可演示。桌面模式下走 Rust 命令真正落盘。

## 双模式

- **Standalone**:独立工程,只用 `displayType` 即可轻量调试。
- **Linked FOSim**:打开 FOSim 工作区,索引 ModelDatabase/ScenarioSource,发布 XML 并写回 BehaviorLogic;此模式下所有绑定参数必须具备可解析的 `malType`,否则阻断发布。

## 核心约束

- 运行 XML 必须能被现有 `BT::BTXmlLoader` 解析(**最高优先级**)。
- 保存(设计态 + `*.bt.meta.json`)与导出(运行 `*.bt.xml`)**两条链路分离**;UI 布局/注释不进运行 XML。
- 校验分 Error / Warning / Info;**有 Error 时禁止导出 / 运行 / 发布**。
- 受限节点只允许查看 / 删除 / 替换,不允许发布。
- 所有编辑动作经 **Graph Command Bus**;快捷键不绕过校验。

## 页面

行为树设计 · 函数目录 · 变量与类型 · 模型工作空间 · 项目工作空间 · 导入与映射修复 · 校验与导出 · 运行调试 · 场景挂接 · 回归与样例。

## R3 能力(对齐 behaviac / vue2)

- **双范式**:行为树 + **状态机(FSM)**。设计页 `+状态机` 新建 FSM 工程;节点库按工程类型切换;导出 `*.fsm.xml`。见 [`docs/STATE_MACHINE.md`](docs/STATE_MACHINE.md)。
- **根类函数绑定**:Root 选一个类,Action/Condition 函数只来自该类方法;参数可绑 **常量 / 黑板变量 / 类成员**。
- **类型系统 + 代码生成**:behaviac 式 `meta.xml`(类/成员/方法/枚举/结构体)导入导出 + 生成 C++ 类型/Agent 头(含 `///<<< BEGIN/END` 保留区)。见 [`docs/META_AND_CODEGEN.md`](docs/META_AND_CODEGEN.md)。
- **全 XML 持久化**:工程 `*.workspace.xml`、类型 `*.meta.xml`、运行 `*.bt.xml`、状态机 `*.fsm.xml`。
- **28 节点目录 + vue2 视觉**(rect/ellipse/polygon + 渐变);**按类型连接校验**(And/Or 只接条件、State↔跳转、监测分支等)。

详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)、[`docs/XML_FORMAT.md`](docs/XML_FORMAT.md)、[`docs/STATE_MACHINE.md`](docs/STATE_MACHINE.md)、[`docs/META_AND_CODEGEN.md`](docs/META_AND_CODEGEN.md)、[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)、[`docs/BUILD.md`](docs/BUILD.md)。

---

## 使用教程 —— 从设计到 C++ 工程编译 + 断点

一条完整链路:**编辑器画 BT/FSM → 一键生成 C++ 工程 → CMake 编译 → ctest 逻辑校验 → 在 Action 函数体断点**。生成产物默认保留用户手写代码块 `///<<< BEGIN WRITING YOUR CODE <tag> ... ///<<< END WRITING YOUR CODE <tag>`,再生成不会覆盖。

### 1) 安装与启动

```bash
pnpm install
pnpm --filter @btstudio/bt-core build          # 生成 dist,给 scripts/genKdd.mjs 用
pnpm --filter @btstudio/desktop tauri dev      # 桌面模式(推荐,可落盘)
# 或浏览器模式
pnpm --filter @btstudio/desktop dev            # http://localhost:5180
```

### 2) 建模型 & 画树

1. **模型工作空间**:上传/编辑 `.mcr` 或 `meta.xml`,定义类、成员、方法(Action/Condition)。方法的 `intendedCmd` 决定 C++ 端 `RegisterDecisionFunction(cmd, ...)` 的首键。
2. **设计页 → 新建行为树 / 新建状态机**:拖节点、连线、Action/Condition 绑定到已建的方法;参数可选 常量 / 黑板变量 / 类成员。
3. **校验与导出**:必须无 Error;工程保存到 `*.workspace.xml`,行为树到 `*.bt.xml`,状态机到 `*.fsm.xml`。

### 3) 一键生成 C++ 工程

推荐用脚本(不依赖 Tauri 环境):

```bash
node packages/bt-core/scripts/genKdd.mjs \
     <你的工作空间>.workspace.xml \
     <输出目录>
```

生成结构:

```
<输出目录>/
├─ CMakeLists.txt                    # 顶层,链接 runtime + types,含 ctest
├─ runtime/                          # 自包含 BT/FSM 运行时(loader + task + observer)
│  ├─ include/fosim/{bt_runtime,fsm_runtime,cyber_types}.h
│  └─ src/{bt_runtime,fsm_runtime}.cpp
├─ types/                            # 由类目录生成:每个用户类 → .h/.cpp
│  ├─ include/<ns>/BTAirToMCog.h     # class : CyberDecisionAgentBase
│  └─ src/BTAirToMCog.cpp            # RegisterFunctions + 每个方法的 ///<<< 保留区
├─ behaviors/*.bt.xml *.fsm.xml      # 编辑器导出的运行时 XML
├─ app/main.cpp                      # 加载全部 BT+FSM,单帧循环并行 tick
├─ tests/tick_check.cpp              # ctest 入口,断言 BT 不 Running 收敛
└─ engine-core/                      # (可选)真引擎干净子集,USE_REAL_ENGINE_LOADER=ON 才编
```

**再次生成时**:所有 `///<<< BEGIN WRITING YOUR CODE <tag> ... ///<<< END WRITING YOUR CODE <tag>` 内的手写代码会被 `scripts/genKdd.mjs` 中的 `mergeUserBlocks` 保留,包括 `tests/tick_check.cpp` 的 `tick_check_main` 块。

### 4) 编译

```bash
cd <输出目录>
cmake -S . -B build
cmake --build build --config Release
```

### 5) 逻辑校验 (ctest)

```bash
ctest --test-dir build --output-on-failure
# 通过 → logic_check: PASS (BT=N FSM=M frames=X)
```

`tick_check` 会加载所有 `behaviors/*.bt.xml` + `*.fsm.xml`,单帧循环并行 Tick,断言所有 BT 不再 Running。失败会带路径 + 帧数报错。

### 6) 在 Action 断点调试

BT/FSM 的每个 Leaf Action 在 Tick 时**真的会调用你注册的类方法**(通过 `CyberDecisionAgentBase::FindFunction` + `InvokeDecisionFunction(agent, fptr, in, out)`,`fptr` 是最通用成员函数指针 `__UnexistingClass::*ProcessDecisionFunctionPtr`,`reinterpret_cast<__UnexistingClass*>(agent)` 后调用,避 MSVC C4407)。

在 `types/src/<你的类>.cpp` 里,任意方法的 `///<<< BEGIN WRITING YOUR CODE <方法名>` 内写业务代码,例如:

```cpp
///<<< BEGIN WRITING YOUR CODE Get_Sensor_Status
std::printf("[USER] Get_Sensor_Status called!\n");
status = "sensor_ok";
///<<< END WRITING YOUR CODE Get_Sensor_Status
```

用 Visual Studio 打开 `build/*.sln`,在该 `printf` 或方法首行下断点,Debug 启动 `kdd_workspace` / `tick_check`,一旦 BT 走到该 Action 节点即命中。

### 7) 环境变量

- `FOSIM_BT_TRACE=full` — 打印每个节点的 Enter/Exit/Result,方便定位 BT 走向;`summary` 只打印顶层;不设为 off。
- `argv` 覆盖:`kdd_workspace.exe path/to/other.bt.xml [more.bt.xml ...] [foo.fsm.xml ...]` 可绕过编译期 `btPaths/fsmPaths` 清单跑指定文件。

### 8) 常见问题

| 症状 | 原因 / 修法 |
|---|---|
| 生成后手写代码丢了 | 检查 `///<<< END WRITING YOUR CODE <tag>` 的 tag 必须与 BEGIN 完全一致(生成器已修) |
| Action 断点不进 | 该类未在 `types/` 生成 → 检查方法 `ownerClass` 是否落在 catalog.classes 里,且 `source` 是 user 或 model 且带方法 |
| ctest FAIL "still Running" | BT 里有死循环 / 未收敛节点;把 `FOSIM_BT_TRACE=full` 打开重跑看最后 tick 卡在哪个节点 |
| MSVC C4407 编译错 | 已通过 `class __UnexistingClass;` + `pointers_to_members(full_generality)` 规避,不要改回具体类成员指针 |


