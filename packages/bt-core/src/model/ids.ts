/**
 * 稳定 ID 生成与变量 key 合法化(文档 §9.1 / 5.16)。
 *
 * 注意:这里使用模块级计数器 + 时间戳,保证同一进程内不重复。测试中可通过 resetIdCounter 复位。
 */

let counter = 0;

function rand(): string {
  // 36 进制短随机串;在非确定性场景(真实运行)足够。
  return Math.floor(Math.random() * 0xffffff).toString(36);
}

export function resetIdCounter(): void {
  counter = 0;
}

export function prefixedId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${rand()}`;
}

export const newTreeId = () => prefixedId("tree");
export const newNodeId = () => prefixedId("node");
export const newEdgeId = () => prefixedId("edge");
export const newBlackboardId = () => prefixedId("bb");
export const newVariableId = () => prefixedId("var");
export const newFunctionId = () => prefixedId("fn");
export const newEnumId = () => prefixedId("enum");
export const newStructId = () => prefixedId("struct");
export const newLogId = () => prefixedId("log");
export const newSessionId = () => prefixedId("ses");
export const newPackageId = () => prefixedId("pkg");

/** ISO 时间戳。 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 变量 key 合法化(SanitizeVariableKey)。允许字母数字下划线,首字符非数字。
 */
export function sanitizeVariableKey(raw: string): string {
  let key = (raw ?? "").trim().replace(/[^A-Za-z0-9_]/g, "_");
  if (key.length === 0) key = "var";
  if (/^[0-9]/.test(key)) key = `_${key}`;
  return key;
}

export function isValidVariableKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

/**
 * 把编辑器稳定 nodeId 映射为运行态正整数 id。
 * 约定:导出时按 BFS 顺序从 1 递增重新编号,保证 BTXmlLoader 要求的唯一非零正整数。
 */
export function buildNumericIdMap(orderedNodeIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  orderedNodeIds.forEach((nid, idx) => map.set(nid, idx + 1));
  return map;
}
