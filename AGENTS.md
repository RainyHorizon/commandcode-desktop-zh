# AGENTS.md — Command Code 桌面端汉化项目维护指南

面向接手这个项目的 AI agent / 人。读完这一页就能安全地改动、补词条、排障。

## 项目是什么

给 **Command Code 桌面版**（Electron 应用）做简体中文界面。官方没有 i18n、没有语言设置，
界面文案全部硬编码在打包后的渲染层 JS 里，所以只能**运行时注入**：

```
启动器 .cmd
  └─ 关掉旧实例 → 带 --remote-debugging-port=9222 启动 Command Code.exe
       └─ inject.js（Node 常驻）
            └─ 通过 CDP 连到页面 → Runtime.evaluate 注入 dictionary.json
                 └─ 页面内 MutationObserver + 轮询，持续把英文替换成中文
```

**关键约束：不修改应用任何文件。** 不碰 `Command Code.exe`、不碰 `resources/app`，
所以应用升级不受影响，卸载只需删掉本项目文件夹。

## 环境

- Windows；Command Code 桌面版（当前验证版本 v0.1.37）
- Node.js >= 22（用到内置 `fetch` / `WebSocket`，零第三方依赖）
- 应用默认安装路径：`E:\Program\CommandCode\Command Code\Command Code.exe`
  （换机器时改 `启动 Command Code 中文版.cmd` 里的 `APP`）

## 文件职责

| 文件 | 作用 | 注意 |
|---|---|---|
| `启动 Command Code 中文版.cmd` | 关旧实例 → 带调试端口启动 → 跑注入器 | 内容保持纯 ASCII，避免 cmd 编码问题 |
| `inject.js` | 注入器 + 页面侧注入引擎 | 引擎代码改了就 **必须 +1 `ENGINE_VERSION`** |
| `dictionary.json` | 全部中文词条 | 唯一需要日常维护的文件 |
| `cdp-eval.js` | CDP 调试工具 | 求值 / 导文案 / 找漏翻 |
| `tools/extract-strings.js` | 静态扫打包产物找候选文案 | 应用升级后先用它 |
| `tools/sweep.js` | 自动点开各页面，汇总运行时漏翻 | **权威来源**，静态扫不到运行时/后端文案 |
| `tools/missing.txt` `tools/runtime-missing.txt` | 工具输出（可随时删） | 已 gitignore 可忽略 |

## 日常任务：补/改词条

### 1. 跑起来

```powershell
# 双击启动器，或在 PowerShell 里：
& "E:\Projects\commandcode-zh\启动 Command Code 中文版.cmd"
```
命令行窗口保持开着（注入器在里面跑）。关掉窗口 = 停止汉化（应用还在，只是变回英文）。

### 2. 定位漏翻

**方式 A：运行时扫描（推荐，覆盖最全）**

```powershell
cd E:\Projects\commandcode-zh
node tools\sweep.js --port 9222
```
它会依次点开「通用/外观/快捷键/智能体/高级/品味/技能/MCP/用量/文件/终端/浏览器/拉取请求/活跃智能体/搜索」
（只切视图，不做破坏性操作），把当前界面里"还不是中文"的文案汇总到 `tools/runtime-missing.txt` 并打印。

**方式 B：静态扫打包产物（应用升级后找新文案）**

```powershell
node tools\extract-strings.js --missing            # → tools/missing.txt
node tools\extract-strings.js --missing --print    # 顺便打印
```

**方式 C：看当前页面**

```powershell
node cdp-eval.js --port 9222 --dump-untranslated
node cdp-eval.js --port 9222 --dump-text
node cdp-eval.js --port 9222 "document.title"
node cdp-eval.js --port 9222 --file diag.js        # 执行 diag.js 里的表达式
```

> ⚠️ **复核输出时必须"短的长的都看"。** 工具输出的条目按长度混在一起，长文案（多句描述，
> 例如设置里那段 390 字符的 ZDR 说明）最容易被当成噪音跳过——实际项目里就漏过一条。
> 建议用 `--dump-untranslated` 之外的顺序复核：先按长度排序，把 ≥70 字符的逐条读一遍。
> 另外静态提取器只认它 `UI_PROP_RE` 里列出的属性名（`children`/`label`/`description`/`body`…），
> 应用新增了别的属性承载文案时，要往那个正则里补。

### 3. 写词条

编辑 `dictionary.json`，**保存即生效**（1~2 秒内界面自动更新，无需重启）。

```jsonc
{
  "texts":         { "New chat": "新建对话" },              // 精确匹配（首选，90% 的情况）
  "textPatterns":  [["^(\\d+) files?$", "$1 个文件", ""]],  // 正则：[正则, 替换, 标志]
  "wholeElements": { "A + B": "整句翻译" },                 // 一句被拆成多个文本节点时
  "wholePatterns": [["^~(\\d+) tokens$", "约 $1 个 token", ""]], // 同上但用正则
  "attrs":         {},                                      // 属性覆盖（默认复用 texts）
  "attrPatterns":  [["^Search (.+)$", "搜索 $1", ""]],       // 属性正则
  "skipSelectors": ["pre", "code", "[data-cczh-skip]"]       // 永不翻译
}
```

选择规则：

1. 静态文本 → `texts`
2. 带数字/变量的 → `textPatterns`
3. 一句话被 React 插值拆成多个节点（DOM 里是 `"~"` + `"63"` + `" tokens"`）→ `wholePatterns`
4. `placeholder` / `aria-label` / `title` / `alt` → 默认复用 `texts`，特殊时用 `attrs`

匹配时自动归一化 `'`↔`’`、`...`↔`…`、不间断空格，所以词条里写哪种引号都能命中。

## 日常任务：应用升级后

1. 升级 Command Code（安装路径可能变，用注册表确认）：
   ```powershell
   Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" |
     Where-Object DisplayName -match "Command Code" | Select DisplayName, DisplayVersion, InstallLocation
   ```
2. 用启动器重开 → 界面照旧是中文（注入器不依赖文件结构，只按文本替换）。
3. 跑一遍 `node tools/sweep.js --port 9222`，把新增的英文补进 `dictionary.json`。
4. 如果 `tools/extract-strings.js` 报"没有候选"，说明它的 `APP_CHUNK_RE` 前缀列表需要跟着
   新的 chunk 命名调整（当前按 `index-` / `workspace-screen-` / `settings-panel-` 等前缀匹配，一般不用改）。

## 铁律 / 常见坑

1. **改了 `inject.js` 页面侧代码 → `ENGINE_VERSION` 必须 +1。**
   页面里的引擎版本号 = `ENGINE_VERSION + ":" + 词条mtime`。只改代码不改词条时，
   旧引擎会被判定为"已是最新"而不被替换，你会对着旧行为调试到怀疑人生。
2. **页面侧代码禁止 `eval` / `new Function`。**
   应用 `index.html` 的 CSP 是 `script-src 'self' 'wasm-unsafe-eval' 'sha256-...'`，
   字符串求值会被拦截。CDP `Runtime.evaluate` 本身不受 CSP 限制，所以注入要用它，
   且注入的代码里不能再动态求值。
3. **不要写文件时带 BOM。** 用 PowerShell 的 `Set-Content -Encoding UTF8` 会写入 BOM，
   导致 `JSON.parse` 直接失败。用 `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`。
   （注入器已能容错 BOM 并在词条坏掉时保留上一份可用词条，但别依赖它。）
4. **不要翻译"内容"。** 只翻译应用自己的界面文案。以下必须保持英文：
   技能名与技能描述（来自 SKILL.md）、模型名/厂商名、主题名、版本号、快捷键、
   项目名/分支名/文件名、聊天内容与 AI 回复。
5. **不要删改 DOM 结构。** 注入器只改文本节点的值和 4 个属性，且记录原文
   （`__cczhOrig` / `__cczhOut`），词条删掉会自动还原英文。改结构会跟 React 打架。
6. **应用有单实例锁。** 不先关掉已运行的实例，新进程会忽略 `--remote-debugging-port`，
   注入器就会一直报"还没发现可注入的页面"。
7. **`.cmd` 保持纯 ASCII**，否则 cmd 解析中文会乱码。
8. **长度上限要保持一致。** 引擎侧 `inject.js` 的 `translate()` / `translateAttr()` 有
   `length > 1000 return null`，提取器 `tools/extract-strings.js` 有 `MAX_LEN`（默认 1000）、
   正则里的 `{1,1000}`。应用出现超长文案时三处都要同步放宽，否则词条写了也不生效。
9. **看漏翻报告别只扫短文案。** 见上面「复核输出」的警告——长句描述最容易漏。

## 自检清单（改完跑一遍）

```powershell
cd E:\Projects\commandcode-zh
node --check inject.js
node --check cdp-eval.js
node --check tools\sweep.js
node --check tools\extract-strings.js
node -e "JSON.parse(require('fs').readFileSync('dictionary.json','utf8')); console.log('dict ok')"

# 注入器在跑、引擎版本已更新、当前页无漏翻
node cdp-eval.js --port 9222 "window.__cczh.version"
node cdp-eval.js --port 9222 --dump-untranslated
```

`--dump-untranslated` 里剩下的应该只有：快捷键、模型名、品牌名、技能名/描述、聊天内容。
出现别的就是漏词条，补 `dictionary.json`。

## 排障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 弹窗说找不到 github.exe / 应用 | 启动器 `APP` 路径不对 | 改 `.cmd` 里的 `APP` |
| 注入器一直说"还没发现可注入的页面" | 没用启动器启动 / 旧实例没关 / 端口被占 | 用启动器重开；或 `netstat -ano \| findstr 9222` |
| 界面部分中文部分英文 | 词条缺 | 跑 `sweep.js` 补词条 |
| 改了 `inject.js` 但行为没变 | 忘了 +1 `ENGINE_VERSION` | 改版本号后重启注入器 |
| 改了词条界面没变 | 注入器没在跑，或改的是"已翻译节点的中文" | 确认注入器窗口在；必要时刷新应用窗口 |
| 某个词条怎么都不生效 | 引号/省略号/多节点问题 | 用 `cdp-eval.js --file` 打印该节点的 `nodeValue` 和 `childNodes` 排查 |
| 注入器崩了 | `dictionary.json` JSON 语法错 | 看窗口报错，修 JSON；工具已能容错并保留上一份 |
