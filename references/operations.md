# 能力参数

Actor ID 不在客户端硬编码为权限依据。调用前通过 `GET /v1/actors` 或 `list-actors` 获取当前 API Key 可用的 Actor 和 operation。

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

客户端下载字段固定为关闭，避免无必要保存媒体文件。

## 抖音评论采集

operation：`douyin_fetch_comments`

| 字段 | 约束 |
| --- | --- |
| `awemeUrls` | 1 至 20 个抖音 HTTPS 链接或纯数字视频 ID |
| `maxCommentsPerAweme` | 每个视频 1 至 200 条评论 |
| `includeReplies` | 是否采集回复，默认 `false` |
| `maxRepliesPerComment` | 采集回复时必需，1 至 200 |

建议从较小数量开始。最终点数以单个上游任务返回的冻结与结算字段为准。
