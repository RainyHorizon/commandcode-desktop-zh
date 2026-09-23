#!/usr/bin/env node
/**
 * Command Code 桌面端汉化 · CDP 调试小工具
 *
 * 前提: 应用以 --remote-debugging-port=9222 启动(用启动器打开即可)。
 *
 * 用法:
 *   node cdp-eval.js "document.title"                  # 在页面里求值并打印
 *   node cdp-eval.js --dump-text                        # 打印页面所有可见文本
 *   node cdp-eval.js --dump-untranslated                # 打印还没被翻译的英文文案
 *   node cdp-eval.js --port 9222 "location.href"
 */

"use strict";

const fs = require("fs");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PORT = Number(argValue("--port", 9222));
const HOST = argValue("--host", "127.0.0.1");
const FILE = argValue("--file", "");
const expr = args.filter(
  (a) => !a.startsWith("--") && a !== String(PORT) && a !== FILE && a !== HOST
)[0];

const DUMP_TEXT = args.includes("--dump-text");
const DUMP_MISSING = args.includes("--dump-untranslated");

if (DUMP_TEXT) {
  console.log = console.log.bind(console);
}

async function listTargets() {
  const res = await fetch(`http://${HOST}:${PORT}/json/list`);
  return res.json();
}

function isAppPage(t) {
  return t.type === "page" && typeof t.url === "string" && t.url.includes("renderer/index.html");
}

async function main() {
  const targets = (await listTargets()).filter(isAppPage);
  if (targets.length === 0) {
    console.error("[cczh] 没有找到页面。请先用启动器打开应用。");
    process.exit(1);
  }
  const t = targets[0];
  const ws = new WebSocket(t.webSocketDebuggerUrl);
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

  let code;
  if (FILE) {
    code = fs.readFileSync(FILE, "utf8");
  } else if (DUMP_TEXT) {
    code = `[...document.querySelectorAll('body *')]
      .filter(el => el.children.length === 0 && el.textContent.trim())
      .map(el => el.textContent.trim())
      .filter((v, i, a) => a.indexOf(v) === i)
      .join('\\n')`;
  } else if (DUMP_MISSING) {
    code = `[...document.querySelectorAll('body *')]
      .filter(el => el.children.length === 0)
      .map(el => el.textContent.trim())
      .filter(v => v && v.length > 1 && v.length < 70 && /[A-Za-z]/.test(v) && !/[\\u4e00-\\u9fff]/.test(v))
      .filter((v, i, a) => a.indexOf(v) === i)
      .join('\\n')`;
  } else {
    code = expr || "document.title";
  }

  const r = await send("Runtime.evaluate", {
    expression: code,
    returnByValue: true,
    awaitPromise: false
  });
  if (r.result && r.result.exceptionDetails) {
    console.error(JSON.stringify(r.result.exceptionDetails, null, 2));
    process.exit(2);
  }
  console.log(r.result && r.result.result ? r.result.result.value : JSON.stringify(r.result));
  ws.close();
}

main().catch((e) => {
  console.error("[cczh]", e.message);
  process.exit(1);
});
