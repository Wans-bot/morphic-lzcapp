# morphic-lzcapp

懒猫微服 LPK 打包工程：[Morphic](https://github.com/miurla/morphic) —— 开源的 AI 答案引擎。

推 `v*` tag 即触发 GitHub Actions（`ca-x/lazycat-github-action`）完成：改版本号 → 打包 LPK → 发 Release → 提交官方商店审核。

## 应用构成

| 服务 | 镜像（已中转至 registry.lazycat.cloud） | 作用 |
|---|---|---|
| morphic | `registry.lazycat.cloud/wans/miurla/morphic:aee06ffc1cbf0d02` | Next.js 前端与 API，端口 3000 |
| postgres | `registry.lazycat.cloud/wans/library/postgres:54b52fdd68074990` | 会话与消息持久化 |
| redis | `registry.lazycat.cloud/wans/library/redis:966d984e0a0c0c25` | 缓存与队列 |
| searxng | `registry.lazycat.cloud/wans/searxng/searxng:94ab6f1da25347` | 元搜索引擎，负责检索 |

## 两个必须知道的配置点

**1. 镜像不能用上游旧提交。** 早先钉的 `d689cf5e…` 是 20 个月前的构建，里面 Bun 1.1.3 缺 `TextEncoderStream`/`TextDecoderStream`，Next 的 edge-runtime 垫片一启动就崩，容器起不来。现在固定的是 `:latest` 对应提交，运行时为 Bun 1.4.2 + Node 22。

**2. SearXNG 必须裁剪引擎。** 上游 `settings.yml` 用的是默认引擎组（Google / DuckDuckGo / Brave / Wikipedia）。在国内网络下这些站点的 TLS 握手直接超时，表现为「界面正常、搜索永远 0 结果、日志无报错」，只留下 `unresponsive_engines: [[google, timeout], ...]`。本工程在 `content/searxng/settings.yml` 里显式关掉不可达引擎，只保留实测可用的 Bing + 百度 + 搜狗 + 360 + 夸克。

同时该文件声明了 `search.formats: [json]`，否则 SearXNG 只输出 HTML，Morphic 取 JSON 会 403。

## 模型接入

应用本身不含模型算力，通过部署参数接用户自己的 OpenAI 兼容端点（`lzc-deploy-params.yml`）：

- 模型 API Key（secret）
- 模型 API 地址（默认 `https://api.deepseek.com`）
- 模型列表（默认 `deepseek-chat`）
- 模型服务显示名

留空也能安装并打开界面，只是没有可用模型。

## 打包

```bash
npm install -g @lazycatcloud/lzc-cli
lzc-cli project lint      # 无告警
lzc-cli project release   # 产出 dist/cloud.lazycat.app.morphic-v1.8.0-1.lpk
```

## 自动出包与提审

```bash
git tag v1.8.0-1 && git push origin v1.8.0-1
```

需要仓库 Secret `LAZYCAT_TOKEN`（懒猫开发者令牌）。

## 目录

```
lzc-manifest.yml        多服务编排、路由、健康检查
package.yml             包元数据与中英文文案
lzc-deploy-params.yml   安装时向用户收集的模型参数
lzc-build.yml           构建入口（纯打包，无 buildscript）
content/searxng/        SearXNG 配置（JSON 格式 + 引擎裁剪）
docs/screenshots/       商店截图 3 PC + 3 移动
.github/                CI 工作流与 Action 配置
```

## 许可

本打包工程仅包含 LazyCat 平台适配文件。上游 Morphic 采用 Apache-2.0；随附的 SearXNG 为 AGPL-3.0，均以独立容器形式运行，未修改其源码。
