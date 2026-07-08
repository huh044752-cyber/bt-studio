// 端到端脚本:从 workspace.xml 生成完整 C++ 工程(含真引擎 engine-core/)+ tick_check 到指定输出目录。
// 用法: node packages/bt-core/scripts/genKdd.mjs <workspace.xml> <output-dir>
// 例:   node packages/bt-core/scripts/genKdd.mjs F:/0411/ccc/kdd_workspace.workspace.xml F:/0411/ccc/GeneratedCpp/空地打击
//
// 步骤:
//   1. 读 workspace.xml → parseWorkspaceXml 拿 catalog + designTrees + globalBlackboards
//   2. 每棵 designTree 用对应 exporter 生成运行时 XML(BT:xmlSerializer / FSM:fsmXml.exportFsmXml)
//   3. generateProject(input) 得到 skeleton + tests/tick_check.cpp + CMake
//   4. 拷贝 apps/desktop/public/fosim-runtime/ 全部文件到 engine-core/
//   5. 写盘(先清空冲突目录,防止旧 build 干扰)
//   6. 报告文件数与关键路径
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 用编译后的 dist(package.json 的 exports 指向 raw ts,Node 直接跑不了 TS —— 走 main 字段)。
import {
  parseWorkspaceXml,
  generateProject,
  toBehaviorTreeDef,
  serializeBehaviorTreeXml,
  serializeFsmXml,
} from "../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BUNDLE_DIR = path.join(REPO_ROOT, "apps/desktop/public/fosim-runtime");

function readText(p) {
  return fs.readFileSync(p, "utf-8");
}
// 保留用户在 ///<<< BEGIN WRITING YOUR CODE <tag> ... ///<<< END WRITING YOUR CODE <tag>
// 区块里的内容。策略:老文件里出现过的 tag,用老内容替换新内容的同 tag 块;新增 tag 保持新模板。
// 对无 BEGIN 标记的文件(纯 CMake、纯 XML、纯 README 等)直接覆盖 —— 只有生成器约定的用户扩展文件受保护。
const BEGIN_RE = /(\/\/\/<<<\s*BEGIN WRITING YOUR CODE\s+([\w\.\-]+))([\s\S]*?)(\/\/\/<<<\s*END WRITING YOUR CODE\s+\2)/g;
function extractBlocks(text) {
  const map = new Map();
  let m;
  BEGIN_RE.lastIndex = 0;
  while ((m = BEGIN_RE.exec(text)) !== null) {
    map.set(m[2], m[3]); // tag → body between BEGIN 行末与 END 行首
  }
  return map;
}
function mergeUserBlocks(oldText, newText) {
  if (!oldText.includes("///<<< BEGIN WRITING YOUR CODE")) return newText;
  const oldMap = extractBlocks(oldText);
  if (oldMap.size === 0) return newText;
  BEGIN_RE.lastIndex = 0;
  return newText.replace(BEGIN_RE, (whole, beginLine, tag, _body, endLine) => {
    return oldMap.has(tag) ? `${beginLine}${oldMap.get(tag)}${endLine}` : whole;
  });
}
function writeText(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let finalContent = content;
  if (fs.existsSync(p)) {
    try {
      const prev = fs.readFileSync(p, "utf-8");
      finalContent = mergeUserBlocks(prev, content);
    } catch { /* ignore, fall through with fresh content */ }
  }
  fs.writeFileSync(p, finalContent);
}
function listBundleFiles() {
  const mf = JSON.parse(readText(path.join(BUNDLE_DIR, "manifest.json")));
  return mf.files.map((rel) => ({ rel, abs: path.join(BUNDLE_DIR, rel) }));
}

async function main() {
  const [, , workspaceXmlArg, outDirArg] = process.argv;
  const workspaceXmlPath = workspaceXmlArg ?? "F:/0411/ccc/kdd_workspace.workspace.xml";
  const outDir = outDirArg ?? "F:/0411/ccc/GeneratedCpp/空地打击";
  console.log(`[gen] workspace = ${workspaceXmlPath}`);
  console.log(`[gen] outDir    = ${outDir}`);

  const xml = readText(workspaceXmlPath);
  const parsed = parseWorkspaceXml(xml);
  console.log(`[gen] parsed: name=${parsed.name}, classes=${parsed.catalog.classes?.length ?? 0}, trees=${parsed.behaviorTrees.length}`);

  // 每棵 DesignTree → 运行时 XML(BT 或 FSM),恢复成 generateProject 要的字符串输入
  const behaviors = parsed.behaviorTrees.map((t) => {
    const isFsm = (t.projectKind ?? "behavior_tree") === "state_machine";
    const treeXml = isFsm
      ? serializeFsmXml(t)
      : serializeBehaviorTreeXml(toBehaviorTreeDef(t));
    return {
      name: t.treeName ?? t.displayName ?? "tree",
      xml: treeXml,
      kind: isFsm ? "state_machine" : "behavior_tree",
    };
  });

  const input = {
    workspaceName: parsed.name,
    namespace: parsed.config.cppNamespace || "btproj",
    catalog: {
      classes: parsed.catalog.classes ?? [],
      members: parsed.catalog.members ?? [],
      functionCatalog: parsed.catalog.functionCatalog ?? { functions: [] },
      enums: parsed.catalog.enums ?? [],
      structs: parsed.catalog.structs ?? [],
    },
    behaviors,
  };

  const files = generateProject(input);
  console.log(`[gen] generateProject → ${files.length} files`);

  // 追加打包的真引擎文件到 engine-core/
  let engineCount = 0;
  for (const f of listBundleFiles()) {
    if (!fs.existsSync(f.abs)) continue;
    files.push({ path: `engine-core/${f.rel}`, content: readText(f.abs) });
    engineCount++;
  }
  // engine-core/CMakeLists.txt 由 ENGINE_CORE_CMAKE 提供(与 desktop tauri.ts 里字符串一致)。
  // 这里独立生成,免得脚本重复 desktop 端的 400 行字符串常量;简化版对齐 INTERFACE 目标。
  files.push({
    path: "engine-core/CMakeLists.txt",
    content: `cmake_minimum_required(VERSION 3.16)
# engine-core 默认作 INTERFACE(仅暴露真引擎 header,skeleton 的 shim 接口已对齐)。
option(USE_REAL_ENGINE_LOADER "编译业务无关的真解析器(需要 ENGINE_EXTRA_INCLUDE)" OFF)
set(ENGINE_EXTRA_INCLUDE "" CACHE PATH "FOSim 引擎 include 根")

add_library(fosim_engine_core INTERFACE)
target_include_directories(fosim_engine_core INTERFACE
    "\${CMAKE_CURRENT_SOURCE_DIR}/include"
    "\${CMAKE_CURRENT_SOURCE_DIR}/include/FOSim/Engine")
if(ENGINE_EXTRA_INCLUDE)
    target_include_directories(fosim_engine_core INTERFACE "\${ENGINE_EXTRA_INCLUDE}")
endif()

if(USE_REAL_ENGINE_LOADER)
    set(REAL_LOADER_SOURCES
        "\${CMAKE_CURRENT_SOURCE_DIR}/src/modules/extern/bt_xml_loader.cpp"
        "\${CMAKE_CURRENT_SOURCE_DIR}/src/modules/extern/state_machine_loader.cpp"
        "\${CMAKE_CURRENT_SOURCE_DIR}/src/modules/extern/register_wrapper.cpp"
        "\${CMAKE_CURRENT_SOURCE_DIR}/src/pugi/pugixml.cpp")
    add_library(fosim_engine_core_loader STATIC \${REAL_LOADER_SOURCES})
    target_link_libraries(fosim_engine_core_loader PUBLIC fosim_engine_core)
    set_target_properties(fosim_engine_core_loader PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
endif()
`,
  });
  console.log(`[gen] +engine-core: ${engineCount} bundled files`);

  // 清 build/ 防脏(cmake 一路生成会自动 mkdir)
  const buildDir = path.join(outDir, "build");
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log(`[gen] 清空旧 build/`);
  }

  // 写盘
  for (const f of files) {
    writeText(path.join(outDir, f.path), f.content);
  }
  console.log(`[gen] 写盘完成 (${files.length} 个文件) → ${outDir}`);
  console.log(`[gen] 抽样:`);
  for (const key of ["CMakeLists.txt", "app/main.cpp", "tests/tick_check.cpp", "engine-core/include/FOSim/Engine/modules/extern/bt_task.h", "engine-core/CMakeLists.txt"]) {
    console.log(`       ${fs.existsSync(path.join(outDir, key)) ? "✓" : "✗"} ${key}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
