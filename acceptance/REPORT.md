# 返工验收报告 — cloud.lazycat.app.morphic

| 项 | 值 |
|---|---|
| 应用 | Morphic（开源 AI 答案引擎，`miurla/morphic`） |
| 包名 | `cloud.lazycat.app.morphic` |
| 本版版本号 | `1.8.0-2`（**未改动**，按任务要求由主控统一升版） |
| 驳回审核单 | **#20762**，`review_status = -1`，附件 1 张 |
| 驳回理由原文 | 「**没有密码自动注入，也没有提供密码，无法测试**」 |
| 驳回截图 | 应用自己的 `/auth/login`（「Welcome back / Sign in to your account / Email / Password」） |
| 返工范围 | 让评审打开应用**看不到任何登录/密码入口**，且使用说明与界面一致 |
| 验收盒子 | `lzcbox`（`wans.heiyu.space`），lzcos 实机，`lzc-docker` |
| 验收域名 | `https://morphic.wans.heiyu.space`（经 TLS 前置 + lzcinit 网关，真实域名链路） |
| 本版 LPK sha256 | `82b3146a3dbd5447fec8b93d09f22b9da1e64bf82442982256fc34b784ca46a2` |

---

## 1. 结论

**登录页已彻底消失，应用进入即用。** 评审打开应用（首页）与直接访问 `/auth/login`、`/auth/sign-up`
的最终落点都是同一个搜索首页，页面上不存在任何密码输入框、邮箱输入框、登录/注册按钮或指向
`/auth/*` 的链接；整轮回归 `pageerror = 0`、`console.error = 0`、HTTP ≥ 400 = 0。

---

## 2. 根因

> 一句话：**`ENABLE_AUTH=false` 只摘掉了界面里的登录「入口」，没有摘掉 `/auth/*` 这批路由；
> 上游的登录页组件没有任何「认证关闭就跳走」的兜底，所以直接访问 `/auth/login` 照样渲染出
> 邮箱+密码表单。**

分三层证据：

**① 界面上本来就没有登录入口（改前也一样）**

改前抓首页 RSC payload，账号能力位全为 false：

```
capabilities: { signUp:false, passwordReset:false, deleteUser:false,
                oauth:false, emailVerification:false, share:false }
```

改前逐一点击首页全部 28 个可交互控件（Toggle Sidebar / History Actions / Feedback / Open menu /
Add / 模式切换 / 模型选择 / 5 个建议 chip），**没有任何一个跳到 `/auth/login`**，也没有任何
`a[href*="/auth"]`。即「评审是被界面引导过去」的假设不成立。

**② 登录页是「URL 可直接到达」的**

改前实测（真实域名链路）：

| 路径 | 状态码 | 最终 URL | 可见密码框 | 页面文案 |
|---|---|---|---|---|
| `/auth/login` | 200 | `/auth/login` | **1 个（可见）** | Welcome back / Sign in to your account / Email / Password / Sign In |
| `/auth/sign-up` | 307 | `/auth/login` | **1 个（可见）** | 同上 |
| `/auth/error` | 200 | `/auth/error` | 0 | Sorry, something went wrong. |

复现截图：`shots/before/BEFORE-pc02-auth-login.png`（与评审附件同一页面）。

**③ 上游镜像里这段路由是「无条件注册」的**

- Next.js 构建产物 `routes-manifest.json` 里 `/auth/login`、`/auth/sign-up`、`/auth/forgot-password`、
  `/auth/update-password`、`/auth/sign-up-success`、`/auth/admin`、`/auth/confirm`、`/auth/error`
  全部在 `staticRoutes` 中。
- 登录表单组件（`components_*.js` 里的 `LoginForm`）只按能力位隐藏了「Sign Up / Forgot password /
  Sign In with Google」三块，**邮箱 + 密码表单本身没有任何 `isAuthEnabled()` 判断**。
- `ENABLE_AUTH=false` 的实际作用只有一处：`getCurrentUserId()` 返回
  `process.env.ANONYMOUS_USER_ID || "anonymous-user"`（本应用配的是 `lazycat-anonymous`）。
  **页面组件没有 `if (!isAuthEnabled()) redirect("/")` 这类守卫。**
- 改完之后直连业务容器（绕过网关注入）仍能拿到登录页，反证「拦在网关层是对的」：

```
$ curl -s -D- http://172.28.4.134:3000/auth/login
HTTP/1.1 200 OK
X-Powered-By: Next.js
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
→ 正文 44822 字节，含 "Welcome back" 与 type="password"
```

**评审为什么会走到这一页**：应用内没有入口，所以大概率是评审按经验直接试了 `/auth/login`
（或按以往同类应用的惯例去找登录页），于是拿到一张要密码的截图 —— 在
`ENABLE_AUTH=false` 的设计下，这个页面本就不该存在。

---

## 3. 改动清单

只改了 `lzc-manifest.yml` 与 `package.yml`，**未改镜像、未改 content 脚本、未改 version**。

### 3.1 `lzc-manifest.yml` — 新增 `application.injects`（两层）

**第一层 `morphic-block-auth-pages`（`on: request`，真正生效的一层）**

```yaml
- id: morphic-block-auth-pages
  'on': request
  auth_required: false
  when:
    - /auth
    - /auth/*
  do: |
    ctx.response.send(302, "", {
      location: "/",
      headers: { "Cache-Control": "no-store" },
    });
```

要点（都是踩过的坑，写进注释了）：

- **`auth_required: false` 是必须的**。默认 `true` 时「没有合法 `SAFE_UID` 的请求会被静默跳过」，
  而评审/匿名访问正是这种请求 —— 不写这一行，注入等于没写，登录页照样出来。
- `when` 同时列 `/auth`（精确）和 `/auth/*`（前缀）。按平台规则 `/auth/*` 的前缀是 `/auth/`，
  不匹配 `/auth` 本身，所以两条都要写。
- 路径不带 `?query` 时 query 不参与匹配，因此 `/auth/login?_rsc=…` 这类 RSC 预取也会命中。
- 加 `Cache-Control: no-store`：不让浏览器把这条重定向或后续页面当旧副本复用。
- **试过但放弃的写法**：原本对 RSC 预取（`RSC: 1` 头）回 `ctx.response.send(204, "")`，
  实测这条路径会**直接断开连接、一个字节都不回**（curl 报 `000`，TLS 前置 nginx 记
  `502 Bad Gateway`），比回 302 更糟。而页面里已不存在任何指向 `/auth/*` 的链接
  （`capabilities.signUp=false`，没有注册/忘记密码/分享入口），App Router 不会去预取这些路由，
  所以统一 302 最稳。已实测带 `RSC: 1` 头请求 `/auth/login?_rsc=abc` 也正常拿到 `302 → /`。

**第二层 `morphic-auth-page-guard`（`on: browser`，兜底）**

```yaml
- id: morphic-auth-page-guard
  'on': browser
  auth_required: false
  when: [ /auth, /auth/* ]
  do: |
    (function () {
      var p = location.pathname;
      if (p === "/auth" || p.indexOf("/auth/") === 0) location.replace("/");
    })();
```

只匹配 `/auth/*`，不影响首页、`/search/*`、`/api/*` 与静态资源。作用是「万一」：浏览器复用了旧
`/auth/login` 副本、或将来上游改成客户端 `router.push` 跳登录页时，页面自己在跳回首页。
本版因为它上游已无任何入口，实测处于**休眠状态**（首页 HTML 里没有 `/_lzc/injects/` 脚本标签，
说明 browser 注入确实没有误命中非 `/auth` 页面）。

### 3.2 `package.yml` — `locales` 的 `usage` 与界面口径对齐

zh-CN 与 en-US 都显式写明「没有应用内账号、也没有应用内密码，打开即用，访问控制由懒猫账号负责」：

```yaml
zh-CN.usage:
  - 本应用**没有应用内账号，也没有应用内密码**：不需要注册、不需要登录，
    打开就是搜索界面，可以直接提问。应用内不存在登录页、注册页或任何密码输入框。
  - 访问控制由懒猫账号（微服账号体系）负责，能打开本应用就说明已经通过微服鉴权。
en-US.usage:
  - This app has **no in-app account and no in-app password**. ... The app contains no login
    page, no sign-up page and no password field.
  - Access control is handled by the Lazycat (box) account system ...
```

`lzc-cli project lint` → **No manifest lint warnings found.**

---

## 4. 实机验收

### 4.1 验收方式

全程真实链路，非推断：

```
Chrome(headless,CDP) --https--> mh-tls(nginx TLS 前置, 补 X-Forwarded-Proto)
   --http + Host: morphic.wans.heiyu.space--> cloudlazycatappmorphic-app-1(lzcinit 网关, 跑 inject)
   --> cloudlazycatappmorphic-morphic-1:3000(Next.js)
```

- 脚手架：`box-harness.sh up cloudlazycatappmorphic-app-1 morphic.wans.heiyu.space mh`
- 浏览器驱动：`acceptance/tools/morphic-accept.mjs`（puppeteer-core over CDP）
- 因为脚手架走的是 lzcinit 网关，**能命中 request 阶段注入**（打业务容器会绕过注入）。

### 4.2 全新安装流程（照做，含清数据）

```bash
bash box-harness.sh down mh                                   # 先拆前置，否则占住端点
lpk-manager uninstall cloud.lazycat.app.morphic               # Uninstall completed
lzc-docker ps -a | grep -i morphic                            # 空 → 容器已移除
rm -rf /lzcsys/data/appvar/cloud.lazycat.app.morphic          # 清本应用数据
lpk-manager install /root/morphic.lpk                         # Install succeeded
# 等 PREPARING → STARTING → RUNNING
bash box-harness.sh up cloudlazycatappmorphic-app-1 morphic.wans.heiyu.space mh
```

安装的 LPK sha256 与本地打包产物逐字节一致：
`82b3146a3dbd5447fec8b93d09f22b9da1e64bf82442982256fc34b784ca46a2`。

### 4.3 容器状态

| 容器 | 状态 |
|---|---|
| `cloudlazycatappmorphic-app-1`（lzcinit 网关） | Up (healthy) |
| `cloudlazycatappmorphic-morphic-1` | Up（该服务未定义 healthcheck，平台就绪门由 `application.health_check` 覆盖） |
| `cloudlazycatappmorphic-postgres-1` | Up (healthy) |
| `cloudlazycatappmorphic-redis-1` | Up (healthy) |
| `cloudlazycatappmorphic-searxng-1` | Up (healthy) |

`lpk-manager status` → `cloud.lazycat.app.morphic  RUNNING  morphic`。

### 4.4 `/auth/*` 全量拦截（改后）

经真实域名链路，`Location: /`、`Cache-Control: no-store`、`Content-Length: 0`
（`no-store` 是本次注入写的，可作为「是我们的注入在生效、不是 Next.js 自己跳的」的判据）：

| 路径 | 状态码 | 落点 |
|---|---|---|
| `/auth` | 302 | `/` |
| `/auth/` | 302 | `/` |
| `/auth/login` | 302 | `/` |
| `/auth/sign-up` | 302 | `/` |
| `/auth/forgot-password` | 302 | `/` |
| `/auth/update-password` | 302 | `/` |
| `/auth/sign-up-success` | 302 | `/` |
| `/auth/admin` | 302 | `/` |
| `/auth/confirm` | 302 | `/` |
| `/auth/error` | 302 | `/` |
| `/auth/login?_rsc=abc` | 302 | `/` |
| `/auth/login` + `RSC: 1` 头 | 302 | `/` |

浏览器实测的最终落点（`page.goto('/auth/login')`）：

| 请求路径 | 最终 URL | 可见密码框 | 登录文案 |
|---|---|---|---|
| `/auth/login` | `https://morphic.wans.heiyu.space/` | 0 | 无 |
| `/auth/sign-up` | `https://morphic.wans.heiyu.space/` | 0 | 无 |

> 说明：表格里「最终 URL」为首页，`page.goto` 返回的 `status=200` 是**跟随 302 之后**首页的
> 状态码；原始 302 见上一张表与 `Location` 头。

### 4.5 非 `/auth` 路径未受影响

| 路径 | 状态码 |
|---|---|
| `/` | 200 |
| `/search/accfxchat00000000000000001` | 200 |
| `/api/chats` | 200（返回 JSON 列表） |
| `/_next/static/chunks/0-hrh_uw98wb_.js`（首页引用的真实 chunk） | 200 `application/javascript` |
| `/favicon.ico` | 200 |

两个 404 与本次改动无关，已逐一直连业务容器（绕过注入）验证过：

- `/api/usage` —— 直连上游 `http://<morphic 容器>:3000/api/usage` 同样是 **404**，
  是上游自身行为（未配置用量统计时该路由不存在），不是被注入打坏。
- `/_next/static/chunks/main-app.js` —— 该文件名在本 Turbopack 构建里不存在，是我随手写的探测路径；
  首页真实引用的 chunk `/_next/static/chunks/0-hrh_uw98wb_.js` 返回 200 `application/javascript`。

页面实际加载过程中 HTTP ≥ 400 计数为 **0**。

### 4.6 页面扫描（PC 1920×1080 + 移动 430×932 DPR3）

每一页都同时检查：可见密码框、`input[type=email]`、`a[href]` 里是否指向 `/auth|login|signup`、
可见文案是否命中 `sign in / login / password / 登录 / 注册 / 密码 / 邮箱 / 账号` 等词。

| 页面 | 状态 | 最终 URL | 可见密码框 | 指向 auth 的链接 | 登录类文案命中 |
|---|---|---|---|---|---|
| 首页（PC，侧栏收起） | 200 | `/` | 0 | 0 | 无 |
| 首页（PC，侧栏展开＝历史列表） | 200 | `/` | 0 | 0 | 无 |
| 引用详情 `/search/<id>`（PC） | 200 | 同路径 | 0 | 0 | 无 |
| **`/auth/login`** | 200 | **`/`** | **0** | 0 | **无** |
| **`/auth/sign-up`** | 200 | **`/`** | **0** | 0 | **无** |
| 首页（移动 430×932） | 200 | `/` | 0 | 0 | 无 |
| 引用详情（移动 430×932） | 200 | 同路径 | 0 | 0 | 无 |

**汇总**：`pagesWithVisiblePasswordInput = []`、`pagesWithAuthLinks = []`。
移动端横向溢出：`overflowDoc = 0`、越界可见元素 `0`（`docWidth == innerWidth == 430`）。

### 4.7 控制台 / 网络

| 指标 | 次数 | 说明 |
|---|---|---|
| `pageerror` | **0** | |
| `console.error` | **0** | |
| HTTP ≥ 400 | **0** | |
| 请求失败（`requestfailed`） | 9 | **全部**是 Next.js App Router 的 RSC 预取被主动取消：`?_rsc=…` + `net::ERR_ABORTED`（导航时浏览器丢弃进行中的预取，属正常行为，非报错） |
| 第三方外链 | 0 | 整轮没有任何跨域请求 |

### 4.8 截图

PC 1920×1080（5 张，全部为真实页面）：

| 文件 | 内容 |
|---|---|
| `shots/pc-01-home.png` | 首页，可直接提问；无登录入口 |
| `shots/pc-02-history.png` | 首页 + 展开的历史侧栏（有对话记录） |
| `shots/pc-03-citation.png` | 引用详情 `/search/<id>`，答案正文 + `[1][2]` 引用角标 |
| `shots/pc-04-auth-login-landing.png` | **访问 `/auth/login` 的实际画面 —— 就是首页** |
| `shots/pc-05-auth-signup-landing.png` | 访问 `/auth/sign-up` 的实际画面 —— 也是首页 |

移动端 430×932 DPR3（1290×2796）：

| 文件 | 内容 |
|---|---|
| `shots/mob-01-home.png` | 移动首页，输入栏完整、无横向溢出 |
| `shots/mob-02-citation.png` | 移动引用详情页 |

改前复现（对照用，`shots/before/`）：

| 文件 | 内容 |
|---|---|
| `BEFORE-pc02-auth-login.png` | **复现评审附件**：Welcome back / Email / Password / Sign In |
| `BEFORE-pc03-auth-signup.png` | `/auth/sign-up` 被 307 到同一登录页 |
| `BEFORE-pc01-home.png` | 改前首页（同样没有登录入口，证明问题不在入口而在 URL 可达） |
| `BEFORE-pc04-auth-error.png` | `/auth/error` |
| `BEFORE-probresult.json` | 改前逐页扫描原始数据 |

机器可读结果：`shots/accept-result.json`。

---

## 5. 遗留限制与风险

1. **答案生成仍然需要一个模型 API Key（未变，且使用说明里已写明）**。
   本次验收是用 `lpk-manager install` 直装、未带部署参数，因此 `OPENAI_COMPATIBLE_MODELS`
   为空，界面右下角显示 `No enabled model available`，点发送不会产生对话。
   这是上游 Morphic 的既定设计（应用本身不含算力），不是本次返工引入的问题。
   走商店安装时 `lzc-deploy-params.yml` 的默认值（`deepseek-chat` / `https://api.deepseek.com`）
   会让模型出现在下拉里，但没有 key 时请求仍会失败。

2. **引用详情页的截图用的是「渲染用固定数据」，不是真实模型回答**。
   因为盒子上没有任何可用的 LLM 凭据，无法产生真实答案，所以我在 PostgreSQL 里插入了一条
   验收专用对话（`chats.id = 'accfxchat00000000000000001'`，`user_id = 'lazycat-anonymous'`，
   正文为两条 `text` part + 两条 `source-url` part），只为验证 `/search/<id>`、历史侧栏能正常
   渲染、不出现登录入口。**它不是产品功能证据**。真实答案/引用卡的完整形态（含 favicon 引用
   卡片）仍需在有 key 的环境下复核。同理，截图里的 `[1] [2]` 是纯文本角标而非可点 chip，
   原因是没有 `search` 工具调用的输出可供映射，这同样属于「没有模型」的连带现象。

3. **`morphic` 业务容器没有独立的 healthcheck**（manifest 里只有应用级 `health_check.test_url`），
   平台状态为 `RUNNING`、容器 `Up`。本次未加，因为该镜像内是否有 `curl`/`wget` 未经验证，
   贸然加 `CMD-SHELL` 探测有把应用探成 unhealthy 的风险。若后续主控要求「每个服务都有健康状态」，
   需先确认镜像内可用探测命令。

4. **浏览器旧副本风险已排除但值得记录**：上游 `/auth/login` 自身的响应头是
   `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`，
   因此评审即使上一轮访问过，浏览器也不会复用旧页面；本次 302 又额外加了 `no-store`。
   另外验收中确实踩到过一次「库里改了、页面还是旧内容」，那是这台复用 profile 的 Chrome 的
   缓存/Next Router 缓存造成的，验收脚本已加 `Network.clearBrowserCache` + 时间戳 query 规避。

5. 移动端按 **430×932 DPR3** 出图（沿用 1.8.0-2 已测结论：390/393/412px 下底部输入栏会横向
   溢出、430px 完整）。本次复测 430px 无溢出；更窄机型的问题属上游响应式限制，不在本次改动范围。

---

## 6. 复现命令

```bash
# 打包（纯清单改动，不重建镜像）
cd /home/wans/rework/morphic
lzc-cli project lint
mkdir -p dist && lzc-cli project release -f ./lzc-build.yml -o ./dist/morphic.lpk

# 装到盒子（先拆脚手架，避免 has active endpoints）
ssh lzcbox 'bash /root/mh-tools/box-harness.sh down mh'
ssh lzcbox 'lpk-manager uninstall cloud.lazycat.app.morphic; rm -rf /lzcsys/data/appvar/cloud.lazycat.app.morphic'
scp dist/morphic.lpk lzcbox:/root/morphic.lpk
ssh lzcbox 'lpk-manager install /root/morphic.lpk'
ssh lzcbox 'bash /root/mh-tools/box-harness.sh up cloudlazycatappmorphic-app-1 morphic.wans.heiyu.space mh'

# CDP 隧道 + 验收
ssh -N -L 127.0.0.1:9334:<mh-chrome IP>:9441 lzcbox &
PUPPETEER_CORE_DIR=/lzcapp/document/wans/lpk-skill/node_modules \
  node acceptance/tools/morphic-accept.mjs \
    --base https://morphic.wans.heiyu.space --cdp http://127.0.0.1:9334 \
    --chat accfxchat00000000000000001 --out acceptance/shots

# 一条命令看拦截是否生效（应全部 302 -> / 且带 Cache-Control: no-store）
ssh lzcbox 'curl -sk -D- -o /dev/null -H "Host: morphic.wans.heiyu.space" https://<mh-tls IP>/auth/login'
```

> 盒子上的 `box-harness.sh` 原始路径 `/lzcapp/document/wans/lpk-skill/toolbox/box/box-harness.sh`
> **在盒子上不存在**（`/lzcapp/document` 是用户文稿目录，不是技能库）。本次是把本工作容器里的
> 权威版本 `scp` 到盒子 `/root/mh-tools/box-harness.sh` 后运行的（md5 与工作容器一致）。

---

## 7. 声明

- 未 push 到 GitHub，未提审，未改 `version`（仍为 `1.8.0-2`）。
- 未重建设 docker 镜像，未改 `content/**`。
- 未改动其它应用，未改动 `/lzcapp/document/wans/lpk-skill` 知识库。
- 仓库内改动：`lzc-manifest.yml`、`package.yml`，另新增 `acceptance/`（报告 + 探针 + 截图）。

## 8. 盒子收尾状态

- 应用**保持安装并运行中**：`lpk-manager status` → `RUNNING`，五个容器全部 `Up`
  （postgres / redis / searxng / app 为 healthy）。
- 验收脚手架（`mh-tls` / `mh-chrome` / `mh-cdp-proxy` / `mh-net`）**已全部拆除**，
  不会占住应用的 compose 网络端点 —— 后续任何 `uninstall` / 重装都不会再撞 `has active endpoints`。
- 本机到盒子 Chrome 的 CDP 隧道（`127.0.0.1:9334`）已关闭。
- 验收用的固定数据仍留在应用库里。若要还原成「空历史」，执行：

```bash
ssh lzcbox 'lzc-docker exec cloudlazycatappmorphic-postgres-1   psql -U morphic -d morphic -c "DELETE FROM chats WHERE id = '"'"'accfxchat00000000000000001'"'"';"'
```
