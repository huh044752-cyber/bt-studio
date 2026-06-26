# 构建说明

## 1. 核心引擎(TS)

```bash
pnpm --filter @btstudio/bt-core build   # tsc -> dist/
pnpm --filter @btstudio/bt-core test    # vitest(全部逻辑测试)
```

## 2. 前端 Web 产物

```bash
pnpm --filter @btstudio/desktop build   # vue-tsc 类型检查 + vite build -> apps/desktop/dist/
```

## 3. 桌面应用(Tauri 2 + Rust)

前置(Windows):
- Rust stable(`rustup`)
- Microsoft C++ Build Tools(MSVC)
- WebView2 Runtime
- 图标资源:`apps/desktop/src-tauri/icons/icon.png`(打包需要;缺失会导致 `tauri build` 失败)

```bash
pnpm --filter @btstudio/desktop tauri dev     # 开发
pnpm --filter @btstudio/desktop tauri build   # 发布安装包
```

Rust 本地服务层单元测试(纯逻辑:原子写入 / ZIP / BehaviorLogic 冲突策略 / 工作区扫描):

```bash
cd apps/desktop/src-tauri
cargo test
```

> 说明:`cargo test` 会编译整个 crate(含 tauri 依赖与 `tauri::generate_context!`),因此同样需要上述 Tauri 前置与 `icons/icon.png`。纯逻辑模块(`fs_ops`/`zip_ops`/`behaviorlogic`/`workspace_scan`)均带 `#[cfg(test)]` 用例。

## 4. C++ 运行时 SDK

`packages/bt-runtime-sdk` 仅含头文件骨架,无需单独构建。接入真实 FOSim 引擎时新建实现 `.cpp`,
链接 FOSimEngine 并实现 `IBehaviorTreeRuntime` / `IMalBridge`(见该目录 README)。

## 5. FOSim 兼容回归(loader 复读)

`samples/` 中的 `*.bt.xml` 结构对齐 `BT::BTXmlLoader`。要做真实 loader 复读:

1. 用 FOSimEngine 测试程序调用 `BT::BTXmlLoader::LoadFromContent(xml)`。
2. 比对样例 `expected.md` 的预期结构(根类型、节点数、黑板数、引用子树数)。
3. 失败时保留 loader 错误日志。

> 当前仓库内的"兼容回归"在前端 `回归与样例` 页与 `bt-core` 测试中做的是**结构层**校验(projectType / 元素名 / 子节点规则);接入引擎后用上述步骤做端到端 loader 复读。
