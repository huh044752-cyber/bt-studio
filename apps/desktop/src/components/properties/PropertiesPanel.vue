<script setup lang="ts">
import { computed } from "vue";
import {
  defaultRegistry, VALID_COMPARE_OPS, COMPARE_OP_LABELS,
  functionOwnerClass, malFzLabel, isWritebackCompatible, validateMalValueConversion,
  type DesignNode, type Variable,
} from "@btstudio/bt-core";
import { useWorkspaceStore } from "@/stores/workspace";
import { describeNode } from "@/utils/nodeInfo";

const ws = useWorkspaceStore();

const node = computed(() => ws.selectedNode);
const def = computed(() => (node.value ? defaultRegistry.get(node.value.nodeType) : undefined));
const info = computed(() => {
  void ws.rev;
  return node.value ? describeNode(node.value, ws.currentTree, ws.functionCatalog) : undefined;
});
const schema = computed(() => def.value?.properties ?? []);
const isFnNode = computed(() =>
  ["Action", "Condition", "ConditionTransform", "Wait", "State", "ConditionTransition"].includes(node.value?.nodeType ?? ""),
);

const funcOutputs = computed(() => info.value?.outputs ?? []);
const hasFuncOutput = computed(() => funcOutputs.value.length > 0);
const compareOpLabel = (op: string) => COMPARE_OP_LABELS[op as keyof typeof COMPARE_OP_LABELS] ?? op;

function showField(p: { propName: string; dependsOn?: string }): boolean {
  const n = node.value;
  if (!n) return false;
  if (p.propName === "compareOutputName") return n.compareType === "Output";
  if (p.dependsOn === "compareType" && n.nodeType === "Condition") return !!n.compareType;
  return true;
}

const nodeIssues = computed(() => ws.issues.filter((i) => i.nodeId === node.value?.nodeId));

const nodeClass = computed(() => node.value?.targetSelector?.modelClass ?? "");
const modelClasses = computed(() => { void ws.rev; return ws.classes; });
const methodsForClass = computed(() => {
  void ws.rev;
  const cls = nodeClass.value;
  if (!cls) return [];
  // 不按 action/condition 分类过滤:条件节点也可以选动作类方法,只看返回值/输出字段判定。
  return ws.functionCatalog.functions.filter((f) => functionOwnerClass(f) === cls);
});

const stateOptions = computed(() => {
  void ws.rev;
  const t = ws.currentTree;
  if (!t) return [] as { nodeId: string; name: string }[];
  return Object.values(t.nodes).filter((n) => n.nodeType === "State").map((n) => ({ nodeId: n.nodeId, name: n.name }));
});

/** 可见黑板按全局/本地分组(用于 <optgroup> 分级显示)。 */
const blackboardGroups = computed<{ label: string; scope: string; variables: Variable[] }[]>(() => {
  void ws.rev;
  const id = ws.currentTreeId;
  if (!id) return [];
  return ws.visibleBlackboards(id).map((bb) => ({
    label: bb.scope === "global" ? `◈ ${bb.name}(全局)` : `◇ ${bb.name}(本地)`,
    scope: bb.scope,
    variables: bb.variables,
  })).filter((g) => g.variables.length > 0);
});

/** 按输出参数 malType 过滤可选回写变量:类型对应才能回写。 */
function candidatesForOutput(paramName: string): { label: string; scope: string; variables: Variable[] }[] {
  const n = node.value;
  if (!n) return blackboardGroups.value;
  const fn = ws.functionCatalog.functions.find(
    (f) => f.name === n.functionRef && functionOwnerClass(f) === (n.targetSelector?.modelClass ?? ""),
  );
  const param = fn?.params.find((p) => p.name === paramName);
  if (!param) return blackboardGroups.value;
  return blackboardGroups.value.map((g) => ({
    ...g,
    variables: g.variables.filter((v) =>
      isWritebackCompatible(param.malType, v.malType, param.displayType, v.displayType),
    ),
  })).filter((g) => g.variables.length > 0);
}

/** 所有可见变量(输入绑定选黑板变量用,不限类型)。 */
const variableCandidates = computed<Variable[]>(() => {
  void ws.rev;
  const id = ws.currentTreeId;
  return id ? ws.visibleBlackboards(id).flatMap((b) => b.variables) : [];
});

function patch(p: Partial<DesignNode>) {
  if (!node.value) return;
  ws.run({ kind: "UpdateNodeProperty", nodeId: node.value.nodeId, patch: p });
}

function setNodeClass(className: string) {
  const n = node.value;
  if (!n) return;
  ws.run({ kind: "UpdateNodeProperty", nodeId: n.nodeId,
    patch: { targetSelector: { ...(n.targetSelector ?? {}), modelClass: className }, functionRef: "", inputBindings: [], outputBindings: [] } });
}

function bindMethod(methodName: string) {
  const n = node.value;
  if (!n) return;
  const fn = ws.functionCatalog.functions.find(
    (f) => f.name === methodName && functionOwnerClass(f) === nodeClass.value,
  );
  const inputs = (fn?.params ?? []).filter((p) => p.direction !== "output").map((p) => ({
    name: p.name, type: p.originalType ?? (p.malType ? malFzLabel(p.malType) : ""),
    source: "constant" as const, value: p.defaultValue ?? "",
    displayType: p.displayType, malType: p.malType, valueFormat: p.valueFormat,
  }));
  const outputs = (fn?.params ?? []).filter((p) => p.direction === "output").map((p) => ({
    name: p.name, blackboardId: "", variableId: "", displayType: p.displayType, malType: p.malType,
  }));
  ws.run({ kind: "BindFunction", nodeId: n.nodeId, functionRef: methodName, inputBindings: inputs, outputBindings: outputs });
}

function setParamSource(index: number, variableId: string) {
  const n = node.value;
  if (!n) return;
  const b = n.inputBindings[index];
  if (!b) return;
  if (variableId) {
    const v = variableCandidates.value.find((x) => x.variableId === variableId);
    const bb = ws.visibleBlackboards(ws.currentTreeId).find((x) => x.variables.some((y) => y.variableId === variableId));
    b.source = "blackboard"; b.variableId = variableId; b.blackboardId = bb?.blackboardId;
    if (v?.malType) b.malType = v.malType;
  } else {
    b.source = "constant"; b.variableId = undefined; b.blackboardId = undefined;
  }
  ws.bump(); ws.validate();
}

/** 输入参数常量值即时校验:返回错误消息(无错返回 undefined)。 */
function paramError(binding: { value?: string; malType?: string; source?: string }): string | undefined {
  if (binding.source === "blackboard") return undefined;
  if (!binding.malType) return undefined;
  const val = binding.value ?? "";
  const res = validateMalValueConversion(val, binding.malType as never, "literal");
  return res.ok ? undefined : res.message;
}

/** 设置输出回写变量(variableId 为空 = 不回写)。 */
function setOutputVar(bindingIndex: number, variableId: string) {
  const n = node.value;
  if (!n) return;
  const b = n.outputBindings[bindingIndex];
  if (!b) return;
  if (variableId) {
    const bb = ws.visibleBlackboards(ws.currentTreeId).find((x) => x.variables.some((y) => y.variableId === variableId));
    b.variableId = variableId; b.blackboardId = bb?.blackboardId ?? "";
  } else {
    b.variableId = ""; b.blackboardId = "";
  }
  ws.bump(); ws.validate();
}
</script>

<template>
  <div v-if="!node" class="empty muted-2">未选中节点</div>
  <div v-else :key="node.nodeId" class="props scroll">
    <div class="head">
      <span class="tag" :class="def?.colorToken">{{ def?.displayName ?? node.nodeType }}</span>
      <span class="mono muted-2">{{ node.nodeId.slice(0, 14) }}</span>
    </div>

    <!-- 节点描述(与画布悬停提示同一数据源 describeNode,行为树/状态机统一) -->
    <div v-if="info" class="desc-block">
      <div v-if="info.typeDesc" class="desc-type">{{ info.typeDesc }}</div>
      <div v-if="info.method" class="desc-row">
        <span class="muted-2">方法</span> <b>{{ info.method }}</b>
        <span v-if="info.methodDesc" class="desc-method"> — {{ info.methodDesc }}</span>
      </div>
      <div v-if="info.params.length" class="desc-params">
        <span class="muted-2">参数</span>
        <div v-for="p in info.params" :key="p.name" class="desc-param">
          · {{ p.name }} <span class="mono muted-2">{{ p.type }}</span>
          <span v-if="p.dir === 'output'" class="tag info">出</span>
          <span v-if="p.required" class="req">*</span>
          <span v-if="p.desc" class="muted-2"> — {{ p.desc }}</span>
        </div>
      </div>
      <div v-if="info.judgment" class="desc-row desc-judge">
        <span class="muted-2">判断</span> <b>{{ info.judgment }}</b>
      </div>
      <div v-if="info.targetState" class="desc-row">
        <span class="muted-2">→ 目标状态</span> <b>{{ info.targetState }}</b>
      </div>
      <div v-if="info.endState" class="desc-row ok-text">结束态</div>
    </div>

    <div v-if="nodeIssues.length" class="issues">
      <div v-for="(i, idx) in nodeIssues" :key="idx" class="issue" :class="i.level">
        <span class="tag" :class="i.level">{{ i.level }}</span> {{ i.message }}
      </div>
    </div>

    <!-- 类型空间为空时:绑定无意义,引导先准备类型 -->
    <div v-if="isFnNode && modelClasses.length === 0" class="bind-block no-type">
      <span class="tag warning">无类型</span>
      类型空间为空,绑定函数无意义。请先到「工作空间 → 模型类型抽取」勾选真实模型类,或在「类型空间」新建类。
    </div>
    <!-- 每节点 类→方法 绑定(Action/Condition/State 等)。类来自真实模型/用户类。 -->
    <div v-else-if="isFnNode" class="form bind-block">
      <label class="field">
        <span class="lbl">类 (Class) <span class="req">*</span></span>
        <select class="select" :value="nodeClass" @change="setNodeClass(($event.target as HTMLSelectElement).value)">
          <option value="">— 选择类 —</option>
          <option v-for="c in modelClasses" :key="c.classId" :value="c.className">
            {{ c.displayName || c.className }}{{ c.source === 'model' ? '' : ' [用户]' }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">方法 (Method) <span class="req">*</span></span>
        <select class="select" :value="node.functionRef ?? ''" :disabled="!nodeClass" @change="bindMethod(($event.target as HTMLSelectElement).value)">
          <option value="">— 选择方法 —</option>
          <option v-for="m in methodsForClass" :key="m.functionId" :value="m.name">
            {{ m.displayName || m.name }} ({{ m.category }})
          </option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">组件 componentId <span class="muted-2 hint">(挂接场景时由实体回填)</span></span>
        <input class="input" :value="node.targetSelector?.componentId ?? ''"
          @input="patch({ targetSelector: { ...(node.targetSelector ?? {}), componentId: ($event.target as HTMLInputElement).value } })" />
      </label>
    </div>

    <div class="form section">
      <div class="sec-title muted-2">属性</div>
      <template v-for="p in schema" :key="p.propName">
        <!-- function-picker 已由上方「类→方法」取代,跳过 -->
        <template v-if="p.editorType === 'function-picker'" />
        <label v-else-if="p.editorType !== 'target-picker' && showField(p)" class="field">
          <span class="lbl">
            {{ p.displayName }}
            <span v-if="p.required" class="req">*</span>
            <span v-if="p.noExport" class="muted-2 hint">(仅Meta)</span>
          </span>

          <select
            v-if="p.editorType === 'subtree-picker'"
            class="select"
            :value="node.subtreeRef ?? ''"
            @change="patch({ subtreeRef: ($event.target as HTMLSelectElement).value })"
          >
            <option value="">— 选择子树 —</option>
            <option v-for="t in ws.trees.filter((x) => x.treeId !== ws.currentTreeId)" :key="t.treeId" :value="t.treeId">
              {{ t.displayName }}
            </option>
          </select>

          <select
            v-else-if="p.editorType === 'target-state-picker'"
            class="select"
            :value="node.transitionTarget ?? ''"
            @change="patch({ transitionTarget: ($event.target as HTMLSelectElement).value })"
          >
            <option value="">— 选择目标状态 —</option>
            <option v-for="s in stateOptions.filter((x) => x.nodeId !== node!.nodeId)" :key="s.nodeId" :value="s.nodeId">
              {{ s.name }}
            </option>
          </select>

          <!-- 比较模式:Function(比较返回值)/ Output(比较输出字段)。无函数输出时禁用 Output。 -->
          <template v-else-if="p.propName === 'compareType'">
            <select
              class="select"
              :value="node.compareType ?? ''"
              @change="patch({ compareType: ($event.target as HTMLSelectElement).value } as any)"
            >
              <option value="">— 不比较(用返回状态) —</option>
              <option value="Function">函数比较(比较返回值)</option>
              <option value="Output" :disabled="!hasFuncOutput">
                输出比较(比较输出字段){{ hasFuncOutput ? "" : " · 需函数有输出" }}
              </option>
            </select>
          </template>

          <!-- 输出比较字段:从函数的输出参数里选,而非手填。 -->
          <select
            v-else-if="p.propName === 'compareOutputName'"
            class="select"
            :value="node.compareOutputName ?? ''"
            @change="patch({ compareOutputName: ($event.target as HTMLSelectElement).value } as any)"
          >
            <option value="">— 选择输出字段 —</option>
            <option v-for="o in funcOutputs" :key="o.name" :value="o.name">
              {{ o.name }}{{ o.type ? ` (${o.type})` : "" }}
            </option>
          </select>

          <!-- 比较运算:显示符号 == / != / > / >= / < / <=(存储仍为 eq/ne/...)。 -->
          <select
            v-else-if="p.editorType === 'compare-op'"
            class="select compare-op"
            :value="(node as any)[p.propName] ?? ''"
            @change="patch({ [p.propName]: ($event.target as HTMLSelectElement).value } as any)"
          >
            <option value="">—</option>
            <option v-for="op in VALID_COMPARE_OPS" :key="op" :value="op">{{ compareOpLabel(op) }}</option>
          </select>

          <select
            v-else-if="p.editorType === 'enum'"
            class="select"
            :value="(node as any)[p.propName] ?? ''"
            @change="patch({ [p.propName]: ($event.target as HTMLSelectElement).value } as any)"
          >
            <option value="">—</option>
            <option v-for="ev in p.enumValues" :key="ev" :value="ev">{{ ev }}</option>
          </select>

          <input
            v-else-if="p.editorType === 'boolean'"
            type="checkbox"
            class="checkbox"
            :checked="!!(node as any)[p.propName]"
            @change="patch({ [p.propName]: ($event.target as HTMLInputElement).checked } as any)"
          />

          <input
            v-else-if="p.editorType === 'number'"
            type="number"
            class="input"
            :value="(node as any)[p.propName] ?? ''"
            @input="patch({ [p.propName]: Number(($event.target as HTMLInputElement).value) } as any)"
          />

          <input
            v-else
            class="input"
            :value="(node as any)[p.propName] ?? ''"
            @input="patch({ [p.propName]: ($event.target as HTMLInputElement).value } as any)"
          />
        </label>
      </template>
    </div>

    <div v-if="isFnNode && node.inputBindings.length" class="bindings section">
      <div class="sec-title muted-2">输入参数 <span class="hint">FZ 类型 · 常量 / 黑板</span></div>
      <div v-for="(b, i) in node.inputBindings" :key="i" class="binding-row">
        <span class="bname">{{ b.name }}</span>
        <span class="tag info" :title="b.malType">{{ malFzLabel(b.malType, b.displayType) }}</span>
        <select
          class="select tiny src"
          :value="b.source === 'blackboard' ? (b.variableId ?? '') : ''"
          @change="setParamSource(i, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">直接输入</option>
          <optgroup v-for="g in blackboardGroups" :key="g.label" :label="g.label">
            <option v-for="v in g.variables" :key="v.variableId" :value="v.variableId">
              ▣ {{ v.name }} ({{ malFzLabel(v.malType, v.displayType) }})
            </option>
          </optgroup>
        </select>
        <input
          v-if="b.source !== 'blackboard'"
          class="input tiny"
          :class="{ 'in-error': paramError(b) }"
          :value="b.value ?? ''"
          :title="paramError(b)"
          @input="b.value = ($event.target as HTMLInputElement).value; ws.bump(); ws.validate()"
        />
        <span v-if="paramError(b)" class="inline-err" :title="paramError(b)">⚠</span>
      </div>
    </div>

    <div v-if="isFnNode && node.outputBindings.length" class="bindings section">
      <div class="sec-title muted-2">输出参数 <span class="hint">回写黑板 · 不选则保留在原 MAL 数据</span></div>
      <div v-for="(b, i) in node.outputBindings" :key="i" class="binding-row">
        <span class="bname">{{ b.name }}</span>
        <span class="tag warning" :title="b.malType">出 {{ malFzLabel(b.malType, b.displayType) }}</span>
        <select
          class="select tiny src"
          :value="b.variableId ?? ''"
          @change="setOutputVar(i, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">— 不回写(留在 MAL) —</option>
          <optgroup v-for="g in candidatesForOutput(b.name)" :key="g.label" :label="g.label">
            <option v-for="v in g.variables" :key="v.variableId" :value="v.variableId">
              ▣ {{ v.name }} ({{ malFzLabel(v.malType, v.displayType) }})
            </option>
          </optgroup>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty {
  padding: 16px;
}
.props {
  height: 100%;
  padding: 4px 2px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding: 7px 9px;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(94, 179, 255, 0.14), rgba(94, 179, 255, 0.02));
  border: 1px solid var(--line-soft);
  border-left: 3px solid var(--accent, #5eb3ff);
}
.head .tag {
  font-weight: 600;
}
.desc-block {
  margin-bottom: 10px;
  padding: 8px 9px;
  border-radius: 8px;
  background: rgba(94, 179, 255, 0.06);
  border: 1px solid var(--line-soft);
  font-size: 12px;
  line-height: 1.55;
}
.desc-judge b {
  color: #ffd479;
  font-family: var(--mono, monospace);
}
.desc-type {
  color: var(--muted);
  margin-bottom: 4px;
}
.desc-row {
  margin-top: 3px;
}
.desc-method {
  color: var(--muted-2);
}
.desc-params {
  margin-top: 5px;
}
.desc-param {
  padding-left: 4px;
  font-size: 11.5px;
}
.ok-text {
  color: var(--ok);
}
.issues {
  margin-bottom: 8px;
}
.issue {
  font-size: 11.5px;
  padding: 3px 0;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 卡片式分区:属性 / 输入参数 / 输出参数 视觉成组,提升整体层次。 */
.section {
  margin-bottom: 10px;
  padding: 9px 10px 10px;
  border-radius: 8px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.015);
}
.section .sec-title {
  margin: -2px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line-soft);
  letter-spacing: 0.04em;
}
.compare-op {
  font-family: var(--mono, monospace);
  font-weight: 600;
}
.bind-block {
  border: 1px solid rgba(94, 179, 255, 0.25);
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 8px;
  background: rgba(94, 179, 255, 0.05);
}
.bind-block.no-type {
  border-color: rgba(245, 182, 92, 0.4);
  background: rgba(245, 182, 92, 0.07);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--muted);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lbl {
  font-size: 11.5px;
  color: var(--muted);
}
.req {
  color: var(--err);
}
.hint {
  font-size: 10px;
}
.checkbox {
  width: 16px;
  height: 16px;
}
.sec-title {
  font-size: 10px;
  text-transform: uppercase;
  margin-bottom: 5px;
}
.binding-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.bname {
  font-size: 11.5px;
  min-width: 90px;
}
.input.tiny {
  height: 24px;
  font-size: 11px;
}
</style>
