---
name: sofunny-ai-search
description: >-
  小红书、抖音、快手和微博内容搜索与采集 Skill。通过 Apify 官方 API 搜索笔记和视频、读取热榜、用户、
  评论、回复、点赞和转发数据。用户需要搜索、查看详情、采集互动数据，或启动本地网页界面时使用。
---

# Sofunny AI Search

通过 `scripts/platform_skill.py` 使用 Apify 官方 API 创建 Actor Run、轮询状态并读取默认 Dataset。

## 安装后引导

安装完成后先运行：

```powershell
python scripts/platform_skill.py show-config
```

- 未配置 Apify Token：说明用户需要在“API配置”页或 `APIFY_API_TOKEN` 环境变量中配置 Token；配置后运行 `list-actors` 验证。
- 已配置 Token：询问用户“是否启动本地网页？”。不要未经确认启动。
- 用户确认启动：以后台方式运行下列命令，等待输出实际地址，并告知用户打开该 URL：

```powershell
python scripts/platform_skill.py serve --port 0 --open-browser
```

`--port 0` 自动选择可用端口。用户拒绝启动时，提示可在需要时运行同一条命令。

## 任务流程

1. 运行 `python scripts/platform_skill.py list-actors`，选择包含目标 operation 的 Actor。
2. 将业务输入写入 UTF-8 JSON 文件，不自行添加 Actor 原生前缀或改写字段。
3. 使用 `run` 提交任务；需要等待时添加 `--wait`。
4. 使用 `status` 查询任务；仅在状态为 `settled` 时使用 `results` 读取结果。
5. 状态为 `failed` 或 `refunded` 时停止读取结果并报告原因。

```powershell
python scripts/platform_skill.py run `
  --actor-id <从 list-actors 获取> `
  --operation search_notes `
  --input-file request.json `
  --wait
```

官方模式的 POST 不自动重试，避免重复创建付费 Run。

## 意图映射

| 平台 | 用户意图 | operation | 核心输入 |
| --- | --- | --- | --- |
| 小红书 | 搜索笔记 / 热榜 | `search_notes` / `search_hot_list` | `keyword` / 可选 `max_items` |
| 小红书 | 笔记详情、用户、评论、回复 | `get_note_detail`、`get_user_info`、`get_note_comments`、`get_note_sub_comments` | 对应 ID 或 URL |
| 抖音 | 搜索视频 / 采集评论 | `douyin_search_videos` / `douyin_fetch_comments` | `keywords` / `awemeUrls` |
| 快手 | 搜索、详情、评论、回复、用户 | `kuaishou_*` | 关键词、视频 ID 或用户 ID |
| 微博 | 搜索、热搜、详情、用户、评论、回复、点赞、转发 | `weibo_*` | 关键词、帖子 ID 或用户 ID |

抖音仅在用户明确需要回复时设置 `includeReplies=true`，并从较小的 `maxRepliesPerComment` 开始。微博首次搜索的 `page_token` 必须为空，不能填写页码。

## 常用命令

```powershell
python scripts/platform_skill.py show-config
python scripts/platform_skill.py list-actors
python scripts/platform_skill.py run --actor-id <id> --operation <operation> --input-file <json>
python scripts/platform_skill.py status <task_id>
python scripts/platform_skill.py results <task_id>
python scripts/platform_skill.py serve --port 0 --open-browser
```

网页和 CLI 共用 Apify 配置；启动命令输出的 URL 是唯一应向用户报告的访问地址。

## 数据与安全

- 仅通过环境变量或被 Git 忽略的 `config.local.json` 提供 Apify Token。
- 浏览器只访问本地 `/api/client/*`，配置接口只返回 Token 掩码。
- 浏览器缓存最近 50 个任务和结果；已完成任务 JSON 写入 `outputs/task-results/`。
- 不输出、记录或提交 Token、密码和私钥。

按需读取 [references/operations.md](references/operations.md)、[references/configuration.md](references/configuration.md) 和 [references/architecture.md](references/architecture.md)。
