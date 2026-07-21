# 能力参数

调用前运行 `list-actors` 获取可用 Actor 和 operation。官方模式使用客户端内置 Actor 目录并验证 Apify Token；网关模式通过 `GET /v1/actors` 读取网关授权目录。

## 小红书

| operation | 用途 | 必填或至少一项 | 常用可选参数 |
| --- | --- | --- | --- |
| `search_notes` | 关键词搜索笔记 | `keyword` | `max_items`、`sort_type`、`note_type`、`publish_time_range` |
| `search_hot_list` | 热榜内容 | 无 | `max_items` |
| `get_note_detail` | 笔记详情 | `note_id` 或 `note_url` | 无 |
| `get_user_info` | 博主资料 | `user_id` 或 `profile_url` | 无 |
| `list_user_notes` | 博主笔记 | `user_id` 或 `profile_url` | `max_items` |
| `get_note_comments` | 笔记评论 | `note_id` 或 `note_url` | `max_items` |
| `get_note_sub_comments` | 评论回复 | `note_id`、`comment_id` | `max_items` |

## 抖音视频搜索

operation：`douyin_search_videos`

| 字段 | 约束 |
| --- | --- |
| `keywords` | 1 至 5 个关键词的数组，单项不超过 100 字符 |
| `maxResultsPerQuery` | 每个关键词 1 至 200 条 |
| `sort` | `general`、`most_liked`、`latest` |
| `publishTime` | `unlimited`、`one_day`、`one_week`、`half_year` |
| `duration` | `unlimited`、`under_1m`、`one_to_five`、`over_5m` |

客户端固定请求视频封面以支持结果卡片和详情预览；视频文件与图集文件仍固定为关闭，避免无必要保存媒体文件。

## 抖音评论采集

operation：`douyin_fetch_comments`

| 字段 | 约束 |
| --- | --- |
| `awemeUrls` | 1 至 20 个抖音 HTTPS 链接或纯数字视频 ID |
| `maxCommentsPerAweme` | 每个视频 1 至 200 条评论 |
| `includeReplies` | 是否采集回复，默认 `false` |
| `maxRepliesPerComment` | 采集回复时必需，1 至 200 |

建议从较小数量开始。官方模式费用以 Apify 为准；网关模式以单个任务返回的点数为准。

## 微博

微博 operation 使用 `weibo_` 前缀，与小红书同类能力严格区分。

| operation | 用途 | 必填或至少一项 | 常用可选参数 |
| --- | --- | --- | --- |
| `weibo_search_posts` | 关键词搜索微博 | `keyword` | `page_token`、`max_items`、`auto_paginate` |
| `weibo_search_hot_list` | 微博热搜榜 | 无 | `max_items` |
| `weibo_get_post_detail` | 微博详情 | `post_id` 或 `post_url` | 无 |
| `weibo_get_user_info` | 用户资料 | `user_id` 或 `profile_url` | 无 |
| `weibo_list_user_posts` | 用户微博列表 | `user_id` 或 `profile_url` | `page_token`、`max_items`、`auto_paginate` |
| `weibo_get_post_comments` | 微博评论 | `post_id` 或 `post_url` | `sort_type`、`page_token`、`max_items`、`auto_paginate` |
| `weibo_get_post_comment_replies` | 评论回复 | `post_id`、`comment_id` | `page_token`、`max_items`、`auto_paginate` |
| `weibo_list_post_likers` | 点赞用户 | `post_id` 或 `post_url` | `page_token`、`max_items`、`auto_paginate` |
| `weibo_list_post_reposts` | 转发列表 | `post_id` 或 `post_url` | `page_token`、`max_items`、`auto_paginate` |

`max_items` 范围为 1 至 1000，仍受上游平台全局上限约束。评论排序只接受 `hot` 或 `time_descending`；回复采集必须使用评论结果返回的真实 ID。

### 分页与失败处理

- 第一页的 `page_token` 必须留空或省略；它不是页码。
- 后续请求只能原样使用上一页响应返回的 `page_token`。
- `"page_token": "1"` 这类输入会被服务端拒绝，上游 Run 进入 `FAILED`，并可能产生 Actor 启动费。
- 服务端任务状态为 `failed` 时，优先查看任务中的错误消息，不要把 0 条结果当作成功搜索。

### 最小验证请求

```json
{
  "keyword": "人工智能",
  "max_items": 5,
  "auto_paginate": true,
  "page_token": ""
}
```

历史网关联调已验证该请求可返回 5 条微博。官方与网关计费口径不同，执行前分别确认 Apify 费用和平台点数。
# 快手

当前前端约定以下 operation。官方模式使用 Actor `W0cFcwuH7hhObmnwT`；网关备份需注册等价快手 Actor，并通过 `/v1/actors` 返回这些 operation。

| operation | 用途 | 核心输入 |
| --- | --- | --- |
| `kuaishou_search_videos` | 关键词搜索快手视频 | `keyword`、可选 `max_items` |
| `kuaishou_get_video_detail` | 获取视频详情 | `video_id` 或 `video_url` |
| `kuaishou_get_video_comments` | 获取实际一级评论 | `video_id` 或 `video_url`、可选 `max_items` |
| `kuaishou_get_comment_replies` | 获取二级评论回复 | `video_id`、`comment_id`、可选 `max_items` |
| `kuaishou_get_user_info` | 获取博主资料 | `user_id` 或 `profile_url` |
| `kuaishou_list_user_videos` | 获取博主作品 | `user_id` 或 `profile_url`、可选 `max_items` |

建议先运行“10 个视频、每个视频 20 条评论、少量回复”的小批量任务，确认字段完整性和实际费用后再扩大范围。
