/**
 * 场景 .sdata 解析 + 行为树挂接(R4)。逻辑放 TS 以便单测;文件读写由 Rust 负责。
 *
 * .sdata 结构(已勘察):
 *  <Units><Unit><ObjectHandle>1</><Name>J-10</><TypeOfUnit>飞机</><ModelID>uuid</>
 *     <ModelData><FzFixedWing data_id="uuid">..</FzFixedWing><FzAPSDP data_id="uuid"/>..</ModelData></Unit></Units>
 *  <BehaviorLogic><BehaviorTreeInstances>
 *     <BehaviorTreeInstance id="1" name=".." belongUnit="1" enable="true" paramStates="complete"><Root .../></BehaviorTreeInstance>
 *  </BehaviorTreeInstances><StateMachineInstances>..</StateMachineInstances></BehaviorLogic>
 */
import { XMLParser } from "fast-xml-parser";

export interface ScenarioComponent {
  className: string;
  componentId: string; // data_id
}
export interface ScenarioUnit {
  objectHandle: string;
  name: string;
  typeOfUnit?: string;
  modelId?: string;
  components: ScenarioComponent[];
}

function arr<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** 解析 .sdata 的 Units(含每实体的组件 className+data_id)。 */
export function parseScenarioUnits(sdataXml: string): ScenarioUnit[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: () => false });
  let root: Record<string, unknown>;
  try {
    root = parser.parse(sdataXml) as Record<string, unknown>;
  } catch {
    return [];
  }
  // 找到包含 Units 的层(场景根名不固定)
  const findUnits = (obj: unknown): Record<string, unknown> | undefined => {
    if (!obj || typeof obj !== "object") return undefined;
    const o = obj as Record<string, unknown>;
    if (o["Units"]) return o["Units"] as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const r = findUnits(o[k]);
      if (r) return r;
    }
    return undefined;
  };
  const unitsNode = findUnits(root);
  if (!unitsNode) return [];
  const units: ScenarioUnit[] = [];
  for (const u of arr<Record<string, unknown>>(unitsNode["Unit"] as never)) {
    const md = (u["ModelData"] as Record<string, unknown>) ?? {};
    const components: ScenarioComponent[] = [];
    // 新版形态:<ModelData><FzFixedWing data_id="uuid"/>...</ModelData>
    // 老版形态:<ModelData><中文名><FzOOIC uuid="1" name="..." type="Cognition" .../></中文名></ModelData>
    //         即 ModelData 下先有一层"模型名"包装层,再列组件。
    const collect = (container: Record<string, unknown>) => {
      for (const [key, val] of Object.entries(container)) {
        for (const comp of arr<Record<string, unknown>>(val as never)) {
          if (!comp || typeof comp !== "object") continue;
          const c = comp as Record<string, unknown>;
          // data_id(新)或 uuid(老)。
          const compId = String(c["@_data_id"] ?? c["@_uuid"] ?? "");
          if (compId) components.push({ className: key, componentId: compId });
        }
      }
    };
    collect(md);
    // 老版:ModelData 只有一层中文包装时,components 会把"中文名"误当 className 又拿不到 id。
    // 此时再下钻一层。
    if (components.length === 0) {
      for (const inner of Object.values(md)) {
        if (inner && typeof inner === "object") collect(inner as Record<string, unknown>);
      }
    }
    units.push({
      objectHandle: String(u["ObjectHandle"] ?? ""),
      name: String(u["Name"] ?? ""),
      typeOfUnit: u["TypeOfUnit"] ? String(u["TypeOfUnit"]) : undefined,
      modelId: u["ModelID"] ? String(u["ModelID"]) : undefined,
      components,
    });
  }
  return units;
}

/**
 * 老版分支:把 BT 名字写进 <Unit><Script>ADD Behaviac "name";</Script></Unit>。
 * - 老引擎解析想定时执行 Script 命令,在 Unit 上挂行为树(按 BT 文件名找 <Root cognition="...">)。
 * - 若该 Unit 已有同名 ADD Behaviac,根据 policy 决定 reject / overwrite。
 *
 * @param sdataXml 整份 .sdata 文本(我们做基于行/正则的局部替换以保留中文 + 注释)
 * @param unitName 目标 Unit 的 <Name>(老想定 Unit 顺序按 <Name> 索引,而非 uuid)
 * @param btName 要挂载的行为树名(对应 ModelDatabase/BehaviacTree/<btName>.bt)
 * @param policy reject = 同名已存在则拒绝;overwrite = 直接替换;backup_then_overwrite = 由调用方负责备份再 overwrite
 */
export function attachOldScenario(
  sdataXml: string,
  unitName: string,
  btName: string,
  policy: AttachPolicy,
): AttachOutcome {
  const cmd = `ADD Behaviac "${btName}";`;
  // 锁定到目标 Unit:从 <Unit> ... <Name>X</Name> ... </Unit> 中找包含 <Name>unitName</Name> 的那段
  // 用一个稳健的 unitRe,允许中间有任意空白与子节点
  const unitRe = new RegExp(
    `(<Unit\\b[^>]*>)([\\s\\S]*?<Name>\\s*${escapeRe(unitName)}\\s*</Name>[\\s\\S]*?)(</Unit>)`,
    "m",
  );
  const m = unitRe.exec(sdataXml);
  if (!m) {
    return { ok: false, conflict: false, message: `未找到名为 ${unitName} 的 Unit` };
  }
  const before = m[1]!;
  let inner = m[2]!;
  const after = m[3]!;

  // 在该 Unit 的 <Script>...</Script> 内插入/替换。<Script> 可能为 <Script></Script> 或带原命令。
  const scriptRe = /<Script>([\s\S]*?)<\/Script>/;
  const scriptMatch = scriptRe.exec(inner);
  let conflict = false;
  if (scriptMatch) {
    const body = scriptMatch[1]!;
    const dupRe = new RegExp(`ADD\\s+Behaviac\\s+"${escapeRe(btName)}"\\s*;`, "i");
    const hasDup = dupRe.test(body);
    if (hasDup && policy === "reject") {
      return { ok: false, conflict: true, message: `Unit ${unitName} 已挂载 ${btName},reject 拒绝` };
    }
    conflict = hasDup;
    let nextBody: string;
    if (hasDup) nextBody = body.replace(dupRe, cmd);
    else nextBody = body.trim() ? body.replace(/\s*$/, "") + "\n      " + cmd + "\n    " : cmd;
    inner = inner.replace(scriptRe, `<Script>${nextBody}</Script>`);
  } else {
    // 没有 <Script> 节点:在 </Unit> 前插入
    inner = inner.replace(/(\s*)$/, `\n      <Script>${cmd}</Script>$1`);
  }
  const newXml = sdataXml.slice(0, m.index) + before + inner + after + sdataXml.slice(m.index + m[0].length);
  return {
    ok: true,
    xml: newXml,
    conflict,
    message: conflict
      ? `已替换 Unit ${unitName} 的 ADD Behaviac "${btName}"`
      : `已写入 Unit ${unitName}:ADD Behaviac "${btName}"`,
  };
}

/** 挂接校验:树中每个 类→方法 节点,实体须有该 className 组件,且模型该类须含此方法。 */
export interface AttachIssue {
  nodeId: string;
  nodeName: string;
  className: string;
  functionRef: string;
  level: "error" | "ok";
  reason: string;
}
export interface AttachValidation {
  issues: AttachIssue[];
  errorCount: number;
}

export function validateTreeForUnit(
  tree: { nodes: Record<string, { nodeId: string; nodeType: string; name: string; functionRef?: string; targetSelector?: { modelClass?: string } }> },
  unit: ScenarioUnit,
  functions: { name: string; ownerClass?: string; bindingTarget: string }[],
): AttachValidation {
  const compClasses = new Set(unit.components.map((c) => c.className));
  const FN_TYPES = new Set(["Action", "Condition", "ConditionTransform", "Wait", "State"]);
  const issues: AttachIssue[] = [];
  for (const node of Object.values(tree.nodes)) {
    if (!FN_TYPES.has(node.nodeType)) continue;
    if (!node.functionRef) continue;
    const cls = node.targetSelector?.modelClass ?? "";
    if (!cls) {
      issues.push({ nodeId: node.nodeId, nodeName: node.name, className: "", functionRef: node.functionRef, level: "error", reason: "节点未选类" });
      continue;
    }
    if (!compClasses.has(cls)) {
      issues.push({ nodeId: node.nodeId, nodeName: node.name, className: cls, functionRef: node.functionRef, level: "error", reason: `实体 ${unit.name} 无 ${cls} 组件` });
      continue;
    }
    const has = functions.some((f) => f.name === node.functionRef && (f.ownerClass ?? f.bindingTarget.split(".")[0]) === cls);
    if (!has) {
      issues.push({ nodeId: node.nodeId, nodeName: node.name, className: cls, functionRef: node.functionRef, level: "error", reason: `组件类 ${cls} 不含方法 ${node.functionRef}` });
      continue;
    }
    issues.push({ nodeId: node.nodeId, nodeName: node.name, className: cls, functionRef: node.functionRef, level: "ok", reason: "组件含该函数" });
  }
  return { issues, errorCount: issues.filter((i) => i.level === "error").length };
}

export type AttachPolicy = "reject" | "overwrite" | "backup_then_overwrite";

export interface AttachOptions {
  instanceName: string;
  belongUnit: string;
  btTemplateId: string;
  modelId: string;
  /** 运行 XML(含 <?xml?> 头)或仅 <Root>..</Root>。 */
  treeXml: string;
  policy: AttachPolicy;
}

export interface AttachOutcome {
  ok: boolean;
  xml?: string;
  conflict: boolean;
  message: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把当前树挂接进 .sdata 的 BehaviorLogic;返回新 XML。 */
export function attachTreeToScenario(sdataXml: string, opts: AttachOptions): AttachOutcome {
  const rootBlock = opts.treeXml.replace(/^<\?xml[^>]*\?>\s*/i, "").trim();
  if (!rootBlock.startsWith("<Root")) {
    return { ok: false, conflict: false, message: "树 XML 缺少 <Root> 根" };
  }
  const indented = rootBlock
    .split("\n")
    .map((l) => "        " + l)
    .join("\n");
  const instanceBlock =
    `      <BehaviorTreeInstance id="1" name="${opts.instanceName}" belongUnit="${opts.belongUnit}" enable="true" paramStates="complete">\n` +
    `${indented}\n` +
    `      </BehaviorTreeInstance>`;

  let xml = sdataXml;
  const dupRe = new RegExp(
    `[ \\t]*<BehaviorTreeInstance\\b[^>]*\\bname="${escapeRe(opts.instanceName)}"[^>]*>[\\s\\S]*?<\\/BehaviorTreeInstance>\\n?`,
  );
  const hasDup = dupRe.test(xml);
  if (hasDup && opts.policy === "reject") {
    return { ok: false, conflict: true, message: `已存在同名实例 ${opts.instanceName},策略 reject 拒绝写回` };
  }
  if (hasDup) xml = xml.replace(dupRe, "");

  if (/<BehaviorTreeInstances>/.test(xml)) {
    xml = xml.replace(/([ \t]*)<\/BehaviorTreeInstances>/, `${instanceBlock}\n$1</BehaviorTreeInstances>`);
  } else if (/<BehaviorLogic>/.test(xml)) {
    xml = xml.replace(/<BehaviorLogic>/, `<BehaviorLogic>\n    <BehaviorTreeInstances>\n${instanceBlock}\n    </BehaviorTreeInstances>`);
  } else {
    // 在场景根闭合标签前插入
    const m = xml.match(/\n([ \t]*)<\/[A-Za-z_][\w.-]*>\s*$/);
    const block = `  <BehaviorLogic>\n    <BehaviorTreeInstances>\n${instanceBlock}\n    </BehaviorTreeInstances>\n  </BehaviorLogic>\n`;
    if (m && m.index !== undefined) {
      xml = xml.slice(0, m.index + 1) + block + xml.slice(m.index + 1);
    } else {
      xml = xml + "\n" + block;
    }
  }

  return {
    ok: true,
    xml,
    conflict: hasDup,
    message: hasDup ? `已替换同名实例 ${opts.instanceName}` : `已挂接 ${opts.instanceName} 到 belongUnit=${opts.belongUnit}`,
  };
}
