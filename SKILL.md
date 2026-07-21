---
name: sofunny-ai-search
description: >-
  小红书、抖音、快手和微博内容搜索与采集 Skill。通过 Apify 官方 API 搜索笔记和视频、读取热榜、用户、
  评论、回复、点赞和转发数据。用户需要搜索、查看详情、采集互动数据，或启动本地网页界面时使用。
---

# Sofunny AI Search

通过 `scripts/platform_skill.py` 使用 Apify 官方 API 创建 Actor Run、轮询状态并读取默认 Dataset。

## 安装与网页入口

- Skill 安装目录为包含本文件的目录；所有脚本都从该目录执行，不假定用户的当前工作目录。
- **安装后的首次交互必须先询问网页启动，不能直接执行搜索、采集或其他业务操作。** 先向用户发送：`Sofunny AI Search 已安装。是否现在启动本地网页？`
- 未得到明确同意时，不得启动服务；用户拒绝时，继续处理其 CLI 请求，或告知其可随时要求启动网页。
- 用户明确同意时，以后台方式运行下列命令，等待其输出后告知用户打开固定地址 `http://127.0.0.1:8790`：

```powershell
python scripts/platform_skill.py serve --port 8790 --open-browser
```

**始终使用 `127.0.0.1:8790`，不得使用 `--port 0` 或其他端口。** 浏览器的 `localStorage` 按地址和端口隔离；更换端口会让已保存的本地任务与结果 JSON 缓存不可见，用户会误以为数据丢失。端口已被占用时，先提示用户复用已运行的 `http://127.0.0.1:8790` 服务，或由用户停止旧服务后再启动；不得自动选择其他端口。浏览器打开失败不影响服务时，仍报告固定 URL。

用户确认或拒绝网页启动后，运行：

```powershell
python scripts/platform_skill.py show-config
```

- 未配置 Apify Token：提示用户在网页“API配置”页或 `APIFY_API_TOKEN` 环境变量中配置 Token；配置后运行 `list-actors` 验证。
- 已配置 Token：继续执行用户请求。

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

快手先使用 `kuaishou_get_video_comments` 采集一级评论，再仅对 `has_replies=true` 的结果使用真实 `photo_id + comment_id` 调用 `kuaishou_get_comment_replies`。不要把评论与回复合并成一个任务；客户端会将字段和 operation 转换为快手 Actor 的原生契约。

网页端把所有平台的评论和回复视为详情内部任务：从笔记、视频或微博详情发起并在原详情内展示，不把评论任务当作独立采集结果或全局任务展示。CLI 仍可直接调用对应 operation。

## 常用命令

```powershell
python scripts/platform_skill.py show-config
python scripts/platform_skill.py list-actors
python scripts/platform_skill.py run --actor-id <id> --operation <operation> --input-file <json>
python scripts/platform_skill.py status <task_id>
python scripts/platform_skill.py results <task_id>
python scripts/platform_skill.py serve --port 8790 --open-browser
```

网页和 CLI 共用 Apify 配置；网页入口固定为 `http://127.0.0.1:8790`，以便恢复同一浏览器中的本地任务与结果缓存。

## 数据与安全

- 仅通过环境变量或被 Git 忽略的 `config.local.json` 提供 Apify Token。
- 浏览器只访问本地 `/api/client/*`，配置接口只返回 Token 掩码。
- 浏览器缓存最近 50 个任务和结果；已完成任务 JSON 写入 `outputs/task-results/`。
- 不输出、记录或提交 Token、密码和私钥。

按需读取 [references/operations.md](references/operations.md)、[references/configuration.md](references/configuration.md) 和 [references/architecture.md](references/architecture.md)。
