/**
 * 类型系统 -> behaviac 风格 meta.xml(对齐 F:\0411\behaviac *.meta.xml)。
 *
 * 结构:
 *   <meta>
 *     <types>
 *       <enumtype Type Namespace DisplayName><enum NativeValue Value DisplayName/></enumtype>
 *       <struct Type DisplayName><Member Name Type/></struct>
 *     </types>
 *     <agents>
 *       <agent classfullname base DisplayName IsRefType>
 *         <Member Name Type Static Public/>
 *         <Method Name ReturnType Static Public istask><Param Name Type DisplayName/></Method>
 *       </agent>
 *     </agents>
 *   </meta>
 *
 * 函数目录=Agent.methods;变量/类型=Agent.members(static=全局 / instance=本地)+ enum/struct。
 */
import type { CatalogBundle, EnumDescriptor, StructDescriptor } from "../types/catalog.js";
import { functionOwnerClass } from "../types/catalog.js";
import { xmlEscape } from "./xmlSerializer.js";

function attr(name: string, value: string | number | boolean | undefined): string {
  if (value === undefined || value === "" || value === false) return "";
  return ` ${name}="${xmlEscape(String(value))}"`;
}

export function serializeMetaXml(catalog: CatalogBundle): string {
  const lines: string[] = ["<?xml version='1.0' encoding='utf-8'?>", "<meta>"];

  // types
  lines.push("  <types>");
  for (const e of catalog.enums) lines.push(serializeEnum(e));
  for (const s of catalog.structs) lines.push(serializeStruct(s));
  lines.push("  </types>");

  // agents
  lines.push("  <agents>");
  for (const cls of catalog.classes) {
    const members = catalog.members.filter((m) => m.ownerClassId === cls.classId);
    const methods = catalog.functionCatalog.functions.filter(
      (f) => functionOwnerClass(f) === cls.className,
    );
    const head = `    <agent${attr("classfullname", cls.className)}${attr("base", "behaviac::Agent")}${attr("DisplayName", cls.displayName)}${attr("IsRefType", "true")}`;
    if (members.length === 0 && methods.length === 0) {
      lines.push(`${head} />`);
      continue;
    }
    lines.push(`${head}>`);
    for (const m of members) {
      lines.push(
        `      <Member${attr("Name", m.memberName)}${attr("Class", cls.className)}${attr("Type", m.valueType)}${attr("Static", m.static ? "true" : "false")}${attr("Public", "true")}${attr("defaultvalue", m.defaultValue)} />`,
      );
    }
    for (const fn of methods) {
      const mh = `      <Method${attr("Name", fn.name)}${attr("DisplayName", fn.displayName)}${attr("Class", cls.className)}${attr("ReturnType", fn.returnType)}${attr("Static", fn.static ? "true" : "false")}${attr("Public", "true")}${attr("istask", fn.isTask ? "true" : "false")}`;
      const params = fn.params;
      if (params.length === 0) {
        lines.push(`${mh} />`);
        continue;
      }
      lines.push(`${mh}>`);
      for (const p of params) {
        lines.push(
          `        <Param${attr("Name", p.name)}${attr("Type", p.originalType ?? p.malType ?? p.displayType)}${attr("IsRef", p.direction === "output" ? "true" : "")}${attr("DisplayName", p.name)} />`,
        );
      }
      lines.push("      </Method>");
    }
    lines.push("    </agent>");
  }
  lines.push("  </agents>");
  lines.push("  <instances />");
  lines.push("</meta>");
  return lines.join("\n") + "\n";
}

function serializeEnum(e: EnumDescriptor): string {
  const head = `    <enumtype${attr("Type", e.name)}${attr("DisplayName", e.name)}`;
  if (e.items.length === 0) return `${head} />`;
  const lines = [`${head}>`];
  for (const it of e.items) {
    lines.push(`      <enum${attr("NativeValue", it.runtimeValue)}${attr("Value", it.runtimeValue)}${attr("DisplayName", it.displayName)} />`);
  }
  lines.push("    </enumtype>");
  return lines.join("\n");
}

function serializeStruct(s: StructDescriptor): string {
  const head = `    <struct${attr("Type", s.name)}${attr("DisplayName", s.name)}`;
  if (s.fields.length === 0) return `${head} />`;
  const lines = [`${head}>`];
  for (const f of s.fields) {
    lines.push(`      <Member${attr("Name", f.fieldName)}${attr("Type", f.displayType)} Public="true" />`);
  }
  lines.push("    </struct>");
  return lines.join("\n");
}
