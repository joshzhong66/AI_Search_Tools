---
name: signalflow-ai-search
description: >-
  小红书与抖音内容搜索 Skill。通过 AI-Search-Platform 提交笔记搜索、热榜、详情、
  博主、评论回复、抖音视频搜索和批量评论采集任务。用户需要搜索或采集这两个平台时使用。
---

# AI 搜索 Skill

本 Skill 是 `AI-Search-Platform` 的轻量客户端。它不登录平台账号、不直连 Apify，也不在本地建立数据中心。所有权限、执行、计费和结果持久化均由上游平台负责。

## 执行流程

1. 运行 `python scripts/platform_skill.py show-config` 检查上游地址和 API Key 掩码。
2. 运行 `python scripts/platform_skill.py list-actors`，从返回结果动态选择包含目标 operation 的 Actor。
3. 收集目标能力所需字段，将任务 `input` 写入 UTF-8 JSON 文件。
4. 使用 `run` 提交任务。需要等待终态时增加 `--wait`。
5. 使用 `status` 查询任务；状态为 `settled` 或 `refunded` 后使用 `results` 读取结果。

```powershell
python scripts/platform_skill.py run `
  --actor-id <从 list-actors 获取> `
  --operation search_notes `
  --input-file request.json `
  --wait
```

重试同一业务请求时，传入相同的 `--idempotency-key`，避免重复创建任务。

## 意图映射

| 用户意图 | operation | 核心输入 |
| --- | --- | --- |
| 搜索小红书笔记 | `search_notes` | `keyword` |
| 查看小红书热榜 | `search_hot_list` | 可选 `max_items` |
| 查看笔记详情 | `get_note_detail` | `note_id` 或 `note_url` |
| 查看博主资料 | `get_user_info` | `user_id` 或 `profile_url` |
| 查看博主笔记 | `list_user_notes` | `user_id` 或 `profile_url` |
| 采集笔记评论 | `get_note_comments` | `note_id` 或 `note_url` |
| 采集评论回复 | `get_note_sub_comments` | `note_id`、`comment_id` |
| 搜索抖音视频 | `douyin_search_videos` | `keywords` |
| 批量采集抖音评论 | `douyin_fetch_comments` | `awemeUrls` |

抖音评论采集只有在用户明确需要回复时才设置 `includeReplies=true`，并使用较小的 `maxRepliesPerComment` 起步。

## 命令

```powershell
python scripts/platform_skill.py show-config
python scripts/platform_skill.py list-actors
python scripts/platform_skill.py run --actor-id <id> --operation <operation> --input-file <json>
python scripts/platform_skill.py status <task_id>
python scripts/platform_skill.py results <task_id>
python scripts/platform_skill.py serve --open-browser
```

本地网页默认地址为 `http://127.0.0.1:8790`。网页和 CLI 共用同一份上游配置。

## 安全边界

- API Key 通过环境变量或被 Git 忽略的 `config.local.json` 提供。
- 浏览器只访问本地 `/api/client/*` 代理，无法读取 Key 明文。
- `localStorage` 只保存最近 50 个任务的索引，不保存采集结果。
- 不要把 API Key、Apify Token、密码或完整结果写入仓库。

详细参数见 [references/operations.md](references/operations.md)，配置见 [references/configuration.md](references/configuration.md)。
