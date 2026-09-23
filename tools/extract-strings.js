// Command Code 桌面端 · 界面文案提取 / 差集工具（开发用，不参与运行时）
//
// 用法:
//   node tools/extract-strings.js                          # 全部候选 → tools/candidates.txt
//   node tools/extract-strings.js --missing                # 只列出"字典里还没有"的 → tools/missing.txt
//   node tools/extract-strings.js --missing --print        # 顺便打印到终端
//
// 原理: 只扫应用自己的 chunk（排除 shiki 语法/主题/xterm 终端/图表库）,
//       抓 React 产物里 children/label/description/placeholder/title 等属性后的
//       字符串字面量 —— 这些几乎都是界面文案。

const fs = require("fs");
const path = require("path");

const APP_ROOT =
  process.env.CCZH_APP_ROOT ||
  "E:\\Program\\CommandCode\\Command Code\\resources\\app";
const ASSETS = path.join(APP_ROOT, "out", "renderer", "assets");
const DICT = path.join(__dirname, "..", "dictionary.json");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const ONLY_MISSING = args.includes("--missing");
const PRINT = args.includes("--print");
const MAX_LEN = Number(argValue("--max-len", 1000));
const OUT = argValue(
  "--out",
  path.join(__dirname, ONLY_MISSING ? "missing.txt" : "candidates.txt")
);

// 应用自身的 chunk（按前缀匹配，不受打包哈希影响；其余是 shiki 语法、主题、xterm、mermaid 等第三方产物）
const APP_CHUNK_RE =
  /^(index-|workspace-screen-|settings-panel-|source-panel-|layout-|onboarding-screen-|desktop-|diff-viewer-|terminal-settings-)/;

const SKIP_MARKERS = ["scopeName", "tokenColors", "embeddedLangs", "vscode-textmate"];

// React 产物里界面文案出现的位置
const UI_PROP_RE =
  /(?:children|label|placeholder|title|description|tooltip|heading|message|subtitle|caption|helperText|emptyText|confirmText|cancelText|hint|body|text)\s*:\s*"((?:[^"\\\n]|\\.){1,1000})"/g;

const FILENAME_RE =
  /^[\w.@-]+\.(md|mdx|txt|toml|lock|json|jsonc|js|mjs|cjs|ts|tsx|css|scss|html|png|jpe?g|svg|ico|yml|yaml|xml|sh|bat|ps1|py|rs|go|java|kt|rb|php|c|cpp|h|hpp|cs|swift|sql|env)$/i;

const BAD_CHARS = /[<>\\{}[\]|=;&#@^~`*+$%]/;
const URL_RE = /https?:\/\/|www\.|@[a-z0-9.-]+\.[a-z]{2,}/i;
const CSSY_RE =
  /(flex|grid|min-w-|min-h-|max-w-|max-h-|px-|py-|mt-|mb-|gap-|bg-|border-|rounded|truncate|absolute|relative|items-|justify-|hover:|focus:|var\(|sans-serif|serif|monospace)/;
const CODEY_RE =
  /(\bfunction\b|\breturn\b|\bconst\b|=>|\.map\(|\.filter\(|JSON|undefined|null\b|true|false|Error:|\[object|\\u|\\n)/;

// 第三方噪音（打包进 index-*.js 的 mermaid 流程图节点名、类型名、希伯来语 locale 等）
const NOISE_RE =
  /^(Represents .+|.+ (storage|shape|step|point|document|process|data store)|Data flow diagram data store|Communication link|Junction point|Direct access storage|Disk storage|Internal storage|Stored data|Paper tape|Text block|Summary|Subprocess|Bang|Small starting point|Standard process shape|Starting point|Terminal point|Priority action|Preparation or condition step|Manual file operation|Manual input step|Loop limit step|Extraction process|Multiple documents|Multiple processes|Tagged document|Tagged process|Divided process shape|Lined document|Lined process shape|Odd shape|Adds a comment|Fork or join in process flow|Diagram)$/;

function unescapeString(s) {
  return s.replace(/\\(.)/g, (m, c) => {
    switch (c) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "\\": return "\\";
      case '"': return '"';
      case "'": return "'";
      default: return c;
    }
  });
}

function looksLikeUiText(s) {
  if (s.length < 2 || s.length > MAX_LEN) return false;
  if (s !== s.trim()) return false;
  if (/[\n\r\t]/.test(s)) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  if (NOISE_RE.test(s)) return false;
  if (/[\u0590-\u05FF\u0600-\u06FF]/.test(s)) return false; // 希伯来/阿拉伯 locale 数据
  if (!/\s/.test(s) && /^[A-Z0-9_]{2,14}$/.test(s)) return false; // BigInt / UUID / SKILL / MCP ...
  if (BAD_CHARS.test(s)) return false;
  if (URL_RE.test(s)) return false;
  if (FILENAME_RE.test(s)) return false;
  if (/^M[\d .-]/.test(s)) return false;
  if (/^[a-z][A-Za-z0-9_-]*$/.test(s)) return false; // code id
  if (CSSY_RE.test(s) && !/\s[A-Z]/.test(s)) return false;
  if (CODEY_RE.test(s)) return false;
  // 至少满足: 首字母大写, 或含空格(句子)
  if (!/^[A-Z\u4e00-\u9fff]/.test(s) && !/\s/.test(s)) return false;
  return true;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".js")) out.push(p);
  }
}

const files = [];
walk(ASSETS, files);

const hits = new Map();
for (const f of files) {
  const name = path.basename(f);
  if (!APP_CHUNK_RE.test(name)) continue;
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  if (SKIP_MARKERS.some((m) => text.includes(m))) continue;
  UI_PROP_RE.lastIndex = 0;
  let m;
  while ((m = UI_PROP_RE.exec(text))) {
    const s = unescapeString(m[1]);
    if (!looksLikeUiText(s)) continue;
    hits.set(s, (hits.get(s) || 0) + 1);
  }
}

let list = [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

let skipped = 0;
if (ONLY_MISSING) {
  const dict = JSON.parse(fs.readFileSync(DICT, "utf8"));
  // 与注入器一致的归一化: 弯引号/省略号/不换行空格
  const nkey = (s) =>
    String(s)
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\u2026/g, "...")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const known = new Set(
    Object.keys(dict.texts || {}).map(nkey).concat(
      (dict.textPatterns || []).map((r) => nkey(r[0]))
    )
  );
  const before = list.length;
  list = list.filter(([s]) => !known.has(nkey(s)));
  skipped = before - list.length;
}

fs.writeFileSync(OUT, list.map(([s, c]) => `${c}\t${s}`).join("\n"), "utf8");
console.log(`scanned ${files.length} js files`);
console.log(`candidates: ${hits.size}, 已在字典中: ${skipped}, 输出: ${list.length} -> ${OUT}`);
if (PRINT) console.log(list.map(([s]) => s).join("\n"));
