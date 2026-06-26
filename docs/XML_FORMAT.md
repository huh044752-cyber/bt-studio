# 运行 XML 格式与字段映射

本文件记录 BT Studio 导出的 `*.bt.xml` 与 FOSim `BT::BTXmlLoader` 的精确映射。基线实测自
`F:\FOSim\FOSimEngine\src\modules\extern\bt_xml_loader.cpp` 与 `F:\FOSim\FZFOSimModel\ModelDatabase\BehaviacTree\*.bt`。

## 文件头与根

```xml
<?xml version='1.0' encoding='utf-8'?>
<Root id="1" projectType="行为树" name="..." btTemplateId="..." modelId="..." cognition="...">
  <Blackboards> ... </Blackboards>
  <ReferencedBehaviorTrees />
  <!-- 恰好一个行为根节点 -->
</Root>
```

- `projectType` **必须**为 `行为树`(loader 强校验)。
- Root 必须且只能有 1 个行为节点子节点。
- 节点 `id` 为唯一非零正整数(导出时按 BFS 从 1 重新编号)。

## 节点元素名(注意与 kind 不同名)

| 设计态 nodeType / runtimeKind | XML 元素名 |
| --- | --- |
| Loop | `DecoratorLoop`(属性 `count`) |
| SuccessUntil | `DecoratorSuccessUntil`(`count`) |
| FailureUntil | `DecoratorFailureUntil`(`count`) |
| Subtree | `SubTree`(`btTemplateId` / `btInstanceId` / `paramStates`) |
| Sequence/Selector/And/Or/Parallel/IfElse/MonitorBranch/SelectMonitor | 同名 |
| Invert/ConditionTransform/AlwaysSuccess/AlwaysFailure/End/Null | 同名 |
| Action/Wait | `Action` |
| Condition | `Condition` |

## 节点属性

- Action/Condition/ConditionTransform:`function` 或 `script` / `scriptRef`;组件选择器 `mdataName`(=modelName)、`className`、`typeName`、`componentId`、`componentName`。
- Parallel:`successThreshold` / `failureThreshold`。
- End:`status="SUCCESS|Failure"`、`externalTree`。
- 输入捕获:`inputCapture="onEnter"`。

## 黑板

```xml
<Blackboards>
  <Blackboard linked="true" scope="global" name="空战全局板" id="nd_air_global">
    <Variable key="scan_azimuth" id="bb_scan_azimuth" type="FZRealType" value="45" />
  </Blackboard>
</Blackboards>
```

`scope` 为 `global` / `local`;`type` 取 FOSim 习惯类型串(`FZRealType`/`FZIntegerType`/`FZStringType`/`FZBOOL`/...),由 `malType` 推导。

## 输入 / 输出绑定

```xml
<Inputs>
  <Input name="DURATION_TIME" type="FZRealType" source="blackboard" blackboardKey="nd_air_global" variableKey="bb_duration" />
  <Input name="JAM_TYPE" type="FZIntegerType" value="1" />
</Inputs>
<Outputs>
  <Output name="JAMMER_STATUS" blackboardKey="nd_state" variableKey="state_jammer_status" />
</Outputs>
```

## 条件比较(comparetype=Output)

```xml
<Condition id="3" name="查询状态" function="QueryJammerState" comparetype="Output">
  <Outputs>
    <Output name="JAMMER_STATUS" blackboardKey="nd_state" variableKey="state_jammer_status" />
  </Outputs>
  <Output name="JAMMER_STATUS" op="eq" value="1" />
</Condition>
```

`op` ∈ `eq|ne|gt|ge|lt|le`。

## loader 结构校验

- Root 恰好 1 子;Composite 必须有子;Decorator 恰好 1 子;IfElse 恰好 3 子;MonitorBranch 恰好 2 子;最大深度 512。

## displayType → malType → XML type

见 `packages/bt-core/src/mal/malMapping.ts`。例:`int→FZ_MARGTYPE_INTEGER→FZIntegerType`、
`float→FZ_MARGTYPE_REAL→FZRealType`、`bool→FZ_MARGTYPE_BOOL→FZBOOL`、`string→FZ_MARGTYPE_STRING→FZStringType`、
`coordinate→FZ_MARGTYPE_COORDINATE`、`position→FZ_MARGTYPE_POSITION`。

---

# 设计态 XML(R3 新增,全 XML 持久化)

运行 `*.bt.xml`(上文)不变;以下为设计态/类型/工程持久化格式,全部 XML(不再用 JSON)。

## meta.xml(类型系统,behaviac 风格)— `packages/bt-core/src/export/metaXml.ts`

```xml
<?xml version='1.0' encoding='utf-8'?>
<meta>
  <types>
    <enumtype Type="WeaponState" DisplayName="武器状态">
      <enum NativeValue="Idle" Value="Idle" DisplayName="待机" />
    </enumtype>
    <struct Type="Vec2" DisplayName="Vec2"><Member Name="x" Type="float" Public="true" /></struct>
  </types>
  <agents>
    <agent classfullname="FZAirFighter" base="behaviac::Agent" DisplayName="战机" IsRefType="true">
      <Member Name="speed" Class="FZAirFighter" Type="float" Static="false" Public="true" />
      <Member Name="g_round" Class="FZAirFighter" Type="int" Static="true" Public="true" />
      <Method Name="Engage" Class="FZAirFighter" ReturnType="behaviac::EBTStatus" Static="false" istask="false">
        <Param Name="TARGET" Type="string" DisplayName="目标" />
        <Param Name="RESULT" Type="int" IsRef="true" DisplayName="结果" />
      </Method>
    </agent>
  </agents>
  <instances />
</meta>
```

- 函数目录 = Agent 的 `<Method>`;`<Param IsRef="true">` = 输出参数。
- 变量 = Agent 的 `<Member>`;`Static="true"` = 全局黑板候选,否则本地黑板候选。
- 根类绑定:行为树的 `rootClass` 决定其 Action/Condition 函数只来自该类的方法。

## workspace.xml(单一工程持久化)— `packages/bt-core/src/export/workspaceXml.ts`

```xml
<?xml version='1.0' encoding='utf-8'?>
<Workspace name="proj" language="cpp">
  <meta>...内联 meta...</meta>
  <GlobalBlackboards>
    <Blackboard id="nd_g" name="全局板" scope="global">
      <Variable key="speed" id="v1" type="FZRealType" value="10" displayType="float" />
    </Blackboard>
  </GlobalBlackboards>
  <Behaviors>
    <Behavior name="主树" kind="behavior_tree" rootClass="FZAirFighter"><Root .../></Behavior>
    <Behavior name="巡逻机" kind="state_machine"><Root projectType="状态机"><FSMNodes/></Root></Behavior>
  </Behaviors>
</Workspace>
```

## FSM XML(状态机)— `packages/bt-core/src/export/fsmXml.ts`

```xml
<?xml version='1.0' encoding='utf-8'?>
<Root id="1" projectType="状态机" name="巡逻机">
  <FSMNodes>
    <Node Class="State" Id="1" Name="巡逻" Method="Patrol">
      <Attachment Class="TransitionCondition" Id="3" TargetFSMNodeId="2" Operator="eq" Opl="SeeEnemy" Opr="1" />
    </Node>
    <Node Class="State" Id="2" Name="追击" Method="Chase" IsEndState="true" />
  </FSMNodes>
</Root>
```

> FOSim `BTXmlLoader` 无 FSM 加载器,FSM XML 面向 behaviac 兼容运行时。

## C++ 代码生成 — `packages/bt-core/src/export/codegen/cppCodegen.ts`

由 meta 生成 `types/btstudio_types.h`(enum/struct)与每类 `types/internal/<Class>.h`
(类声明 + 成员 + 方法签名,含 `///<<< BEGIN/END` 保留区,只可改保留区内代码)。
