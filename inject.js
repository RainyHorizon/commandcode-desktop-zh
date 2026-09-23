#!/usr/bin/env node
/**
 * Command Code 桌面端 · 简体中文运行时注入器 (CDP)
 *
 * 原理:
 *   1. 应用以 --remote-debugging-port=9222 启动(由启动器 .cmd 负责)
 *   2. 本脚本通过 CDP (Chrome DevTools Protocol) 连到每个页面
 *   3. 把 dictionary.json 作为字典注入页面, 页面内用 MutationObserver + 轮询
 *      持续把界面英文替换成中文 —— 不修改应用任何文件
 *   4. 监听 dictionary.json 的修改时间, 保存即热重载
 *
 * 依赖: Node.js >= 22 (需要内置 WebSocket / fetch), 无第三方包
 *
 * 用法:
 *   node inject.js                    # 连 127.0.0.1:9222, 常驻运行
 *   node inject.js --port 9333        # 换端口
 *   node inject.js --once             # 注入一次后退出(调试用)
 *   node inject.js --list             # 只列出可注入的页面
 */

"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = Number(argValue("--port", process.env.CCZH_PORT || 9222));
const HOST = argValue("--host", "127.0.0.1");
const ONCE = args.includes("--once");
const LIST_ONLY = args.includes("--list");
const DICT_PATH = argValue("--dict", path.join(__dirname, "dictionary.json"));
const POLL_MS = Number(argValue("--interval", 1500));

if (typeof WebSocket !== "function" || typeof fetch !== "function") {
  console.error(
    "[cczh] 需要 Node.js >= 22 (内置 fetch/WebSocket)。当前版本: " + process.version
  );
  process.exit(1);
}

const log = (...a) => console.log("[cczh]", ...a);
const warn = (...a) => console.warn("[cczh]", ...a);

// 注入引擎版本号: 改 inject.js 里页面侧代码时必须 +1,
// 否则页面里的旧引擎不会因为"词条没变"而被替换掉。
const ENGINE_VERSION = "4";

// ---------------------------------------------------------------- dictionary

let dictRaw = "";
let dictStamp = 0;

function loadDictionary(force) {
  const st = fs.statSync(DICT_PATH);
  const stamp = st.mtimeMs;
  if (!force && stamp === dictStamp && dictRaw) return false;
  let text = fs.readFileSync(DICT_PATH, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去掉 Windows 编辑器写入的 BOM
  JSON.parse(text); // 提前报错, 避免把坏 JSON 注入页面
  dictRaw = text;
  dictStamp = stamp;
  return true;
}

// 词条出错时不要杀掉整个注入器: 保留上一份可用词条, 只警告
function tryLoadDictionary(force) {
  try {
    return loadDictionary(force);
  } catch (e) {
    warn("词条读取失败(保留上一份可用词条):", e.message);
    return false;
  }
}

// ------------------------------------------------------- in-page payload

function buildPayload() {
  const VERSION = ENGINE_VERSION + ":" + dictStamp;
  return `(() => {
  const VERSION = ${JSON.stringify(VERSION)};
  if (window.__cczh && window.__cczh.version === VERSION) return { skipped: true };
  if (window.__cczh && window.__cczh.dispose) { try { window.__cczh.dispose(); } catch (e) {} }

  const DICT = ${dictRaw};
  const texts = DICT.texts || {};
  const attrs = DICT.attrs || {};
  const whole = DICT.wholeElements || {};
  const skipSel = (DICT.skipSelectors || []).join(",");
  const textRes = (DICT.textPatterns || []).map(function (r) { return [new RegExp(r[0], r[2] || ""), r[1]]; });
  const attrRes = (DICT.attrPatterns || []).map(function (r) { return [new RegExp(r[0], r[2] || ""), r[1]]; });
  const ATTR_NAMES = ["placeholder", "aria-label", "title", "alt"];

  // 归一化: 弯引号/直引号、省略号、不换行空格、多余空白
  // 应用里同一个词条可能写成 ’ 或 ', … 或 ... , 归一化后共用一条词条
  function nkey(s) {
    return String(s)
      .replace(/[\\u2018\\u2019\\u02bc]/g, "'")
      .replace(/[\\u201c\\u201d]/g, '"')
      .replace(/\\u2026/g, "...")
      .replace(/\\u00a0/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
  }
  const normTexts = {};
  for (const k in texts) normTexts[nkey(k)] = texts[k];
  const normAttrs = {};
  for (const k in attrs) normAttrs[nkey(k)] = attrs[k];
  const normWhole = {};
  for (const k in whole) normWhole[nkey(k)] = whole[k];
  const wholeRes = (DICT.wholePatterns || []).map(function (r) { return [new RegExp(r[0], r[2] || ""), r[1]]; });

  let hits = 0;
  let misses = new Map();

  function norm(s) { return String(s == null ? "" : s).replace(/\\s+/g, " ").trim(); }

  function isSkipped(el) {
    if (!el || el.nodeType !== 1) return false;
    if (skipSel && el.closest(skipSel)) return true;
    return false;
  }

  function translate(raw) {
    const t = raw.trim();
    if (t.length < 2 || t.length > 1000) return null;
    if (texts[t] !== undefined) return [t, texts[t]];
    const nk = nkey(t);
    if (normTexts[nk] !== undefined) return [t, normTexts[nk]];
    for (let i = 0; i < textRes.length; i++) {
      const re = textRes[i][0];
      if (re.test(t)) return [t, t.replace(re, textRes[i][1])];
    }
    return null;
  }

  function translateAttr(value) {
    if (!value || value.length < 2 || value.length > 1000) return null;
    const t = value.trim();
    if (attrs[t] !== undefined) return attrs[t];
    if (texts[t] !== undefined) return texts[t];
    const nk = nkey(t);
    if (normAttrs[nk] !== undefined) return normAttrs[nk];
    if (normTexts[nk] !== undefined) return normTexts[nk];
    for (let i = 0; i < attrRes.length; i++) {
      const re = attrRes[i][0];
      if (re.test(t)) return t.replace(re, attrRes[i][1]);
    }
    // 属性也走正文正则(例如 placeholder="Search 3 preferences")
    for (let i = 0; i < textRes.length; i++) {
      const re = textRes[i][0];
      if (re.test(t)) return t.replace(re, textRes[i][1]);
    }
    return null;
  }

  // 只替换"我们自己写过的值": 记住原文(__cczhOrig)与上次写入值(__cczhOut)。
  // 好处: (1) 改词条立刻生效; (2) React 重渲染出的新文案会被重新翻译;
  //       (3) 词条被删掉时自动还原英文。
  function applyTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || isSkipped(parent)) continue;
      const raw = node.nodeValue;
      if (!raw) continue;

      const fromOurs = node.__cczhOut !== undefined && node.__cczhOut === raw;
      if (!fromOurs) node.__cczhOrig = raw;
      const orig = fromOurs ? node.__cczhOrig : raw;

      const hit = translate(orig);
      if (!hit) {
        if (fromOurs) {
          node.__cczhOut = undefined;
          if (orig !== raw) node.nodeValue = orig;
        }
        const t = orig.trim();
        if (misses.size < 3000 && t.length > 2 && t.length < 60 && /[A-Za-z]/.test(t)) {
          misses.set(t, (misses.get(t) || 0) + 1);
        }
        continue;
      }
      const next = orig.replace(hit[0], hit[1]);
      node.__cczhOut = next;
      if (next !== raw) { node.nodeValue = next; hits++; }
    }
  }

  function applyAttributes(root) {
    const els = root.querySelectorAll("[placeholder],[aria-label],[title],[alt]");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (isSkipped(el)) continue;
      const origs = el.__cczhAttrOrig || (el.__cczhAttrOrig = {});
      const outs = el.__cczhAttrOut || (el.__cczhAttrOut = {});
      for (let a = 0; a < ATTR_NAMES.length; a++) {
        const name = ATTR_NAMES[a];
        const v = el.getAttribute(name);
        if (v === null) continue;
        const fromOurs = outs[name] !== undefined && outs[name] === v;
        if (!fromOurs) origs[name] = v;
        const orig = fromOurs ? origs[name] : v;
        const translated = translateAttr(orig);
        if (translated === null) {
          if (fromOurs) { delete outs[name]; if (orig !== v) el.setAttribute(name, orig); }
          continue;
        }
        outs[name] = translated;
        if (translated !== v) { el.setAttribute(name, translated); hits++; }
      }
    }
  }

  // 整句: 一个元素被拆成多个文本节点(React 的插值, 如 "~" + "63" + " tokens"),
  // 逐节点无法匹配, 只能按整句匹配。先按"原样拼接"再按"空格拼接"两种方式试。
  function applyWholeElements(root) {
    const els = root.querySelectorAll("body *");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.children.length > 0 || isSkipped(el)) continue;
      const tn = [];
      for (let c = 0; c < el.childNodes.length; c++) {
        const n = el.childNodes[c];
        if (n.nodeType === 3 && n.nodeValue.trim()) tn.push(n);
      }
      if (tn.length < 2) continue;

      const rawJoin = tn.map(function (n) { return n.nodeValue; }).join("");
      const fromOurs = el.__cczhWholeOut !== undefined && norm(el.__cczhWholeOut) === norm(rawJoin);
      const variants = fromOurs && el.__cczhWholeOrig
        ? [el.__cczhWholeOrig]
        : [rawJoin, tn.map(function (n) { return n.nodeValue; }).join(" ")];

      let target;
      for (let v = 0; v < variants.length && target === undefined; v++) {
        const k = nkey(variants[v]);
        if (normWhole[k] !== undefined) { target = normWhole[k]; break; }
        for (let r = 0; r < wholeRes.length; r++) {
          if (wholeRes[r][0].test(k)) { target = k.replace(wholeRes[r][0], wholeRes[r][1]); break; }
        }
      }

      if (target === undefined) {
        if (fromOurs) el.__cczhWholeOut = undefined;
        continue;
      }
      if (!fromOurs) el.__cczhWholeOrig = variants.find(function (v) { return nkey(v).length; }) || rawJoin;
      el.__cczhWholeOut = target;
      if (norm(rawJoin) === norm(target)) continue;
      tn[0].nodeValue = target;
      for (let k2 = 1; k2 < tn.length; k2++) tn[k2].nodeValue = "";
      hits++;
    }
  }

  function apply() {
    if (!document.body) return;
    applyTextNodes(document.body);
    applyAttributes(document.body);
    applyWholeElements(document.body);
  }

  let scheduled = 0;
  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(function () { scheduled = 0; try { apply(); } catch (e) {} }, 120);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR_NAMES });
  const timer = setInterval(function () { try { apply(); } catch (e) {} }, ${POLL_MS});

  apply();

  window.__cczh = {
    version: VERSION,
    dict: DICT,
    apply: apply,
    stats: function () { return { hits: hits, misses: misses }; },
    dispose: function () {
      try { observer.disconnect(); } catch (e) {}
      clearInterval(timer);
      if (scheduled) clearTimeout(scheduled);
      delete window.__cczh;
    }
  };

  return { installed: true, hits: hits };
})()`;
}

// --------------------------------------------------------------------- CDP

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  const res = await fetch(`http://${HOST}:${PORT}/json/list`);
  return res.json();
}

function isAppPage(t) {
  return t.type === "page" && typeof t.url === "string" && t.url.includes("renderer/index.html");
}

class Session {
  constructor(target) {
    this.target = target;
    this.id = 0;
    this.pending = new Map();
    this.closeTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.target.webSocketDebuggerUrl);
      this.ws = ws;
      const to = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("connect timeout")); }, 10000);
      ws.addEventListener("open", () => { clearTimeout(to); resolve(); });
      ws.addEventListener("error", (e) => { clearTimeout(to); reject(e.error || new Error("ws error")); });
      ws.addEventListener("message", (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        }
      });
      ws.addEventListener("close", () => {
        if (this.onclose) this.onclose();
      });
    });
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error("ws not open"));
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + " timeout")); }
      }, 15000);
    });
  }

  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: false,
      userGesture: false
    });
    if (r && r.exceptionDetails) {
      throw new Error("page exception: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    }
    return r && r.result ? r.result.value : undefined;
  }

  close() {
    try { this.ws && this.ws.close(); } catch (e) {}
  }
}

const sessions = new Map(); // targetId -> Session

async function injectInto(session, verbose) {
  const payload = buildPayload();
  const out = await session.evaluate(payload);
  if (out && out.skipped) {
    if (verbose) log("已是最新词条:", session.target.title || session.target.url);
    return false;
  }
  log("注入成功 ->", session.target.title || session.target.url, JSON.stringify(out));
  return true;
}

async function syncTargets(force) {
  let targets;
  try {
    targets = await listTargets();
  } catch (e) {
    return; // 端口还没起来
  }
  const pages = targets.filter(isAppPage);
  for (const t of pages) {
    if (sessions.has(t.id) && !force) continue;
    const s = new Session(t);
    try {
      await s.connect();
      await s.send("Runtime.enable");
      sessions.set(t.id, s);
      s.onclose = () => { sessions.delete(t.id); };
      log("已连接页面:", t.title || t.url);
    } catch (e) {
      warn("连接页面失败:", e.message);
      try { s.close(); } catch (_) {}
    }
  }
  // 清理已消失的 target
  for (const [id, s] of sessions) {
    if (!pages.some((p) => p.id === id)) { s.close(); sessions.delete(id); }
  }
}

async function main() {
  if (!tryLoadDictionary(true)) { console.error("[cczh] 无法读取词条, 退出。"); process.exit(1); }

  if (LIST_ONLY) {
    const targets = await listTargets().catch(() => []);
    console.log(JSON.stringify(targets.filter(isAppPage), null, 2));
    return;
  }

  log(`目标 http://${HOST}:${PORT}  词条 ${DICT_PATH}`);

  if (ONCE) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && sessions.size === 0) {
      await syncTargets(false);
      if (sessions.size === 0) await sleep(1000);
    }
    for (const s of sessions.values()) {
      try { await injectInto(s, true); } catch (e) { warn("注入失败:", e.message); }
    }
    for (const s of sessions.values()) s.close();
    log("一次性注入完成。");
    return;
  }

  let warned = false;
  for (;;) {
    await syncTargets(false);
    if (sessions.size === 0) {
      if (!warned) {
        warn("还没发现可注入的页面。请确认是用『启动 Command Code 中文版.cmd』启动的应用。");
        warned = true;
      }
    } else {
      warned = false;
      tryLoadDictionary(false);
      for (const s of sessions.values()) {
        try {
          await injectInto(s, false);
        } catch (e) {
          warn("注入失败:", e.message);
        }
      }
    }
    await sleep(1000);
  }
}

process.on("SIGINT", () => {
  for (const s of sessions.values()) s.close();
  process.exit(0);
});

main().catch((e) => {
  console.error("[cczh] 致命错误:", e && e.stack ? e.stack : e);
  process.exit(1);
});
