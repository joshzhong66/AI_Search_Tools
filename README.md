# AI_Search_Tools

AI_Search_Tools 是本地 AI Skill 客户端，提供无登录网页和统一 CLI，用于执行小红书、抖音、快手与微博内容搜索和采集任务。

项目仅直连 Apify 官方 API。客户端不提供账号、钱包、API 令牌管理、计费聚合或本地数据中心。

## 功能

- 小红书：独立的“搜索与采集”和“采集结果”页面，覆盖笔记、热榜、博主、评论和回复。
- 小红书笔记结果中的评论数字可打开评论详情弹窗，并在确认数量后发起评论或回复采集。
- 四个平台的评论和回复都只在对应内容详情弹窗中采集和展示，不进入平台采集结果历史或“全部任务”。
- 抖音：独立的视频搜索、评论采集和中文结果页面，支持视频筛选、批量评论及可选回复。
- 微博：覆盖微博搜索、热搜、详情、用户微博、评论回复、点赞用户和转发列表，共 9 项能力。
- 快手：支持关键词视频搜索、视频详情、一级评论、二级回复、博主资料与博主作品；评论与回复分成独立任务，官方模式使用 Actor `W0cFcwuH7hhObmnwT`。
- 任务：状态轮询、提供方标记、单任务费用、结果表格、详情、JSON 和 CSV 下载。
- 连接：本机保存 Apify Token；可选保存网关地址和 API Key，浏览器只访问本地代理。
- CLI：与网页共用配置、operation 和双适配器调用逻辑。

## 快速开始

要求 Python 3.10 或更高版本，不需要安装第三方 Python 包。

```powershell
python scripts/platform_skill.py serve --port 8790 --open-browser
```

固定访问地址为 `http://127.0.0.1:8790`。不要使用 `--port 0` 或其他端口：浏览器的本地任务与结果缓存按端口隔离，切换端口会让历史结果不可见。在“API配置”页填写 Apify API Token，官方地址固定为 `https://api.apify.com/v2`。

主要页面：

- `/xiaohongshu/search`、`/xiaohongshu/results`
- `/douyin/search`、`/douyin/results`
- `/kuaishou/search`、`/kuaishou/results`
- `/weibo/search`、`/weibo/results`
- `/tasks`、`/config`

官方模式内置当前四个平台的 Actor 目录，并通过 Apify `/users/me` 验证 Token。微博 Actor 为 `2LERepIog9VIQCmN6`，快手 Actor 为 `W0cFcwuH7hhObmnwT`；实际权限和费用以 Apify 账户为准。

微博关键词搜索示例（第一页不要传页码）：

```json
{
  "keyword": "人工智能",
  "max_items": 5,
  "auto_paginate": true,
  "page_token": ""
}
```

`page_token` 是上游返回的分页令牌，不是页码。第一页必须留空；翻页时才原样传入上一页结果中的令牌。传入 `"1"` 等页码会导致任务失败并产生启动费。

界面使用全屏工作区；`1024–1439px` 使用紧凑侧栏，低于 `1024px` 切换为抽屉导航。

也可以运行交互向导：

```powershell
python scripts/wizard.py
```

## 配置

配置优先级从高到低：

1. `APIFY_API_TOKEN`、`APIFY_API_BASE`、`AI_SEARCH_GATEWAY_FALLBACK_ENABLED`、`AI_SEARCH_PLATFORM_URL`、`AI_SEARCH_PLATFORM_API_KEY` 环境变量
2. 被 Git 忽略的 `config.local.json`
3. 不含敏感值的 `config.json`

`config.local.json` 示例：

```json
{
  "apify_api_base": "https://api.apify.com/v2",
  "apify_api_token": ""
}
```

## CLI

```powershell
python scripts/platform_skill.py show-config
python scripts/platform_skill.py list-actors
python scripts/platform_skill.py run --actor-id <id> --operation <operation> --input-file request.json --wait
python scripts/platform_skill.py status <task_id>
python scripts/platform_skill.py results <task_id>
```

Actor ID 必须从 `list-actors` 获取。Apify 官方 POST 不自动重试；网关请求重试时复用同一个 `--idempotency-key`。

历史网关 smoke test：关键词“人工智能”、`max_items=5`、自动翻页，任务成功返回 5 条微博。真实官方 Token 必须由用户在本机设置页输入，本仓库和测试不包含任何凭据，也不会自动运行付费任务。

## 架构

```text
AI / CLI ─┐                                      ┌─ Apify 官方 API ─ Actor Run / Dataset
          ├─ platform_skill.py（127.0.0.1）─────┤
浏览器 ───┘                                      └─
```

浏览器 `localStorage` 保存最近 50 个任务的索引及结果 JSON 缓存；重新打开时会先读取本地缓存，再通过 Apify 官方 API 同步任务状态和结果。

已完成任务的完整结果还会写入 `outputs/task-results/<任务ID>.json`。该目录不进入 Git，适合本地归档和重启服务后的结果留存。

## 测试

```powershell
python -m unittest discover -s tests -v
python -m compileall scripts
node --check frontend/assets/client.js
node tests/ui_check.js
git diff --check
```

任务状态统一为：`running` 表示执行中，`settled` 表示成功且可读取结果，`failed` 表示执行失败，`refunded` 表示网关已退款。状态和结果始终从创建任务的同一提供方读取。

浏览器检查需要本机已安装 Node.js、`playwright` 运行库和 Chrome，可通过 `PLAYWRIGHT_BROWSER_PATH` 指定其他 Chromium 浏览器。

## 安全

- `config.local.json`、`.env` 和 `outputs/` 不进入 Git。
- 本地代理仅允许绑定回环地址，避免 API Key 暴露到局域网。
- 历史版本中曾提交过的 Apify Token 必须在 Apify 后台撤销并轮换；删除当前文件中的值不能使历史凭据失效。

更多说明见 [配置](references/configuration.md)、[能力参数](references/operations.md)和[架构](references/architecture.md)。
