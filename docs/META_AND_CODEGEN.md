# 类型系统(Meta)、根类函数绑定与 C++ 代码生成

对齐 Tencent behaviac 的 meta 体系:工具里"创建函数/变量/类型"等价于"声明 C++ 类的方法/成员/枚举/结构体"。

## 数据模型(`packages/bt-core/src/types/catalog.ts`)

| 概念 | 类型 | 说明 |
| --- | --- | --- |
| 类 / Agent | `ClassDescriptor` | className / displayName |
| 成员(变量) | `MemberDescriptor` | `static=true`→全局黑板候选,`false`→本地;valueType/displayType/malType |
| 方法(函数) | `FunctionDescriptor` | `ownerClass`(所属类)、`returnType`、`static`、`isTask`、`params[]` |
| 参数 | `FunctionParam` | `direction`(input/output)、`displayType`↔`malType`、`required`、`defaultValue` |
| 枚举 / 结构体 | `EnumDescriptor` / `StructDescriptor` | 导出 enum/struct |

`functionOwnerClass(fn)`:取 `ownerClass`,否则取 `bindingTarget` 的 `类.方法` 前缀。

## 类归属:自由类型空间

- 行为树**没有根类绑定**。Root/Behavior 层不写 `rootClass` / `cognition` 属性。
- Action/Condition 的类归属由**每个叶子自己的 `className`** 决定 —— 从 `ws.classes` 全量类里自由选,再从该类的方法里选 `functionRef`。
- 挂接到具体 Unit 时,`ScenarioAttachPage` 的 `validateTreeForUnit` 校验每个叶子的 `(className, functionRef)` 与 Unit 的 `components` + 该类下方法一致,全部通过才允许写盘。
- 节点参数可绑定:**常量** 或 **黑板变量**(属性面板的"直接输入/▣变量"下拉);输出参数(`IsRef`)回写黑板。

## meta.xml 导入/导出

- 导出:`serializeMetaXml(catalog)`(模型工作空间页"导出 meta.xml"/函数目录页"导出目录")。
- 导入:`parseMetaXml(xml)` → 合并进类/成员/函数/枚举/结构体(模型工作空间页"导入 meta.xml→应用到目录")。
- 无模型时:在变量与类型页 / 模型工作空间页手动新建类型;有模型时从 meta.xml(或目录)解析。

## C++ 代码生成(`export/codegen/cppCodegen.ts`)

`generateCpp(catalog)` 产出:
- `types/btstudio_types.h`:由枚举/结构体生成 C++ `enum` / `struct`。
- `types/internal/<Class>.h`:Agent 类声明 + 成员 + 方法签名,含 `///<<< BEGIN/END WRITING YOUR CODE` 保留区(只可改保留区内代码,重生成不丢失手写实现)。

边界(总设计文档 §7.1):只导出**声明/签名/类型**,不导出实现本体、内存、函数指针、编译产物。

## R4 增量:对接真实 FOSim 模型 + 每节点绑定 + 完整工程

- **真实模型解析**:工作空间页/类型空间页"选择模型目录"指向 `F:\FOSim\FZFOSimModel`,扫描 `.cmp`(`import/cmpModel.ts`,Rust `model_scan` 读盘)→ 真实 FZ* 类/方法/参数(参数类型为 `FZIntegerType/FZRealType/FZVectorType/...`)。
- **每节点 类→方法→组件**:节点属性面板选 `className`(`targetSelector.modelClass`)→ 选该类方法 → 参数按 `.cmp` 自动填充(类型显示为 FZ*)→ 绑常量/黑板;`componentId` 在场景挂接时由实体组件回填。校验:`(className, function)` 必须在模型目录存在(`ValidationEngine`)。
- **完整可编译工程**(`export/codegen/projectGen.ts`,工作空间页"生成完整工程"):产出 `include/<ns>/<UserClass>.h`(继承 `BT::Agent`)+ `src/<UserClass>.cpp`(stub + `RegisterFunctions`,对齐 FOSim `_register.cpp`)+ `behaviors/*.bt.xml` + `src/main.cpp`(`BT::BTXmlLoader().LoadFromContent()` + `BehaviorNodeAgent.ExecNode()`)+ `CMakeLists.txt`(引用引擎 include/lib)。模型已有类(source=model)不重生。用户补全宿主上下文/取消 CMake link 注释即可编译运行。
- **工作空间配置**:`工作空间名 / 模型目录 / 导出代码目录 / C++ 命名空间 / 引擎 include 目录 / 语言`(弹窗配置,对齐 behaviac workspace.xml)。
- **场景外挂**(`import/scenario.ts` + Rust `scenario.rs`):扫 `ScenarioSource` → 选场景→解析 Units(组件 className/componentId)→选实体→把当前树写入 `.sdata` 的 `<BehaviorLogic><BehaviorTreeInstance belongUnit=..>` + 写 `.bt` 模板,含冲突检测(reject/overwrite/backup_then_overwrite)/备份/回滚。
- **创建走弹窗**(`components/common/ModalDialog.vue`):新建行为树/状态机、新建类/枚举、新建工作空间(含配置)均为弹窗。
- **页面精简**:删除"导入与映射修复""函数目录"(函数在类型空间查看)。

## 与真实 FOSim 引擎对齐(codegen 关键)

- 方法返回类型 = **`FZDFMPFRC`**(`fz_enum_type.h`:UNKNOWN/CONTINUOUS/SINGLE/ERROR),条件可用 `FZBOOL`,成败用 `FZRC`。UI 返回值下拉即这三种。
- 方法签名固定:`FZDFMPFRC Name(FZMalImpl* in_mal, FZMalImpl* out_mal)`。
- 生成的类继承引擎基类(由 `.cmp` 的 `type` 映射:RuleDecision→`FZCognitionImpl`、Jammers→`FZJammerImpl`、Platforms→`FZPlatformImpl` 等,见 `categoryToBaseClass`)。
- 生成的 `<Class>.cpp` 的 `RegisterFunctions()` 完全对齐 FOSim `*_register.cpp` 模式:
  `DecisionFunctionInitialParameter* d = new ...; d->function_ptr_ = (ProcessDecisionFunctionPtr)&Class::M; d->delay_time_/repeat_time_=..; d->mal_ = FZMalImpl::CreateMAL(); RegisterDecisionFunction("CMD","M", d);`
  其中 CMD/delay/repeat 来自 `.cmp` 的 `IntendedCmd/Delay/Repeat`。
- 完整工程 = 用户类 `.h/.cpp` + `behaviors/*.bt.xml` + `src/main.cpp`(`BT::BTXmlLoader().LoadFromContent` + `BehaviorNodeAgent.ExecNode`)+ `CMakeLists.txt`(引用 `FOSimEngine/include` + 链接引擎库)。用户只需补全宿主上下文即可编译运行。
- **场景外挂关联**:挂接时按所选实体的 `<ModelData>` 组件(className→data_id)自动回填每个节点的 `componentId`,再写入 `.sdata` 的 `<BehaviorLogic><BehaviorTreeInstance belongUnit=..>` 与 `.bt` 模板。
