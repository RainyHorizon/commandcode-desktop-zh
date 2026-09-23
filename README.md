# Command Code 桌面端 · 简体中文汉化（非官方）

> 运行时注入 · 不修改应用文件 · 升级不失效 · 词条可热更新

给 [Command Code 桌面版](https://commandcode.ai/desktop)（Electron 应用）提供简体中文界面。

## 这是什么

Command Code 桌面端**没有内置中文，也没有语言设置**——界面文案全部硬编码在打包后的
渲染层 JS 里（`resources/app/out/renderer/assets/*.js`），二进制里既没有 i18n 框架，
也没有 locales 加载逻辑。`--lang=zh-CN` 只影响 Chromium 自带的部分（右键菜单、
拼写检查、日期格式），改不了应用自己的文案。

所以汉化只有一条路：**运行时注入**。本项目通过 WebView/Chromium 的调试端口（CDP）
连到页面，把 `dictionary.json` 里的词条注入进去，页面内用 MutationObserver + 轮询
持续把英文替换成中文。

## 特性

- **不动应用本体**：不修改 `Command Code.exe`、不改 `resources/app` 里的任何文件，升级不受影响；
- **实时生效**：React 重渲染 / 刷新页面后自动重新应用；
- **热更新词条**：改 `dictionary.json` 保存即生效，无需重启（已验证）;
- **不误翻内容**：代码块（`pre`/`code`/`kbd`）、输入框、`contenteditable` 区域会被跳过，AI 回复里的代码不会被翻译；
- **只改自己写过的值**：记录每个节点的原文，词条删掉会自动还原英文，不会把界面改坏。

## 环境要求

- Windows + Command Code 桌面版（已在 v0.1.37 上验证）
- **Node.js >= 22**（用到内置 `fetch` / `WebSocket`，无第三方依赖）：https://nodejs.org

## 使用方法

1. 把整个文件夹放到任意位置即可（不需要放进安装目录）；
2. 确认 `启动 Command Code 中文版.cmd` 开头的 `APP` 指向你的安装路径：
   ```bat
   set "APP=E:\Program\CommandCode\Command Code\Command Code.exe"
   ```
3. 双击 **`启动 Command Code 中文版.cmd`**。

启动器会做三件事：关掉正在运行的实例（Command Code 有单实例锁，不关掉的话新进程
会忽略调试参数）→ 带 `--remote-debugging-port=9222` 启动应用 → 运行 `inject.js` 注入中文。

> 注意：命令行窗口要保持打开（注入器在运行），关掉窗口就恢复英文。
> 直接点官方图标启动的仍是英文，必须走这个启动器。

## 自定义词条

编辑 `dictionary.json`，保存后 1~2 秒内自动生效：

| 区块 | 作用 | 示例 |
|---|---|---|
| `texts` | 精确匹配文本/属性 | `"New chat": "新建对话"` |
| `textPatterns` | 正则替换 `[正则, 替换, 标志]` | `["^(\\d+) files?$", "$1 个文件", ""]` |
| `attrs` | 属性覆盖（`placeholder` / `aria-label` / `title` / `alt`） | `"Write a message": "输入消息"` |
| `attrPatterns` | 属性正则替换 | `["^Search (.+)$", "搜索 $1", ""]` |
| `wholeElements` | 被拆成多个文本节点的整句 | `"Learn this project's taste": "学习此项目的品味"` |
| `wholePatterns` | 同上，但用正则（React 插值会把一句拆成多个节点，如 `~` + `63` + ` tokens`） | `["^~(\\d+) tokens$", "约 $1 个 token", ""]` |
| `skipSelectors` | 永不翻译的选择器 | `["pre", "code", "[data-cczh-skip]"]` |

属性默认复用 `texts`，所以 `placeholder="Write a message"` 只写一条就够。

引号（`'` / `’`）、省略号（`...` / `…`）、不换行空格会在匹配时自动归一化，
所以词条里写哪种写法都能命中。

如果某个标签需要**禁止**翻译，给它加 `data-cczh-skip` 属性即可。

## 什么会被翻译、什么不会

会被翻译：应用自己的界面文案（按钮、菜单、设置项、提示语、报错、空状态等）。

**不会**翻译（这些属于"内容"，不是界面）：

- 技能名与技能描述（来自 `SKILL.md`，例如 `baoyu-diagram` 及其说明文字）；
- 模型名、厂商名（`DeepSeek V4.1 Flash`、`Claude Opus 4.8`、`MCP`…）；
- 主题名（`Shades of Purple`）、版本号（`v0.1.37`）、快捷键（`Ctrl+K`）；
- 项目名、分支名、文件名、聊天内容、AI 回复。

## 调试工具

应用必须是用启动器（带调试端口）打开的。

```bash
node cdp-eval.js "document.title"            # 在页面里执行任意表达式
node cdp-eval.js --dump-text                 # 打印页面所有可见文本
node cdp-eval.js --dump-untranslated         # 打印"还没被翻译"的英文文案
node cdp-eval.js --file diag.js              # 执行一个 js 文件里的表达式
node inject.js --list                        # 列出可注入的页面
node tools/sweep.js                          # 自动点开每个设置页/视图, 汇总漏翻文案
```

补词条的推荐流程：

1. 静态扫打包产物：`node tools/extract-strings.js --missing` → `tools/missing.txt`；
2. 动态扫运行时：`node tools/sweep.js` → `tools/runtime-missing.txt`；
3. 把英文复制进 `dictionary.json` 的 `texts`（动态的写 `textPatterns` / `wholePatterns`）；
4. 保存，1 秒内界面自动变中文，无需重启。

## 文件结构

```
commandcode-zh/
├── 启动 Command Code 中文版.cmd   # 一键启动器（关旧实例 → 带调试端口启动 → 注入）
├── inject.js                      # CDP 注入器（Node，无依赖，常驻运行 + 词条热重载）
├── dictionary.json                # 中文词条（746 条 + 正则 + 整句）
├── cdp-eval.js                    # 调试工具（求值 / 导文案 / 找漏翻）
├── tools/
│   ├── extract-strings.js         # 从打包产物扫候选文案（应用升级后用）
│   └── sweep.js                   # 自动遍历界面, 汇总运行时漏翻文案
└── README.md
```

应用升级后如果出现新的英文文案，按上面的流程重扫一遍即可。

## 给维护者

- 改 `inject.js` 里**页面侧**的代码后，必须把文件顶部的 `ENGINE_VERSION` 加一，
  否则页面里已注入的旧引擎会因为"词条没变"而不被替换（版本号 = 引擎版本 + 词条 mtime）。
- 页面侧的注入代码不能使用 `eval` / `new Function` —— 应用的 CSP 不允许，会直接失效。
- 注入器只改文本节点和 `placeholder`/`aria-label`/`title`/`alt` 属性，不删改 DOM 结构，
  避免和 React 打架。

## 已知限制

- 图片/图标里内嵌的英文无法翻译；
- 后端返回的文本（例如 `Insufficient credits` 这类聊天里的提示）属于内容而非界面文案，不翻译；
- 极少数"一句话被拆成多个文本节点 + 中间夹着组件"的文案需要写进 `wholeElements`；
- 如果应用某次更新换了 chunk 文件名/结构，注入器不用改（它是按文本替换的），但可能需要补新词条；
- 每次应用更新后，用启动器重新打开即可，无需重装。

## 卸载

不修改任何应用文件，直接删掉这个文件夹即可。如果改过启动器里的路径，也一并还原。

## 免责声明

非官方社区汉化，与 Command Code（Langbase, Inc.）无关，仅供学习交流使用。
请遵守 Command Code 的服务条款。

## License

MIT
