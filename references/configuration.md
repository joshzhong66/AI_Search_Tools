# 配置说明

## 优先级

1. 环境变量
2. 被 Git 忽略的 `config.local.json`
3. 不含敏感值的 `config.json`

官方环境变量为 `APIFY_API_BASE`、`APIFY_API_TOKEN`。网关环境变量为 `AI_SEARCH_GATEWAY_FALLBACK_ENABLED`、`AI_SEARCH_PLATFORM_URL`、`AI_SEARCH_PLATFORM_API_KEY`。

## 字段

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `apify_api_base` | Apify 官方 API 地址 | `https://api.apify.com/v2` |
| `apify_api_token` | Apify Token，敏感值 | 空 |
| `poll_interval_seconds` | 任务轮询间隔 | `2` |
| `request_timeout_seconds` | 单次请求超时 | `60` |

设置页仅使用 Apify 官方 API。任务创建、状态查询和结果读取均使用同一个官方 Token。

## 安全规则

- 不在 `config.json`、Git、日志、测试和命令参数中写入真实 Token 或 Key。
- 通过设置页输入的凭据只写入 `config.local.json`；配置接口只返回掩码。
- 本地代理只绑定回环地址，不绑定 `0.0.0.0` 或局域网地址。
- 在聊天、截图或 Git 历史中出现过的凭据必须立即撤销并轮换。
