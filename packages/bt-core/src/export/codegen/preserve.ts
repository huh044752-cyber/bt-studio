/**
 * 保留区合并(对齐 behaviac 代码生成):重新导出时,不覆盖用户在
 * `///<<< BEGIN WRITING YOUR CODE <tag>` ... `///<<< END WRITING YOUR CODE` 之间手写的代码。
 *
 * 用法:写文件前,若目标已存在,mergePreservedRegions(旧内容, 新内容) 把旧文件各保留区的
 * 正文搬到新内容对应 tag 的保留区中,其余(签名/注册/参数读写等)用新生成的。
 */
const BLOCK_RE =
  /\/\/\/<<< BEGIN WRITING YOUR CODE ([^\n\r]*)\r?\n([\s\S]*?)\/\/\/<<< END WRITING YOUR CODE/g;

/** 提取旧内容里所有保留区:tag -> 正文(不含 BEGIN/END 标记行)。 */
function extractBlocks(content: string): Map<string, string> {
  const map = new Map<string, string>();
  let m: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(content)) !== null) {
    const tag = m[1]!.trim();
    if (!map.has(tag)) map.set(tag, m[2]!);
  }
  return map;
}

/**
 * 把 oldContent 中保留区的正文合并进 newContent(按 tag 匹配)。
 * 没有旧内容或没有保留区时,原样返回 newContent。
 */
export function mergePreservedRegions(oldContent: string, newContent: string): string {
  if (!oldContent) return newContent;
  const oldBlocks = extractBlocks(oldContent);
  if (oldBlocks.size === 0) return newContent;
  return newContent.replace(
    BLOCK_RE,
    (full, tag: string, _body: string, ...rest: unknown[]) => {
      const key = tag.trim();
      const kept = oldBlocks.get(key);
      if (kept === undefined) return full;
      // 重建该保留区:用旧正文替换新正文,保留 BEGIN/END 标记行。
      const beginLine = `///<<< BEGIN WRITING YOUR CODE ${tag}`;
      // full 以 BEGIN 行开头;END 标记为固定串。
      const endIdx = full.lastIndexOf("///<<< END WRITING YOUR CODE");
      const beginEol = full.indexOf("\n");
      const eol = full.slice(beginEol, beginEol + 2).startsWith("\r\n") ? "\r\n" : "\n";
      return `${beginLine}${eol}${kept}${full.slice(endIdx)}`;
    },
  );
}

/** 是否包含保留区标记(用于决定是否需要合并)。 */
export function hasPreservedRegions(content: string): boolean {
  return content.includes("///<<< BEGIN WRITING YOUR CODE");
}
