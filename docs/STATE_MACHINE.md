# 状态机(FSM)设计

BT Studio 支持两种工程范式(对齐 behaviac / vue2 `projectType`):**行为树** 与 **状态机**。

## 模型

FSM 工程是 `projectKind="state_machine"` 的设计树,复用同一套画布 / 命令总线 / 校验 / 布局。

- **状态(State)**:执行一个方法(`functionRef`),可设结束态(`endStatusSuccess`)。动态多入多出。
- **跳转节点**:`ConditionTransition`(条件跳转)/ `StateTransition`(按引用行为树返回值跳转)/ `Transition`(直接转换)。
- 图结构:`State --edge--> 跳转节点 --edge--> 目标 State`。

## 连接规则(`registry/connectionRules.ts`)

- `State` 的输出只能接 `ConditionTransition` / `StateTransition`。
- 跳转节点只能指向 `State`。
- 状态机工程下 `Root` 只能接 `State`。

## 节点库过滤

`NodeRegistry.listForParadigm("state_machine")` 只返回 `paradigm in {fsm, both}` 的节点;
节点库随当前工程类型自动切换(BT 工程显示 BT 节点,FSM 工程显示状态/跳转)。

## 导出

`serializeFsmXml(tree)` 生成 behaviac 风格 `<FSMNodes>`:每个 State 折叠其下游跳转为
`<Attachment Class="TransitionCondition" TargetFSMNodeId=.. Operator/Opl/Opr>`(或 `StateTransform` + `ReferenceBehavior`)。
见 `docs/XML_FORMAT.md`。

> FOSim `BTXmlLoader` 不加载 FSM;FSM 运行依赖 behaviac 兼容运行时。

## 创建

设计页左栏 `+状态机` 按钮创建 FSM 工程;校验与导出页对 FSM 工程导出 `*.fsm.xml`。
