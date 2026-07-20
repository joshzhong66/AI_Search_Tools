# AI_Search_Tools

AI_Search_Tools 是 AI 搜索中转平台的本地 Skill 客户端，提供无登录网页和统一 CLI，用于执行小红书与抖音内容搜索任务。

本项目不直连 Apify，不负责账号、钱包、API 令牌、Actor 管理、计费聚合或数据中心。上述能力由上游 `AI-Search-Platform` 统一提供。

## 功能

- 小红书：独立的“搜索与采集”和“采集结果”页面，覆盖笔记、热榜、博主、评论和回复。
- 小红书笔记结果中的评论数字可打开评论详情弹窗，并在确认数量后发起评论或回复采集。
- 抖音：独立的视频搜索、评论采集和中文结果页面，支持视频筛选、批量评论及可选回复。
- 任务：状态轮询、单任务点数信息、结果表格、详情、JSON 和 CSV 下载。
- 连接：本机保存平台地址和 API Key，浏览器只访问本地代理。
- CLI：与网页共用上游地址、API Key 和任务接口。

## 快速开始

要求 Python 3.10 或更高版本，不需要安装第三方 Python 包。

```powershell
python scripts/platform_skill.py serve --open-browser
```

浏览器访问 `http://127.0.0.1:8790`，在“上游连接”页填写平台 API Key。默认上游地址为 `http://172.16.30.55:8787`。

主要页面：

- `/xiaohongshu/search`、`/xiaohongshu/results`
- `/douyin/search`、`/douyin/results`
- `/tasks`、`/config`

界面使用全屏工作区；`1024–1439px` 使用紧凑侧栏，低于 `1024px` 切换为抽屉导航。

也可以运行交互向导：

```powershell
python scripts/wizard.py
```

## 配置

配置优先级从高到低：

1. `AI_SEARCH_PLATFORM_URL`、`AI_SEARCH_PLATFORM_API_KEY` 环境变量
2. 被 Git 忽略的 `config.local.json`
3. 不含敏感值的 `config.json`

`config.local.json` 示例：

```json
{
  "platform_api_base": "http://172.16.30.55:8787",
  "platform_api_key": "sf_live_replace_me"
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

Actor ID 必须从 `list-actors` 动态获取。请求重试时使用同一个 `--idempotency-key`。

## 架构

```text
AI / CLI ─┐
          ├─ platform_skill.py（127.0.0.1）─ AI-Search-Platform ─ Actor
浏览器 ───┘                                  ├─ 权限与 API Key
                                             ├─ 钱包与点数计费
                                             └─ 任务与结果持久化
```

浏览器 `localStorage` 只记录最近 50 个任务的 ID、平台、operation、提交时间和显示名称，完整采集数据仅在查看时从上游读取。

## 测试

```powershell
python -m unittest discover -s tests -v
python -m compileall scripts
node --check frontend/assets/client.js
node tests/ui_check.js
git diff --check
```

浏览器检查需要本机已安装 Node.js、`playwright` 运行库和 Chrome，可通过 `PLAYWRIGHT_BROWSER_PATH` 指定其他 Chromium 浏览器。

## 安全

- `config.local.json`、`.env` 和 `outputs/` 不进入 Git。
- 本地代理仅允许绑定回环地址，避免 API Key 暴露到局域网。
- 历史版本中曾提交过的 Apify Token 必须在 Apify 后台撤销并轮换；删除当前文件中的值不能使历史凭据失效。

更多说明见 [配置](references/configuration.md)、[能力参数](references/operations.md)和[架构](references/architecture.md)。
