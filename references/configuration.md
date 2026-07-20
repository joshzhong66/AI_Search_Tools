# 配置说明

## 优先级

1. 环境变量 `AI_SEARCH_PLATFORM_URL`、`AI_SEARCH_PLATFORM_API_KEY`
2. `config.local.json`
3. `config.json`

环境变量按字段覆盖文件配置。网页连接页写入 `config.local.json`；该文件已加入 `.gitignore`。

## 字段

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `platform_api_base` | AI-Search-Platform 地址，只接受 HTTP/HTTPS | `http://172.16.30.55:8787` |
| `platform_api_key` | 平台 API Key，敏感值 | 空 |
| `poll_interval_seconds` | 任务轮询间隔 | `2` |
| `request_timeout_seconds` | 单次上游请求超时 | `60` |

`config.json` 不得包含真实 Key。生产或自动化环境优先使用环境变量；个人电脑可通过网页将 Key 保存到 `config.local.json`。

## 安全规则

- 不配置或读取 Apify Token。
- 配置接口仅返回 API Key 掩码。
- 本地代理不得绑定 `0.0.0.0` 或局域网地址。
- 历史 Git 中出现过的凭据必须在提供方后台撤销并轮换。
