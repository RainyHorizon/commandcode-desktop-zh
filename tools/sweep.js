#!/usr/bin/env node
/**
 * Command Code 桌面端汉化 · 运行时文案扫描（开发用）
 *
 * 用 CDP 依次点开侧边栏/设置里的每个页面, 收集"还没被翻译"的英文文案。
 * 比静态扫 bundle 更准 —— 能抓到运行时才出现、以及后端/CLI 提供的文案。
 *
 * 前提: 应用用启动器(带 --remote-debugging-port)打开, 注入器在运行。
 *
 * 用法:
 *   node tools/sweep.js                 # 扫默认页面集合
 *   node tools/sweep.js --port 9222
 *   node tools/sweep.js --out tools/runtime-missing.txt
 */

"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PORT = Number(argValue("--port", 9222));
const HOST = argValue("--host", "127.0.0.1");
const OUT = argValue("--out", path.join(__dirname, "runtime-missing.txt"));

// 依次点击的导航文案（点击后会等一会儿再扫描）
const STEPS = [
  "通用",
  "外观",
  "快捷键",
  "智能体",
  "高级",
  "品味",
  "技能",
  "MCP",
  "用量",
  "文件",
  "终端",
  "浏览器",
  "拉取请求",
  "活跃智能体",
  "搜索"
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isAppPage(t) {
  return t.type === "page" && typeof t.url === "string" && t.url.includes("renderer/index.html");
}

async function main() {
  const targets = (await (await fetch(`http://${HOST}:${PORT}/json/list`)).json()).filter(isAppPage);
  if (!targets.length) {
    console.error("[cczh] 没找到页面, 请先用启动器打开应用。");
    process.exit(1);
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      p(m);
    }
  });
  const send = (method, params) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      return { __error: JSON.stringify(r.result.exceptionDetails.exception || {}) };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const CLICK_FN = `
    (function(label){
      var all = document.querySelectorAll('button,a,[role="button"],[role="tab"],[role="menuitem"],li,span,div');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.children.length !== 0) continue;
        if (el.textContent.trim() !== label) continue;
        var t = el.closest('button,a,[role="button"],[role="tab"],[role="menuitem"]') || el;
        t.click();
        return true;
      }
      return false;
    })`;

  const COLLECT = `
    (function(){
      var skip = "pre,code,kbd,samp,script,style,textarea,[contenteditable='true']";
      var seen = {}, out = [];
      var els = document.querySelectorAll('body *');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.children.length) continue;
        if (el.closest(skip)) continue;
        var t = el.textContent.trim();
        if (t.length < 2 || t.length > 300) continue;
        if (!/[A-Za-z]/.test(t)) continue;
        if (/^[A-Za-z0-9_\\-]+$/.test(t) && t.length < 12) continue;   // 短标识符/快捷键
        if (/^(Ctrl|Alt|Shift|Cmd|Mod|⌘|⌥)/.test(t)) continue;
        if (seen[t]) continue;
        seen[t] = 1;
        out.push(t);
      }
      return out;
    })()`;

  const found = new Map();
  const collect = async (where) => {
    const list = await evaluate(COLLECT);
    if (!Array.isArray(list)) return 0;
    let n = 0;
    for (const t of list) {
      if (!found.has(t)) { found.set(t, where); n++; }
    }
    return n;
  };

  console.log(`[cczh] 扫描 ${targets[0].title || targets[0].url}`);
  let n = await collect("起始页面");
  console.log(`  起始页面: +${n}`);

  for (const label of STEPS) {
    const clicked = await evaluate(`${CLICK_FN}(${JSON.stringify(label)})`);
    if (!clicked) continue;
    await sleep(2600);
    n = await collect(label);
    console.log(`  点击「${label}」: +${n}`);
  }

  const lines = [...found.entries()].sort().map(([t, w]) => `${w}\t${t}`);
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`\n共 ${found.size} 条未翻译文案 -> ${OUT}`);
  console.log(lines.map((l) => l.split("\t")[1]).join("\n"));
  ws.close();
}

main().catch((e) => {
  console.error("[cczh]", e && e.message ? e.message : e);
  process.exit(1);
});
