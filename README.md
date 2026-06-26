# BT Studio — 独立行为树插件与可视化编辑器

面向 FOSim 的独立行为树设计平台:可视化建树、MAL 感知绑定、校验、导出 **FOSim 兼容 `*.bt.xml`**、导入恢复、独立调试、场景挂接与回归。围绕行为树工具本身,**不**包含状态机 / 脚本桥接 / 通用业务平台。

> 设计依据:`F:\FOSim\behaviac\独立行为树插件与可视化编辑器总设计文档.md`

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
