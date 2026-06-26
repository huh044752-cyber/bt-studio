# 开发启动说明

## 前置

- Node ≥ 18,pnpm 9（`npm i -g pnpm@9`）。
- 桌面模式额外需要:Rust（stable）、Tauri 2 前置（Windows:WebView2 Runtime + MSVC build tools）。

## 安装

```bash
cd F:/FOSim/behaviac/bt-studio
pnpm install
```

## 常用命令

```bash
# 核心引擎单元测试(文档要求的全部逻辑测试)
pnpm --filter @btstudio/bt-core test

# 核心引擎构建 / 类型检查
pnpm --filter @btstudio/bt-core build

# 前端类型检查
pnpm --filter @btstudio/desktop typecheck

# 浏览器模式开发(端口 5180,无需 Rust)
pnpm --filter @btstudio/desktop dev

# 桌面模式(需 Tauri 前置)
pnpm --filter @btstudio/desktop tauri dev
```

## 开发顺序(已实现)

1. 核心类型(runtime/editor/catalog/mal) → 2. 设计态模型工厂 → 3. Node Registry →
4. Graph Command Bus(undo/redo) → 5. Validation + MAL → 6. Export(XML/meta/manifest) →
7. Import(解析 + 映射修复) → 8. vitest → 9. 设计页(X6) → 10. 其余 9 页 →
11. Rust 命令层 → 12. C++ SDK + 文档 + 样例。

## 浏览器模式 vs 桌面模式

- 浏览器模式:磁盘操作降级为下载 / `<input type=file>` / mock 列表;调试用内置 mock 运行时。适合快速演示设计→校验→导出→调试主链路。
- 桌面模式:走 Rust `#[tauri::command]` 真正落盘(原子写入)、ZIP 工程包、工作区扫描、BehaviorLogic 写回/回滚。

## 加节点类型的流程

1. 在 `bt-core/src/registry/builtins.ts` 增加 `NodeDefinition`(`runtimeKind` 必须映射 `BTNodeKind`、给出 `xmlElement`、端口规则、属性 Schema)。
2. 若导出有特殊属性,在 `export/xmlSerializer.ts` 增加分支。
3. 在 `import/xmlParser.ts` 通过 Registry 反查自动恢复。
4. 补样例与回归(`samples/`)。

## 约定

- 所有编辑动作走 `GraphCommandBus.execute`;不要直接改 store / tree。
- 校验规则集中在 `ValidationEngine`;Error 必须能定位到 node/field。
- 运行 XML 由 `BehaviorTreeDef` 生成,严禁直接把 X6 JSON 当协议。
