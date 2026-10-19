#!/usr/bin/env node
// Morphic 返工验收探针（审核单 #20762：没有密码自动注入，也没有提供密码，无法测试）
//
// 验收目标：评审打开应用看不到任何登录/密码入口，直接可用。
// 做法：经盒子上的 TLS 前置 + 无头 Chrome，用真实域名 https://morphic.wans.heiyu.space 走完整链路，
//      逐页扫「可见文案 / 密码框 / 指向 /auth/* 的链接」，并把 /auth/login、/auth/sign-up 的
//      状态码与最终落点记下来。
//
// 用法：
//   PUPPETEER_CORE_DIR=/lzcapp/document/wans/lpk-skill/node_modules \
//   node acceptance/tools/morphic-accept.mjs \
//     --base https://morphic.wans.heiyu.space --cdp http://127.0.0.1:9334 \
//     --chat accfxchat00000000000000001 --out acceptance/shots
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SKILL_NM = '/lzcapp/document/wans/lpk-skill/node_modules';
const ppDir = [process.env.PUPPETEER_CORE_DIR, SKILL_NM]
  .find((d) => d && fs.existsSync(path.join(d, 'puppeteer-core', 'package.json')));
if (!ppDir) { console.error('找不到 puppeteer-core，设 PUPPETEER_CORE_DIR'); process.exit(1); }
const puppeteer = createRequire(path.join(ppDir, 'noop.js'))(path.join(ppDir, 'puppeteer-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = opt('--base', '').replace(/\/$/, '');
const CDP = opt('--cdp', 'http://127.0.0.1:9334');
const OUT = path.resolve(opt('--out', 'acceptance/shots'));
const CHAT = opt('--chat', '');
if (!BASE) { console.error('需要 --base https://<domain>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 页面扫描：登录/密码入口判定 + 可交互控件清单
const scan = () => {
  const txt = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const low = txt.toLowerCase();
  const hits = [];
  for (const w of ['sign in', 'sign-in', 'signin', 'log in', 'login', 'sign up', 'signup',
    'password', 'email address', '登录', '登入', '注册', '密码', '邮箱', '账号', '账户']) {
    if (low.includes(w.toLowerCase())) hits.push(w);
  }
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const pwInputs = [...document.querySelectorAll('input[type=password]')]
    .map((e) => ({ id: e.id, name: e.name, visible: vis(e) }));
  const emailInputs = [...document.querySelectorAll('input[type=email]')]
    .map((e) => ({ id: e.id, name: e.name, visible: vis(e) }));
  const authLinks = [...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href') || '')
    .filter((h) => /(^|\/)auth(\/|$)|login|sign-?up|signin/i.test(h));
  const injects = [...document.querySelectorAll('script[src*="/_lzc/injects/"]')]
    .map((s) => s.getAttribute('src'));
  return {
    url: location.href, title: document.title, textLen: txt.length,
    textHead: txt.slice(0, 700), loginWordHits: hits,
    pwInputs, emailInputs, authLinks, injectScripts: injects,
  };
};

const rec = {
  base: BASE, cdp: CDP, startedAt: new Date().toISOString(),
  pages: [], consoleError: [], pageError: [], requestFailed: [], http4xx5xx: [], external: [],
};
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
try {
  const c = await page.createCDPSession();
  await c.send('Security.setIgnoreCertificateErrors', { ignore: true });
  // 这台 Chrome 的 profile 是复用的（/tmp/cdp），HTTP 缓存里可能留着上一轮的页面副本。
  // 不清理会量到旧内容（实测：库里已改，页面仍显示旧文本），评审也可能遇到同类问题，
  // 所以验收前显式清一次缓存，并对 /search/* 加时间戳 query 绕过任何中间缓存。
  await c.send('Network.enable');
  await c.send('Network.clearBrowserCache');
} catch { /* 非致命 */ }

page.on('console', (m) => { if (m.type() === 'error') rec.consoleError.push(`${page.url()} :: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => rec.pageError.push(`${page.url()} :: ${String(e.message).slice(0, 300)}`));
page.on('requestfailed', (r) => rec.requestFailed.push(`${r.url().slice(0, 150)} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  const u = r.url(); const s = r.status();
  if (s >= 400) rec.http4xx5xx.push(`${s} ${u.replace(BASE, '').slice(0, 150)}`);
  if (!u.startsWith(BASE) && !/^(data|blob):/.test(u)) rec.external.push(u.slice(0, 150));
});

// 侧栏的展开状态存在 cookie `sidebar_state`（true/false）里，默认还是 false（折叠）。
// 直接点按钮只改 cookie、不一定立刻重排，所以在导航前把 cookie 设成 true，页面加载即为展开态。
const openSidebar = async () => {
  const u = new URL(BASE);
  await page.setCookie({ name: 'sidebar_state', value: 'true', domain: u.hostname, path: '/' }).catch(() => {});
};

// go() 返回 HTTP 状态：page.goto 的 response 是「链条末端」的响应，这里额外记导航链
const go = async (p, waitMs = 3000) => {
  const r = await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => {
    rec.pageError.push(`goto ${p}: ${String(e.message).slice(0, 160)}`); return null;
  });
  await sleep(waitMs);
  return { status: r ? r.status() : null, finalUrl: page.url() };
};

const visit = async (p, tag, shot, waitMs) => {
  const nav = await go(p, waitMs);
  const s = await page.evaluate(scan);
  const row = { step: p, tag, ...nav, ...s };
  rec.pages.push(row);
  if (shot) await page.screenshot({ path: path.join(OUT, shot) });
  const flag = (row.pwInputs.some((x) => x.visible) || row.authLinks.length) ? '✗ 有密码框/登录链接' : '✓ 无';
  console.log(`  ${flag.padEnd(20)} ${p.padEnd(26)} status=${row.status} final=${row.finalUrl.replace(BASE, '') || '/'} 文案命中=${JSON.stringify(row.loginWordHits)}`);
  return row;
};

// ── PC 1920×1080 ─────────────────────────────────────────────
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
console.log('\n[PC 1920x1080]');
await visit('/', 'home', 'pc-01-home.png', 4000);

// 历史：侧栏里的对话列表（seed 过一条 fixture 对话）
await openSidebar();
await visit('/', 'home-with-history', null, 3500);
rec.sidebarExpanded = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')]
    .find((e) => /sidebar-wrapper/.test(typeof e.className === 'string' ? e.className : ''));
  const sb = [...document.querySelectorAll('div')].find((e) => {
    const c = typeof e.className === 'string' ? e.className : '';
    if (!/w-\(--sidebar-width\)/.test(c) || !/fixed/.test(c)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 100 && r.left >= -1;
  });
  return { hasWrapper: !!el, sidebarVisible: !!sb, sidebarLeft: sb ? Math.round(sb.getBoundingClientRect().left) : null };
});
const hist = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a[href^="/search/"]')].map((a) => a.getAttribute('href'));
  return [...new Set(links)];
});
rec.historyLinks = hist;
console.log(`  历史侧栏里的对话链接: ${JSON.stringify(hist)}`);
await page.screenshot({ path: path.join(OUT, 'pc-02-history.png') });

// 引用详情（/search/<id>，含引用来源）
if (CHAT) {
  await visit(`/search/${CHAT}?ts=${Date.now()}`, 'citation-detail', 'pc-03-citation.png', 5000);
}

// /auth/login 的最终落点（评审就是被这一页挡住的）
const loginRow = await visit('/auth/login', 'auth-login', 'pc-04-auth-login-landing.png', 4000);
// /auth/sign-up
const signupRow = await visit('/auth/sign-up', 'auth-signup', 'pc-05-auth-signup-landing.png', 3000);

// ── 移动端 430×932 DPR3（对齐 1.8.0-2 已验收的移动端参数） ──
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
console.log('\n[移动 430x932 DPR3]');
await visit('/', 'mobile-home', 'mob-01-home.png', 4000);
if (CHAT) await visit(`/search/${CHAT}?ts=${Date.now()}`, 'mobile-citation', 'mob-02-citation.png', 5000);

// 移动端横向溢出检查（只看可见元素）
const overflow = await page.evaluate(() => {
  const de = document.documentElement;
  const wide = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect();
    if (!(r.width > 0 && r.right - window.innerWidth > 8)) return false;
    const s = getComputedStyle(e);
    return !(s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0);
  }).map((e) => `${e.tagName.toLowerCase()}@${Math.round(e.getBoundingClientRect().right)}`);
  return { innerWidth: window.innerWidth, docWidth: de.scrollWidth, overflowDoc: de.scrollWidth - window.innerWidth, wideCount: wide.length, wide: wide.slice(0, 5) };
});
rec.mobileOverflow = overflow;
console.log(`  溢出检查: ${JSON.stringify(overflow)}`);

rec.finishedAt = new Date().toISOString();
rec.summary = {
  totalPages: rec.pages.length,
  pagesWithVisiblePasswordInput: rec.pages.filter((p) => p.pwInputs.some((x) => x.visible)).map((p) => p.step),
  pagesWithAuthLinks: rec.pages.filter((p) => p.authLinks.length).map((p) => p.step),
  authLogin: { status: loginRow.status, finalUrl: loginRow.finalUrl },
  authSignup: { status: signupRow.status, finalUrl: signupRow.finalUrl },
  pageerror: rec.pageError.length,
  consoleError: rec.consoleError.length,
  requestFailed: rec.requestFailed.length,
  http4xx5xx: rec.http4xx5xx.length,
};
fs.writeFileSync(path.join(OUT, 'accept-result.json'), JSON.stringify(rec, null, 1));

console.log('\n=== 汇总 ===');
console.log(JSON.stringify(rec.summary, null, 1));
if (rec.consoleError.length) console.log('console.error:\n  ' + rec.consoleError.join('\n  '));
if (rec.pageError.length) console.log('pageerror:\n  ' + rec.pageError.join('\n  '));
if (rec.requestFailed.length) console.log('请求失败:\n  ' + rec.requestFailed.join('\n  '));
if (rec.http4xx5xx.length) console.log('HTTP>=400:\n  ' + rec.http4xx5xx.join('\n  '));
const ext = [...new Set(rec.external)];
if (ext.length) console.log('第三方外链（盒子网络/离线可能失败，不在修复范围）:\n  ' + ext.join('\n  '));
console.log(`\n截图目录 ${OUT}`);

await page.close();
browser.disconnect();
