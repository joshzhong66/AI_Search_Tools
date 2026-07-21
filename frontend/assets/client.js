(() => {
  "use strict";

  const app = document.querySelector("#app");
  const storageKey = "ai-search-skill:recent-tasks:v1";
  const resultsStorageKey = "ai-search-skill:result-cache:v1";
  const apifyOfficialUrl = "https://api.apify.com/v2";
  const terminalStatuses = new Set(["settled", "failed", "refunded"]);
  const routes = new Set(["/config", "/tasks", "/xiaohongshu/search", "/xiaohongshu/results", "/douyin/search", "/douyin/results", "/kuaishou/search", "/kuaishou/results", "/weibo/search", "/weibo/results"]);
  const errorMessages = {
    401: "API Key 缺失、无效或已过期，请到“上游连接”重新配置。",
    402: "账户余额或 API Key 配额不足，请到上游平台充值或调整额度。",
    403: "当前 API Key 无权使用该采集能力，或上游账户不可用。",
    409: "任务尚未完成，或幂等键与已有请求冲突。",
    429: "同时运行的任务已达到上限，请等待现有任务完成。",
    502: "上游服务暂时不可用，请稍后重试。",
  };
  const operationLabels = {
    search_notes: "笔记搜索", search_hot_list: "热榜搜索", get_note_detail: "笔记详情",
    get_user_info: "博主信息", list_user_notes: "博主笔记", get_note_comments: "笔记评论",
    get_note_sub_comments: "评论回复", douyin_search_videos: "视频搜索", douyin_fetch_comments: "评论采集",
    kuaishou_search_videos: "视频搜索", kuaishou_get_video_detail: "视频详情", kuaishou_get_video_comments: "视频评论",
    kuaishou_get_comment_replies: "评论回复", kuaishou_get_user_info: "博主资料", kuaishou_list_user_videos: "博主作品",
    weibo_search_posts: "微博搜索", weibo_search_hot_list: "微博热搜", weibo_get_post_detail: "微博详情",
    weibo_get_user_info: "用户资料", weibo_list_user_posts: "用户微博", weibo_get_post_comments: "微博评论",
    weibo_get_post_comment_replies: "评论回复", weibo_list_post_likers: "点赞用户", weibo_list_post_reposts: "转发列表",
  };
  const detailOnlyOperations = new Set([
    "get_note_comments", "get_note_sub_comments", "douyin_fetch_comments",
    "kuaishou_get_video_comments", "kuaishou_get_comment_replies",
    "weibo_get_post_comments", "weibo_get_post_comment_replies",
  ]);
  const primaryXhsOperations = new Set(["search_notes", "search_hot_list", "get_note_detail", "get_user_info", "list_user_notes"]);
  const primaryKuaishouOperations = new Set(["kuaishou_search_videos", "kuaishou_get_video_detail", "kuaishou_get_user_info", "kuaishou_list_user_videos"]);
  const primaryWeiboOperations = new Set(["weibo_search_posts", "weibo_search_hot_list", "weibo_get_post_detail", "weibo_get_user_info", "weibo_list_user_posts", "weibo_list_post_likers", "weibo_list_post_reposts"]);
  const xhsOperations = {
    search_notes: { title: "笔记搜索", description: "按关键词检索笔记，并控制排序、类型与时间范围。", fields: [
      ["keyword", "搜索关键词", "text", true, "例如：厦门咖啡"], ["max_items", "结果数量", "number", false, "20", 20],
      ["sort_type", "排序方式", "select", false, "", "general", { general: "综合", time_descending: "最新", like_count_descending: "最多点赞" }],
      ["note_type", "笔记类型", "select", false, "", "all", { all: "全部", image: "图文", video: "视频" }],
      ["publish_time_range", "发布时间", "select", false, "", "all", { all: "不限", day: "一天内", week: "一周内", half_year: "半年内" }],
    ] },
    search_hot_list: { title: "热榜搜索", description: "获取当前热门内容。", fields: [["max_items", "结果数量", "number", false, "20", 20]] },
    get_note_detail: { title: "笔记详情", description: "使用笔记 ID 或完整链接读取单条笔记。", oneOf: ["note_id", "note_url"], fields: [["note_id", "笔记 ID", "text", false, "输入 ID"], ["note_url", "笔记链接", "url", false, "https://www.xiaohongshu.com/..."]] },
    get_user_info: { title: "博主信息", description: "使用用户 ID 或主页链接读取博主资料。", oneOf: ["user_id", "profile_url"], fields: [["user_id", "用户 ID", "text", false, "输入 ID"], ["profile_url", "主页链接", "url", false, "https://www.xiaohongshu.com/user/..."]] },
    list_user_notes: { title: "博主笔记", description: "读取指定博主发布的笔记列表。", oneOf: ["user_id", "profile_url"], fields: [["user_id", "用户 ID", "text", false, "输入 ID"], ["profile_url", "主页链接", "url", false, "https://www.xiaohongshu.com/user/..."], ["max_items", "结果数量", "number", false, "20", 20]] },
    get_note_comments: { title: "笔记评论", description: "读取指定笔记下的一级评论。", oneOf: ["note_id", "note_url"], fields: [["note_id", "笔记 ID", "text", false, "输入 ID"], ["note_url", "笔记链接", "url", false, "https://www.xiaohongshu.com/..."], ["max_items", "评论数量", "number", false, "20", 20]] },
    get_note_sub_comments: { title: "评论回复", description: "读取指定一级评论下的回复。", fields: [["note_id", "笔记 ID", "text", true, "输入笔记 ID"], ["comment_id", "评论 ID", "text", true, "输入评论 ID"], ["max_items", "回复数量", "number", false, "20", 20]] },
  };
  const weiboOperations = {
    weibo_search_posts: { title: "微博搜索", description: "按关键词搜索微博内容。首次采集建议先取 5 条确认结果。", fields: [["keyword", "搜索关键词", "text", true, "例如：人工智能、骑行"], ["page_token", "分页令牌（首次留空）", "text", false, "仅继续采集时粘贴令牌，不能填写页码"], ["max_items", "结果数量", "number", false, "5", 5, null, 1000], ["auto_paginate", "自动翻页", "checkbox", false, "", true]] },
    weibo_search_hot_list: { title: "微博热搜", description: "获取当前微博热搜榜。", fields: [["max_items", "结果数量", "number", false, "20", 20, null, 1000]] },
    weibo_get_post_detail: { title: "微博详情", description: "使用微博 ID 或完整链接读取帖子详情。", oneOf: ["post_id", "post_url"], fields: [["post_id", "微博 ID", "text", false, "输入帖子 ID"], ["post_url", "微博链接", "url", false, "https://weibo.com/..."]] },
    weibo_get_user_info: { title: "用户资料", description: "使用用户 ID 或主页链接读取微博用户资料。", oneOf: ["user_id", "profile_url"], fields: [["user_id", "用户 ID", "text", false, "输入用户 ID"], ["profile_url", "用户主页", "url", false, "https://weibo.com/u/..."]] },
    weibo_list_user_posts: { title: "用户微博", description: "读取指定用户发布的微博列表。", oneOf: ["user_id", "profile_url"], fields: [["user_id", "用户 ID", "text", false, "输入用户 ID"], ["profile_url", "用户主页", "url", false, "https://weibo.com/u/..."], ["page_token", "分页令牌（首次留空）", "text", false, "仅继续采集时粘贴令牌，不能填写页码"], ["max_items", "结果数量", "number", false, "20", 20, null, 1000], ["auto_paginate", "自动翻页", "checkbox", false, "", true]] },
    weibo_get_post_comments: { title: "微博评论", description: "采集指定微博下的一级评论。", oneOf: ["post_id", "post_url"], fields: [["post_id", "微博 ID", "text", false, "输入帖子 ID"], ["post_url", "微博链接", "url", false, "https://weibo.com/..."], ["sort_type", "评论排序", "select", false, "", "hot", { hot: "热门", time_descending: "最新" }], ["page_token", "分页令牌（首次留空）", "text", false, "仅继续采集时粘贴令牌，不能填写页码"], ["max_items", "评论数量", "number", false, "20", 20, null, 1000], ["auto_paginate", "自动翻页", "checkbox", false, "", true]] },
    weibo_get_post_comment_replies: { title: "评论回复", description: "采集指定一级评论下的回复。", fields: [["post_id", "微博 ID", "text", true, "输入帖子 ID"], ["comment_id", "一级评论 ID", "text", true, "输入真实评论 ID"], ["page_token", "分页令牌（首次留空）", "text", false, "仅继续采集时粘贴令牌，不能填写页码"], ["max_items", "回复数量", "number", false, "20", 20, null, 1000], ["auto_paginate", "自动翻页", "checkbox", false, "", true]] },
    weibo_list_post_likers: { title: "点赞用户", description: "读取指定微博的点赞用户。", oneOf: ["post_id", "post_url"], fields: [["post_id", "微博 ID", "text", false, "输入帖子 ID"], ["post_url", "微博链接", "url", false, "https://weibo.com/..."], ["page_token", "分页令牌（首次留空）", "text", false, "仅继续采集时粘贴令牌，不能填写页码"], ["max_items", "用户数量", "number", false, "20", 20, null, 1000], ["auto_paginate", "自动翻页", "checkbox", false, "", true]] },
    weibo_list_post_reposts: { title: "转发列表", description: "读取指定微博的转发记录。", oneOf: ["post_id", "post_url"], fields: [["post_id", "微博 ID", "text", false, "输入帖子 ID"], ["post_url", "微博链接", "url", false, "https://weibo.com/..."], ["page_token", "分页令牌（首次留空）", "text", false, "仅继续采集时粘贴令牌，不能填写页码"], ["max_items", "转发数量", "number", false, "20", 20, null, 1000], ["auto_paginate", "自动翻页", "checkbox", false, "", true]] },
  };
  const kuaishouOperations = {
    kuaishou_search_videos: { title: "视频搜索", description: "按关键词搜索快手视频。首次建议少量采集，确认字段和费用后再扩大范围。", fields: [["keyword", "搜索关键词", "text", true, "例如：露营、咖啡"], ["max_items", "结果数量", "number", false, "10", 10, null, 100]] },
    kuaishou_get_video_detail: { title: "视频详情", description: "使用作品 ID 或完整链接读取视频详情与互动数据。", oneOf: ["video_id", "video_url"], fields: [["video_id", "视频 ID", "text", false, "输入作品 ID"], ["video_url", "视频链接", "url", false, "https://www.kuaishou.com/..."]] },
    kuaishou_get_video_comments: { title: "视频评论", description: "采集指定作品下的实际一级评论。", oneOf: ["video_id", "video_url"], fields: [["video_id", "视频 ID", "text", false, "输入作品 ID"], ["video_url", "视频链接", "url", false, "https://www.kuaishou.com/..."], ["max_items", "评论数量", "number", false, "20", 20, null, 100]] },
    kuaishou_get_comment_replies: { title: "评论回复", description: "使用一级评论的真实评论 ID 采集二级回复。", fields: [["video_id", "视频 ID", "text", true, "输入作品 ID"], ["comment_id", "一级评论 ID", "text", true, "输入真实评论 ID"], ["max_items", "回复数量", "number", false, "20", 20, null, 100]] },
    kuaishou_get_user_info: { title: "博主资料", description: "使用用户 ID 或主页链接读取博主资料。", oneOf: ["user_id", "profile_url"], fields: [["user_id", "用户 ID", "text", false, "输入用户 ID"], ["profile_url", "用户主页", "url", false, "https://www.kuaishou.com/profile/..."]] },
    kuaishou_list_user_videos: { title: "博主作品", description: "读取指定博主发布的作品列表。", oneOf: ["user_id", "profile_url"], fields: [["user_id", "用户 ID", "text", false, "输入用户 ID"], ["profile_url", "用户主页", "url", false, "https://www.kuaishou.com/profile/..."], ["max_items", "结果数量", "number", false, "20", 20, null, 100]] },
  };

  const state = {
    config: null, actors: [], actorsError: "", selectedXhsOperation: "search_notes", selectedWeiboOperation: "weibo_search_posts", selectedKuaishouOperation: "kuaishou_search_videos", douyinMode: "search",
    recentTasks: readTasks(), taskDetails: new Map(), results: readResults(), selectedVideos: new Set(),
    selectedPlatformTask: { xiaohongshu: "", douyin: "", kuaishou: "", weibo: "" }, genericTaskId: "", resultFilter: "",
    xhsPrefill: {}, weiboPrefill: {}, kuaishouPrefill: {}, douyinPrefillUrls: [], activeNote: null, activeDouyinVideo: null, activeKuaishouVideo: null, activeWeiboPost: null, douyinDetailError: "", douyinDetailBusy: false, douyinCommentTaskId: "", kuaishouDetailError: "", kuaishouDetailBusy: false, kuaishouCommentTaskId: "", kuaishouReplyTaskIds: new Map(), kuaishouReplyBusy: new Set(), weiboDetailError: "", weiboDetailBusy: false, weiboCommentTaskId: "", weiboReplyTaskIds: new Map(), weiboReplyBusy: new Set(), commentTaskId: "", commentTaskIds: [],
    replyTaskIds: new Map(), commentError: "", replyBusy: new Set(), noteDetailTaskId: "", noteDetailError: "", batchReplyPlan: null, batchReplyProgress: null, alert: null, busy: false, polling: new Map(), renderQueued: false,
  };

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
  function escapeAttr(value) { return escapeHtml(value); }
  function formatValue(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "boolean") return value ? "是" : "否";
    return String(value);
  }
  function number(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
  function feeText(detail, meta = {}) {
    const provider = detail?.provider || meta?.provider;
    if (provider === "apify") return detail?.cost_usd == null ? "Apify 计费" : `$${Number(detail.cost_usd).toFixed(4)}`;
    return detail?.billed_points == null ? "-" : `${number(detail.billed_points)} 点`;
  }
  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
  }
  function normalizeRoute(path) {
    if (path === "/xiaohongshu") return "/xiaohongshu/search";
    if (path === "/douyin") return "/douyin/search";
    if (path === "/kuaishou") return "/kuaishou/search";
    if (path === "/weibo") return "/weibo/search";
    if (routes.has(path)) return path;
    return state.config?.api_key_configured ? "/xiaohongshu/search" : "/config";
  }
  function readTasks() {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || "[]"); return Array.isArray(value) ? value.slice(0, 50) : []; }
    catch (_) { return []; }
  }
  function saveTasks() { localStorage.setItem(storageKey, JSON.stringify(state.recentTasks.slice(0, 50))); }
  function readResults() {
    try {
      const entries = JSON.parse(localStorage.getItem(resultsStorageKey) || "[]");
      return new Map(Array.isArray(entries) ? entries.filter((entry) => Array.isArray(entry) && typeof entry[0] === "string" && entry.length === 2).slice(-50) : []);
    } catch (_) { return new Map(); }
  }
  function saveResults() {
    const entries = [...state.results.entries()].slice(-50);
    try { localStorage.setItem(resultsStorageKey, JSON.stringify(entries)); }
    catch (_) { try { localStorage.setItem(resultsStorageKey, JSON.stringify(entries.slice(-10))); } catch (_) { /* Keep the in-memory result when browser storage is full. */ } }
  }
  function rememberResult(taskId, payload) {
    state.results.delete(taskId); state.results.set(taskId, payload); saveResults();
  }
  function rememberTask(task, meta) {
    const id = String(task.id); const previous = state.recentTasks.find((item) => item.id === id) || {};
    const item = { ...previous, ...meta, id, provider: task.provider || meta.provider || previous.provider || "", platform: meta.platform || previous.platform || "", operation: meta.operation || previous.operation || task.operation || "", submittedAt: meta.submittedAt || previous.submittedAt || new Date().toISOString(), displayName: meta.displayName || previous.displayName || operationLabels[task.operation] || task.operation || id };
    state.recentTasks = [item, ...state.recentTasks.filter((entry) => entry.id !== id)].slice(0, 50);
    state.taskDetails.set(id, task); saveTasks(); return item;
  }
  function makeIdempotencyKey() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  async function requestJson(url, options = {}) {
    let response;
    try { response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}) } }); }
    catch (_) { throw new Error("无法连接本地代理，请确认本地服务已启动。"); }
    const text = await response.text(); let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { throw new Error("本地代理返回了无法解析的响应。"); }
    if (!response.ok) { const message = errorMessages[response.status] || payload?.detail || `请求失败（HTTP ${response.status}）`; throw new Error(payload?.detail && errorMessages[response.status] ? `${message} ${payload.detail}` : message); }
    return payload;
  }
  function actorFor(operation) { return state.actors.find((actor) => Array.isArray(actor.operations) && actor.operations.includes(operation)); }
  function hasOperation(operation) { return Boolean(actorFor(operation)); }
  function setAlert(type, message) { state.alert = message ? { type, message } : null; }
  function alertHtml() { return state.alert ? `<div class="alert ${escapeAttr(state.alert.type)}"><span>${escapeHtml(state.alert.message)}</span><button type="button" data-action="dismiss-alert" aria-label="关闭">×</button></div>` : ""; }
  function statusHtml(status) {
    const value = status || "unknown"; const names = { connected: "已连接", error: "未配置", starting: "启动中", reserved: "已预留", running: "运行中", settlement_pending: "结算中", settled: "已结算", failed: "失败", refunded: "已退款", unknown: "待查询" };
    return `<span class="status ${escapeAttr(value)}">${escapeHtml(names[value] || value)}</span>`;
  }
  function pageHeader(section, title, description, action = "") { return `<header class="page-header"><div><span class="eyebrow">${escapeHtml(section)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${action ? `<div class="header-actions">${action}</div>` : ""}</header>`; }
  function isDetailOnlyTask(task) { return Boolean(task?.hideFromHistory) || detailOnlyOperations.has(task?.operation); }
  function platformTasks(platform) { return state.recentTasks.filter((task) => task.platform === platform && !isDetailOnlyTask(task)); }
  function resultItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    return payload && typeof payload === "object" ? [payload] : [];
  }
  function fieldHtml(field, prefillValues = state.xhsPrefill) {
    const [name, label, type, required, placeholder, defaultValue, options] = field;
    const prefill = prefillValues[name]; const value = prefill ?? defaultValue ?? "";
    if (type === "select") return `<label class="field"><span>${escapeHtml(label)}${required ? " *" : ""}</span><select name="${escapeAttr(name)}" ${required ? "required" : ""}>${Object.entries(options).map(([option, text]) => `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
    if (type === "checkbox") return `<label class="check-field"><input name="${escapeAttr(name)}" type="checkbox" ${value ? "checked" : ""} /><span>${escapeHtml(label)}</span></label>`;
    const max = field[7] || 200;
    const help = name === "page_token" ? '<small class="field-help">首次采集必须留空；继续采集时粘贴上一次返回的完整令牌，不能填写 1、2 等页码。</small>' : "";
    return `<label class="field"><span>${escapeHtml(label)}${required ? " *" : ""}</span><input name="${escapeAttr(name)}" type="${escapeAttr(type)}" placeholder="${escapeAttr(placeholder || "")}" value="${escapeAttr(value)}" ${required ? "required" : ""}${type === "number" ? ` min="1" max="${max}" step="1"` : ""} />${help}</label>`;
  }

  function latestSummary(platform) {
    const item = platformTasks(platform)[0]; if (!item) return `<div class="empty compact-empty">尚未提交采集任务</div>`;
    const task = state.taskDetails.get(item.id) || {};
    return `<div class="recent-summary"><div><span>任务</span><strong>${escapeHtml(item.displayName)}</strong></div><div><span>来源</span><strong>${(task.provider || item.provider) === "apify" ? "Apify 官方" : "平台网关"}</strong></div><div><span>状态</span>${statusHtml(task.status)}</div><div><span>结果</span><strong>${task.item_count == null ? "待返回" : `${number(task.item_count)} 条`}</strong></div><div><span>本次费用</span><strong>${escapeHtml(feeText(task, item))}</strong></div><a class="button primary" href="/${platform}/results" data-link>打开采集结果</a></div>`;
  }
  function taskContextHtml(platform, operation) {
    const actor = actorFor(operation); const name = platform === "douyin" ? "抖音" : platform === "kuaishou" ? "快手" : platform === "weibo" ? "微博" : "小红书";
    return `<div class="side-stack"><section class="panel"><header class="panel-header"><div><h2>任务控制</h2><p>提交前确认平台与能力</p></div></header><div class="panel-body task-context"><div><span>平台</span><strong>${name}</strong></div><div><span>当前能力</span><strong>${escapeHtml(operationLabels[operation])}</strong></div><div><span>采集权限</span><strong>${actor ? "可用" : "不可用"}</strong></div><div><span>上游连接</span><strong>${state.config?.api_key_configured ? "已连接" : "未配置"}</strong></div><a class="button secondary" href="/config" data-link>管理上游连接</a></div></section><section class="panel"><header class="panel-header"><div><h2>最近一次采集</h2><p>状态和费用来自上游</p></div></header><div class="panel-body">${latestSummary(platform)}</div></section></div>`;
  }

  function renderXhsSearch() {
    const operation = state.selectedXhsOperation; const definition = xhsOperations[operation];
    const tabs = Object.entries(xhsOperations).filter(([id]) => primaryXhsOperations.has(id)).map(([id, item]) => `<button type="button" data-xhs-operation="${id}" class="${id === operation ? "active" : ""}">${escapeHtml(item.title)}</button>`).join("");
    app.innerHTML = `<div class="page">${pageHeader("小红书插件 / 数据采集", "小红书搜索与采集", "选择采集能力并填写参数，任务统一由上游平台执行和结算。", `<a class="button secondary" href="/xiaohongshu/results" data-link>查看采集结果</a>`)}${alertHtml()}<div class="segmented capability-tabs">${tabs}</div><div class="workspace search-workspace"><section class="panel"><header class="panel-header"><div><h2>搜索参数 · ${escapeHtml(definition.title)}</h2><p>${escapeHtml(definition.description)}</p></div>${hasOperation(operation) ? statusHtml("connected") : statusHtml("error")}</header><form id="xhs-form" class="panel-body"><div class="form-grid">${definition.fields.map(fieldHtml).join("")}</div>${definition.oneOf ? `<p class="form-hint">${definition.oneOf.map((key) => `<code>${key}</code>`).join(" 或 ")} 至少填写一项。</p>` : ""}<div class="actions form-actions"><button class="button primary" type="submit" ${!hasOperation(operation) || state.busy ? "disabled" : ""}>${state.busy ? "提交中..." : "开始采集"}</button></div></form></section>${taskContextHtml("xiaohongshu", operation)}</div></div>`;
  }

  function renderDouyinSearch() {
    const operation = "douyin_search_videos";
    const form = `<form id="douyin-search-form" class="panel-body"><div class="form-grid"><label class="field wide"><span>搜索关键词 *</span><textarea name="keywords" rows="3" required placeholder="每行一个关键词，最多 5 个"></textarea></label><label class="field"><span>每个关键词结果数</span><input name="maxResultsPerQuery" type="number" min="1" max="200" value="10" required /></label><label class="field"><span>排序</span><select name="sort"><option value="general">综合</option><option value="most_liked">最多点赞</option><option value="latest">最新发布</option></select></label><label class="field"><span>发布时间</span><select name="publishTime"><option value="unlimited">不限</option><option value="one_day">一天内</option><option value="one_week">一周内</option><option value="half_year">半年内</option></select></label><label class="field"><span>视频时长</span><select name="duration"><option value="unlimited">不限</option><option value="under_1m">1 分钟内</option><option value="one_to_five">1 至 5 分钟</option><option value="over_5m">5 分钟以上</option></select></label></div><div class="actions form-actions"><button class="button primary" type="submit" ${!hasOperation(operation) || state.busy ? "disabled" : ""}>开始搜索</button></div></form>`;
    app.innerHTML = `<div class="page">${pageHeader("抖音插件 / 数据采集", "抖音搜索与采集", "先搜索视频；评论和回复仅在视频详情中采集和展示。", `<a class="button secondary" href="/douyin/results" data-link>查看采集结果</a>`)}${alertHtml()}<div class="workspace search-workspace"><section class="panel"><header class="panel-header"><div><h2>视频搜索参数</h2><p>按关键词筛选抖音视频</p></div>${hasOperation(operation) ? statusHtml("connected") : statusHtml("error")}</header>${form}</section>${taskContextHtml("douyin", operation)}</div></div>`;
  }

  function renderWeiboSearch() {
    const operation = state.selectedWeiboOperation; const definition = weiboOperations[operation];
    const tabs = Object.entries(weiboOperations).filter(([id]) => primaryWeiboOperations.has(id)).map(([id, item]) => `<button type="button" data-weibo-operation="${id}" class="${id === operation ? "active" : ""}">${escapeHtml(item.title)}</button>`).join("");
    app.innerHTML = `<div class="page">${pageHeader("微博插件 / 数据采集", "微博搜索与采集", "搜索微博、热搜、用户和互动数据，任务由上游平台统一执行和计费。", `<a class="button secondary" href="/weibo/results" data-link>查看采集结果</a>`)}${alertHtml()}<div class="segmented capability-tabs">${tabs}</div><div class="workspace search-workspace"><section class="panel"><header class="panel-header"><div><h2>采集参数 · ${escapeHtml(definition.title)}</h2><p>${escapeHtml(definition.description)}</p></div>${hasOperation(operation) ? statusHtml("connected") : statusHtml("error")}</header><form id="weibo-form" class="panel-body"><div class="form-grid">${definition.fields.map((field) => fieldHtml(field, state.weiboPrefill)).join("")}</div>${definition.oneOf ? `<p class="form-hint">${definition.oneOf.map((key) => `<code>${key}</code>`).join(" 或 ")} 至少填写一项。</p>` : ""}<div class="actions form-actions"><button class="button primary" type="submit" ${!hasOperation(operation) || state.busy ? "disabled" : ""}>${state.busy ? "提交中..." : "开始采集"}</button></div></form></section>${taskContextHtml("weibo", operation)}</div></div>`;
  }
  function renderKuaishouSearch() {
    const operation = state.selectedKuaishouOperation; const definition = kuaishouOperations[operation];
    const tabs = Object.entries(kuaishouOperations).filter(([id]) => primaryKuaishouOperations.has(id)).map(([id, item]) => `<button type="button" data-kuaishou-operation="${id}" class="${id === operation ? "active" : ""}">${escapeHtml(item.title)}</button>`).join("");
    app.innerHTML = `<div class="page">${pageHeader("快手插件 / 数据采集", "快手搜索与采集", "搜索视频、获取一级评论与二级回复，并采集博主资料和作品。", `<a class="button secondary" href="/kuaishou/results" data-link>查看采集结果</a>`)}${alertHtml()}<div class="segmented capability-tabs">${tabs}</div><div class="workspace search-workspace"><section class="panel"><header class="panel-header"><div><h2>采集参数 · ${escapeHtml(definition.title)}</h2><p>${escapeHtml(definition.description)}</p></div>${hasOperation(operation) ? statusHtml("connected") : statusHtml("error")}</header><form id="kuaishou-form" class="panel-body"><div class="form-grid">${definition.fields.map((field) => fieldHtml(field, state.kuaishouPrefill)).join("")}</div>${definition.oneOf ? `<p class="form-hint">${definition.oneOf.map((key) => `<code>${key}</code>`).join(" 或 ")} 至少填写一项。</p>` : ""}<div class="actions form-actions"><button class="button primary" type="submit" ${!hasOperation(operation) || state.busy ? "disabled" : ""}>${state.busy ? "提交中..." : "开始采集"}</button></div></form></section>${taskContextHtml("kuaishou", operation)}</div></div>`;
  }

  function historyHtml(platform) {
    const tasks = platformTasks(platform); const selected = state.selectedPlatformTask[platform];
    if (!tasks.length) return `<div class="history-empty">暂无采集任务</div>`;
    return tasks.map((task) => { const detail = state.taskDetails.get(task.id) || {}; return `<button class="history-item ${selected === task.id ? "active" : ""}" type="button" data-select-platform-task="${escapeAttr(task.id)}" data-platform="${platform}"><span>${formatDate(task.submittedAt)}</span><strong>${escapeHtml(task.displayName)}</strong><small>${escapeHtml(operationLabels[task.operation] || task.operation)} · ${detail.item_count == null ? "待返回" : `${number(detail.item_count)} 条`}</small>${statusHtml(detail.status)}</button>`; }).join("");
  }
  function metric(label, value, hint) { return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`; }
  function table(columns, items, taskId, extra = null) {
    if (!items.length) return `<div class="empty">当前任务没有返回数据</div>`;
    const rows = items.slice(0, 500).map((item, index) => {
      const cells = columns.map((column) => `<td class="${column.numeric ? "numeric" : ""}">${column.render ? column.render(item, index) : escapeHtml(formatValue(item[column.key]))}</td>`).join("");
      const tail = extra ? extra(item, index) : `<button class="button secondary compact" type="button" data-detail-index="${index}" data-task-id="${escapeAttr(taskId)}">详情</button>`;
      return `<tr data-result-row data-search-text="${escapeAttr(JSON.stringify(item).toLowerCase())}">${cells}<td>${tail}</td></tr>`;
    }).join("");
    return `<div class="table-wrap result-table"><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}<th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function mediaUrl(url) {
    if (!url || /^(data:|blob:)/i.test(String(url))) return String(url || "");
    return `/api/client/media?url=${encodeURIComponent(String(url))}`;
  }
  function image(url, alt, className = "avatar") { return url ? `<img class="${className}" src="${escapeAttr(mediaUrl(url))}" alt="${escapeAttr(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true" />` : `<span class="${className} placeholder"></span>`; }
  function noteType(value) { return value === "video" ? "视频" : value === "image" ? "图文" : formatValue(value); }
  function noteMediaUrls(note) {
    const values = [note.cover_image_url, note.image_url, note.cover_url];
    for (const field of [note.image_urls, note.images, note.image_list, note.images_list]) {
      if (!Array.isArray(field)) continue;
      for (const item of field) values.push(typeof item === "string" ? item : item?.url || item?.url_default || item?.image_url || item?.info_list?.[0]?.url);
    }
    return [...new Set(values.filter(Boolean).map(String))];
  }
  function noteOriginalLink(note) {
    return note.note_url ? `<a class="xhs-original-link" href="${escapeAttr(note.note_url)}" target="_blank" rel="noopener">打开原文</a>` : "";
  }
  function renderMediaFailure(note, message = "图片链接可能已过期") {
    const canRefresh = hasOperation("get_note_detail") && (note.note_id || note.note_url);
    const detailState = state.noteDetailTaskId ? "正在获取完整笔记详情..." : state.noteDetailError || message;
    return `<div class="xhs-media-failure"><strong>图片暂时无法加载</strong><span>${escapeHtml(detailState)}</span><div class="actions">${noteOriginalLink(note)}${canRefresh ? `<button class="button secondary compact" type="button" data-action="refresh-note-detail" ${state.noteDetailTaskId ? "disabled" : ""}>获取完整笔记详情</button>` : ""}</div></div>`;
  }
  function renderNoteMedia(note) {
    const videoUrl = note.video_url || note.video?.url || note.video?.media?.stream?.h264?.[0]?.master_url || "";
    const images = noteMediaUrls(note);
    if (videoUrl) return `<video class="xhs-note-video" controls preload="metadata" poster="${escapeAttr(mediaUrl(images[0] || ""))}" data-xhs-note-media><source src="${escapeAttr(mediaUrl(videoUrl))}" /></video>`;
    if (images.length) return `<img class="xhs-note-image" data-xhs-note-media src="${escapeAttr(mediaUrl(images[0]))}" alt="${escapeAttr(note.title || "笔记图片")}" referrerpolicy="no-referrer" />${images.length > 1 ? `<span class="xhs-media-count">1 / ${images.length}</span>` : ""}`;
    return renderMediaFailure(note, "该条结果未返回图片");
  }

  function renderXhsData(taskMeta, detail, payload) {
    const items = resultItems(payload); const operation = taskMeta.operation; const taskId = taskMeta.id;
    if (["search_notes", "get_note_detail", "list_user_notes"].includes(operation)) {
      const likes = items.reduce((sum, item) => sum + Number(item.like_count || 0), 0); const comments = items.reduce((sum, item) => sum + Number(item.comment_count || 0), 0);
      const images = items.filter((item) => item.note_type === "image").length; const videos = items.filter((item) => item.note_type === "video").length;
      const columns = [
        { label: "笔记", render: (item, index) => `<div class="identity-cell">${image(item.cover_image_url, item.title, "cover-thumb")}<div><button class="note-title-link" type="button" data-open-comments data-task-id="${escapeAttr(taskId)}" data-item-index="${index}">${escapeHtml(item.title || "未命名笔记")}</button><small>${escapeHtml(item.note_id || "-")}</small></div></div>` },
        { label: "作者", render: (item) => `<div class="identity-cell compact-identity">${image(item.author_avatar_url, item.author_name)}<div><strong>${escapeHtml(item.author_name || "-")}</strong><small>${escapeHtml(item.author_red_id || item.author_user_id || "-")}</small></div></div>` },
        { label: "类型", render: (item) => `<span class="type-chip">${escapeHtml(noteType(item.note_type))}</span>` },
        { label: "点赞", key: "like_count", numeric: true }, { label: "收藏", key: "collect_count", numeric: true },
        { label: "评论", numeric: true, render: (item, index) => `<button class="count-link" type="button" data-open-comments data-task-id="${escapeAttr(taskId)}" data-item-index="${index}" title="查看并采集评论">${number(item.comment_count)}</button>` },
        { label: "发布时间", render: (item) => escapeHtml(formatDate(item.publish_time)) },
      ];
      return `<div class="metrics">${metric("笔记", number(items.length), "当前结果")}${metric("点赞", number(likes), "合计")}${metric("评论", number(comments), "合计")}${metric("内容结构", `${images} / ${videos}`, "图文 / 视频")}</div>${table(columns, items, taskId, (_, index) => `<button class="button secondary compact" type="button" data-detail-index="${index}" data-task-id="${escapeAttr(taskId)}">详情</button>`)}`;
    }
    if (operation === "search_hot_list") {
      return `<div class="metrics">${metric("热榜条目", number(items.length), "当前结果")}${metric("最高热度", number(Math.max(0, ...items.map((item) => Number(item.hot_value || 0)))), "当前结果")}${metric("数据来源", "热榜", "小红书")}${metric("任务结果", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游状态")}</div>${table([{ label: "排名", render: (_, index) => index + 1, numeric: true }, { label: "热门内容", key: "title" }, { label: "热度", key: "hot_value", numeric: true }], items, taskId)}`;
    }
    if (operation === "get_user_info") {
      const columns = [
        { label: "博主", render: (item) => `<div class="identity-cell">${image(item.avatar_url, item.name)}<div><strong>${escapeHtml(item.name || "-")}</strong><small>小红书号 ${escapeHtml(item.red_id || "-")}</small></div></div>` },
        { label: "认证", render: (item) => escapeHtml(item.verification_name || (item.verified ? "已认证" : "未认证")) },
        { label: "粉丝", key: "follower_count", numeric: true }, { label: "关注", key: "following_count", numeric: true }, { label: "笔记", key: "posted_note_count", numeric: true },
        { label: "获赞", key: "received_like_count", numeric: true }, { label: "获收藏", key: "received_collect_count", numeric: true }, { label: "地区", key: "ip_location" },
      ];
      return `<div class="metrics">${metric("博主", number(items.length), "当前结果")}${metric("粉丝", number(items.reduce((s, i) => s + Number(i.follower_count || 0), 0)), "合计")}${metric("发布笔记", number(items.reduce((s, i) => s + Number(i.posted_note_count || 0), 0)), "合计")}${metric("获赞", number(items.reduce((s, i) => s + Number(i.received_like_count || 0), 0)), "合计")}</div>${table(columns, items, taskId)}`;
    }
    const isReply = operation === "get_note_sub_comments";
    const columns = [
      { label: "评论用户", render: (item) => `<div class="identity-cell compact-identity">${image(item.author_avatar_url, item.author_name)}<div><strong>${escapeHtml(item.author_name || "-")}</strong><small>${escapeHtml(item.author_red_id || item.author_user_id || "-")}</small></div></div>` },
      { label: isReply ? "回复内容" : "评论内容", render: (item) => `<div class="comment-content"><strong>${escapeHtml(item.content || "-")}</strong>${item.parent_comment_id ? `<small>回复评论 ${escapeHtml(item.parent_comment_id)}</small>` : ""}</div>` },
      { label: "点赞", key: "like_count", numeric: true }, { label: "回复", key: "reply_count", numeric: true },
      { label: "发布时间", render: (item) => escapeHtml(formatDate(item.publish_time)) }, { label: "地区", key: "ip_location" },
    ];
    return `<div class="metrics">${metric(isReply ? "回复" : "评论", number(items.length), "当前结果")}${metric("点赞", number(items.reduce((s, i) => s + Number(i.like_count || 0), 0)), "合计")}${metric("回复数", number(items.reduce((s, i) => s + Number(i.reply_count || 0), 0)), "平台统计")}${metric("所属笔记", items[0]?.note_id ? "1" : "0", "当前结果")}</div>${table(columns, items, taskId, (item, index) => `${!isReply && Number(item.reply_count || 0) > 0 ? `<button class="button primary compact" type="button" data-open-comment-replies data-task-id="${escapeAttr(taskId)}" data-item-index="${index}">采集回复</button>` : ""}<button class="button secondary compact" type="button" data-detail-index="${index}" data-task-id="${escapeAttr(taskId)}">详情</button>`)}`;
  }

  function douyinAuthor(item) { return item.authorMeta || item.author || item.user || {}; }
  function douyinStats(item) { return item.statistics || item.stats || {}; }
  function douyinTitle(item) { return item.text || item.caption || item.itemTitle || item.desc || item.description || item.title || "未命名视频"; }
  function douyinUrl(item) { return item.url || item.shareUrl || item.webVideoUrl || item.awemeUrl || item.aweme_id || item.awemeId || item.id || ""; }
  function douyinCover(item) {
    const value = firstValue(item, ["cover", "coverUrl", "cover_url", "coverImage", "cover_image", "videoCover", "dynamicCover", "dynamic_cover"], firstValue(item.video, ["cover", "coverUrl", "url"], ""));
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return String(value.find((entry) => typeof entry === "string") || "");
    return value && typeof value === "object" ? String(firstValue(value, ["url", "url_list", "urlList", "uri"], "") || "") : "";
  }
  function douyinAvatar(item) { return firstValue(douyinAuthor(item), ["avatarThumb", "avatarMedium", "avatarLarger", "avatar", "avatar_url", "avatarUrl"], ""); }
  function douyinStat(item, keys) { return Number(firstValue(douyinStats(item), keys, firstValue(item, keys, 0))) || 0; }
  function douyinVideoId(item) { return String(firstValue(item, ["awemeId", "aweme_id", "videoId", "video_id", "id"], "")); }
  function douyinCoverHtml(item, className = "douyin-detail-cover") {
    const cover = douyinCover(item);
    return cover ? `<img class="${className}" src="${escapeAttr(mediaUrl(cover))}" alt="${escapeAttr(douyinTitle(item))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true" />` : `<div class="${className} douyin-cover-placeholder"><span>抖音视频</span></div>`;
  }
  function renderDouyinCollectedComments() {
    const taskId = state.douyinCommentTaskId;
    if (!taskId) return "";
    const task = state.taskDetails.get(taskId) || {}; const items = resultItems(state.results.get(taskId));
    if (!terminalStatuses.has(task.status)) return `<section class="douyin-detail-comments"><header><strong>评论</strong>${statusHtml(task.status)}</header><div class="empty-comments"><strong>正在采集评论</strong><span>任务完成后将在此处展示。</span></div></section>`;
    if (task.status !== "settled") return `<section class="douyin-detail-comments"><header><strong>评论</strong>${statusHtml(task.status)}</header><p class="modal-error">${escapeHtml(task.error_message || "评论采集未完成")}</p></section>`;
    return `<section class="douyin-detail-comments"><header><strong>评论 ${number(items.length)}</strong><span>本次采集结果</span></header>${items.length ? `<div class="douyin-comment-list">${items.map((comment) => { const user = comment.user || comment.author || {}; return `<article><div class="identity-cell compact-identity">${image(user.avatarThumb || user.avatar || user.avatar_url, user.nickname || user.name, "comment-avatar")}<div><strong>${escapeHtml(user.nickname || user.name || "未知用户")}</strong><small>${escapeHtml(comment.region || comment.ipLocation || "")}</small></div></div><p>${escapeHtml(comment.text || comment.content || "-")}</p><footer><span>点赞 ${number(comment.likeCount || comment.like_count)}</span><span>回复 ${number(comment.replyCount || comment.reply_count)}</span><span>${escapeHtml(formatDate(comment.createDate || comment.createTime))}</span></footer></article>`; }).join("")}</div>` : `<div class="empty-comments"><strong>没有公开评论</strong><span>任务已完成，但未返回评论数据。</span></div>`}</section>`;
  }
  function renderDouyinDetailModal() {
    const item = state.activeDouyinVideo;
    if (!item) return "";
    const stats = douyinStats(item); const url = String(douyinUrl(item)); const author = douyinAuthor(item); const comments = douyinStat(item, ["commentCount", "comment_count"]);
    return `<div class="modal-backdrop" data-douyin-modal-backdrop><section class="douyin-detail-modal" role="dialog" aria-modal="true" aria-labelledby="douyin-detail-title"><button class="modal-close" type="button" data-action="close-douyin-detail" aria-label="关闭">×</button><div class="douyin-detail-media">${douyinCoverHtml(item, "douyin-detail-cover")}</div><div class="douyin-detail-side"><div class="douyin-detail-scroll"><header class="douyin-author-row">${image(douyinAvatar(item), douyinAuthor(item).name || douyinAuthor(item).nickname || "作者", "douyin-author-avatar")}<div><strong>${escapeHtml(author.name || author.nickname || "未知作者")}</strong><small>${escapeHtml(String(author.uniqueId || author.secUid || author.id || ""))}</small></div></header><section class="douyin-detail-copy"><h2 id="douyin-detail-title">${escapeHtml(douyinTitle(item))}</h2><p>${escapeHtml(firstValue(item, ["text", "caption", "desc", "description", "title"], "暂无视频文案"))}</p><div class="douyin-detail-stats"><span>播放 ${number(douyinStat(item, ["playCount", "play_count"]))}</span><span>点赞 ${number(douyinStat(item, ["diggCount", "digg_count"]))}</span><span>评论 ${number(comments)}</span><span>收藏 ${number(douyinStat(item, ["collectCount", "collect_count"]))}</span><span>分享 ${number(douyinStat(item, ["shareCount", "share_count"]))}</span></div><footer><span>发布于 ${escapeHtml(formatDate(firstValue(item, ["createDate", "createTime", "create_date", "create_time"], "")))}</span><span>视频 ID ${escapeHtml(douyinVideoId(item) || "-")}</span>${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">打开抖音原页</a>` : ""}</footer></section><section class="douyin-collection"><header><div><strong>采集评论</strong><small>确认参数后才会提交上游任务</small></div></header>${state.douyinDetailError ? `<p class="modal-error">${escapeHtml(state.douyinDetailError)}</p>` : ""}<form id="douyin-detail-comments-form" class="douyin-collection-form"><label class="field"><span>评论条数</span><input name="maxCommentsPerAweme" type="number" min="1" max="200" value="20" required ${state.douyinDetailBusy ? "disabled" : ""} /></label><label class="check-field"><input name="includeReplies" type="checkbox" ${state.douyinDetailBusy ? "disabled" : ""} /><span>同时采集评论回复</span></label><label class="field"><span>每条评论回复上限</span><input name="maxRepliesPerComment" type="number" min="1" max="200" value="20" disabled /></label><button class="button primary" type="submit" ${!url || state.douyinDetailBusy ? "disabled" : ""}>${state.douyinDetailBusy ? "提交中..." : "采集评论"}</button></form></section>${renderDouyinCollectedComments()}</div></div></section></div>`;
  }
  function renderDouyinData(taskMeta, detail, payload) {
    const items = resultItems(payload); const taskId = taskMeta.id;
    if (taskMeta.operation === "douyin_search_videos") {
      const totals = (keys) => items.reduce((sum, item) => sum + douyinStat(item, keys), 0);
      const columns = [
        { label: "视频标题", render: (item, index) => `<button class="note-title-link" type="button" data-open-douyin-detail data-task-id="${escapeAttr(taskId)}" data-item-index="${index}">${escapeHtml(douyinTitle(item))}</button>` },
        { label: "作者", render: (item) => `<div class="identity-cell compact-identity">${image(douyinAvatar(item), douyinAuthor(item).name || douyinAuthor(item).nickname || "作者")}<div><strong>${escapeHtml(douyinAuthor(item).name || douyinAuthor(item).nickname || "未知作者")}</strong><small>${escapeHtml(String(douyinAuthor(item).uniqueId || douyinAuthor(item).id || "-"))}</small></div></div>` },
        { label: "播放", render: (item) => number(douyinStat(item, ["playCount", "play_count"])), numeric: true },
        { label: "点赞", render: (item) => number(douyinStat(item, ["diggCount", "digg_count"])), numeric: true },
        { label: "评论", render: (item) => number(douyinStat(item, ["commentCount", "comment_count"])), numeric: true },
        { label: "收藏", render: (item) => number(douyinStat(item, ["collectCount", "collect_count"])), numeric: true },
        { label: "分享", render: (item) => number(douyinStat(item, ["shareCount", "share_count"])), numeric: true },
        { label: "发布时间", render: (item) => escapeHtml(formatDate(firstValue(item, ["createDate", "createTime", "create_date", "create_time"], ""))) },
      ];
      return `<div class="metrics">${metric("视频", number(items.length), "当前结果")}${metric("播放", number(totals(["playCount", "play_count"])), "合计")}${metric("点赞", number(totals(["diggCount", "digg_count"])), "合计")}${metric("评论", number(totals(["commentCount", "comment_count"])), "进入详情采集")}</div>${table(columns, items, taskId, (_, index) => `<button class="button secondary compact" type="button" data-open-douyin-detail data-task-id="${escapeAttr(taskId)}" data-item-index="${index}">详情</button>`)}`;
    }
    const groups = new Map();
    for (const item of items) { const id = String(item.awemeId || item.aweme_id || item.videoId || item.video_id || "未知视频"); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(item); }
    if (!items.length) return `<div class="metrics">${metric("评论", "0", "当前视频没有公开评论")}${metric("任务状态", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游返回")}${metric("结算点数", number(detail.billed_points), "本次任务")}${metric("视频", "1", "采集目标")}</div><div class="empty">任务执行成功，但目标视频没有返回公开评论</div>`;
    return `<div class="metrics">${metric("评论", number(items.length), "当前结果")}${metric("视频", number(groups.size), "已分组")}${metric("点赞", number(items.reduce((s, i) => s + Number(i.likeCount || i.like_count || 0), 0)), "合计")}${metric("回复", number(items.reduce((s, i) => s + Number(i.replyCount || i.reply_count || 0), 0)), "合计")}</div><div class="comment-groups">${[...groups.entries()].map(([id, rows]) => `<section class="comment-group"><header><div><span>视频</span><strong>${escapeHtml(id)}</strong></div><small>${rows.length} 条评论</small></header>${rows.map((item) => { const user = item.user || item.author || {}; const index = items.indexOf(item); return `<article data-result-row data-search-text="${escapeAttr(JSON.stringify(item).toLowerCase())}"><div class="identity-cell compact-identity">${image(user.avatarThumb || user.avatar || user.avatar_url, user.nickname || user.name)}<div><strong>${escapeHtml(user.nickname || user.name || "未知用户")}</strong><small>${escapeHtml(item.region || item.ipLocation || "")}</small></div></div><p>${escapeHtml(item.text || item.content || "-")}</p><footer><span>点赞 ${number(item.likeCount || item.like_count)}</span><span>${escapeHtml(formatDate(item.createDate || item.createTime))}</span><button class="button secondary compact" type="button" data-detail-index="${index}" data-task-id="${escapeAttr(taskId)}">详情</button></footer></article>`; }).join("")}</section>`).join("")}</div>`;
  }

  function firstValue(item, keys, fallback = "") {
    for (const key of keys) if (item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== "") return item[key];
    return fallback;
  }
  function weiboUser(item) { return item?.user || item?.author || item?.user_info || {}; }
  function weiboUserName(item) { const user = weiboUser(item); return firstValue(item, ["author_name", "user_name", "screen_name", "nickname"], firstValue(user, ["screen_name", "name", "nickname"], "未知用户")); }
  function weiboUserId(item) { const user = weiboUser(item); return String(firstValue(item, ["author_user_id", "user_id", "uid"], firstValue(user, ["id", "idstr", "user_id", "uid"], ""))); }
  function weiboAvatar(item) { const user = weiboUser(item); return firstValue(item, ["author_avatar_url", "avatar_url"], firstValue(user, ["avatar_hd", "avatar_large", "avatar_url", "profile_image_url"], "")); }
  function weiboPostId(item) { return String(firstValue(item, ["post_id", "idstr", "mid", "mblogid", "id"], "")); }
  function weiboPostUrl(item) { return String(firstValue(item, ["post_url", "url", "scheme"], "")); }
  function weiboContent(item) { return String(firstValue(item, ["content", "text_raw", "text", "title", "description"], "-")); }
  function weiboCount(item, keys) { return Number(firstValue(item, keys, 0)) || 0; }
  function weiboIdentity(item) { return `<div class="identity-cell compact-identity">${image(weiboAvatar(item), weiboUserName(item))}<div><strong>${escapeHtml(weiboUserName(item))}</strong><small>${escapeHtml(weiboUserId(item) || "-")}</small></div></div>`; }
  function weiboPostKey(item) { return weiboPostUrl(item) || weiboPostId(item); }
  function weiboCommentId(item) { return String(firstValue(item, ["comment_id", "idstr", "id"], "")); }
  function weiboHasReplies(item) { return weiboCount(item, ["reply_count", "total_number"]) > 0; }
  function renderWeiboReplies(comment) {
    const commentId = weiboCommentId(comment); const taskId = state.weiboReplyTaskIds.get(commentId); if (!taskId) return "";
    const task = state.taskDetails.get(taskId) || {}; const replies = resultItems(state.results.get(taskId));
    if (!terminalStatuses.has(task.status)) return `<div class="modal-reply-list kuaishou-reply-list"><span>正在采集回复...</span></div>`;
    if (task.status !== "settled") return `<div class="modal-reply-list kuaishou-reply-list"><p class="modal-error">${escapeHtml(task.error_message || "回复采集未完成")}</p></div>`;
    return `<div class="modal-reply-list kuaishou-reply-list">${replies.length ? replies.map((reply) => `<div class="kuaishou-reply-item">${weiboIdentity(reply)}<p>${escapeHtml(weiboContent(reply))}</p><footer><span>点赞 ${number(weiboCount(reply, ["like_count", "like_counts"]))}</span><span>${escapeHtml(formatDate(firstValue(reply, ["publish_time", "created_at", "create_time"])))}</span></footer></div>`).join("") : `<span>任务完成，没有返回公开回复。</span>`}</div>`;
  }
  function renderWeiboCollectedComments() {
    const taskId = state.weiboCommentTaskId; if (!taskId) return "";
    const task = state.taskDetails.get(taskId) || {}; const comments = resultItems(state.results.get(taskId));
    if (!terminalStatuses.has(task.status)) return `<section class="douyin-detail-comments"><header><strong>评论</strong>${statusHtml(task.status)}</header><div class="empty-comments"><strong>正在采集评论</strong><span>任务完成后将在此处展示。</span></div></section>`;
    if (task.status !== "settled") return `<section class="douyin-detail-comments"><header><strong>评论</strong>${statusHtml(task.status)}</header><p class="modal-error">${escapeHtml(task.error_message || "评论采集未完成")}</p></section>`;
    return `<section class="douyin-detail-comments"><header><strong>评论 ${number(comments.length)}</strong><span>评论和回复仅保留在当前详情</span></header>${comments.length ? `<div class="kuaishou-reply-settings"><div><strong>评论回复</strong><small>只为存在回复的一级评论创建独立任务</small></div><label class="field"><span>每条回复数量</span><input id="weibo-reply-limit" type="number" min="1" max="100" value="20" /></label></div><div class="douyin-comment-list">${comments.map((comment) => { const commentId = weiboCommentId(comment); const postId = String(firstValue(comment, ["post_id", "mid"], weiboPostId(state.activeWeiboPost))); const hasReplies = weiboHasReplies(comment); const busy = state.weiboReplyBusy.has(commentId); return `<article>${weiboIdentity(comment)}<p>${escapeHtml(weiboContent(comment))}</p><footer><span>点赞 ${number(weiboCount(comment, ["like_count", "like_counts"]))}</span><span>${hasReplies ? `回复 ${number(weiboCount(comment, ["reply_count", "total_number"]))}` : "暂无回复"}</span><span>${escapeHtml(formatDate(firstValue(comment, ["publish_time", "created_at", "create_time"])))}</span>${hasReplies ? `<button class="button secondary compact" type="button" data-weibo-collect-replies data-post-id="${escapeAttr(postId)}" data-comment-id="${escapeAttr(commentId)}" ${!postId || !commentId || busy ? "disabled" : ""}>${busy ? "采集中..." : state.weiboReplyTaskIds.has(commentId) ? "重新采集回复" : "采集回复"}</button>` : ""}</footer>${renderWeiboReplies(comment)}</article>`; }).join("")}</div>` : `<div class="empty-comments"><strong>没有公开评论</strong><span>任务已完成，但未返回评论数据。</span></div>`}</section>`;
  }
  function renderWeiboDetailModal() {
    const item = state.activeWeiboPost; if (!item) return "";
    const postId = weiboPostId(item); const postUrl = weiboPostUrl(item);
    return `<div class="modal-backdrop" data-weibo-modal-backdrop><section class="douyin-detail-modal weibo-detail-modal" role="dialog" aria-modal="true" aria-labelledby="weibo-detail-title"><button class="modal-close" type="button" data-action="close-weibo-detail" aria-label="关闭">×</button><div class="douyin-detail-media"><div class="douyin-detail-cover douyin-cover-placeholder"><span>微博内容</span></div></div><div class="douyin-detail-side"><div class="douyin-detail-scroll"><header class="douyin-author-row">${image(weiboAvatar(item), weiboUserName(item), "douyin-author-avatar")}<div><strong>${escapeHtml(weiboUserName(item))}</strong><small>${escapeHtml(weiboUserId(item) || "")}</small></div></header><section class="douyin-detail-copy"><h2 id="weibo-detail-title">${escapeHtml(weiboContent(item))}</h2><div class="douyin-detail-stats"><span>点赞 ${number(weiboCount(item, ["like_count", "attitudes_count"]))}</span><span>评论 ${number(weiboCount(item, ["comment_count", "comments_count"]))}</span><span>转发 ${number(weiboCount(item, ["repost_count", "reposts_count"]))}</span></div><footer><span>发布于 ${escapeHtml(formatDate(firstValue(item, ["publish_time", "created_at", "create_time"])))}</span><span>微博 ID ${escapeHtml(postId || "-")}</span>${postUrl ? `<a href="${escapeAttr(postUrl)}" target="_blank" rel="noopener">打开微博原文</a>` : ""}</footer></section><section class="douyin-collection"><header><div><strong>采集评论</strong><small>评论只在当前微博详情中展示</small></div></header>${state.weiboDetailError ? `<p class="modal-error">${escapeHtml(state.weiboDetailError)}</p>` : ""}<form id="weibo-detail-comments-form" class="douyin-collection-form"><label class="field"><span>评论条数</span><input name="max_items" type="number" min="1" max="100" value="20" required ${state.weiboDetailBusy ? "disabled" : ""} /></label><button class="button primary" type="submit" ${!weiboPostKey(item) || state.weiboDetailBusy ? "disabled" : ""}>${state.weiboDetailBusy ? "提交中..." : "采集评论"}</button></form></section>${renderWeiboCollectedComments()}</div></div></section></div>`;
  }

  function renderWeiboData(taskMeta, detail, payload) {
    const items = resultItems(payload); const operation = taskMeta.operation; const taskId = taskMeta.id;
    const postOperations = new Set(["weibo_search_posts", "weibo_get_post_detail", "weibo_list_user_posts"]);
    if (postOperations.has(operation)) {
      const columns = [
        { label: "微博内容", render: (item, index) => `<div class="comment-content"><button class="note-title-link" type="button" data-open-weibo-detail data-task-id="${escapeAttr(taskId)}" data-item-index="${index}">${escapeHtml(weiboContent(item))}</button><small>${escapeHtml(weiboPostId(item) || "-")}</small></div>` },
        { label: "用户", render: weiboIdentity },
        { label: "点赞", render: (item) => number(weiboCount(item, ["like_count", "attitudes_count"])), numeric: true },
        { label: "评论", render: (item) => number(weiboCount(item, ["comment_count", "comments_count"])), numeric: true },
        { label: "转发", render: (item) => number(weiboCount(item, ["repost_count", "reposts_count"])), numeric: true },
        { label: "发布时间", render: (item) => escapeHtml(formatDate(firstValue(item, ["publish_time", "created_at", "create_time"]))) },
      ];
      const likes = items.reduce((sum, item) => sum + weiboCount(item, ["like_count", "attitudes_count"]), 0);
      const comments = items.reduce((sum, item) => sum + weiboCount(item, ["comment_count", "comments_count"]), 0);
      const reposts = items.reduce((sum, item) => sum + weiboCount(item, ["repost_count", "reposts_count"]), 0);
      return `<div class="metrics">${metric("微博", number(items.length), "当前结果")}${metric("点赞", number(likes), "合计")}${metric("评论", number(comments), "进入详情采集")}${metric("转发", number(reposts), "合计")}</div>${table(columns, items, taskId, (_, index) => `<button class="button secondary compact" type="button" data-open-weibo-detail data-task-id="${escapeAttr(taskId)}" data-item-index="${index}">详情</button>`)}`;
    }
    if (operation === "weibo_search_hot_list") {
      const columns = [{ label: "排名", render: (item, index) => number(firstValue(item, ["rank", "rank_num"], index + 1)), numeric: true }, { label: "热搜词", render: (item) => escapeHtml(firstValue(item, ["keyword", "title", "note", "word"], "-")) }, { label: "热度", render: (item) => number(firstValue(item, ["hot_value", "num", "raw_hot"], 0)), numeric: true }, { label: "分类", render: (item) => escapeHtml(firstValue(item, ["category", "label_name", "icon_desc"], "-")) }];
      return `<div class="metrics">${metric("热搜", number(items.length), "当前榜单")}${metric("最高热度", number(Math.max(0, ...items.map((item) => Number(firstValue(item, ["hot_value", "num", "raw_hot"], 0)) || 0))), "当前结果")}${metric("数据来源", "微博", "热搜榜")}${metric("任务状态", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游状态")}</div>${table(columns, items, taskId)}`;
    }
    if (operation === "weibo_get_user_info" || operation === "weibo_list_post_likers") {
      const columns = [{ label: "用户", render: weiboIdentity }, { label: "认证", render: (item) => escapeHtml(firstValue(item, ["verified_reason", "verification", "verified_type"], firstValue(weiboUser(item), ["verified_reason"], "-"))) }, { label: "粉丝", render: (item) => number(firstValue(item, ["followers_count", "follower_count"], firstValue(weiboUser(item), ["followers_count"], 0))), numeric: true }, { label: "关注", render: (item) => number(firstValue(item, ["friends_count", "following_count"], firstValue(weiboUser(item), ["friends_count"], 0))), numeric: true }, { label: "微博", render: (item) => number(firstValue(item, ["statuses_count", "post_count"], firstValue(weiboUser(item), ["statuses_count"], 0))), numeric: true }, { label: "简介", render: (item) => escapeHtml(firstValue(item, ["description", "user_description"], firstValue(weiboUser(item), ["description"], "-"))) }];
      return `<div class="metrics">${metric(operation === "weibo_list_post_likers" ? "点赞用户" : "用户", number(items.length), "当前结果")}${metric("粉丝", number(items.reduce((sum, item) => sum + Number(firstValue(item, ["followers_count", "follower_count"], firstValue(weiboUser(item), ["followers_count"], 0)) || 0), 0)), "合计")}${metric("认证用户", number(items.filter((item) => Boolean(firstValue(item, ["verified"], firstValue(weiboUser(item), ["verified"], false)))).length), "当前结果")}${metric("任务状态", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游状态")}</div>${table(columns, items, taskId)}`;
    }
    const isReply = operation === "weibo_get_post_comment_replies"; const isRepost = operation === "weibo_list_post_reposts";
    const columns = [{ label: isRepost ? "转发用户" : "评论用户", render: weiboIdentity }, { label: isRepost ? "转发内容" : isReply ? "回复内容" : "评论内容", render: (item) => `<div class="comment-content"><strong>${escapeHtml(weiboContent(item))}</strong><small>${escapeHtml(firstValue(item, ["comment_id", "idstr", "id"], "-"))}</small></div>` }, { label: "点赞", render: (item) => number(weiboCount(item, ["like_count", "like_counts", "attitudes_count"])), numeric: true }, { label: "回复", render: (item) => number(weiboCount(item, ["reply_count", "total_number"])), numeric: true }, { label: "发布时间", render: (item) => escapeHtml(formatDate(firstValue(item, ["publish_time", "created_at", "create_time"]))) }, { label: "地区", render: (item) => escapeHtml(firstValue(item, ["ip_location", "source"], "-")) }];
    return `<div class="metrics">${metric(isRepost ? "转发" : isReply ? "回复" : "评论", number(items.length), "当前结果")}${metric("点赞", number(items.reduce((sum, item) => sum + weiboCount(item, ["like_count", "like_counts", "attitudes_count"]), 0)), "合计")}${metric("回复数", number(items.reduce((sum, item) => sum + weiboCount(item, ["reply_count", "total_number"]), 0)), "平台统计")}${metric("任务状态", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游状态")}</div>${table(columns, items, taskId, (item, index) => `${!isReply && !isRepost && weiboCount(item, ["reply_count", "total_number"]) > 0 ? `<button class="button primary compact" type="button" data-weibo-replies data-post-id="${escapeAttr(String(firstValue(item, ["post_id", "mid"], "")))}" data-comment-id="${escapeAttr(String(firstValue(item, ["comment_id", "idstr", "id"], "")))}">采集回复</button>` : ""}<button class="button secondary compact" type="button" data-detail-index="${index}" data-task-id="${escapeAttr(taskId)}">详情</button>`)}`;
  }
  function kuaishouUser(item) { return item?.author || item?.user || item?.author_info || {}; }
  function kuaishouValue(item, keys, fallback = "") { return firstValue(item, keys, firstValue(kuaishouUser(item), keys, fallback)); }
  function kuaishouVideoId(item) { return String(kuaishouValue(item, ["video_id", "photo_id", "id", "work_id"], "")); }
  function kuaishouVideoUrl(item) { return String(kuaishouValue(item, ["video_url", "share_url", "url"], "")); }
  function kuaishouUserName(item) { return String(kuaishouValue(item, ["author_name", "user_name", "nickname", "name"], "未知用户")); }
  function kuaishouCount(item, keys) { return Number(kuaishouValue(item, keys, 0)) || 0; }
  function kuaishouTitle(item) { return String(kuaishouValue(item, ["title", "caption", "description", "text", "content"], "未命名视频")); }
  function kuaishouCover(item) { return String(kuaishouValue(item, ["cover_url", "coverUrl", "cover", "cover_image", "coverImage", "thumbnail_url", "thumbnail"], "")); }
  function kuaishouAvatar(item) { return String(kuaishouValue(item, ["avatar_url", "avatarUrl", "avatar", "head_url", "headUrl"], "")); }
  function kuaishouVideoKey(item) { return kuaishouVideoUrl(item) || kuaishouVideoId(item); }
  function kuaishouCommentId(item) { return String(kuaishouValue(item, ["comment_id", "id"], "")); }
  function kuaishouCommentPhotoId(item) { return String(kuaishouValue(item, ["photo_id", "video_id", "work_id"], "")); }
  function kuaishouHasReplies(item) { return Boolean(item?.has_replies) || kuaishouCount(item, ["reply_count", "sub_comment_count", "replyCount"]) > 0; }
  function renderKuaishouReplies(comment) {
    const commentId = kuaishouCommentId(comment); const taskId = state.kuaishouReplyTaskIds.get(commentId); if (!taskId) return "";
    const task = state.taskDetails.get(taskId) || {}; const replies = resultItems(state.results.get(taskId));
    if (!terminalStatuses.has(task.status)) return `<div class="modal-reply-list"><span>正在采集回复...</span></div>`;
    if (task.status !== "settled") return `<div class="modal-reply-list"><p class="modal-error">${escapeHtml(task.error_message || "回复采集未完成")}</p></div>`;
    return `<div class="modal-reply-list kuaishou-reply-list">${replies.length ? replies.map((reply) => `<div class="kuaishou-reply-item"><div class="identity-cell compact-identity">${image(kuaishouAvatar(reply), kuaishouUserName(reply), "comment-avatar")}<div><strong>${escapeHtml(kuaishouUserName(reply))}</strong></div></div><p>${escapeHtml(kuaishouValue(reply, ["content", "text", "comment"], "-"))}</p><footer><span>点赞 ${number(kuaishouCount(reply, ["like_count", "liked_count", "likeCount"]))}</span><span>${escapeHtml(formatDate(kuaishouValue(reply, ["publish_time", "created_at", "create_time", "timestamp"])))}</span></footer></div>`).join("") : `<span>任务完成，没有返回公开回复。</span>`}</div>`;
  }
  function renderKuaishouCollectedComments() {
    const taskId = state.kuaishouCommentTaskId;
    if (!taskId) return "";
    const task = state.taskDetails.get(taskId) || {}; const items = resultItems(state.results.get(taskId));
    if (!terminalStatuses.has(task.status)) return `<section class="douyin-detail-comments kuaishou-detail-comments"><header><strong>评论</strong>${statusHtml(task.status)}</header><div class="empty-comments"><strong>正在采集评论</strong><span>任务完成后将在此处展示。</span></div></section>`;
    if (task.status !== "settled") return `<section class="douyin-detail-comments kuaishou-detail-comments"><header><strong>评论</strong>${statusHtml(task.status)}</header><p class="modal-error">${escapeHtml(task.error_message || "评论采集未完成")}</p></section>`;
    return `<section class="douyin-detail-comments kuaishou-detail-comments"><header><strong>评论 ${number(items.length)}</strong><span>一级评论已完成；回复按需单独采集</span></header>${items.length ? `<div class="kuaishou-reply-settings"><div><strong>评论回复</strong><small>只为有回复的一级评论创建独立任务</small></div><label class="field"><span>每条回复数量</span><input id="kuaishou-reply-limit" type="number" min="1" max="100" value="20" /></label></div><div class="douyin-comment-list">${items.map((comment) => { const commentId = kuaishouCommentId(comment); const photoId = kuaishouCommentPhotoId(comment); const busy = state.kuaishouReplyBusy.has(commentId); const hasReplies = kuaishouHasReplies(comment); return `<article><div class="identity-cell compact-identity">${image(kuaishouAvatar(comment), kuaishouUserName(comment), "comment-avatar")}<div><strong>${escapeHtml(kuaishouUserName(comment))}</strong><small>${escapeHtml(kuaishouValue(comment, ["ip_location", "region", "location"], ""))}</small></div></div><p>${escapeHtml(kuaishouValue(comment, ["content", "text", "comment"], "-"))}</p><footer><span>点赞 ${number(kuaishouCount(comment, ["like_count", "liked_count", "likeCount"]))}</span><span>${hasReplies ? "存在回复" : "暂无回复"}</span><span>${escapeHtml(formatDate(kuaishouValue(comment, ["publish_time", "created_at", "create_time", "timestamp"])))}</span>${hasReplies ? `<button class="button secondary compact" type="button" data-kuaishou-collect-replies data-photo-id="${escapeAttr(photoId)}" data-comment-id="${escapeAttr(commentId)}" ${!photoId || !commentId || busy ? "disabled" : ""}>${busy ? "采集中..." : state.kuaishouReplyTaskIds.has(commentId) ? "重新采集回复" : "采集回复"}</button>` : ""}</footer>${renderKuaishouReplies(comment)}</article>`; }).join("")}</div>` : `<div class="empty-comments"><strong>没有公开评论</strong><span>任务已完成，但未返回评论数据。</span></div>`}</section>`;
  }
  function renderKuaishouDetailModal() {
    const item = state.activeKuaishouVideo;
    if (!item) return "";
    const url = kuaishouVideoUrl(item); const videoId = kuaishouVideoId(item); const cover = kuaishouCover(item); const comments = kuaishouCount(item, ["comment_count", "commentCount"]);
    const media = cover ? `<img class="douyin-detail-cover" src="${escapeAttr(mediaUrl(cover))}" alt="${escapeAttr(kuaishouTitle(item))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true" />` : `<div class="douyin-detail-cover douyin-cover-placeholder"><span>快手视频</span></div>`;
    return `<div class="modal-backdrop" data-kuaishou-modal-backdrop><section class="douyin-detail-modal kuaishou-detail-modal" role="dialog" aria-modal="true" aria-labelledby="kuaishou-detail-title"><button class="modal-close" type="button" data-action="close-kuaishou-detail" aria-label="关闭">×</button><div class="douyin-detail-media">${media}</div><div class="douyin-detail-side"><div class="douyin-detail-scroll"><header class="douyin-author-row">${image(kuaishouAvatar(item), kuaishouUserName(item), "douyin-author-avatar")}<div><strong>${escapeHtml(kuaishouUserName(item))}</strong><small>${escapeHtml(kuaishouValue(item, ["author_id", "user_id", "uid", "id"], ""))}</small></div></header><section class="douyin-detail-copy"><h2 id="kuaishou-detail-title">${escapeHtml(kuaishouTitle(item))}</h2><p>${escapeHtml(kuaishouValue(item, ["description", "caption", "text", "content", "title"], "暂无视频文案"))}</p><div class="douyin-detail-stats"><span>播放 ${number(kuaishouCount(item, ["view_count", "play_count", "playCount", "viewCount"]))}</span><span>点赞 ${number(kuaishouCount(item, ["like_count", "liked_count", "real_like_count", "likeCount"]))}</span><span>评论 ${number(comments)}</span><span>分享 ${number(kuaishouCount(item, ["share_count", "shareCount"]))}</span></div><footer><span>发布于 ${escapeHtml(formatDate(kuaishouValue(item, ["publish_time", "created_at", "create_time", "timestamp"])))}</span><span>视频 ID ${escapeHtml(videoId || "-")}</span>${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">打开快手原页</a>` : ""}</footer></section><section class="douyin-collection kuaishou-collection"><header><div><strong>采集评论</strong><small>确认参数后才会提交上游任务</small></div></header>${state.kuaishouDetailError ? `<p class="modal-error">${escapeHtml(state.kuaishouDetailError)}</p>` : ""}<form id="kuaishou-detail-comments-form" class="douyin-collection-form"><label class="field"><span>评论条数</span><input name="max_items" type="number" min="1" max="100" value="20" required ${state.kuaishouDetailBusy ? "disabled" : ""} /></label><button class="button primary" type="submit" ${!kuaishouVideoKey(item) || state.kuaishouDetailBusy ? "disabled" : ""}>${state.kuaishouDetailBusy ? "提交中..." : "采集评论"}</button></form></section>${renderKuaishouCollectedComments()}</div></div></section></div>`;
  }
  function renderKuaishouData(taskMeta, detail, payload) {
    const items = resultItems(payload); const operation = taskMeta.operation; const taskId = taskMeta.id;
    if (["kuaishou_search_videos", "kuaishou_get_video_detail", "kuaishou_list_user_videos"].includes(operation)) {
      const columns = [{ label: "视频", render: (item, index) => `<div class="comment-content"><button class="note-title-link" type="button" data-open-kuaishou-detail data-task-id="${escapeAttr(taskId)}" data-item-index="${index}">${escapeHtml(kuaishouTitle(item))}</button><small>${escapeHtml(kuaishouVideoId(item) || "-")}</small></div>` }, { label: "作者", render: (item) => escapeHtml(kuaishouUserName(item)) }, { label: "点赞", render: (item) => number(kuaishouCount(item, ["like_count", "liked_count", "real_like_count"])), numeric: true }, { label: "评论", render: (item) => number(kuaishouCount(item, ["comment_count", "commentCount"])), numeric: true }, { label: "发布时间", render: (item) => escapeHtml(formatDate(kuaishouValue(item, ["publish_time", "created_at", "create_time", "timestamp"]))) }];
      return `<div class="metrics">${metric("视频", number(items.length), "当前结果")}${metric("点赞", number(items.reduce((sum, item) => sum + kuaishouCount(item, ["like_count", "liked_count", "real_like_count"]), 0)), "合计")}${metric("评论", number(items.reduce((sum, item) => sum + kuaishouCount(item, ["comment_count", "commentCount"]), 0)), "可继续采集")}${metric("任务状态", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游状态")}</div>${table(columns, items, taskId, (_, index) => `<button class="button secondary compact" type="button" data-open-kuaishou-detail data-task-id="${escapeAttr(taskId)}" data-item-index="${index}">详情</button>`)}`;
    }
    if (operation === "kuaishou_get_user_info") {
      const columns = [{ label: "博主", render: (item) => `<div class="identity-cell compact-identity">${image(kuaishouValue(item, ["avatar_url", "avatar"]), kuaishouUserName(item))}<div><strong>${escapeHtml(kuaishouUserName(item))}</strong><small>${escapeHtml(kuaishouValue(item, ["user_id", "id"], "-"))}</small></div></div>` }, { label: "粉丝", render: (item) => number(kuaishouCount(item, ["follower_count", "followers_count"])), numeric: true }, { label: "关注", render: (item) => number(kuaishouCount(item, ["following_count", "follow_count"])), numeric: true }, { label: "作品", render: (item) => number(kuaishouCount(item, ["video_count", "work_count", "photo_count"])), numeric: true }, { label: "简介", render: (item) => escapeHtml(kuaishouValue(item, ["description", "bio"], "-")) }];
      return `<div class="metrics">${metric("博主", number(items.length), "当前结果")}${metric("粉丝", number(items.reduce((sum, item) => sum + kuaishouCount(item, ["follower_count", "followers_count"]), 0)), "合计")}${metric("作品", number(items.reduce((sum, item) => sum + kuaishouCount(item, ["video_count", "work_count", "photo_count"]), 0)), "合计")}${metric("任务状态", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游状态")}</div>${table(columns, items, taskId)}`;
    }
    const isReply = operation === "kuaishou_get_comment_replies";
    const columns = [{ label: "评论用户", render: (item) => escapeHtml(kuaishouUserName(item)) }, { label: isReply ? "回复内容" : "评论内容", render: (item) => `<div class="comment-content"><strong>${escapeHtml(kuaishouValue(item, ["content", "text", "comment"], "-"))}</strong><small>${escapeHtml(kuaishouValue(item, ["comment_id", "id"], "-"))}</small></div>` }, { label: "点赞", render: (item) => number(kuaishouCount(item, ["like_count", "liked_count"])), numeric: true }, { label: "回复", render: (item) => number(kuaishouCount(item, ["reply_count", "sub_comment_count"])), numeric: true }, { label: "发布时间", render: (item) => escapeHtml(formatDate(kuaishouValue(item, ["publish_time", "created_at", "create_time"]))) }];
    return `<div class="metrics">${metric(isReply ? "回复" : "评论", number(items.length), "当前结果")}${metric("点赞", number(items.reduce((sum, item) => sum + kuaishouCount(item, ["like_count", "liked_count"]), 0)), "合计")}${metric("回复数", number(items.reduce((sum, item) => sum + kuaishouCount(item, ["reply_count", "sub_comment_count"]), 0)), "平台统计")}${metric("任务状态", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游状态")}</div>${table(columns, items, taskId, (item, index) => `${!isReply && kuaishouCount(item, ["reply_count", "sub_comment_count"]) > 0 ? `<button class="button primary compact" type="button" data-kuaishou-replies data-video-id="${escapeAttr(String(kuaishouValue(item, ["video_id", "photo_id", "work_id"], "")))}" data-comment-id="${escapeAttr(String(kuaishouValue(item, ["comment_id", "id"], "")))}">采集回复</button>` : ""}<button class="button secondary compact" type="button" data-detail-index="${index}" data-task-id="${escapeAttr(taskId)}">详情</button>`)}`;
  }

  function resultShell(platform, content) {
    const name = platform === "douyin" ? "抖音" : platform === "kuaishou" ? "快手" : platform === "weibo" ? "微博" : "小红书"; const searchRoute = `/${platform}/search`;
    return `<div class="page result-page">${pageHeader(`${name}插件 / 数据结果`, `${name}采集结果`, "按任务查看上游采集数据，完整结果不会保存在本地。", `<a class="button secondary" href="${searchRoute}" data-link>返回搜索与采集</a>`)}${alertHtml()}<div class="results-layout"><aside class="history-panel"><header><span>历史结果</span><strong>${platformTasks(platform).length} 份</strong><small>最近 50 个本地任务索引</small></header><div class="history-list">${historyHtml(platform)}</div></aside><section class="results-main">${content}</section></div></div>`;
  }
  function renderPlatformResults(platform) {
    const visibleTasks = platformTasks(platform); const selectedId = visibleTasks.some((item) => item.id === state.selectedPlatformTask[platform]) ? state.selectedPlatformTask[platform] : visibleTasks[0]?.id || ""; state.selectedPlatformTask[platform] = selectedId; const taskMeta = visibleTasks.find((item) => item.id === selectedId);
    if (!taskMeta) { app.innerHTML = resultShell(platform, `<div class="empty result-empty"><strong>暂无采集结果</strong><span>先提交一个采集任务，完成后会显示在这里。</span><a class="button primary" href="/${platform}/search" data-link>开始搜索与采集</a></div>`); return; }
    const detail = state.taskDetails.get(selectedId) || {}; const payload = state.results.get(selectedId);
    let dataContent = `<div class="empty">正在读取任务状态...</div>`;
    if (payload) dataContent = platform === "xiaohongshu" ? renderXhsData(taskMeta, detail, payload) : platform === "kuaishou" ? renderKuaishouData(taskMeta, detail, payload) : platform === "weibo" ? renderWeiboData(taskMeta, detail, payload) : renderDouyinData(taskMeta, detail, payload);
    else if (detail.status && !terminalStatuses.has(detail.status)) dataContent = `<div class="empty"><strong>任务${statusHtml(detail.status)}</strong><span>页面将每 ${state.config?.poll_interval_seconds || 2} 秒自动刷新。</span></div>`;
    const header = `<header class="result-detail-header"><div><span>当前结果</span><h2>${escapeHtml(taskMeta.displayName)}</h2><p>${formatDate(taskMeta.submittedAt)} · ${escapeHtml(operationLabels[taskMeta.operation] || taskMeta.operation)} · ${(detail.provider || taskMeta.provider) === "apify" ? "Apify 官方" : "平台网关"}</p></div><div class="result-meta">${statusHtml(detail.status)}<span>${detail.item_count == null ? "-" : `${number(detail.item_count)} 条`}</span><span>${escapeHtml(feeText(detail, taskMeta))}</span></div></header><div class="result-actions"><label class="result-search"><span>筛选结果</span><input id="result-filter" type="search" placeholder="输入标题、作者或内容" value="${escapeAttr(state.resultFilter)}" /></label><div class="actions"><button class="button secondary" type="button" data-download="json" data-task-id="${escapeAttr(selectedId)}" ${payload ? "" : "disabled"}>下载 JSON</button><button class="button secondary" type="button" data-download="csv" data-task-id="${escapeAttr(selectedId)}" ${payload ? "" : "disabled"}>下载 CSV</button><button class="button secondary" type="button" data-action="refresh-selected-result" data-platform="${platform}">刷新</button></div></div>`;
    app.innerHTML = resultShell(platform, `${header}${dataContent}`); applyResultFilter(state.resultFilter);
  }

  function renderTasks() {
    const rows = state.recentTasks.filter((item) => !isDetailOnlyTask(item)).map((item) => { const detail = state.taskDetails.get(item.id) || {}; const route = item.platform === "douyin" ? "/douyin/results" : item.platform === "kuaishou" ? "/kuaishou/results" : item.platform === "weibo" ? "/weibo/results" : "/xiaohongshu/results"; return `<div class="task-row"><span>${formatDate(item.submittedAt)}</span><div><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.id)} · ${(detail.provider || item.provider) === "apify" ? "Apify 官方" : "平台网关"}</small></div><span>${escapeHtml(operationLabels[item.operation] || item.operation)}</span>${statusHtml(detail.status)}<span class="numeric">${escapeHtml(feeText(detail, item))}</span><div class="row-actions"><button class="button secondary compact" type="button" data-view-task="${escapeAttr(item.id)}">详情</button><button class="button secondary compact" type="button" data-open-platform-result="${escapeAttr(item.id)}" data-platform="${escapeAttr(item.platform)}" data-route-target="${route}">平台结果</button></div></div>`; }).join("");
    app.innerHTML = `<div class="page">${pageHeader("任务 / 跨平台监控", "全部任务", "查看小红书、抖音、快手和微博任务状态、结算点数和通用结果。", `<button class="button secondary" type="button" data-action="refresh-tasks">刷新状态</button>`)}${alertHtml()}<section class="panel"><header class="panel-header"><div><h2>最近任务</h2><p>本地仅保存最近 50 个任务索引</p></div><button class="button danger compact" type="button" data-action="clear-tasks">清空索引</button></header>${rows ? `<div class="task-list">${rows}</div>` : `<div class="empty">尚未提交任务</div>`}</section>${renderGenericResult()}</div>`;
  }
  function renderGenericResult() {
    const id = state.genericTaskId; const payload = state.results.get(id); if (!id || !payload) return `<section class="panel"><header class="panel-header"><div><h2>通用结果</h2><p>点击任务“详情”后显示原始字段</p></div></header><div class="empty">尚未选择任务</div></section>`;
    const items = resultItems(payload); const fields = [...new Set(items.flatMap((item) => item && typeof item === "object" ? Object.keys(item) : ["value"]))].slice(0, 12);
    return `<section class="panel"><div class="result-toolbar"><strong>通用结果 · ${items.length} 条</strong><div class="actions"><button class="button secondary" data-download="json" data-task-id="${escapeAttr(id)}">下载 JSON</button><button class="button secondary" data-download="csv" data-task-id="${escapeAttr(id)}">下载 CSV</button></div></div>${table(fields.map((key) => ({ label: key, key })), items, id)}</section>`;
  }
  function renderConfig() {
    const apiConfig = state.config || {}; const apiActorRows = state.actors.map((actor) => `<tr><td>${escapeHtml(actor.title || "-")}</td><td>${escapeHtml(actor.platform === "douyin" ? "抖音" : actor.platform === "kuaishou" ? "快手" : actor.platform === "weibo" ? "微博" : "小红书")}</td><td><code>${escapeHtml(actor.actor_id)}</code></td><td>${(actor.operations || []).map((op) => `<span class="capability">${escapeHtml(operationLabels[op] || op)}</span>`).join(" ")}</td></tr>`).join("");
    app.innerHTML = `<div class="page">${pageHeader("设置 / API配置", "API配置", "仅使用 Apify 官方 API 执行采集任务与读取结果。")}${alertHtml()}<div class="workspace"><section class="panel"><header class="panel-header"><div><h2>Apify 官方 API</h2><p>Token 仅保存在本机，浏览器无法读取明文。</p></div>${apiConfig.api_key_configured ? statusHtml("connected") : statusHtml("error")}</header><form id="config-form" class="panel-body"><div class="connection-options"><div class="connection-option active"><strong>Apify 官方 API</strong><span>${escapeHtml(apiConfig.apify_api_base || apifyOfficialUrl)}</span><small>任务通过 Apify Run 执行，结果从默认 Dataset 读取。</small></div></div><div class="form-grid"><label class="field wide"><span>官方地址</span><input type="url" readonly value="${escapeAttr(apiConfig.apify_api_base || apifyOfficialUrl)}" /></label><label class="field wide"><span>Apify API Token</span><input name="apify_api_token" type="password" autocomplete="off" placeholder="${escapeAttr(apiConfig.apify_token_masked || "apify_api_...")}" /></label></div><p class="form-hint">Token 留空将保留当前值；当前：${escapeHtml(apiConfig.apify_token_masked || "未配置")}。</p><div class="actions form-actions"><button class="button primary" type="submit">保存并测试</button><a class="button secondary" href="https://console.apify.com/account/integrations" target="_blank" rel="noopener">打开 Apify Token 页面</a><button class="button danger" type="button" data-action="clear-apify-token">清除 Token</button></div></form></section><section class="panel"><header class="panel-header"><div><h2>可用采集器</h2><p>${state.actorsError ? escapeHtml(state.actorsError) : "由 Apify Token 的账户权限决定"}</p></div><button class="button secondary compact" type="button" data-action="test-connection">重新测试</button></header>${apiActorRows ? `<div class="table-wrap"><table><thead><tr><th>采集器</th><th>平台</th><th>技术 ID</th><th>开放能力</th></tr></thead><tbody>${apiActorRows}</tbody></table></div>` : `<div class="empty">配置有效 Apify Token 后显示</div>`}</section></div></div>`;
    return;
    const config = state.config || {}; const fallback = Boolean(config.gateway_fallback_enabled); const actorRows = state.actors.map((actor) => `<tr><td>${escapeHtml(actor.title || "-")}</td><td>${escapeHtml(actor.platform === "douyin" ? "抖音" : actor.platform === "kuaishou" ? "快手" : actor.platform === "weibo" ? "微博" : "小红书")}</td><td><code>${escapeHtml(actor.actor_id)}</code></td><td>${(actor.operations || []).map((op) => `<span class="capability">${escapeHtml(operationLabels[op] || op)}</span>`).join(" ")}</td></tr>`).join("");
    app.innerHTML = `<div class="page">${pageHeader("设置 / 平台连接", "上游连接", "默认直连 Apify 官方 API；AI-Search-Platform 网关仅作为可选备份。")}${alertHtml()}<div class="workspace"><section class="panel"><header class="panel-header"><div><h2>连接配置</h2><p>业务 operation 共用，官方与网关由本地代理分别适配</p></div>${config.api_key_configured ? statusHtml("connected") : statusHtml("error")}</header><form id="config-form" class="panel-body"><div class="connection-options"><div class="connection-option active"><strong>Apify 官方 API（首选）</strong><span>${escapeHtml(config.apify_api_base || apifyOfficialUrl)}</span><small>任务由 Apify Run 执行，费用由 Apify 账户结算</small></div></div><div class="form-grid"><label class="field wide"><span>Apify 官方地址</span><input type="url" readonly value="${escapeAttr(config.apify_api_base || apifyOfficialUrl)}" /></label><label class="field wide"><span>Apify API Token</span><input name="apify_api_token" type="password" autocomplete="off" placeholder="${escapeAttr(config.apify_token_masked || "apify_api_...")}" /></label></div><p class="form-hint">Token 留空将保留当前值；当前：${escapeHtml(config.apify_token_masked || "未配置")}。浏览器无法读取明文。</p><div class="connection-options"><label id="gateway-option" class="connection-option ${fallback ? "active" : ""}"><strong>AI-Search-Platform 网关备份</strong><span id="gateway-state">${fallback ? "已启用" : "默认关闭"}</span><small>仅在官方明确未创建 Run 的鉴权或配额错误时自动切换</small><input name="gateway_fallback_enabled" type="checkbox" ${fallback ? "checked" : ""} /></label></div><div class="form-grid gateway-fields" data-gateway-config ${fallback ? "" : "hidden"}><label class="field wide"><span>网关地址</span><input name="platform_api_base" type="url" required value="${escapeAttr(config.platform_api_base || "http://172.16.30.55:8787")}" /></label><label class="field wide"><span>网关 API Key</span><input name="platform_api_key" type="password" autocomplete="off" placeholder="${escapeAttr(config.gateway_key_masked || "sf_live_...")}" /></label></div><p class="form-hint" data-gateway-config ${fallback ? "" : "hidden"}>网关需兼容 /v1/actors、/v1/tasks、任务状态和结果接口；当前 Key：${escapeHtml(config.gateway_key_masked || "未配置")}。</p><div class="actions form-actions"><button class="button primary" type="submit">保存并测试</button><a class="button secondary" href="https://console.apify.com/account/integrations" target="_blank" rel="noopener">打开 Apify Token 页面</a><button class="button danger" type="button" data-action="clear-apify-token">清除官方 Token</button>${fallback ? `<button class="button danger" type="button" data-action="clear-gateway-key">清除网关 Key</button>` : ""}</div></form></section><section class="panel"><header class="panel-header"><div><h2>连接状态</h2><p>实际任务来源会记录在每条任务中</p></div></header><div class="panel-body task-context"><div><span>首选</span><strong>Apify 官方</strong></div><div><span>官方 Token</span><strong>${escapeHtml(config.apify_token_masked || "未配置")}</strong></div><div><span>网关备份</span><strong>${fallback ? "已启用" : "已关闭"}</strong></div><div><span>网关 Key</span><strong>${fallback ? escapeHtml(config.gateway_key_masked || "未配置") : "不使用"}</strong></div><div><span>代理监听</span><strong>仅本机</strong></div><div><span>采集器数量</span><strong>${state.actors.length}</strong></div></div></section></div><section class="panel"><header class="panel-header"><div><h2>可用采集器</h2><p>${state.actorsError ? escapeHtml(state.actorsError) : "当前验证来源返回的能力"}</p></div><button class="button secondary compact" type="button" data-action="test-connection">重新测试</button></header>${actorRows ? `<div class="table-wrap"><table><thead><tr><th>采集器</th><th>平台</th><th>技术 ID</th><th>开放能力</th></tr></thead><tbody>${actorRows}</tbody></table></div>` : `<div class="empty">配置有效 Apify Token，或启用并配置网关备份后显示</div>`}</section></div>`;
  }

  function render() {
    const path = normalizeRoute(location.pathname); if (path !== location.pathname) history.replaceState({}, "", path);
    document.querySelectorAll("[data-route]").forEach((node) => node.classList.toggle("active", node.dataset.route === path));
    if (path === "/config") renderConfig(); else if (path === "/tasks") renderTasks(); else if (path === "/xiaohongshu/search") renderXhsSearch(); else if (path === "/xiaohongshu/results") renderPlatformResults("xiaohongshu"); else if (path === "/douyin/search") renderDouyinSearch(); else if (path === "/douyin/results") renderPlatformResults("douyin"); else if (path === "/kuaishou/search") renderKuaishouSearch(); else if (path === "/kuaishou/results") renderPlatformResults("kuaishou"); else if (path === "/weibo/search") renderWeiboSearch(); else if (path === "/weibo/results") renderPlatformResults("weibo");
    if (state.activeNote) app.insertAdjacentHTML("beforeend", renderCommentsModal());
    if (state.activeDouyinVideo) app.insertAdjacentHTML("beforeend", renderDouyinDetailModal());
    if (state.activeKuaishouVideo) app.insertAdjacentHTML("beforeend", renderKuaishouDetailModal());
    if (state.activeWeiboPost) app.insertAdjacentHTML("beforeend", renderWeiboDetailModal());
    updateConnectionSummary();
  }
  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => { state.renderQueued = false; render(); });
  }
  function platformFromPath(path) { return path.includes("/douyin/") ? "douyin" : path.includes("/kuaishou/") ? "kuaishou" : path.includes("/weibo/") ? "weibo" : "xiaohongshu"; }
  async function navigate(path) {
    if (normalizeRoute(path).endsWith("/search")) setAlert("", "");
    history.pushState({}, "", path); closeMenu(); state.resultFilter = ""; render();
    const normalized = normalizeRoute(path); if (normalized.endsWith("/results")) { await ensurePlatformSelection(platformFromPath(normalized)); render(); }
  }
  function updateConnectionSummary() {
    const node = document.querySelector("#connection-summary"); if (!node) return;
    node.className = `connection-summary ${state.actors.length ? "connected" : state.actorsError ? "error" : ""}`;
    node.innerHTML = `<span></span><div><strong>${state.actors.length ? "Apify 已连接" : state.config?.api_key_configured ? "连接待验证" : "尚未配置"}</strong><small>${state.actors.length ? `${state.actors.length} 个采集器可用` : state.config?.api_key_masked || "需要 Apify API Token"}</small></div>`;
  }
  function formInput(form) {
    const output = {}; new FormData(form).forEach((value, key) => { if (value === "") return; const element = form.elements[key]; if (element?.type === "number") output[key] = Number(value); else if (element?.type === "checkbox") output[key] = element.checked; else output[key] = value; }); return output;
  }
  async function submitTask(operation, input, platform, displayName, metadata = {}) {
    if (!state.config?.api_key_configured) throw new Error("尚未配置 Apify API Token，请到“API配置”完成设置。");
    const actor = actorFor(operation); if (!actor) throw new Error(`Apify 账户未提供${operationLabels[operation]}能力，请在“API配置”刷新并确认 Token 权限。`);
    const task = await requestJson("/api/client/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor_id: actor.actor_id, operation, input, idempotency_key: makeIdempotencyKey() }) });
    const detailOnly = detailOnlyOperations.has(operation); const { selectResult = !detailOnly, storeTask = true, ...storedMetadata } = metadata;
    if (storeTask) rememberTask(task, { platform, operation, displayName, ...storedMetadata, ...(detailOnly ? { hideFromHistory: true } : {}) });
    else state.taskDetails.set(String(task.id), task);
    if (selectResult) state.selectedPlatformTask[platform] = String(task.id);
    startPolling(String(task.id)); return task;
  }
  async function refreshTask(taskId, loadResult = true) {
    const meta = state.recentTasks.find((item) => item.id === taskId);
    const task = await requestJson(`/api/client/tasks/${encodeURIComponent(taskId)}`); state.taskDetails.set(taskId, task); if (meta && !meta.provider && task.provider) { meta.provider = task.provider; saveTasks(); }
    if (terminalStatuses.has(task.status)) { stopPolling(taskId); if (loadResult && task.status === "settled") { const payload = await requestJson(`/api/client/tasks/${encodeURIComponent(taskId)}/results`); rememberResult(taskId, payload); if (payload?.task && typeof payload.task === "object") state.taskDetails.set(taskId, { ...task, ...payload.task }); } }
    if (taskId === state.noteDetailTaskId) syncNoteDetailTask(taskId);
    return task;
  }
  async function ensurePlatformSelection(platform, preferred = "") {
    const tasks = platformTasks(platform); const available = new Set(tasks.map((task) => task.id)); const candidate = preferred || state.selectedPlatformTask[platform] || ""; const id = available.has(candidate) ? candidate : tasks[0]?.id || ""; state.selectedPlatformTask[platform] = id;
    if (!id) return;
    try { await refreshTask(id); } catch (error) { setAlert("error", error.message); }
  }
  function startPolling(taskId) {
    if (state.polling.has(taskId)) return;
    const tick = async () => { const modalTask = isActiveNoteTask(taskId); const previous = state.taskDetails.get(taskId); try { const task = await refreshTask(taskId); const changed = !previous || previous.status !== task.status || previous.item_count !== task.item_count || previous.billed_points !== task.billed_points || previous.error_message !== task.error_message; const path = normalizeRoute(location.pathname); if (state.activeNote) { if (modalTask && changed) refreshActiveNoteModal(); return; } if (state.activeDouyinVideo && taskId === state.douyinCommentTaskId) { if (changed) queueRender(); return; } if (state.activeKuaishouVideo && isKuaishouDetailTask(taskId)) { if (changed) queueRender(); return; } if (state.activeWeiboPost && isWeiboDetailTask(taskId)) { if (changed) queueRender(); return; } if (!changed) return; if (path === "/tasks") { queueRender(); return; } if (path.endsWith("/results") && state.selectedPlatformTask[platformFromPath(path)] === taskId) queueRender(); } catch (error) { stopPolling(taskId); if (state.activeNote) { if (modalTask) { state.commentError = error.message; refreshActiveNoteModal(); } return; } if (state.activeDouyinVideo && taskId === state.douyinCommentTaskId) { state.douyinDetailError = error.message; queueRender(); return; } if (state.activeKuaishouVideo && isKuaishouDetailTask(taskId)) { state.kuaishouDetailError = error.message; queueRender(); return; } if (state.activeWeiboPost && isWeiboDetailTask(taskId)) { state.weiboDetailError = error.message; queueRender(); return; } const path = normalizeRoute(location.pathname); if (path === "/tasks" || (path.endsWith("/results") && state.selectedPlatformTask[platformFromPath(path)] === taskId)) { setAlert("error", error.message); queueRender(); } } };
    state.polling.set(taskId, setInterval(tick, Math.max(1, state.config?.poll_interval_seconds || 2) * 1000)); tick();
  }
  function stopPolling(taskId) { if (state.polling.has(taskId)) clearInterval(state.polling.get(taskId)); state.polling.delete(taskId); }
  function isKuaishouDetailTask(taskId) { return taskId === state.kuaishouCommentTaskId || [...state.kuaishouReplyTaskIds.values()].includes(taskId); }
  function isWeiboDetailTask(taskId) { return taskId === state.weiboCommentTaskId || [...state.weiboReplyTaskIds.values()].includes(taskId); }
  async function loadActors() {
    if (!state.config?.api_key_configured) { state.actors = []; state.actorsError = "尚未配置 API Key"; return; }
    try { const payload = await requestJson("/api/client/actors"); state.actors = Array.isArray(payload?.data) ? payload.data : []; state.actorsError = ""; }
    catch (error) { state.actors = []; state.actorsError = error.message; throw error; }
  }
  function applyResultFilter(value) {
    const keyword = String(value || "").trim().toLowerCase(); let visible = 0;
    document.querySelectorAll("[data-result-row]").forEach((row) => { row.hidden = keyword && !row.dataset.searchText.includes(keyword); if (!row.hidden) visible += 1; });
    const count = document.querySelector("#filtered-count"); if (count) count.textContent = String(visible);
  }
  function downloadResult(taskId, format) {
    const payload = state.results.get(taskId); const items = resultItems(payload); let content; let type;
    if (format === "json") { content = JSON.stringify(payload, null, 2); type = "application/json;charset=utf-8"; }
    else { const fields = [...new Set(items.flatMap((item) => item && typeof item === "object" ? Object.keys(item) : ["value"]))]; const quote = (value) => `"${formatValue(value).replace(/"/g, '""')}"`; content = `\ufeff${fields.map(quote).join(",")}\r\n${items.map((item) => fields.map((field) => quote(field === "value" ? item : item?.[field])).join(",")).join("\r\n")}`; type = "text/csv;charset=utf-8"; }
    const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = `${taskId}.${format}`; link.click(); URL.revokeObjectURL(url);
  }
  function showDetail(taskId, index) {
    const item = resultItems(state.results.get(taskId))[index]; const dialog = document.createElement("dialog"); dialog.className = "detail-dialog";
    dialog.innerHTML = `<header><strong>数据详情</strong><button type="button" aria-label="关闭">×</button></header><pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre>`; document.body.append(dialog); dialog.querySelector("button").addEventListener("click", () => dialog.close()); dialog.addEventListener("close", () => dialog.remove()); dialog.showModal();
  }

  function uniqueItems(items, idFields) {
    const seen = new Set();
    return items.filter((item) => {
      const key = idFields.map((field) => item?.[field]).find((value) => value !== undefined && value !== null && value !== "") || JSON.stringify(item);
      if (seen.has(String(key))) return false;
      seen.add(String(key)); return true;
    });
  }
  function commentItems() {
    const taskIds = state.commentTaskIds.length ? state.commentTaskIds : state.commentTaskId ? [state.commentTaskId] : [];
    return uniqueItems(taskIds.flatMap((taskId) => resultItems(state.results.get(taskId))), ["comment_id", "id"]);
  }
  function replyTaskIds(commentId) { return state.replyTaskIds.get(String(commentId || "")) || []; }
  function replyItems(item) {
    const embedded = Array.isArray(item.replies) ? item.replies : [];
    const collected = replyTaskIds(item.comment_id).flatMap((taskId) => resultItems(state.results.get(taskId)));
    return uniqueItems([...embedded, ...collected], ["comment_id", "id", "reply_id"]);
  }
  function taskIsRunning(taskId) { return Boolean(taskId && !terminalStatuses.has(state.taskDetails.get(taskId)?.status)); }
  function pageToken(payload) {
    const rows = resultItems(payload); const last = rows.at(-1) || {};
    return payload?.next_page_token || payload?.page_next_page_token || payload?.data?.next_page_token || payload?.task?.next_page_token || last.next_page_token || last.page_next_page_token || "";
  }
  function commentPageToken() { return pageToken(state.results.get(state.commentTaskIds.at(-1) || state.commentTaskId)); }
  function replyPageToken(commentId) { return pageToken(state.results.get(replyTaskIds(commentId).at(-1))); }
  function renderReplyItem(item) {
    return `<article class="modal-reply-item">${image(item.author_avatar_url, item.author_name, "reply-avatar")}<div><header><strong>${escapeHtml(item.author_name || "未知用户")}</strong>${item.is_author_comment ? `<span>作者</span>` : ""}</header><p>${escapeHtml(item.content || "-")}</p><footer><span>${escapeHtml(formatDate(item.publish_time))}</span><span>${escapeHtml(item.ip_location || "")}</span><span>赞 ${number(item.like_count)}</span></footer></div></article>`;
  }
  function renderCommentItem(item) {
    const commentId = String(item.comment_id || item.id || ""); const replies = replyItems(item);
    const collectingReplies = replyTaskIds(commentId).some(taskIsRunning) || state.replyBusy.has(commentId);
    return `<article class="modal-comment-item">${image(item.author_avatar_url, item.author_name, "comment-avatar")}<div class="modal-comment-body"><header><strong>${escapeHtml(item.author_name || "未知用户")}</strong>${item.is_author_comment ? `<span>作者</span>` : ""}${item.is_pinned ? `<span>置顶</span>` : ""}</header><p>${escapeHtml(item.content || "-")}</p><footer><span>${escapeHtml(formatDate(item.publish_time))}</span><span>${escapeHtml(item.ip_location || "")}</span><span>赞 ${number(item.like_count)}</span><span>回复 ${number(item.reply_count)}</span>${Number(item.reply_count || 0) > 0 ? `<button class="button secondary compact" type="button" data-action="collect-replies" data-note-id="${escapeAttr(item.note_id || state.activeNote.note_id)}" data-comment-id="${escapeAttr(commentId)}" ${collectingReplies || !hasOperation("get_note_sub_comments") ? "disabled" : ""}>${collectingReplies ? "回复采集中..." : replies.length ? "继续采集回复" : "采集回复"}</button>` : ""}</footer>${replies.length ? `<div class="modal-reply-list">${replies.map(renderReplyItem).join("")}</div>` : ""}</div></article>`;
  }

  function replyCandidates() {
    return commentItems().filter((item) => {
      if (Number(item.reply_count || 0) <= 0) return false;
      const commentId = String(item.comment_id || item.id || "");
      return !replyItems(item).length || Boolean(replyPageToken(commentId));
    });
  }
  function modalControlValue(id, fallback) {
    return Math.min(200, Math.max(1, Number(document.querySelector(`#${id}`)?.value || fallback)));
  }
  function renderCommentsRegion() {
    if (!state.activeNote) return "";
    const items = commentItems(); const task = state.taskDetails.get(state.commentTaskId) || {};
    const collecting = state.commentTaskIds.some(taskIsRunning); const canContinue = !items.length || Boolean(commentPageToken());
    const candidates = replyCandidates(); const repliesCollecting = state.replyBusy.size > 0 || [...state.replyTaskIds.values()].flat().some(taskIsRunning);
    const batchText = state.batchReplyProgress ? `批量处理中 ${state.batchReplyProgress.completed}/${state.batchReplyProgress.total}` : `批量采集 ${Math.min(candidates.length, 20)} 条评论的回复`;
    return `<section class="xhs-comments-region" id="xhs-note-comments">
      <header class="xhs-comments-title"><div><strong>评论 ${number(state.activeNote.comment_count)}</strong><div class="comment-meta"><span>已采集 ${number(items.length)} 条</span>${state.commentTaskId ? statusHtml(task.status) : ""}</div></div><button class="button secondary compact" type="button" data-action="refresh-comments" ${state.commentTaskIds.length || state.replyTaskIds.size ? "" : "disabled"}>刷新</button></header>
      <div class="xhs-collection-bar">
        <div class="collection-action"><strong>评论</strong><input id="comment-limit" type="number" min="1" max="200" value="20" aria-label="评论采集数量" /><button class="button primary compact" type="button" data-action="collect-comments" ${collecting || !canContinue || !hasOperation("get_note_comments") ? "disabled" : ""}>${collecting ? "采集中..." : items.length ? canContinue ? "采集" : "已到末页" : "采集"}</button><small>${items.length ? canContinue ? "继续采集下一页" : "已到最后一页" : "首次从第一页开始"}</small></div>
        <div class="collection-action"><strong>回复</strong><input id="reply-limit" type="number" min="1" max="200" value="20" aria-label="每条评论回复数量" /><button class="button secondary compact" type="button" data-action="collect-all-replies" ${!candidates.length || repliesCollecting || !hasOperation("get_note_sub_comments") ? "disabled" : ""}>${repliesCollecting ? batchText : "采集"}</button><small>符合条件 ${number(candidates.length)} 条，单批最多 20 条</small></div>
      </div>
      ${state.commentError ? `<div class="modal-error">${escapeHtml(state.commentError)}</div>` : ""}
      <div class="comment-list">${items.length ? items.map(renderCommentItem).join("") : `<div class="empty-comments"><strong>${collecting ? "正在采集评论" : "暂无已采集评论"}</strong><span>${collecting ? "任务完成后将在此自动展示。" : "设置数量后点击“采集评论”。"}</span></div>`}</div>
    </section>`;
  }
  function renderNoteSummary(note) {
    const summary = note.summary || note.description || note.desc || note.content || "";
    return `<section class="xhs-note-copy"><h2 id="comment-modal-title">${escapeHtml(note.title || "笔记评论")}</h2>${summary ? `<p>${escapeHtml(summary)}</p>` : ""}<div class="xhs-engagement"><span>赞 ${number(note.like_count)}</span><span>收藏 ${number(note.collect_count)}</span><span>评论 ${number(note.comment_count)}</span></div><footer><span>${escapeHtml(formatDate(note.publish_time))}</span>${note.ip_location ? `<span>${escapeHtml(note.ip_location)}</span>` : ""}<span>笔记 ID ${escapeHtml(note.note_id || "-")}</span></footer></section>`;
  }
  function renderCommentsModal() {
    if (!state.activeNote) return "";
    const note = state.activeNote;
    return `
      <div class="modal-backdrop" data-modal-backdrop>
        <section class="comment-modal xhs-note-modal" role="dialog" aria-modal="true" aria-labelledby="comment-modal-title">
          <div class="xhs-note-media" id="xhs-note-media">${renderNoteMedia(note)}</div>
          <aside class="xhs-note-side" id="xhs-note-side">
            <button class="modal-close" type="button" data-action="close-comments" aria-label="关闭">×</button>
            <div class="xhs-note-scroll">
              <header class="xhs-author-row">
                <div class="xhs-author-identity">${image(note.author_avatar_url, note.author_name, "xhs-author-avatar")}<div><strong>${escapeHtml(note.author_name || "小红书用户")}</strong><small>${escapeHtml(note.author_red_id || note.author_user_id || "")}</small></div></div>
                ${noteOriginalLink(note)}
              </header>
              ${renderNoteSummary(note)}
              ${renderCommentsRegion()}
            </div>
          </aside>
        </section>
      </div>`;
  }
  function refreshActiveNoteModal({ media = false, summary = false } = {}) {
    if (!state.activeNote || !document.querySelector(".comment-modal")) return;
    const comments = document.querySelector("#xhs-note-comments"); if (comments) comments.outerHTML = renderCommentsRegion();
    if (summary) { const copy = document.querySelector(".xhs-note-copy"); if (copy) copy.outerHTML = renderNoteSummary(state.activeNote); }
    if (media) { const mediaNode = document.querySelector("#xhs-note-media"); if (mediaNode) mediaNode.innerHTML = renderNoteMedia(state.activeNote); }
  }
  function isActiveNoteTask(taskId) {
    return taskId === state.noteDetailTaskId || state.commentTaskIds.includes(taskId) || [...state.replyTaskIds.values()].flat().includes(taskId);
  }
  function syncNoteDetailTask(taskId) {
    if (!state.activeNote || taskId !== state.noteDetailTaskId) return;
    const task = state.taskDetails.get(taskId) || {};
    if (!terminalStatuses.has(task.status)) { refreshActiveNoteModal({ media: true }); return; }
    const item = resultItems(state.results.get(taskId))[0];
    if (task.status === "settled" && item) { state.activeNote = { ...state.activeNote, ...item }; state.noteDetailError = ""; }
    else state.noteDetailError = task.error_message || "获取完整笔记详情失败，请稍后重试。";
    state.noteDetailTaskId = ""; refreshActiveNoteModal({ media: true, summary: true });
  }
  async function findModalTasks(noteId) {
    const commentTasks = []; const replyTasks = new Map();
    const candidates = state.recentTasks.filter((task) => task.platform === "xiaohongshu" && ["get_note_comments", "get_note_sub_comments"].includes(task.operation));
    for (const candidate of candidates) {
      try {
        if (!state.results.has(candidate.id)) await refreshTask(candidate.id);
        const rows = resultItems(state.results.get(candidate.id));
        const matchesNote = String(candidate.noteId || "") === String(noteId) || candidate.displayName.includes(noteId) || rows.some((item) => String(item.note_id || "") === String(noteId));
        if (!matchesNote) continue;
        if (candidate.operation === "get_note_comments") commentTasks.unshift(candidate.id);
        else {
          const commentId = String(candidate.commentId || rows[0]?.parent_comment_id || "");
          if (commentId) replyTasks.set(commentId, [candidate.id, ...(replyTasks.get(commentId) || [])]);
        }
      } catch (_) { /* Try the next local task index. */ }
    }
    return { commentTasks, replyTasks };
  }
  async function openComments(taskId, index) {
    const note = resultItems(state.results.get(taskId))[index]; if (!note) return;
    state.activeNote = note; state.commentTaskId = ""; state.commentTaskIds = []; state.replyTaskIds = new Map(); state.replyBusy.clear(); state.commentError = ""; state.noteDetailTaskId = ""; state.noteDetailError = ""; state.batchReplyProgress = null; render();
    const related = await findModalTasks(note.note_id); state.commentTaskIds = related.commentTasks; state.commentTaskId = related.commentTasks.at(-1) || ""; state.replyTaskIds = related.replyTasks; refreshActiveNoteModal();
  }
  async function openCommentTask(taskId, index) {
    const rows = resultItems(state.results.get(taskId)); const comment = rows[index]; if (!comment) return;
    const taskMeta = state.recentTasks.find((task) => task.id === taskId) || {};
    state.activeNote = { note_id: comment.note_id, title: taskMeta.displayName || "笔记评论", comment_count: rows.length };
    state.commentTaskId = taskId; state.commentTaskIds = [taskId]; state.replyTaskIds = new Map(); state.replyBusy.clear(); state.commentError = ""; state.noteDetailTaskId = ""; state.noteDetailError = ""; state.batchReplyProgress = null; render();
    const related = await findModalTasks(comment.note_id); state.commentTaskIds = uniqueItems([...related.commentTasks, taskId].map((id) => ({ id })), ["id"]).map((item) => item.id); state.commentTaskId = state.commentTaskIds.at(-1) || taskId; state.replyTaskIds = related.replyTasks; refreshActiveNoteModal();
  }
  async function collectReplies(noteId, commentId, limit) {
    const input = { note_id: noteId, comment_id: commentId, max_items: limit, auto_paginate: false };
    const token = replyPageToken(commentId); if (token) input.page_token = token;
    const task = await submitTask("get_note_sub_comments", input, "xiaohongshu", `评论回复 · ${noteId} · ${commentId}`, { noteId, commentId, selectResult: false });
    state.replyTaskIds.set(commentId, [...replyTaskIds(commentId), String(task.id)]);
    await refreshTask(String(task.id));
    return task;
  }
  function showModalConfirmation(title, content, action, actionText) {
    const dialog = document.createElement("dialog"); dialog.className = "confirm-dialog";
    dialog.setAttribute("aria-label", title);
    dialog.innerHTML = `<header><strong>${escapeHtml(title)}</strong><button type="button" data-action="cancel-modal-action" aria-label="关闭">×</button></header><div>${content}</div><footer><button class="button secondary" type="button" data-action="cancel-modal-action">取消</button><button class="button primary" type="button" data-action="${escapeAttr(action)}">${escapeHtml(actionText)}</button></footer>`;
    document.body.append(dialog); dialog.addEventListener("close", () => dialog.remove()); dialog.showModal();
  }
  function showNoteDetailConfirmation() {
    const note = state.activeNote; if (!note) return;
    showModalConfirmation("获取完整笔记详情", `<p>将调用上游重新采集该笔记详情和媒体资源，可能产生点数。</p><p class="confirm-note">${escapeHtml(note.title || note.note_id || "当前笔记")}</p>`, "confirm-note-detail", "确认获取");
  }
  function showBatchReplyConfirmation() {
    const candidates = replyCandidates().slice(0, 20); const limit = modalControlValue("reply-limit", 20);
    if (!candidates.length) return;
    state.batchReplyPlan = { candidates, limit };
    showModalConfirmation("批量采集评论回复", `<p>将为 <strong>${candidates.length}</strong> 条一级评论分别创建回复采集任务。</p><p>每条评论最多采集 <strong>${limit}</strong> 条回复。本批最多 20 条评论，任务将由上游计费。</p>`, "confirm-batch-replies", "确认采集");
  }
  async function refreshNoteDetail() {
    const note = state.activeNote; if (!note) return;
    const input = note.note_id ? { note_id: String(note.note_id) } : { note_url: String(note.note_url) };
    state.noteDetailError = "";
    try { const task = await submitTask("get_note_detail", input, "xiaohongshu", `笔记详情 · ${note.note_id || note.title || "当前笔记"}`, { noteId: note.note_id, selectResult: false }); state.noteDetailTaskId = String(task.id); await refreshTask(String(task.id)); }
    catch (error) { state.noteDetailError = error.message; }
    refreshActiveNoteModal({ media: true });
  }
  async function collectBatchReplies() {
    const plan = state.batchReplyPlan; state.batchReplyPlan = null; if (!plan?.candidates?.length || !state.activeNote) return;
    const candidates = plan.candidates; state.batchReplyProgress = { completed: 0, total: candidates.length }; state.commentError = "";
    candidates.forEach((item) => state.replyBusy.add(String(item.comment_id || item.id || ""))); refreshActiveNoteModal();
    for (const item of candidates) {
      const commentId = String(item.comment_id || item.id || "");
      try { await collectReplies(String(item.note_id || state.activeNote.note_id), commentId, plan.limit); }
      catch (error) { state.commentError = error.message; }
      finally { state.replyBusy.delete(commentId); state.batchReplyProgress.completed += 1; refreshActiveNoteModal(); }
    }
    state.batchReplyProgress = null; refreshActiveNoteModal();
  }

  document.addEventListener("error", (event) => {
    if (!event.target.matches?.("[data-xhs-note-media]")) return;
    const media = document.querySelector("#xhs-note-media");
    if (media && state.activeNote) media.innerHTML = renderMediaFailure(state.activeNote);
  }, true);
  document.addEventListener("click", async (event) => {
    const link = event.target.closest("[data-link], [data-route]"); if (link) { event.preventDefault(); await navigate(link.getAttribute("href")); return; }
    const xhs = event.target.closest("[data-xhs-operation]"); if (xhs) { state.selectedXhsOperation = xhs.dataset.xhsOperation; state.xhsPrefill = {}; setAlert("", ""); render(); return; }
    const dy = event.target.closest("[data-douyin-mode]"); if (dy) { state.douyinMode = dy.dataset.douyinMode; render(); return; }
    const weibo = event.target.closest("[data-weibo-operation]"); if (weibo) { state.selectedWeiboOperation = weibo.dataset.weiboOperation; state.weiboPrefill = {}; setAlert("", ""); render(); return; }
    const kuaishou = event.target.closest("[data-kuaishou-operation]"); if (kuaishou) { state.selectedKuaishouOperation = kuaishou.dataset.kuaishouOperation; state.kuaishouPrefill = {}; setAlert("", ""); render(); return; }
    const history = event.target.closest("[data-select-platform-task]"); if (history) { state.resultFilter = ""; state.selectedPlatformTask[history.dataset.platform] = history.dataset.selectPlatformTask; await ensurePlatformSelection(history.dataset.platform, history.dataset.selectPlatformTask); render(); return; }
    const commentLink = event.target.closest("[data-open-comments]"); if (commentLink) { await openComments(commentLink.dataset.taskId, Number(commentLink.dataset.itemIndex)); return; }
    const douyinDetail = event.target.closest("[data-open-douyin-detail]"); if (douyinDetail) { const item = resultItems(state.results.get(douyinDetail.dataset.taskId))[Number(douyinDetail.dataset.itemIndex)]; if (item) { const videoUrl = String(douyinUrl(item)); const savedCommentTask = state.recentTasks.find((task) => task.operation === "douyin_fetch_comments" && task.detailVideoUrl === videoUrl); state.activeDouyinVideo = item; state.douyinDetailError = ""; state.douyinDetailBusy = false; state.douyinCommentTaskId = savedCommentTask?.id || ""; if (savedCommentTask) { try { await refreshTask(savedCommentTask.id); } catch (error) { state.douyinDetailError = error.message; } } render(); } return; }
    const kuaishouDetail = event.target.closest("[data-open-kuaishou-detail]");
    if (kuaishouDetail) {
      const item = resultItems(state.results.get(kuaishouDetail.dataset.taskId))[Number(kuaishouDetail.dataset.itemIndex)];
      if (item) {
        const videoKey = kuaishouVideoKey(item); const savedCommentTask = state.recentTasks.find((task) => task.operation === "kuaishou_get_video_comments" && task.detailVideoKey === videoKey);
        state.activeKuaishouVideo = item; state.kuaishouDetailError = ""; state.kuaishouDetailBusy = false; state.kuaishouCommentTaskId = savedCommentTask?.id || ""; state.kuaishouReplyTaskIds = new Map(); state.kuaishouReplyBusy.clear();
        const savedReplies = state.recentTasks.filter((task) => task.operation === "kuaishou_get_comment_replies" && task.detailVideoKey === videoKey);
        for (const task of savedReplies) if (task.detailCommentId && !state.kuaishouReplyTaskIds.has(task.detailCommentId)) state.kuaishouReplyTaskIds.set(task.detailCommentId, task.id);
        try { await Promise.all([...(savedCommentTask ? [refreshTask(savedCommentTask.id)] : []), ...[...state.kuaishouReplyTaskIds.values()].map((id) => refreshTask(id))]); }
        catch (error) { state.kuaishouDetailError = error.message; }
        render();
      }
      return;
    }
    const kuaishouDetailReplies = event.target.closest("[data-kuaishou-collect-replies]");
    if (kuaishouDetailReplies) {
      const photoId = String(kuaishouDetailReplies.dataset.photoId || ""); const commentId = String(kuaishouDetailReplies.dataset.commentId || ""); const limit = Math.min(100, Math.max(1, Number(document.querySelector("#kuaishou-reply-limit")?.value || 20)));
      if (!photoId || !commentId) { state.kuaishouDetailError = "评论结果缺少作品 ID 或评论 ID，无法采集回复。"; render(); return; }
      state.kuaishouReplyBusy.add(commentId); state.kuaishouDetailError = ""; render();
      try {
        const videoKey = kuaishouVideoKey(state.activeKuaishouVideo || {});
        const task = await submitTask("kuaishou_get_comment_replies", { video_id: photoId, comment_id: commentId, max_items: limit }, "kuaishou", `评论回复 · ${commentId}`, { selectResult: false, hideFromHistory: true, detailVideoKey: videoKey, detailCommentId: commentId });
        state.kuaishouReplyTaskIds.set(commentId, String(task.id)); await refreshTask(String(task.id));
      } catch (error) { state.kuaishouDetailError = error.message; }
      finally { state.kuaishouReplyBusy.delete(commentId); render(); }
      return;
    }
    const commentReplyLink = event.target.closest("[data-open-comment-replies]"); if (commentReplyLink) { await openCommentTask(commentReplyLink.dataset.taskId, Number(commentReplyLink.dataset.itemIndex)); return; }
    const weiboDetail = event.target.closest("[data-open-weibo-detail]");
    if (weiboDetail) {
      const item = resultItems(state.results.get(weiboDetail.dataset.taskId))[Number(weiboDetail.dataset.itemIndex)];
      if (item) {
        const postKey = weiboPostKey(item); const savedCommentTask = state.recentTasks.find((task) => task.operation === "weibo_get_post_comments" && task.detailPostKey === postKey);
        state.activeWeiboPost = item; state.weiboDetailError = ""; state.weiboDetailBusy = false; state.weiboCommentTaskId = savedCommentTask?.id || ""; state.weiboReplyTaskIds = new Map(); state.weiboReplyBusy.clear();
        const savedReplies = state.recentTasks.filter((task) => task.operation === "weibo_get_post_comment_replies" && task.detailPostKey === postKey);
        for (const task of savedReplies) if (task.detailCommentId && !state.weiboReplyTaskIds.has(task.detailCommentId)) state.weiboReplyTaskIds.set(task.detailCommentId, task.id);
        try { await Promise.all([...(savedCommentTask ? [refreshTask(savedCommentTask.id)] : []), ...[...state.weiboReplyTaskIds.values()].map((id) => refreshTask(id))]); }
        catch (error) { state.weiboDetailError = error.message; }
        render();
      }
      return;
    }
    const weiboDetailReplies = event.target.closest("[data-weibo-collect-replies]");
    if (weiboDetailReplies) {
      const postId = String(weiboDetailReplies.dataset.postId || ""); const commentId = String(weiboDetailReplies.dataset.commentId || ""); const limit = Math.min(100, Math.max(1, Number(document.querySelector("#weibo-reply-limit")?.value || 20)));
      if (!postId || !commentId) { state.weiboDetailError = "评论结果缺少微博 ID 或评论 ID，无法采集回复。"; render(); return; }
      state.weiboReplyBusy.add(commentId); state.weiboDetailError = ""; render();
      try {
        const postKey = weiboPostKey(state.activeWeiboPost || {});
        const task = await submitTask("weibo_get_post_comment_replies", { post_id: postId, comment_id: commentId, max_items: limit, auto_paginate: true }, "weibo", `评论回复 · ${commentId}`, { selectResult: false, hideFromHistory: true, detailPostKey: postKey, detailCommentId: commentId });
        state.weiboReplyTaskIds.set(commentId, String(task.id)); await refreshTask(String(task.id));
      } catch (error) { state.weiboDetailError = error.message; }
      finally { state.weiboReplyBusy.delete(commentId); render(); }
      return;
    }
    const platformResult = event.target.closest("[data-open-platform-result]"); if (platformResult) { state.selectedPlatformTask[platformResult.dataset.platform] = platformResult.dataset.openPlatformResult; await navigate(platformResult.dataset.routeTarget); return; }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "dismiss-alert") { setAlert("", ""); render(); return; }
    if (action === "close-douyin-detail") { state.activeDouyinVideo = null; state.douyinDetailError = ""; state.douyinDetailBusy = false; state.douyinCommentTaskId = ""; render(); return; }
    if (action === "close-kuaishou-detail") { state.activeKuaishouVideo = null; state.kuaishouDetailError = ""; state.kuaishouDetailBusy = false; state.kuaishouCommentTaskId = ""; state.kuaishouReplyTaskIds = new Map(); state.kuaishouReplyBusy.clear(); render(); return; }
    if (action === "close-weibo-detail") { state.activeWeiboPost = null; state.weiboDetailError = ""; state.weiboDetailBusy = false; state.weiboCommentTaskId = ""; state.weiboReplyTaskIds = new Map(); state.weiboReplyBusy.clear(); render(); return; }
    if (action === "cancel-modal-action") { event.target.closest("dialog")?.close(); return; }
    if (action === "close-comments") { state.activeNote = null; state.commentTaskId = ""; state.commentTaskIds = []; state.replyTaskIds = new Map(); state.replyBusy.clear(); state.commentError = ""; state.noteDetailTaskId = ""; state.noteDetailError = ""; state.batchReplyPlan = null; state.batchReplyProgress = null; render(); return; }
    if (action === "refresh-note-detail") { showNoteDetailConfirmation(); return; }
    if (action === "confirm-note-detail") { event.target.closest("dialog")?.close(); await refreshNoteDetail(); return; }
    if (action === "confirm-batch-replies") { event.target.closest("dialog")?.close(); await collectBatchReplies(); return; }
    if (action === "refresh-comments") {
      try { await Promise.all([...state.commentTaskIds, ...[...state.replyTaskIds.values()].flat()].map((taskId) => refreshTask(taskId))); state.commentError = ""; }
      catch (error) { state.commentError = error.message; }
      refreshActiveNoteModal(); return;
    }
    if (action === "collect-comments") {
      const input = { note_id: state.activeNote.note_id, max_items: modalControlValue("comment-limit", 20), auto_paginate: false };
      const token = commentPageToken(); if (token) input.page_token = token;
      try { const task = await submitTask("get_note_comments", input, "xiaohongshu", `笔记评论 · ${state.activeNote.note_id}`, { noteId: state.activeNote.note_id, selectResult: false }); state.commentTaskId = String(task.id); state.commentTaskIds.push(String(task.id)); await refreshTask(String(task.id)); state.commentError = ""; }
      catch (error) { state.commentError = error.message; }
      refreshActiveNoteModal(); return;
    }
    if (action === "collect-replies") {
      const button = event.target.closest("[data-comment-id]"); const commentId = String(button.dataset.commentId); const noteId = String(button.dataset.noteId || state.activeNote.note_id);
      const limit = modalControlValue("reply-limit", 20);
      state.replyBusy.add(commentId); state.commentError = ""; refreshActiveNoteModal();
      try { await collectReplies(noteId, commentId, limit); }
      catch (error) { state.commentError = error.message; }
      finally { state.replyBusy.delete(commentId); refreshActiveNoteModal(); }
      return;
    }
    if (action === "collect-all-replies") { showBatchReplyConfirmation(); return; }
    if (action === "clear-tasks") { state.recentTasks = []; state.taskDetails.clear(); state.results.clear(); state.selectedPlatformTask = { xiaohongshu: "", douyin: "", kuaishou: "", weibo: "" }; saveTasks(); saveResults(); render(); return; }
    if (action === "refresh-tasks") { state.busy = true; try { await Promise.all(state.recentTasks.map((task) => refreshTask(task.id))); setAlert("success", "任务状态已刷新。"); } catch (error) { setAlert("error", error.message); } state.busy = false; render(); return; }
    if (action === "refresh-selected-result") { const platform = event.target.closest("[data-platform]").dataset.platform; await ensurePlatformSelection(platform, state.selectedPlatformTask[platform]); render(); return; }
    if (action === "test-connection") { try { await loadActors(); setAlert("success", `连接成功，可用采集器 ${state.actors.length} 个。`); } catch (error) { setAlert("error", error.message); } render(); return; }
    if (action === "clear-apify-token") { try { state.config = await requestJson("/api/client/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apify_api_token: "", keep_existing_apify_token: false }) }); state.actors = []; state.actorsError = "API配置已更新，请重新测试"; setAlert("success", "Apify API Token 已清除。"); } catch (error) { setAlert("error", error.message); } render(); return; }
    const taskButton = event.target.closest("[data-view-task]"); if (taskButton) { try { state.genericTaskId = taskButton.dataset.viewTask; await refreshTask(state.genericTaskId); setAlert("success", "任务结果已更新。"); } catch (error) { setAlert("error", error.message); } render(); return; }
    const download = event.target.closest("[data-download]"); if (download) { downloadResult(download.dataset.taskId, download.dataset.download); return; }
    const detail = event.target.closest("[data-detail-index]"); if (detail) showDetail(detail.dataset.taskId, Number(detail.dataset.detailIndex));
    if (event.target.matches("[data-modal-backdrop]")) { state.activeNote = null; state.commentTaskId = ""; state.commentTaskIds = []; state.replyTaskIds = new Map(); state.replyBusy.clear(); state.commentError = ""; state.noteDetailTaskId = ""; state.noteDetailError = ""; state.batchReplyPlan = null; state.batchReplyProgress = null; render(); }
    if (event.target.matches("[data-douyin-modal-backdrop]")) { state.activeDouyinVideo = null; state.douyinDetailError = ""; state.douyinDetailBusy = false; state.douyinCommentTaskId = ""; render(); }
    if (event.target.matches("[data-kuaishou-modal-backdrop]")) { state.activeKuaishouVideo = null; state.kuaishouDetailError = ""; state.kuaishouDetailBusy = false; state.kuaishouCommentTaskId = ""; state.kuaishouReplyTaskIds = new Map(); state.kuaishouReplyBusy.clear(); render(); }
    if (event.target.matches("[data-weibo-modal-backdrop]")) { state.activeWeiboPost = null; state.weiboDetailError = ""; state.weiboDetailBusy = false; state.weiboCommentTaskId = ""; state.weiboReplyTaskIds = new Map(); state.weiboReplyBusy.clear(); render(); }
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches('#douyin-detail-comments-form input[name="includeReplies"]')) { const input = document.querySelector('#douyin-detail-comments-form input[name="maxRepliesPerComment"]'); if (input) input.disabled = !event.target.checked; return; }
    if (event.target.matches('input[name="gateway_fallback_enabled"]')) { const enabled = event.target.checked; state.config.gateway_fallback_enabled = enabled; document.querySelectorAll("[data-gateway-config]").forEach((node) => { node.hidden = !enabled; }); document.querySelector("#gateway-option")?.classList.toggle("active", enabled); const label = document.querySelector("#gateway-state"); if (label) label.textContent = enabled ? "已启用" : "默认关闭"; return; }
    const checkbox = event.target.closest("[data-video-url]"); if (!checkbox) return; if (checkbox.checked) state.selectedVideos.add(checkbox.dataset.videoUrl); else state.selectedVideos.delete(checkbox.dataset.videoUrl); const count = document.querySelector("#selection-count"); if (count) count.textContent = state.selectedVideos.size;
    const button = document.querySelector("[data-use-selected-videos]"); if (button) button.disabled = !state.selectedVideos.size;
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "result-filter") { state.resultFilter = event.target.value; applyResultFilter(state.resultFilter); }
    if (event.target.closest("#weibo-form") && state.alert?.type === "error") { setAlert("", ""); document.querySelector(".alert")?.remove(); }
  });
  document.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.target;
    if (form.id === "douyin-detail-comments-form") {
      state.douyinDetailBusy = true; state.douyinDetailError = ""; render();
      try {
        const url = String(douyinUrl(state.activeDouyinVideo || "")); if (!url) throw new Error("该视频缺少可用于采集评论的链接。");
        const input = formInput(form); input.includeReplies = Boolean(form.elements.includeReplies?.checked); if (!input.includeReplies) delete input.maxRepliesPerComment;
        const task = await submitTask("douyin_fetch_comments", { ...input, awemeUrls: [url] }, "douyin", `评论采集 · ${douyinTitle(state.activeDouyinVideo)}`, { selectResult: false, hideFromHistory: true, detailVideoUrl: url });
        state.douyinCommentTaskId = String(task.id); state.douyinDetailBusy = false; state.douyinDetailError = ""; render();
      } catch (error) { state.douyinDetailError = error.message; state.douyinDetailBusy = false; render(); }
      return;
    }
    if (form.id === "kuaishou-detail-comments-form") {
      state.kuaishouDetailBusy = true; state.kuaishouDetailError = ""; render();
      try {
        const item = state.activeKuaishouVideo || {}; const videoKey = kuaishouVideoKey(item); if (!videoKey) throw new Error("该视频缺少可用于采集评论的作品 ID 或链接。");
        const input = formInput(form); const videoId = kuaishouVideoId(item); const videoUrl = kuaishouVideoUrl(item);
        const task = await submitTask("kuaishou_get_video_comments", { ...input, ...(videoUrl ? { video_url: videoUrl } : { video_id: videoId }) }, "kuaishou", `视频评论 · ${kuaishouTitle(item)}`, { selectResult: false, hideFromHistory: true, detailVideoKey: videoKey });
        state.kuaishouCommentTaskId = String(task.id); state.kuaishouDetailBusy = false; state.kuaishouDetailError = ""; render();
      } catch (error) { state.kuaishouDetailError = error.message; state.kuaishouDetailBusy = false; render(); }
      return;
    }
    if (form.id === "weibo-detail-comments-form") {
      state.weiboDetailBusy = true; state.weiboDetailError = ""; render();
      try {
        const item = state.activeWeiboPost || {}; const postKey = weiboPostKey(item); if (!postKey) throw new Error("该微博缺少可用于采集评论的微博 ID 或链接。");
        const input = formInput(form); const postId = weiboPostId(item); const postUrl = weiboPostUrl(item);
        const task = await submitTask("weibo_get_post_comments", { ...input, auto_paginate: true, ...(postUrl ? { post_url: postUrl } : { post_id: postId }) }, "weibo", `微博评论 · ${weiboContent(item).slice(0, 30)}`, { selectResult: false, hideFromHistory: true, detailPostKey: postKey });
        state.weiboCommentTaskId = String(task.id); state.weiboDetailBusy = false; state.weiboDetailError = ""; render();
      } catch (error) { state.weiboDetailError = error.message; state.weiboDetailBusy = false; render(); }
      return;
    }
    state.busy = true;
    try {
      if (form.id === "config-form") { const data = formInput(form); state.config = await requestJson("/api/client/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apify_api_token: data.apify_api_token || "", keep_existing_apify_token: !data.apify_api_token }) }); await loadActors(); setAlert("success", `API配置已保存，当前可用采集器 ${state.actors.length} 个。`); }
      else if (form.id === "xhs-form") { const definition = xhsOperations[state.selectedXhsOperation]; const input = formInput(form); if (definition.oneOf && !definition.oneOf.some((key) => input[key])) throw new Error(`${definition.oneOf.join(" 或 ")} 至少填写一项。`); const label = input.keyword || input.note_id || input.user_id || definition.title; const task = await submitTask(state.selectedXhsOperation, input, "xiaohongshu", `${definition.title} · ${label}`); state.xhsPrefill = {}; setAlert("success", `任务 ${task.id} 已提交，正在轮询。`); }
      else if (form.id === "weibo-form") { const definition = weiboOperations[state.selectedWeiboOperation]; const input = formInput(form); if (form.elements.auto_paginate) input.auto_paginate = Boolean(form.elements.auto_paginate.checked); state.weiboPrefill = { ...input }; if (state.selectedWeiboOperation === "weibo_search_posts") { input.keyword = String(input.keyword || "").trim(); if (!input.keyword) throw new Error("请填写搜索关键词。"); } if (/^\d{1,6}$/.test(String(input.page_token || "").trim())) throw new Error("分页令牌不能填写页码。首次采集请留空，继续采集请粘贴上一次返回的完整令牌。"); if (definition.oneOf && !definition.oneOf.some((key) => input[key])) throw new Error(`${definition.oneOf.join(" 或 ")} 至少填写一项。`); const label = input.keyword || input.post_id || input.user_id || definition.title; const task = await submitTask(state.selectedWeiboOperation, input, "weibo", `${definition.title} · ${label}`); state.weiboPrefill = {}; setAlert("success", `微博任务 ${task.id} 已提交，正在轮询。`); }
      else if (form.id === "kuaishou-form") { const definition = kuaishouOperations[state.selectedKuaishouOperation]; const input = formInput(form); if (definition.oneOf && !definition.oneOf.some((key) => input[key])) throw new Error(`${definition.oneOf.join(" 或 ")} 至少填写一项。`); const label = input.keyword || input.video_id || input.user_id || definition.title; const task = await submitTask(state.selectedKuaishouOperation, input, "kuaishou", `${definition.title} · ${label}`); state.kuaishouPrefill = {}; setAlert("success", `快手任务 ${task.id} 已提交，正在轮询。`); }
      else if (form.id === "douyin-search-form") { const input = formInput(form); input.keywords = String(input.keywords || "").split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean); if (!input.keywords.length || input.keywords.length > 5) throw new Error("请输入 1 至 5 个搜索关键词。"); const task = await submitTask("douyin_search_videos", input, "douyin", `视频搜索 · ${input.keywords.join("、")}`); setAlert("success", `视频搜索任务 ${task.id} 已提交。`); }
      else if (form.id === "douyin-comments-form") { const input = formInput(form); input.awemeUrls = String(input.awemeUrls || "").split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean); if (!input.awemeUrls.length || input.awemeUrls.length > 20) throw new Error("请输入 1 至 20 个视频链接或 ID。"); input.includeReplies = Boolean(form.elements.includeReplies.checked); if (!input.includeReplies) delete input.maxRepliesPerComment; const task = await submitTask("douyin_fetch_comments", input, "douyin", `评论采集 · ${input.awemeUrls.length} 个视频`); state.douyinPrefillUrls = []; setAlert("success", `评论采集任务 ${task.id} 已提交。`); }
    } catch (error) { setAlert("error", error.message); }
    finally { state.busy = false; render(); }
  });

  function closeMenu() { document.querySelector("#sidebar")?.classList.remove("open"); document.querySelector("#sidebar-scrim")?.classList.remove("open"); }
  document.querySelector("#menu-button")?.addEventListener("click", () => { document.querySelector("#sidebar")?.classList.add("open"); document.querySelector("#sidebar-scrim")?.classList.add("open"); });
  document.querySelector("#sidebar-scrim")?.addEventListener("click", closeMenu);
  addEventListener("popstate", async () => { render(); const path = normalizeRoute(location.pathname); if (path.endsWith("/results")) { await ensurePlatformSelection(platformFromPath(path)); render(); } });

  async function init() {
    try { state.config = await requestJson("/api/client/config"); try { await loadActors(); } catch (_) { /* Connection error is rendered. */ } for (const task of state.recentTasks) startPolling(task.id); }
    catch (error) { state.config = { apify_api_base: apifyOfficialUrl, apify_token_configured: false, api_key_configured: false, api_key_masked: "", poll_interval_seconds: 2 }; setAlert("error", error.message); }
    render(); const path = normalizeRoute(location.pathname); if (path.endsWith("/results")) { await ensurePlatformSelection(platformFromPath(path)); render(); }
  }
  init();
})();
