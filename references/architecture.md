# 架构说明

## 项目边界

AI_Search_Tools 是无登录 AI Skill 客户端。小红书、抖音、快手与微博共用业务 operation 和页面，统一通过 Apify 官方 API 执行任务。

```text
本地 AI CLI / 无登录网页
  -> scripts/platform_skill.py（凭据保护、输入转换、结果规范化）
  -> Apify 官方 API
  -> Actor Run -> Run 状态 -> 默认 Dataset
```

前端提交业务 operation；本地代理将其转换为 Actor 原生输入。任务创建、状态查询和结果读取始终使用同一个 Apify Token。

## 本地数据与接口

- `config.local.json` 仅保存本机 Apify Token，被 Git 忽略。
- 浏览器 `localStorage` 保存最近 50 个任务的索引及结果 JSON 缓存；重新打开时先展示缓存，再同步官方结果。
- `outputs/task-results/` 保存每个已完成任务的完整结果 JSON，不进入 Git。
- 本地接口保持 `/api/client/config`、`/api/client/actors`、`/api/client/tasks`、任务状态和结果接口。
- 前端页面保持 `/xiaohongshu/*`、`/douyin/*`、`/kuaishou/*`、`/weibo/*`、`/tasks` 和 `/config`。

本地代理只允许绑定回环地址，浏览器不会收到 Token 明文。
