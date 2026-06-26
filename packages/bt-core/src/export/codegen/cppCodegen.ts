/**
 * 由类型目录生成 behaviac 风格 C++(对齐 F:\0411\behaviac behaviac_generated/types)。
 * 生成:每个 Agent 头(类声明 + 成员 + 方法签名,含 ///<<< BEGIN/END 保留区)+ 一个 types 头(enum/struct)。
 * 不导出实现本体/内存/指针(总设计文档 §7.1 边界)。
 */
import type { CatalogBundle } from "../../types/catalog.js";
import { functionOwnerClass } from "../../types/catalog.js";

export interface CppFile {
  path: string;
  content: string;
}

/** displayType/behaviac 类型串 -> C++ 类型(粗映射)。 */
function toCppType(t: string): string {
  const s = (t || "").toLowerCase();
  if (s.includes("bool")) return "bool";
  if (s.includes("float") || s.includes("real")) return "float";
  if (s.includes("double")) return "double";
  if (s.includes("uint")) return "unsigned int";
  if (s.includes("int")) return "int";
  if (s.includes("string")) return "behaviac::string";
  return "behaviac::string";
}

const BEGIN = (tag: string) => `///<<< BEGIN WRITING YOUR CODE ${tag}`;
const END = "///<<< END WRITING YOUR CODE";

function agentHeader(catalog: CatalogBundle, className: string): string {
  const cls = catalog.classes.find((c) => c.className === className);
  const members = catalog.members.filter((m) => cls && m.ownerClassId === cls.classId);
  const methods = catalog.functionCatalog.functions.filter((f) => functionOwnerClass(f) === className);
  const guard = `_BTSTUDIO_${className.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_H_`;
  const lines: string[] = [];
  lines.push("// 由 BT Studio 生成(behaviac 风格)。仅可修改 ///<<< BEGIN/END 之间的代码。");
  lines.push(`#ifndef ${guard}`);
  lines.push(`#define ${guard}`);
  lines.push("");
  lines.push('#include "behaviac/behaviac.h"');
  lines.push("");
  lines.push(BEGIN("FILE_INIT"));
  lines.push(END);
  lines.push("");
  lines.push(`class ${className} : public behaviac::Agent`);
  lines.push("{");
  lines.push("public:");
  lines.push(`    ${className}();`);
  lines.push(`    virtual ~${className}();`);
  lines.push(`    BEHAVIAC_DECLARE_AGENTTYPE(${className}, behaviac::Agent)`);
  lines.push("");
  for (const m of members) {
    const stat = m.static ? "static " : "";
    lines.push(`    ${stat}${toCppType(m.valueType)} ${m.memberName};`);
  }
  if (members.length) lines.push("");
  for (const fn of methods) {
    const stat = fn.static ? "static " : "";
    const ret = fn.category === "condition" ? "bool" : toCppRet(fn.returnType);
    const params = fn.params
      .map((p) => `${toCppType(p.originalType ?? p.displayType)}${p.direction === "output" ? "&" : ""} ${p.name}`)
      .join(", ");
    lines.push(`    ${stat}${ret} ${fn.name}(${params});`);
  }
  lines.push("");
  lines.push(BEGIN("CLASS_PART"));
  lines.push(END);
  lines.push("};");
  lines.push("");
  lines.push(`#endif // ${guard}`);
  return lines.join("\n") + "\n";
}

function toCppRet(returnType: string): string {
  const s = (returnType || "").toLowerCase();
  if (s.includes("ebtstatus") || s.includes("status")) return "behaviac::EBTStatus";
  if (s.includes("void")) return "void";
  return toCppType(returnType);
}

function typesHeader(catalog: CatalogBundle): string {
  const lines: string[] = [];
  lines.push("// 由 BT Studio 生成的类型定义(enum/struct)。请勿手改自动生成区。");
  lines.push("#ifndef _BTSTUDIO_TYPES_H_");
  lines.push("#define _BTSTUDIO_TYPES_H_");
  lines.push("");
  for (const e of catalog.enums) {
    lines.push(`enum ${sanitize(e.name)}`);
    lines.push("{");
    for (const it of e.items) lines.push(`    ${sanitize(it.runtimeValue)},`);
    lines.push("};");
    lines.push("");
  }
  for (const s of catalog.structs) {
    lines.push(`struct ${sanitize(s.name)}`);
    lines.push("{");
    for (const f of s.fields) lines.push(`    ${toCppType(f.displayType)} ${f.fieldName};`);
    lines.push("};");
    lines.push("");
  }
  lines.push("#endif // _BTSTUDIO_TYPES_H_");
  return lines.join("\n") + "\n";
}

function sanitize(n: string): string {
  return n.replace(/[^A-Za-z0-9_]/g, "_");
}

/** 生成全部 C++ 文件。 */
export function generateCpp(catalog: CatalogBundle): CppFile[] {
  const files: CppFile[] = [{ path: "types/btstudio_types.h", content: typesHeader(catalog) }];
  for (const cls of catalog.classes) {
    files.push({
      path: `types/internal/${cls.className}.h`,
      content: agentHeader(catalog, cls.className),
    });
  }
  return files;
}
