# BT Studio — 独立行为树 / 状态机设计平台

面向 FOSim 老引擎的独立行为树 + 状态机设计器。可视化建树、类型抽取、绑定校验、导出 `*.bt.xml` / `*.fsm.xml`、场景挂接回写、生成 C++ 工程 + ctest 逻辑校验。

**Tauri-only 交付**：整体打成一个 `bt-studio.exe`(约 10 MB),不依赖 Node、不起端口服务、不用浏览器。开发用 `tauri dev`(热重载,不打包);发布用 `tauri build`(产 exe)。

---

## 一、依赖

### Node 侧

- **Node.js ≥ 18**(推荐 20 LTS)
- **pnpm 9**(仓库是 pnpm workspace,`packageManager` 已锁)
  ```bash
  npm install -g pnpm@9
  ```

### Rust 侧(Tauri 需要)

- **Rust stable**(≥ 1.77) — https://rustup.rs 一键装
  ```bash
  rustup default stable
  rustup target add x86_64-pc-windows-msvc   # Windows 平台
  ```
- **Tauri CLI**:仓库已作为 devDep 装好,直接 `pnpm --filter @btstudio/desktop tauri ...` 调用,无需全局安装

### 系统前置(Windows)

- **Visual Studio Build Tools 2022**(必须带 "C++ 桌面开发" 工作负载)—— Tauri 的 rustc 链接器要 MSVC
- **WebView2 Runtime** —— Windows 11 自带;Windows 10 需装 <https://developer.microsoft.com/microsoft-edge/webview2/>

### 系统前置(其他平台,仅供参考)

- macOS:Xcode Command Line Tools(`xcode-select --install`)
- Linux:`libwebkit2gtk-4.1-dev` + `libssl-dev` + `libayatana-appindicator3-dev` + `librsvg2-dev`

---

## 二、开发模式(**不打包**)

```bash
# 一次性初始化
pnpm install

# 每天开工:热重载开发(推荐)
pnpm --filter @btstudio/desktop tauri dev
```

- `tauri dev` 会:
  1. 先起 vite 开发服务器(`localhost:5180`,只当 webview 后端用,不面向浏览器)
  2. 编译 Rust,弹出 Tauri 窗口,webview 指向 `devUrl`
  3. 你改前端(Vue/TS)—— **HMR 秒热**,窗口自动刷新
  4. 你改 Rust —— tauri 自动重编重启
- **不产 exe**,不做发布打包,只在内存里跑,速度最快
- **不要在浏览器里打开 `http://localhost:5180`** —— 会看到"必须桌面版打开"阻断页(因为不是 Tauri webview,`window.__TAURI_INTERNALS__` 缺失)

### 只跑 bt-core 单元测试(纯 TS,不需要 Rust)

```bash
pnpm --filter @btstudio/bt-core test        # 76 用例
pnpm --filter @btstudio/desktop typecheck   # 前端类型检查
```

---

## 三、发布模式(**产 exe**)

### 只要单 exe(推荐)

```bash
pnpm --filter @btstudio/desktop tauri build --no-bundle
```

产物路径:

```
apps/desktop/src-tauri/target/release/bt-studio.exe   # ≈ 10 MB
```

双击即可运行。**这一步不生成安装包**,双击的是绿色可分发 exe。

### 要 NSIS 安装包(可选)

```bash
pnpm --filter @btstudio/desktop tauri build
```

产物:

```
apps/desktop/src-tauri/target/release/bundle/nsis/BT Studio_0.1.0_x64-setup.exe
```

> 已在 `tauri.conf.json` 里锁 `"targets": ["nsis"]` 避免默认打 MSI(MSI 走 WiX,构建时会去 GitHub 拉 `wix314-binaries.zip`,国内网络多半失败)。

---

## 四、如何区分自己在哪个模式

| 场景 | 命令 | 是否产 exe | 有 HMR | 用途 |
|---|---|---|---|---|
| **开发调试** | `pnpm --filter @btstudio/desktop tauri dev` | 否 | 有 | 日常写代码 |
| **单元测试** | `pnpm --filter @btstudio/bt-core test` | 否 | — | CI / 逻辑回归 |
| **类型检查** | `pnpm --filter @btstudio/desktop typecheck` | 否 | — | 提交前 |
| **本地试发布** | `pnpm --filter @btstudio/desktop tauri build --no-bundle` | 是,单 exe | 无 | 拿去给别人 |
| **正式发布** | `pnpm --filter @btstudio/desktop tauri build` | 是,exe + NSIS 安装包 | 无 | 分发 |

**误区**:`pnpm --filter @btstudio/desktop dev` 只起 vite,浏览器打开会看到阻断页 —— 这不是"开发桌面版",这是"给 tauri dev 当后端的"。想真开发一定要走 `tauri dev`。

---

## 五、目录结构

```
bt-studio/
├─ packages/
│  ├─ bt-core/              # 纯 TS 核心引擎(数据模型/校验/导入导出/codegen)
│  │  └─ scripts/genKdd.mjs # workspace.xml → 完整 C++ 工程生成器
│  └─ bt-runtime-sdk/       # C++17 运行时 SDK 骨架
├─ apps/desktop/
│  ├─ src/                  # Vue 3 + Pinia 前端
│  ├─ src-tauri/            # Rust 侧
│  │  ├─ src/lib.rs         # 全部 #[tauri::command] (pick_directory/save_text_file/...)
│  │  ├─ capabilities/      # Tauri v2 权限声明
│  │  ├─ icons/             # 应用图标 (tauri icon 生成)
│  │  └─ tauri.conf.json    # 窗口/bundle/devUrl 配置
│  └─ public/fosim-runtime/ # 打包进 exe 的真引擎源码 (modules/extern + core/mal + pugi)
├─ samples/                 # 样例资产
└─ docs/                    # ARCHITECTURE / XML_FORMAT / DEVELOPMENT / BUILD
```

---

## 六、常见坑

| 症状 | 原因 / 修法 |
|---|---|
| `tauri dev` 一直卡在 Compiling | 首次编译 rustc 拖依赖,10-15 分钟正常;后续增量 <10s |
| 双击 exe 白屏 | 缺 WebView2 Runtime(Win10),装完就好 |
| `error: linker 'link.exe' not found` | 没装 VS Build Tools 的 "C++ 桌面开发" 组件 |
| `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` on tauri build | 多半是 `capabilities/default.json` 语法坏了 —— Tauri v2 权限 id 必须 `lowercase-with-hyphens`,不能有下划线 |
| `icons/icon.ico not found` | 首次 clone 后跑 `pnpm --filter @btstudio/desktop tauri icon src-tauri/icons/source.png` 生成全套图标 |
| WiX MSI 下载失败 | 用 `tauri build --no-bundle` 或让 `bundle.targets: ["nsis"]` |
| 浏览器打开 localhost:5180 显示"需桌面版" | 正常 —— Tauri-only 架构不接受浏览器直连;要开发就 `tauri dev` |
| 挂接场景后 .bt 文件去了浏览器下载 | 已修:Tauri-only 之后一律走 modelRoot 直写,若还有请确认在 exe / tauri dev 内运行 |

---

## 七、核心约束(不改)

- **运行 XML 必须能被老引擎 `BT::BTXmlLoader` / `StateMachineLoader` 解析**(最高优先级)
- **保存链路**(设计态 + `*.bt.meta.json`)与**导出链路**(运行 `*.bt.xml`)分离,UI 布局/注释不进运行 XML
- **校验分 Error / Warning / Info**,有 Error 时禁止导出 / 运行 / 发布
- **所有编辑动作经 Graph Command Bus**,快捷键不绕过校验
- **代码生成保留区**:`///<<< BEGIN WRITING YOUR CODE <tag>` … `///<<< END WRITING YOUR CODE <tag>` 之间的手写代码,再生成时 `mergeUserBlocks` 保留不覆盖 —— 包括 `tests/tick_check.cpp` 的 `tick_check_main`

---

## 八、从设计到 C++ 工程编译 + 断点

一条完整链路:**画 BT/FSM → 生成 C++ 工程 → CMake 编译 → ctest 校验 → 在 Action 里断点**。

### 1) 建模型 + 画树

1. **模型工作空间**:配置 `modelRoot`(如 `F:/0411/ccc/FZFOSimModel`),自动扫描 `.cmp` / `.mui`,勾选类抽取到类型空间。
2. **设计页 → 新建行为树 / 状态机**:拖节点、连线、绑定 Action / Condition 方法。
3. **校验与导出**:无 Error 后保存到 `<workspace>.workspace.xml`。

### 2) 生成 C++ 工程

```bash
node packages/bt-core/scripts/genKdd.mjs \
     <你的工作空间>.workspace.xml \
     <输出目录>
```

产物:

```
<输出目录>/
├─ CMakeLists.txt                    # 顶层,链接 runtime + types,含 ctest
├─ runtime/                          # 自包含 BT/FSM 运行时 (loader + task + observer)
├─ types/                            # 每个用户类 → .h/.cpp (含 ///<<< 保留区)
├─ behaviors/*.bt.xml *.fsm.xml      # 编辑器导出的运行时 XML
├─ app/main.cpp                      # 加载全部 BT+FSM,单帧并行 tick
├─ tests/tick_check.cpp              # ctest 入口,断言 BT 收敛
└─ engine-core/                      # (可选) 真引擎源码,USE_REAL_ENGINE_LOADER=ON 才编
```

### 3) 编译 + ctest

```bash
cd <输出目录>
cmake -S . -B build
cmake --build build --config Release
ctest --test-dir build --output-on-failure
```

### 4) 在 Action 里下断点

编辑器生成的 `types/src/<你的类>.cpp` 里,每个方法都有:

```cpp
///<<< BEGIN WRITING YOUR CODE Get_Sensor_Status
std::printf("[USER] Get_Sensor_Status called!\n");
status = "sensor_ok";
///<<< END WRITING YOUR CODE Get_Sensor_Status
```

用 VS 打开 `build/*.sln`,断点下在 `printf` 上,Debug 启动 `tick_check`,BT 走到该 Action 节点即命中。

### 5) 环境变量

- `FOSIM_BT_TRACE=full` — 打印每个节点 Enter/Exit/Result
- `argv` 覆盖:`kdd_workspace.exe path/to/other.bt.xml [more.bt.xml ...]`

---

## 九、进一步文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 整体架构
- [`docs/XML_FORMAT.md`](docs/XML_FORMAT.md) — 运行 XML 格式规范
- [`docs/STATE_MACHINE.md`](docs/STATE_MACHINE.md) — 状态机建模
- [`docs/META_AND_CODEGEN.md`](docs/META_AND_CODEGEN.md) — 类型系统与代码生成
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — 前端/Rust 开发规范
- [`docs/BUILD.md`](docs/BUILD.md) — 构建细节
