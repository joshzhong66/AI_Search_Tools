---
name: signalflow-ai-search
description: >-
  小红书、抖音、快手和微博内容搜索与采集 Skill。默认直连 Apify 官方 API，支持笔记、视频、
  热榜、用户、评论、回复、点赞和转发采集；可显式启用 AI-Search-Platform 网关作为备份。
  用户需要搜索、查看详情或采集这四个平台的数据时使用。
---

# AI 搜索 Skill

通过 `scripts/platform_skill.py` 执行任务。保持业务 operation 不变，由客户端根据提供方选择传输适配器：

- 首选 `Apify 官方 API`：创建 Actor Run、轮询 Run、读取默认 Dataset。
- 备选 `AI-Search-Platform 网关`：默认关闭；仅在本地设置中显式启用。
- 不登录本地账号，不建立本地数据中心，不在浏览器暴露 Token 或 Key。

## 执行流程

1. 运行 `python scripts/platform_skill.py show-config`，确认 Apify Token 已配置；需要备份时确认网关开关与 Key。
2. 运行 `python scripts/platform_skill.py list-actors`，选择包含目标 operation 的 Actor。
3. 将业务输入写入 UTF-8 JSON 文件，不自行添加 Actor 原生前缀或改写字段。
4. 使用 `run` 提交任务；需要等待时增加 `--wait`。
5. 使用 `status` 查询任务；仅在状态为 `settled` 时使用 `results` 读取结果。
6. 状态为 `failed` 或 `refunded` 时停止读取结果并报告原因。

```powershell
python scripts/platform_skill.py run `
  --actor-id <从 list-actors 获取> `
  --operation search_notes `
  --input-file request.json `
  --wait
```

官方模式的 POST 不自动重试，避免重复创建付费 Run。网关模式使用 `--idempotency-key` 去重；重试同一网关业务请求时复用原键。

## 意图映射

| 平台 | 用户意图 | operation | 核心输入 |
| --- | --- | --- | --- |
| 小红书 | 搜索笔记 / 热榜 | `search_notes` / `search_hot_list` | `keyword` / 可选 `max_items` |
| 小红书 | 笔记详情 / 博主资料 / 博主笔记 | `get_note_detail` / `get_user_info` / `list_user_notes` | 对应 ID 或 URL |
| 小红书 | 评论 / 评论回复 | `get_note_comments` / `get_note_sub_comments` | `note_id`，回复另需 `comment_id` |
| 抖音 | 搜索视频 | `douyin_search_videos` | `keywords` |
| 抖音 | 批量评论与可选回复 | `douyin_fetch_comments` | `awemeUrls` |
| 快手 | 搜索 / 详情 | `kuaishou_search_videos` / `kuaishou_get_video_detail` | `keyword` / 视频 ID 或 URL |
| 快手 | 评论 / 回复 | `kuaishou_get_video_comments` / `kuaishou_get_comment_replies` | 视频 ID，回复另需 `comment_id` |
| 快手 | 博主资料 / 作品 | `kuaishou_get_user_info` / `kuaishou_list_user_videos` | 用户 ID 或 URL |
| 微博 | 搜索 / 热搜 / 详情 | `weibo_search_posts` / `weibo_search_hot_list` / `weibo_get_post_detail` | `keyword` / 帖子 ID 或 URL |
| 微博 | 用户 / 用户微博 | `weibo_get_user_info` / `weibo_list_user_posts` | 用户 ID 或 URL |
| 微博 | 评论 / 回复 | `weibo_get_post_comments` / `weibo_get_post_comment_replies` | `post_id`，回复另需 `comment_id` |
| 微博 | 点赞用户 / 转发 | `weibo_list_post_likers` / `weibo_list_post_reposts` | 帖子 ID 或 URL |

抖音仅在用户明确需要回复时设置 `includeReplies=true`，并从较小的 `maxRepliesPerComment` 开始。

微博和快手继续使用带平台前缀的客户端 operation；Apify 适配器会在提交前转换为 Actor 原生 operation。微博第一页的 `page_token` 必须为空，不能填写页码。

## 命令

```powershell
python scripts/platform_skill.py show-config
python scripts/platform_skill.py list-actors
python scripts/platform_skill.py run --actor-id <id> --operation <operation> --input-file <json>
python scripts/platform_skill.py status <task_id> [--provider apify|gateway]
python scripts/platform_skill.py results <task_id> [--provider apify|gateway]
python scripts/platform_skill.py serve --open-browser
```

本地网页默认地址为 `http://127.0.0.1:8790`。网页和 CLI 共用配置；任务索引保存 `provider`，状态与结果不能跨提供方查询。

## 安全边界

- 仅通过环境变量或被 Git 忽略的 `config.local.json` 提供 Apify Token 和网关 API Key。
- 让浏览器只访问本地 `/api/client/*`，配置接口只返回凭据掩码。
- 仅在 `localStorage` 保存最近 50 个任务索引，不保存完整结果。
- 不输出、记录或提交 Token、Key、密码和私钥。
- 用户在聊天、截图或 Git 历史中暴露过的 Token 必须在提供方后台撤销并轮换。

按需读取 [references/operations.md](references/operations.md) 的字段说明、[references/configuration.md](references/configuration.md) 的配置规则和 [references/architecture.md](references/architecture.md) 的适配器边界。
