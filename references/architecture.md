# 架构说明

## 项目边界

AI_Search_Tools 是上游 AI-Search-Platform 的客户端 Skill，不是独立采集服务。

```text
本地 AI CLI / 无登录网页
  -> scripts/platform_skill.py
  -> AI-Search-Platform /v1
  -> 平台授权的 Actor
```

本地代理负责保护 API Key、转发请求和规范化错误，不保存用户、钱包、Actor、计费或采集结果。上游平台负责鉴权、权限、任务幂等、点数冻结与结算、执行和结果持久化。

## 本地数据

- `config.local.json`：本机连接信息，被 Git 忽略。
- 浏览器 `localStorage`：最近 50 个任务索引，不含完整结果。
- 结果：查看或下载时从上游临时读取，不建立本地数据中心。

## 前端页面

- 小红书插件：`/xiaohongshu/search`、`/xiaohongshu/results`
- 抖音插件：`/douyin/search`、`/douyin/results`
- 跨平台任务：`/tasks`
- 上游连接：`/config`

平台结果页只根据浏览器任务索引重新读取上游结果。完整结果不写入 `localStorage`，也不通过本地代理持久化。

## 本地接口

- `GET /api/client/config`
- `POST /api/client/config`
- `GET /api/client/actors`
- `POST /api/client/tasks`
- `GET /api/client/tasks/{task_id}`
- `GET /api/client/tasks/{task_id}/results`

代理默认且仅允许绑定本机回环地址。浏览器不会收到 API Key 明文。
