# 实机验收证据 cloud.lazycat.app.morphic

- 生成时间：2026-10-19T09:58:59.406Z 至 2026-10-19T09:59:42.620Z
- LPK：/home/wans/rework/morphic/dist/morphic-1.8.0-3.lpk（sha256 `c27a8efd3975611335bcdd2e9d4f04e50d6e259b8ed535f85de92ca2a246a635`）
- 应用域名：morphic.wans.heiyu.space；盒子：lzcbox（ssh 用户 root，lzcos v1.6.2，docker 27.5.1）
- 脚手架：mh2；CDP 隧道端口：9337
- 结论：未通过（S7 出图）

| 步骤 | 结果 | 说明 |
|---|---|---|
| S1 前置检查 | 通过 | lzcos v1.6.2 docker 27.5.1 sshCode 0 |
| S1 脚手架名合法 | 通过 | mh2 |
| S2 拆除同名脚手架 | 通过 | HARNESS_DOWN (mh2) |
| S2/S3/S4 跳过安装 | 通过 | 按 --skip-install 直接验收现有实例 |
| S5 容器就绪 | 通过 | 5 个容器 Up，等待 0s |
| S6 起 TLS 前置与 Chrome | 通过 | CHROME_IP=172.28.3.195 |
| S6 入口链路返回应用页面 | 通过 | 63882 字节，注入 0 个 |
| S6 CDP 隧道 | 通过 | 127.0.0.1:9337 -> 172.28.3.195:9441 |
| S7 全页回归 0 报错 | 通过 | 2 页，问题页 0 |
| S7 出图 | 失败 | PC 2 张，移动 2 张 |

## 容器状态

- cloudlazycatappmorphic-morphic-1：Up 49 minutes
- cloudlazycatappmorphic-postgres-1：Up 49 minutes (healthy)
- cloudlazycatappmorphic-searxng-1：Up 49 minutes (healthy)
- cloudlazycatappmorphic-redis-1：Up 49 minutes (healthy)
- cloudlazycatappmorphic-app-1：Up 49 minutes (healthy)

## 回归结果

- 页面数：2，问题页：0
- 外网依赖：https://morphic.wans.heiyu.space/、https://morphic.wans.heiyu.space/_next/static/media/83afe278b6a6bb3c-s.p.0q-301v4kxxnr.woff2、https://morphic.wans.heiyu.space/_next/static/chunks/0dj__faz90r4p.css、https://morphic.wans.heiyu.space/_next/static/chunks/0btkwh0cdeo8c.css、https://morphic.wans.heiyu.space/_next/static/chunks/0-hrh_uw98wb_.js、https://morphic.wans.heiyu.space/_next/static/chunks/16179bmihcxnz.js、https://morphic.wans.heiyu.space/_next/static/chunks/0sdmrx_68ms6t.js、https://morphic.wans.heiyu.space/_next/static/chunks/0aqpm5mabssqz.js、https://morphic.wans.heiyu.space/_next/static/chunks/128aahewwf1we.js、https://morphic.wans.heiyu.space/_next/static/chunks/0th97k6..1was.js、https://morphic.wans.heiyu.space/_next/static/chunks/turbopack-0~-c6rj9hv0_1.js、https://morphic.wans.heiyu.space/_next/static/chunks/0gwg_w3d2qe6j.js、https://morphic.wans.heiyu.space/_next/static/chunks/09ip2nwiko_ed.js、https://morphic.wans.heiyu.space/_next/static/chunks/04ydj-9xvx8uv.js、https://morphic.wans.heiyu.space/_next/static/chunks/0d.heku6_su94.js、https://morphic.wans.heiyu.space/_next/static/chunks/0-~kpotx4sjcs.js、https://morphic.wans.heiyu.space/_next/static/chunks/0i.l9589uvx0j.js、https://morphic.wans.heiyu.space/_next/static/chunks/0dda3yi3lpyd9.js、https://morphic.wans.heiyu.space/_next/static/chunks/13n~bvk5e494-.js、https://morphic.wans.heiyu.space/api/chats?offset=0&limit=20、https://morphic.wans.heiyu.space/?_rsc=tXyZJ52UQVBCVsD3、https://morphic.wans.heiyu.space/search/accfxchat00000000000000001?_rsc=5CB68i4pnAekjehf、https://morphic.wans.heiyu.space/search/accfxchat00000000000000001?_rsc=aCwclxwBhbuw6F7d、https://morphic.wans.heiyu.space/_next/static/chunks/0gby15fqvbm~b.js、https://morphic.wans.heiyu.space/search/accfxchat00000000000000001、https://morphic.wans.heiyu.space/?_rsc=zj-uSgHhA8BZoNaP、https://morphic.wans.heiyu.space/?_rsc=awQQDJxKVwuQBW1d、https://morphic.wans.heiyu.space/search/accfxchat00000000000000001?_rsc=awQQDJxKVwuQBW1d

## 截图

- mob01__.png 1170x2532
- mob02__settings.png 1170x2532
- pc01__.png 1920x1080
- pc02__settings.png 1920x1080

## 说明

- 本脚本覆盖：装包、容器就绪、TLS 前置链路（含 lzcinit 注入）、全页回归、PC 与移动截图、日志留证。
- 未覆盖：业务核心流程的语义判断与持久化回读。这两项按应用写探针（--probe），或由验收人按 references/acceptance-gate.md 逐项确认。
- 截图必须来自本次验收的同一版本；未通过回归的版本不得用于提审。
