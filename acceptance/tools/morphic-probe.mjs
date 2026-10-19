#!/usr/bin/env node
// Morphic 实机探针：验证「评审打开应用看不到任何登录/密码入口，直接可用」。
//
// 用法（本机，连盒子上的 Chrome）：
//   PUPPETEER_CORE_DIR=/lzcapp/document/wans/lpk-skill/node_modules \
//   node acceptance/tools/morphic-probe.mjs --base https://morphic.wans.heiyu.space \
//        --cdp http://127.0.0.1:9334 --out acceptance/shots
//
// 子命令通过 --mode 选择（默认 full）：
//   recon  —— 只做侦察：首屏可见文本、所有可点元素、是否出现登录入口
//   full   —— recon + /auth/login /auth/sign-up 落点 + 截图 + 控制台统计
import fs from 'node:fs';
import path from 'node:path';

const SKILL_NM = '/lzcapp/document/wans/lpk-skill/node_modules';
const ppDir = [process.env.PUPPETEER_CORE_DIR, SKILL_NM]
  .find((d) => d && fs.existsSync(path.join(d, 'puppeteer-core', 'package.json')));
if (!ppDir) { console.error('找不到 puppeteer-core，设 PUPPETEER_CORE_DIR'); process.exit(1); }
// puppeteer-core 是 CJS（main = lib/puppeteer/puppeteer-core.js），用 createRequire 加载，
// 按 ESM 路径 import 会 ERR_MODULE_NOT_FOUND。
const { createRequire } = await import('node:module');
const puppeteer = createRequire(path.join(ppDir, 'noop.js'))(path.join(ppDir, 'puppeteer-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = opt('--base', '').replace(/\/$/, '');
const CDP = opt('--cdp', 'http://127.0.0.1:9334');
const OUT = path.resolve(opt('--out', 'acceptance/shots'));
const MODE = opt('--mode', 'full');
const TAG = opt('--tag', 'cur');
if (!BASE) { console.error('需要 --base https://<domain>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scanPage = () => {
  const txt = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const lower = txt.toLowerCase();
  const hits = [];
  for (const w of ['sign in', 'sign-in', 'signin', 'login', 'log in', 'sign up', 'signup', 'password', '登录', '注册', '密码', '邮箱']) {
    if (lower.includes(w.toLowerCase())) hits.push(w);
  }
  const pwInputs = [...document.querySelectorAll('input[type=password]')].map((e) => ({
    type: e.type, name: e.name, id: e.id, placeholder: e.placeholder,
    visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
  }));
  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => ({ href: a.getAttribute('href'), text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) }))
    .filter((l) => /auth|login|signin|sign-up|signup/i.test(l.href || ''));
  const buttons = [...document.querySelectorAll('button, [role=button]')]
    .map((b) => ({
      text: (b.innerText || b.getAttribute('aria-label') || b.title || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      aria: b.getAttribute('aria-label') || '', title: b.title || '',
      visible: !!(b.offsetWidth || b.offsetHeight),
    }))
    .filter((b) => b.visible && (b.text || b.aria || b.title));
  const emailInputs = [...document.querySelectorAll('input[type=email], input[name*=email i], input[id*=email i]')]
    .map((e) => ({ type: e.type, name: e.name, id: e.id, visible: !!(e.offsetWidth || e.offsetHeight) }));
  return { url: location.href, title: document.title, textLen: txt.length, textHead: txt.slice(0, 900), loginWordHits: hits, pwInputs, emailInputs, authLinks: links, buttons };
};

const rec = { base: BASE, startedAt: new Date().toISOString(), pages: [], errors: [], badResponses: [], external: [] };

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
try { const c = await page.createCDPSession(); await c.send('Security.setIgnoreCertificateErrors', { ignore: true }); } catch { /* 非致命 */ }

const st = { consoleError: [], pageError: [], reqFail: [], http4xx5xx: [] };
page.on('console', (m) => { if (m.type() === 'error') st.consoleError.push(`${page.url()} :: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => st.pageError.push(`${page.url()} :: ${String(e.message).slice(0, 300)}`));
page.on('requestfailed', (r) => st.reqFail.push(`${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  const u = r.url(); const s = r.status();
  if (s >= 400) st.http4xx5xx.push(`${s} ${u.slice(0, 160)}`);
  if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) rec.external.push(u.slice(0, 160));
});

const go = async (p) => {
  const res = await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => { rec.errors.push(`goto ${p}: ${e.message}`); return null; });
  await sleep(3000);
  return { status: res ? res.status() : null, finalUrl: page.url() };
};

// ---- 1) 首页 ----
const home = await go('/');
if (MODE === 'recon' || MODE === 'full') {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await sleep(800);
  const s = await page.evaluate(scanPage);
  rec.pages.push({ step: 'home', ...home, ...s });
  console.log(`\n=== HOME === status=${home.status} finalUrl=${home.finalUrl}`);
  console.log(`title=${s.title} textLen=${s.textLen}`);
  console.log(`loginWordHits=${JSON.stringify(s.loginWordHits)}`);
  console.log(`pwInputs=${JSON.stringify(s.pwInputs)} emailInputs=${JSON.stringify(s.emailInputs)}`);
  console.log(`authLinks=${JSON.stringify(s.authLinks)}`);
  console.log(`buttons=${JSON.stringify(s.buttons)}`);
  console.log(`--- visible text ---\n${s.textHead}\n`);
  if (MODE === 'full') await page.screenshot({ path: path.join(OUT, `${TAG}-pc01-home.png`) });
}

// ---- 2) 直接访问 /auth/login、/auth/sign-up ----
if (MODE === 'full') {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  for (const [p, tag] of [['/auth/login', 'pc02-auth-login'], ['/auth/sign-up', 'pc03-auth-signup'], ['/auth/error', 'pc04-auth-error']]) {
    const r = await go(p);
    const s = await page.evaluate(scanPage);
    rec.pages.push({ step: p, ...r, ...s });
    console.log(`\n=== ${p} === status=${r.status} finalUrl=${r.finalUrl}`);
    console.log(`pwInputs=${JSON.stringify(s.pwInputs)} loginWordHits=${JSON.stringify(s.loginWordHits)}`);
    console.log(`--- visible text ---\n${s.textHead.slice(0, 400)}\n`);
    await page.screenshot({ path: path.join(OUT, `${TAG}-${tag}.png`) });
  }
}

// ---- 3) 收集站内可点链接，挑「历史/引用详情」类页面 ----
if (MODE === 'full') {
  await go('/');
  await sleep(1500);
  const links = await page.evaluate((base) => {
    const out = new Map();
    let origin = null;
    try { origin = new URL(base).origin; } catch { origin = location.origin; }
    document.querySelectorAll('a[href]').forEach((a) => {
      let u; try { u = new URL(a.href, location.href); } catch { return; }
      if (u.origin !== origin) return;
      if (/\.(png|jpg|jpeg|svg|css|js|ico|woff2?)$/i.test(u.pathname)) return;
      out.set(u.pathname + u.search, (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30));
    });
    return [...out].map(([p, label]) => ({ p, label }));
  }, BASE);
  rec.siteLinks = links;
  console.log(`\n=== site links (${links.length}) ===\n${links.map((l) => `${l.p}  [${l.label}]`).join('\n')}`);
  // 额外截图：/search、/library（历史）等
  for (const [p, tag] of [['/search', 'pc05-search'], ['/library', 'pc06-library']]) {
    const r = await go(p);
    const s = await page.evaluate(scanPage);
    rec.pages.push({ step: p, ...r, ...s });
    console.log(`\n=== ${p} === status=${r.status} finalUrl=${r.finalUrl} title=${s.title} textLen=${s.textLen}`);
    await page.screenshot({ path: path.join(OUT, `${TAG}-${tag}.png`) });
  }
}

rec.consoleError = st.consoleError; rec.pageError = st.pageError; rec.reqFail = st.reqFail; rec.http4xx5xx = st.http4xx5xx;
rec.external = [...new Set(rec.external)];
rec.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, `${TAG}-probresult.json`), JSON.stringify(rec, null, 1));
console.log(`\n--- 统计 ---`);
console.log(`pageerror=${st.pageError.length} consoleError=${st.consoleError.length} reqFailed=${st.reqFail.length} http>=400=${st.http4xx5xx.length}`);
if (st.pageError.length) console.log('pageerror:\n  ' + st.pageError.join('\n  '));
if (st.consoleError.length) console.log('consoleError:\n  ' + st.consoleError.join('\n  '));
if (st.reqFail.length) console.log('reqFailed:\n  ' + st.reqFail.join('\n  '));
if (st.http4xx5xx.length) console.log('http>=400:\n  ' + st.http4xx5xx.join('\n  '));
if (rec.external.length) console.log('外链:\n  ' + rec.external.join('\n  '));
console.log(`\n结果写 ${path.join(OUT, `${TAG}-probresult.json`)}`);
await page.close();
browser.disconnect();
