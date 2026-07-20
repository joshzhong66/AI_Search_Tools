(() => {
  "use strict";

  const app = document.querySelector("#app");
  const storageKey = "ai-search-skill:recent-tasks:v1";
  const terminalStatuses = new Set(["settled", "refunded"]);
  const routes = new Set(["/config", "/tasks", "/xiaohongshu/search", "/xiaohongshu/results", "/douyin/search", "/douyin/results"]);
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
  };
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

  const state = {
    config: null, actors: [], actorsError: "", selectedXhsOperation: "search_notes", douyinMode: "search",
    recentTasks: readTasks(), taskDetails: new Map(), results: new Map(), selectedVideos: new Set(),
    selectedPlatformTask: { xiaohongshu: "", douyin: "" }, genericTaskId: "", resultFilter: "",
    xhsPrefill: {}, douyinPrefillUrls: [], activeNote: null, commentTaskId: "", commentTaskIds: [],
    replyTaskIds: new Map(), commentError: "", replyBusy: new Set(), alert: null, busy: false, polling: new Map(),
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
  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
  }
  function normalizeRoute(path) {
    if (path === "/xiaohongshu") return "/xiaohongshu/search";
    if (path === "/douyin") return "/douyin/search";
    if (routes.has(path)) return path;
    return state.config?.api_key_configured ? "/xiaohongshu/search" : "/config";
  }
  function readTasks() {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || "[]"); return Array.isArray(value) ? value.slice(0, 50) : []; }
    catch (_) { return []; }
  }
  function saveTasks() { localStorage.setItem(storageKey, JSON.stringify(state.recentTasks.slice(0, 50))); }
  function rememberTask(task, meta) {
    const id = String(task.id); const previous = state.recentTasks.find((item) => item.id === id) || {};
    const item = { ...previous, ...meta, id, platform: meta.platform || previous.platform || "", operation: meta.operation || previous.operation || task.operation || "", submittedAt: meta.submittedAt || previous.submittedAt || new Date().toISOString(), displayName: meta.displayName || previous.displayName || operationLabels[task.operation] || task.operation || id };
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
    const value = status || "unknown"; const names = { starting: "启动中", reserved: "已预留", running: "运行中", settlement_pending: "结算中", settled: "已结算", refunded: "已退款", unknown: "待查询" };
    return `<span class="status ${escapeAttr(value)}">${escapeHtml(names[value] || value)}</span>`;
  }
  function pageHeader(section, title, description, action = "") { return `<header class="page-header"><div><span class="eyebrow">${escapeHtml(section)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${action ? `<div class="header-actions">${action}</div>` : ""}</header>`; }
  function platformTasks(platform) { return state.recentTasks.filter((task) => task.platform === platform); }
  function resultItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    return payload && typeof payload === "object" ? [payload] : [];
  }
  function fieldHtml(field) {
    const [name, label, type, required, placeholder, defaultValue, options] = field;
    const prefill = state.xhsPrefill[name]; const value = prefill ?? defaultValue ?? "";
    if (type === "select") return `<label class="field"><span>${escapeHtml(label)}${required ? " *" : ""}</span><select name="${escapeAttr(name)}" ${required ? "required" : ""}>${Object.entries(options).map(([option, text]) => `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
    return `<label class="field"><span>${escapeHtml(label)}${required ? " *" : ""}</span><input name="${escapeAttr(name)}" type="${escapeAttr(type)}" placeholder="${escapeAttr(placeholder || "")}" value="${escapeAttr(value)}" ${required ? "required" : ""}${type === "number" ? ' min="1" max="200" step="1"' : ""} /></label>`;
  }

  function latestSummary(platform) {
    const item = platformTasks(platform)[0]; if (!item) return `<div class="empty compact-empty">尚未提交采集任务</div>`;
    const task = state.taskDetails.get(item.id) || {};
    return `<div class="recent-summary"><div><span>任务</span><strong>${escapeHtml(item.displayName)}</strong></div><div><span>状态</span>${statusHtml(task.status)}</div><div><span>结果</span><strong>${task.item_count == null ? "待返回" : `${number(task.item_count)} 条`}</strong></div><div><span>结算点数</span><strong>${task.billed_points == null ? "-" : number(task.billed_points)}</strong></div><a class="button primary" href="/${platform}/results" data-link>打开采集结果</a></div>`;
  }
  function taskContextHtml(platform, operation) {
    const actor = actorFor(operation); const name = platform === "douyin" ? "抖音" : "小红书";
    return `<div class="side-stack"><section class="panel"><header class="panel-header"><div><h2>任务控制</h2><p>提交前确认平台与能力</p></div></header><div class="panel-body task-context"><div><span>平台</span><strong>${name}</strong></div><div><span>当前能力</span><strong>${escapeHtml(operationLabels[operation])}</strong></div><div><span>采集权限</span><strong>${actor ? "可用" : "不可用"}</strong></div><div><span>上游连接</span><strong>${state.config?.api_key_configured ? "已连接" : "未配置"}</strong></div><a class="button secondary" href="/config" data-link>管理上游连接</a></div></section><section class="panel"><header class="panel-header"><div><h2>最近一次采集</h2><p>状态和费用来自上游</p></div></header><div class="panel-body">${latestSummary(platform)}</div></section></div>`;
  }

  function renderXhsSearch() {
    const operation = state.selectedXhsOperation; const definition = xhsOperations[operation];
    const tabs = Object.entries(xhsOperations).map(([id, item]) => `<button type="button" data-xhs-operation="${id}" class="${id === operation ? "active" : ""}">${escapeHtml(item.title)}</button>`).join("");
    app.innerHTML = `<div class="page">${pageHeader("小红书插件 / 数据采集", "小红书搜索与采集", "选择采集能力并填写参数，任务统一由上游平台执行和结算。", `<a class="button secondary" href="/xiaohongshu/results" data-link>查看采集结果</a>`)}${alertHtml()}<div class="segmented capability-tabs">${tabs}</div><div class="workspace search-workspace"><section class="panel"><header class="panel-header"><div><h2>搜索参数 · ${escapeHtml(definition.title)}</h2><p>${escapeHtml(definition.description)}</p></div>${hasOperation(operation) ? statusHtml("connected") : statusHtml("error")}</header><form id="xhs-form" class="panel-body"><div class="form-grid">${definition.fields.map(fieldHtml).join("")}</div>${definition.oneOf ? `<p class="form-hint">${definition.oneOf.map((key) => `<code>${key}</code>`).join(" 或 ")} 至少填写一项。</p>` : ""}<div class="actions form-actions"><button class="button primary" type="submit" ${!hasOperation(operation) || state.busy ? "disabled" : ""}>${state.busy ? "提交中..." : "开始采集"}</button></div></form></section>${taskContextHtml("xiaohongshu", operation)}</div></div>`;
  }

  function renderDouyinSearch() {
    const operation = state.douyinMode === "comments" ? "douyin_fetch_comments" : "douyin_search_videos";
    const tabs = `<button type="button" data-douyin-mode="search" class="${state.douyinMode === "search" ? "active" : ""}">视频搜索</button><button type="button" data-douyin-mode="comments" class="${state.douyinMode === "comments" ? "active" : ""}">评论采集</button>`;
    let form;
    if (state.douyinMode === "search") {
      form = `<form id="douyin-search-form" class="panel-body"><div class="form-grid"><label class="field wide"><span>搜索关键词 *</span><textarea name="keywords" rows="3" required placeholder="每行一个关键词，最多 5 个"></textarea></label><label class="field"><span>每个关键词结果数</span><input name="maxResultsPerQuery" type="number" min="1" max="200" value="10" required /></label><label class="field"><span>排序</span><select name="sort"><option value="general">综合</option><option value="most_liked">最多点赞</option><option value="latest">最新发布</option></select></label><label class="field"><span>发布时间</span><select name="publishTime"><option value="unlimited">不限</option><option value="one_day">一天内</option><option value="one_week">一周内</option><option value="half_year">半年内</option></select></label><label class="field"><span>视频时长</span><select name="duration"><option value="unlimited">不限</option><option value="under_1m">1 分钟内</option><option value="one_to_five">1 至 5 分钟</option><option value="over_5m">5 分钟以上</option></select></label></div><div class="actions form-actions"><button class="button primary" type="submit" ${!hasOperation(operation) || state.busy ? "disabled" : ""}>开始搜索</button></div></form>`;
    } else {
      form = `<form id="douyin-comments-form" class="panel-body"><div class="form-grid"><label class="field wide"><span>视频链接或 ID *</span><textarea name="awemeUrls" rows="5" required placeholder="每行一个抖音视频链接或数字 ID">${escapeHtml(state.douyinPrefillUrls.join("\n"))}</textarea></label><label class="field"><span>每个视频评论数</span><input name="maxCommentsPerAweme" type="number" min="1" max="200" value="10" required /></label><label class="check-field"><input id="includeReplies" name="includeReplies" type="checkbox" /><span>同时采集评论回复</span></label><label class="field"><span>每条评论回复上限</span><input id="maxRepliesPerComment" name="maxRepliesPerComment" type="number" min="1" max="200" value="10" disabled /></label></div><div class="actions form-actions"><button class="button primary" type="submit" ${!hasOperation(operation) || state.busy ? "disabled" : ""}>开始采集评论</button></div></form>`;
    }
    app.innerHTML = `<div class="page">${pageHeader("抖音插件 / 数据采集", "抖音搜索与采集", "搜索视频，或使用结果页选中的视频采集评论与回复。", `<a class="button secondary" href="/douyin/results" data-link>查看采集结果</a>`)}${alertHtml()}<div class="segmented capability-tabs">${tabs}</div><div class="workspace search-workspace"><section class="panel"><header class="panel-header"><div><h2>${escapeHtml(operationLabels[operation])}参数</h2><p>${state.douyinMode === "search" ? "按关键词筛选抖音视频" : "批量采集视频评论，可选择包含回复"}</p></div>${hasOperation(operation) ? statusHtml("connected") : statusHtml("error")}</header>${form}</section>${taskContextHtml("douyin", operation)}</div></div>`;
    document.querySelector("#includeReplies")?.addEventListener("change", (event) => { const input = document.querySelector("#maxRepliesPerComment"); if (input) input.disabled = !event.target.checked; });
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
  function renderNoteMedia(note) {
    const videoUrl = note.video_url || note.video?.url || note.video?.media?.stream?.h264?.[0]?.master_url || "";
    const images = noteMediaUrls(note);
    if (videoUrl) return `<video class="xhs-note-video" controls preload="metadata" poster="${escapeAttr(mediaUrl(images[0] || ""))}"><source src="${escapeAttr(videoUrl)}" /></video>`;
    if (images.length) return `<img class="xhs-note-image" src="${escapeAttr(mediaUrl(images[0]))}" alt="${escapeAttr(note.title || "笔记图片")}" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><div class="xhs-media-error" hidden><strong>图片暂时无法加载</strong><span>图片链接可能已过期，可打开原文查看或重新采集笔记详情。</span></div>${images.length > 1 ? `<span class="xhs-media-count">1 / ${images.length}</span>` : ""}`;
    return `<div class="xhs-media-fallback"><span>“</span><strong>${escapeHtml(note.title || "小红书笔记")}</strong><small>该条结果未返回图片</small></div>`;
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
  function renderDouyinData(taskMeta, detail, payload) {
    const items = resultItems(payload); const taskId = taskMeta.id;
    if (taskMeta.operation === "douyin_search_videos") {
      const columns = [
        { label: "选择", render: (item) => { const stats = douyinStats(item); const url = String(douyinUrl(item)); const enabled = Number(stats.commentCount ?? stats.comment_count ?? 0) > 0; return `<input type="checkbox" data-video-url="${escapeAttr(url)}" ${state.selectedVideos.has(url) ? "checked" : ""} ${enabled ? "" : "disabled"} aria-label="选择视频" />`; } },
        { label: "视频", render: (item) => `<div class="video-title"><strong>${escapeHtml(douyinTitle(item))}</strong><small>${escapeHtml(String(item.id || "-"))}</small></div>` },
        { label: "作者", render: (item) => escapeHtml(douyinAuthor(item).name || douyinAuthor(item).nickname || "-") },
        { label: "播放", render: (item) => number(douyinStats(item).playCount ?? douyinStats(item).play_count), numeric: true },
        { label: "点赞", render: (item) => number(douyinStats(item).diggCount ?? douyinStats(item).digg_count), numeric: true },
        { label: "评论", render: (item) => number(douyinStats(item).commentCount ?? douyinStats(item).comment_count), numeric: true },
        { label: "收藏", render: (item) => number(douyinStats(item).collectCount ?? douyinStats(item).collect_count), numeric: true },
        { label: "分享", render: (item) => number(douyinStats(item).shareCount ?? douyinStats(item).share_count), numeric: true },
        { label: "发布时间", render: (item) => escapeHtml(formatDate(item.createDate || item.createTime)) },
      ];
      const totals = (key) => items.reduce((sum, item) => sum + Number(douyinStats(item)[key] || 0), 0);
      return `<div class="metrics">${metric("视频", number(items.length), "当前结果")}${metric("播放", number(totals("playCount")), "合计")}${metric("点赞", number(totals("diggCount")), "合计")}${metric("评论", number(totals("commentCount")), "可采集")}</div><div class="selection-toolbar"><span>已选择 <strong id="selection-count">${state.selectedVideos.size}</strong> 个有评论的视频</span><button class="button primary" type="button" data-use-selected-videos ${state.selectedVideos.size ? "" : "disabled"}>带入评论采集</button></div>${table(columns, items, taskId)}`;
    }
    const groups = new Map();
    for (const item of items) { const id = String(item.awemeId || item.aweme_id || item.videoId || item.video_id || "未知视频"); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(item); }
    if (!items.length) return `<div class="metrics">${metric("评论", "0", "当前视频没有公开评论")}${metric("任务状态", detail.status === "settled" ? "已结算" : formatValue(detail.status), "上游返回")}${metric("结算点数", number(detail.billed_points), "本次任务")}${metric("视频", "1", "采集目标")}</div><div class="empty">任务执行成功，但目标视频没有返回公开评论</div>`;
    return `<div class="metrics">${metric("评论", number(items.length), "当前结果")}${metric("视频", number(groups.size), "已分组")}${metric("点赞", number(items.reduce((s, i) => s + Number(i.likeCount || i.like_count || 0), 0)), "合计")}${metric("回复", number(items.reduce((s, i) => s + Number(i.replyCount || i.reply_count || 0), 0)), "合计")}</div><div class="comment-groups">${[...groups.entries()].map(([id, rows]) => `<section class="comment-group"><header><div><span>视频</span><strong>${escapeHtml(id)}</strong></div><small>${rows.length} 条评论</small></header>${rows.map((item) => { const user = item.user || item.author || {}; const index = items.indexOf(item); return `<article data-result-row data-search-text="${escapeAttr(JSON.stringify(item).toLowerCase())}"><div class="identity-cell compact-identity">${image(user.avatarThumb || user.avatar || user.avatar_url, user.nickname || user.name)}<div><strong>${escapeHtml(user.nickname || user.name || "未知用户")}</strong><small>${escapeHtml(item.region || item.ipLocation || "")}</small></div></div><p>${escapeHtml(item.text || item.content || "-")}</p><footer><span>点赞 ${number(item.likeCount || item.like_count)}</span><span>${escapeHtml(formatDate(item.createDate || item.createTime))}</span><button class="button secondary compact" type="button" data-detail-index="${index}" data-task-id="${escapeAttr(taskId)}">详情</button></footer></article>`; }).join("")}</section>`).join("")}</div>`;
  }

  function resultShell(platform, content) {
    const name = platform === "douyin" ? "抖音" : "小红书"; const searchRoute = `/${platform}/search`;
    return `<div class="page result-page">${pageHeader(`${name}插件 / 数据结果`, `${name}采集结果`, "按任务查看上游采集数据，完整结果不会保存在本地。", `<a class="button secondary" href="${searchRoute}" data-link>返回搜索与采集</a>`)}${alertHtml()}<div class="results-layout"><aside class="history-panel"><header><span>历史结果</span><strong>${platformTasks(platform).length} 份</strong><small>最近 50 个本地任务索引</small></header><div class="history-list">${historyHtml(platform)}</div></aside><section class="results-main">${content}</section></div></div>`;
  }
  function renderPlatformResults(platform) {
    const selectedId = state.selectedPlatformTask[platform]; const taskMeta = state.recentTasks.find((item) => item.id === selectedId);
    if (!taskMeta) { app.innerHTML = resultShell(platform, `<div class="empty result-empty"><strong>暂无采集结果</strong><span>先提交一个采集任务，完成后会显示在这里。</span><a class="button primary" href="/${platform}/search" data-link>开始搜索与采集</a></div>`); return; }
    const detail = state.taskDetails.get(selectedId) || {}; const payload = state.results.get(selectedId);
    let dataContent = `<div class="empty">正在读取任务状态...</div>`;
    if (payload) dataContent = platform === "xiaohongshu" ? renderXhsData(taskMeta, detail, payload) : renderDouyinData(taskMeta, detail, payload);
    else if (detail.status && !terminalStatuses.has(detail.status)) dataContent = `<div class="empty"><strong>任务${statusHtml(detail.status)}</strong><span>页面将每 ${state.config?.poll_interval_seconds || 2} 秒自动刷新。</span></div>`;
    const header = `<header class="result-detail-header"><div><span>当前结果</span><h2>${escapeHtml(taskMeta.displayName)}</h2><p>${formatDate(taskMeta.submittedAt)} · ${escapeHtml(operationLabels[taskMeta.operation] || taskMeta.operation)}</p></div><div class="result-meta">${statusHtml(detail.status)}<span>${detail.item_count == null ? "-" : `${number(detail.item_count)} 条`}</span><span>${detail.billed_points == null ? "-" : `${number(detail.billed_points)} 点`}</span></div></header><div class="result-actions"><label class="result-search"><span>筛选结果</span><input id="result-filter" type="search" placeholder="输入标题、作者或内容" value="${escapeAttr(state.resultFilter)}" /></label><div class="actions"><button class="button secondary" type="button" data-download="json" data-task-id="${escapeAttr(selectedId)}" ${payload ? "" : "disabled"}>下载 JSON</button><button class="button secondary" type="button" data-download="csv" data-task-id="${escapeAttr(selectedId)}" ${payload ? "" : "disabled"}>下载 CSV</button><button class="button secondary" type="button" data-action="refresh-selected-result" data-platform="${platform}">刷新</button></div></div>`;
    app.innerHTML = resultShell(platform, `${header}${dataContent}`); applyResultFilter(state.resultFilter);
  }

  function renderTasks() {
    const rows = state.recentTasks.map((item) => { const detail = state.taskDetails.get(item.id) || {}; const route = item.platform === "douyin" ? "/douyin/results" : "/xiaohongshu/results"; return `<div class="task-row"><span>${formatDate(item.submittedAt)}</span><div><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.id)}</small></div><span>${escapeHtml(operationLabels[item.operation] || item.operation)}</span>${statusHtml(detail.status)}<span class="numeric">${detail.billed_points == null ? "-" : `${number(detail.billed_points)} 点`}</span><div class="row-actions"><button class="button secondary compact" type="button" data-view-task="${escapeAttr(item.id)}">详情</button><button class="button secondary compact" type="button" data-open-platform-result="${escapeAttr(item.id)}" data-platform="${escapeAttr(item.platform)}" data-route-target="${route}">平台结果</button></div></div>`; }).join("");
    app.innerHTML = `<div class="page">${pageHeader("任务 / 跨平台监控", "全部任务", "查看小红书与抖音任务状态、结算点数和通用结果。", `<button class="button secondary" type="button" data-action="refresh-tasks">刷新状态</button>`)}${alertHtml()}<section class="panel"><header class="panel-header"><div><h2>最近任务</h2><p>本地仅保存最近 50 个任务索引</p></div><button class="button danger compact" type="button" data-action="clear-tasks">清空索引</button></header>${rows ? `<div class="task-list">${rows}</div>` : `<div class="empty">尚未提交任务</div>`}</section>${renderGenericResult()}</div>`;
  }
  function renderGenericResult() {
    const id = state.genericTaskId; const payload = state.results.get(id); if (!id || !payload) return `<section class="panel"><header class="panel-header"><div><h2>通用结果</h2><p>点击任务“详情”后显示原始字段</p></div></header><div class="empty">尚未选择任务</div></section>`;
    const items = resultItems(payload); const fields = [...new Set(items.flatMap((item) => item && typeof item === "object" ? Object.keys(item) : ["value"]))].slice(0, 12);
    return `<section class="panel"><div class="result-toolbar"><strong>通用结果 · ${items.length} 条</strong><div class="actions"><button class="button secondary" data-download="json" data-task-id="${escapeAttr(id)}">下载 JSON</button><button class="button secondary" data-download="csv" data-task-id="${escapeAttr(id)}">下载 CSV</button></div></div>${table(fields.map((key) => ({ label: key, key })), items, id)}</section>`;
  }
  function renderConfig() {
    const config = state.config || {}; const actorRows = state.actors.map((actor) => `<tr><td>${escapeHtml(actor.title || "-")}</td><td>${escapeHtml(actor.platform === "douyin" ? "抖音" : "小红书")}</td><td><code>${escapeHtml(actor.actor_id)}</code></td><td>${(actor.operations || []).map((op) => `<span class="capability">${escapeHtml(operationLabels[op] || op)}</span>`).join(" ")}</td></tr>`).join("");
    app.innerHTML = `<div class="page">${pageHeader("设置 / 平台连接", "上游连接", "API Key 仅保存在被 Git 忽略的本机配置中，浏览器无法读取明文。")}${alertHtml()}<div class="workspace"><section class="panel"><header class="panel-header"><div><h2>连接配置</h2><p>环境变量优先于本地配置文件</p></div>${config.api_key_configured ? statusHtml("connected") : statusHtml("error")}</header><form id="config-form" class="panel-body"><div class="form-grid"><label class="field wide"><span>平台地址 *</span><input name="platform_api_base" type="url" required value="${escapeAttr(config.platform_api_base || "http://172.16.30.55:8787")}" /></label><label class="field wide"><span>平台 API Key</span><input name="platform_api_key" type="password" autocomplete="off" placeholder="${escapeAttr(config.api_key_masked || "sf_live_...")}" /></label></div><p class="form-hint">留空将保留当前 Key；当前：${escapeHtml(config.api_key_masked || "未配置")}</p><div class="actions form-actions"><button class="button primary" type="submit">保存并测试</button><button class="button danger" type="button" data-action="clear-key">清除 Key</button></div></form></section><section class="panel"><header class="panel-header"><div><h2>连接状态</h2><p>能力由当前 Key 动态返回</p></div></header><div class="panel-body task-context"><div><span>代理监听</span><strong>仅本机</strong></div><div><span>上游地址</span><strong>${escapeHtml(config.platform_api_base || "-")}</strong></div><div><span>API Key</span><strong>${escapeHtml(config.api_key_masked || "未配置")}</strong></div><div><span>采集器数量</span><strong>${state.actors.length}</strong></div></div></section></div><section class="panel"><header class="panel-header"><div><h2>可用采集器</h2><p>${state.actorsError ? escapeHtml(state.actorsError) : "由上游动态返回"}</p></div><button class="button secondary compact" type="button" data-action="test-connection">重新测试</button></header>${actorRows ? `<div class="table-wrap"><table><thead><tr><th>采集器</th><th>平台</th><th>技术 ID</th><th>开放能力</th></tr></thead><tbody>${actorRows}</tbody></table></div>` : `<div class="empty">配置有效 API Key 后显示</div>`}</section></div>`;
  }

  function render() {
    const path = normalizeRoute(location.pathname); if (path !== location.pathname) history.replaceState({}, "", path);
    document.querySelectorAll("[data-route]").forEach((node) => node.classList.toggle("active", node.dataset.route === path));
    if (path === "/config") renderConfig(); else if (path === "/tasks") renderTasks(); else if (path === "/xiaohongshu/search") renderXhsSearch(); else if (path === "/xiaohongshu/results") renderPlatformResults("xiaohongshu"); else if (path === "/douyin/search") renderDouyinSearch(); else if (path === "/douyin/results") renderPlatformResults("douyin");
    if (state.activeNote) app.insertAdjacentHTML("beforeend", renderCommentsModal());
    updateConnectionSummary();
  }
  async function navigate(path) {
    history.pushState({}, "", path); closeMenu(); state.resultFilter = ""; render();
    const normalized = normalizeRoute(path); if (normalized.endsWith("/results")) { await ensurePlatformSelection(normalized.includes("douyin") ? "douyin" : "xiaohongshu"); render(); }
  }
  function updateConnectionSummary() {
    const node = document.querySelector("#connection-summary"); if (!node) return;
    node.className = `connection-summary ${state.actors.length ? "connected" : state.actorsError ? "error" : ""}`;
    node.innerHTML = `<span></span><div><strong>${state.actors.length ? "上游已连接" : state.config?.api_key_configured ? "连接待验证" : "尚未配置"}</strong><small>${state.actors.length ? `${state.actors.length} 个采集器可用` : state.config?.api_key_masked || "需要平台 API Key"}</small></div>`;
  }
  function formInput(form) {
    const output = {}; new FormData(form).forEach((value, key) => { if (value === "") return; const element = form.elements[key]; if (element?.type === "number") output[key] = Number(value); else if (element?.type === "checkbox") output[key] = element.checked; else output[key] = value; }); return output;
  }
  async function submitTask(operation, input, platform, displayName, metadata = {}) {
    const actor = actorFor(operation); if (!actor) throw new Error(`当前 API Key 没有${operationLabels[operation]}权限。`);
    const task = await requestJson("/api/client/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor_id: actor.actor_id, operation, input, idempotency_key: makeIdempotencyKey() }) });
    const { selectResult = true, ...storedMetadata } = metadata;
    rememberTask(task, { platform, operation, displayName, ...storedMetadata });
    if (selectResult) state.selectedPlatformTask[platform] = String(task.id);
    startPolling(String(task.id)); return task;
  }
  async function refreshTask(taskId, loadResult = true) {
    const task = await requestJson(`/api/client/tasks/${encodeURIComponent(taskId)}`); state.taskDetails.set(taskId, task);
    if (terminalStatuses.has(task.status)) { stopPolling(taskId); if (loadResult) state.results.set(taskId, await requestJson(`/api/client/tasks/${encodeURIComponent(taskId)}/results`)); }
    return task;
  }
  async function ensurePlatformSelection(platform, preferred = "") {
    const tasks = platformTasks(platform); const id = preferred || state.selectedPlatformTask[platform] || tasks[0]?.id || ""; state.selectedPlatformTask[platform] = id;
    if (!id) return;
    try { await refreshTask(id); } catch (error) { setAlert("error", error.message); }
  }
  function startPolling(taskId) {
    if (state.polling.has(taskId)) return;
    const tick = async () => { try { const task = await refreshTask(taskId); const path = normalizeRoute(location.pathname); if (path === "/tasks" || path.endsWith("/results") || terminalStatuses.has(task.status)) render(); } catch (error) { stopPolling(taskId); setAlert("error", error.message); render(); } };
    state.polling.set(taskId, setInterval(tick, Math.max(1, state.config?.poll_interval_seconds || 2) * 1000)); tick();
  }
  function stopPolling(taskId) { if (state.polling.has(taskId)) clearInterval(state.polling.get(taskId)); state.polling.delete(taskId); }
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
  function renderCommentsModal() {
    if (!state.activeNote) return "";
    const items = commentItems(); const task = state.taskDetails.get(state.commentTaskId) || {};
    const collecting = state.commentTaskIds.some(taskIsRunning); const canContinue = !items.length || Boolean(commentPageToken());
    const replyCandidates = items.filter((item) => Number(item.reply_count || 0) > 0 && !replyItems(item).length);
    const repliesCollecting = state.replyBusy.size > 0 || [...state.replyTaskIds.values()].flat().some(taskIsRunning);
    const note = state.activeNote; const summary = note.summary || note.description || note.desc || note.content || "";
    const originalLink = note.note_url ? `<a class="xhs-original-link" href="${escapeAttr(note.note_url)}" target="_blank" rel="noopener">打开原文</a>` : "";
    return `
      <div class="modal-backdrop" data-modal-backdrop>
        <section class="comment-modal xhs-note-modal" role="dialog" aria-modal="true" aria-labelledby="comment-modal-title">
          <div class="xhs-note-media">${renderNoteMedia(note)}</div>
          <aside class="xhs-note-side">
            <button class="modal-close" type="button" data-action="close-comments" aria-label="关闭">×</button>
            <div class="xhs-note-scroll">
              <header class="xhs-author-row">
                <div class="xhs-author-identity">${image(note.author_avatar_url, note.author_name, "xhs-author-avatar")}<div><strong>${escapeHtml(note.author_name || "小红书用户")}</strong><small>${escapeHtml(note.author_red_id || note.author_user_id || "")}</small></div></div>
                ${originalLink}
              </header>
              <section class="xhs-note-copy">
                <h2 id="comment-modal-title">${escapeHtml(note.title || "笔记评论")}</h2>
                ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
                <footer><span>${escapeHtml(formatDate(note.publish_time))}</span>${note.ip_location ? `<span>${escapeHtml(note.ip_location)}</span>` : ""}<span>笔记 ID ${escapeHtml(note.note_id || "-")}</span></footer>
              </section>
              <section class="xhs-comments-region">
                <header class="xhs-comments-title"><strong>共 ${number(note.comment_count)} 条评论</strong><div class="comment-meta"><span>已采集 ${number(items.length)} 条</span>${state.commentTaskId ? statusHtml(task.status) : ""}</div></header>
                <div class="xhs-collection-bar">
                  <div class="comment-controls">
                    <label><span>评论数</span><input id="comment-limit" type="number" min="1" max="200" value="20" /></label>
                    <label><span>回复数</span><input id="reply-limit" type="number" min="1" max="200" value="20" /></label>
                    <button class="button secondary compact" type="button" data-action="refresh-comments" ${state.commentTaskIds.length || state.replyTaskIds.size ? "" : "disabled"}>刷新</button>
                    <button class="button secondary compact" type="button" data-action="collect-all-replies" ${!replyCandidates.length || repliesCollecting || !hasOperation("get_note_sub_comments") ? "disabled" : ""}>${repliesCollecting ? "回复采集中..." : "批量采集回复"}</button>
                    <button class="button primary compact" type="button" data-action="collect-comments" ${collecting || !canContinue || !hasOperation("get_note_comments") ? "disabled" : ""}>${collecting ? "采集中..." : items.length ? canContinue ? "继续采集" : "已到末页" : "采集评论"}</button>
                  </div>
                </div>
                ${state.commentError ? `<div class="modal-error">${escapeHtml(state.commentError)}</div>` : ""}
                <div class="comment-list">${items.length ? items.map(renderCommentItem).join("") : `<div class="empty-comments"><strong>${collecting ? "正在采集评论" : "暂无已采集评论"}</strong><span>${collecting ? "任务完成后将在此自动展示。" : "设置数量后点击“采集评论”。"}</span></div>`}</div>
              </section>
            </div>
            <footer class="xhs-note-footer"><span>赞 ${number(note.like_count)}</span><span>收藏 ${number(note.collect_count)}</span><span>评论 ${number(note.comment_count)}</span>${originalLink}</footer>
          </aside>
        </section>
      </div>`;
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
    state.activeNote = note; state.commentTaskId = ""; state.commentTaskIds = []; state.replyTaskIds = new Map(); state.replyBusy.clear(); state.commentError = ""; render();
    const related = await findModalTasks(note.note_id); state.commentTaskIds = related.commentTasks; state.commentTaskId = related.commentTasks.at(-1) || ""; state.replyTaskIds = related.replyTasks; render();
  }
  async function openCommentTask(taskId, index) {
    const rows = resultItems(state.results.get(taskId)); const comment = rows[index]; if (!comment) return;
    const taskMeta = state.recentTasks.find((task) => task.id === taskId) || {};
    state.activeNote = { note_id: comment.note_id, title: taskMeta.displayName || "笔记评论", comment_count: rows.length };
    state.commentTaskId = taskId; state.commentTaskIds = [taskId]; state.replyTaskIds = new Map(); state.replyBusy.clear(); state.commentError = ""; render();
    const related = await findModalTasks(comment.note_id); state.commentTaskIds = uniqueItems([...related.commentTasks, taskId].map((id) => ({ id })), ["id"]).map((item) => item.id); state.commentTaskId = state.commentTaskIds.at(-1) || taskId; state.replyTaskIds = related.replyTasks; render();
  }
  async function collectReplies(noteId, commentId, limit) {
    const input = { note_id: noteId, comment_id: commentId, max_items: limit, auto_paginate: false };
    const token = replyPageToken(commentId); if (token) input.page_token = token;
    const task = await submitTask("get_note_sub_comments", input, "xiaohongshu", `评论回复 · ${noteId} · ${commentId}`, { noteId, commentId, selectResult: false });
    state.replyTaskIds.set(commentId, [...replyTaskIds(commentId), String(task.id)]);
    return task;
  }

  document.addEventListener("click", async (event) => {
    const link = event.target.closest("[data-link], [data-route]"); if (link) { event.preventDefault(); await navigate(link.getAttribute("href")); return; }
    const xhs = event.target.closest("[data-xhs-operation]"); if (xhs) { state.selectedXhsOperation = xhs.dataset.xhsOperation; state.xhsPrefill = {}; setAlert("", ""); render(); return; }
    const dy = event.target.closest("[data-douyin-mode]"); if (dy) { state.douyinMode = dy.dataset.douyinMode; render(); return; }
    const history = event.target.closest("[data-select-platform-task]"); if (history) { state.resultFilter = ""; state.selectedPlatformTask[history.dataset.platform] = history.dataset.selectPlatformTask; await ensurePlatformSelection(history.dataset.platform, history.dataset.selectPlatformTask); render(); return; }
    const commentLink = event.target.closest("[data-open-comments]"); if (commentLink) { await openComments(commentLink.dataset.taskId, Number(commentLink.dataset.itemIndex)); return; }
    const commentReplyLink = event.target.closest("[data-open-comment-replies]"); if (commentReplyLink) { await openCommentTask(commentReplyLink.dataset.taskId, Number(commentReplyLink.dataset.itemIndex)); return; }
    const useVideos = event.target.closest("[data-use-selected-videos]"); if (useVideos) { state.douyinMode = "comments"; state.douyinPrefillUrls = [...state.selectedVideos]; await navigate("/douyin/search"); return; }
    const platformResult = event.target.closest("[data-open-platform-result]"); if (platformResult) { state.selectedPlatformTask[platformResult.dataset.platform] = platformResult.dataset.openPlatformResult; await navigate(platformResult.dataset.routeTarget); return; }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "dismiss-alert") { setAlert("", ""); render(); return; }
    if (action === "close-comments") { state.activeNote = null; state.commentTaskId = ""; state.commentTaskIds = []; state.replyTaskIds = new Map(); state.replyBusy.clear(); state.commentError = ""; render(); return; }
    if (action === "refresh-comments") {
      try { await Promise.all([...state.commentTaskIds, ...[...state.replyTaskIds.values()].flat()].map((taskId) => refreshTask(taskId))); state.commentError = ""; }
      catch (error) { state.commentError = error.message; }
      render(); return;
    }
    if (action === "collect-comments") {
      const limit = Number(document.querySelector("#comment-limit")?.value || 20);
      const input = { note_id: state.activeNote.note_id, max_items: Math.min(200, Math.max(1, limit)), auto_paginate: false };
      const token = commentPageToken(); if (token) input.page_token = token;
      try { const task = await submitTask("get_note_comments", input, "xiaohongshu", `笔记评论 · ${state.activeNote.note_id}`, { noteId: state.activeNote.note_id, selectResult: false }); state.commentTaskId = String(task.id); state.commentTaskIds.push(String(task.id)); state.commentError = ""; }
      catch (error) { state.commentError = error.message; }
      render(); return;
    }
    if (action === "collect-replies") {
      const button = event.target.closest("[data-comment-id]"); const commentId = String(button.dataset.commentId); const noteId = String(button.dataset.noteId || state.activeNote.note_id);
      const limit = Math.min(200, Math.max(1, Number(document.querySelector("#reply-limit")?.value || 20)));
      state.replyBusy.add(commentId); state.commentError = ""; render();
      try { await collectReplies(noteId, commentId, limit); }
      catch (error) { state.commentError = error.message; }
      finally { state.replyBusy.delete(commentId); render(); }
      return;
    }
    if (action === "collect-all-replies") {
      const limit = Math.min(200, Math.max(1, Number(document.querySelector("#reply-limit")?.value || 20)));
      const candidates = commentItems().filter((item) => Number(item.reply_count || 0) > 0 && !replyItems(item).length);
      candidates.forEach((item) => state.replyBusy.add(String(item.comment_id || item.id || ""))); state.commentError = ""; render();
      try {
        for (const item of candidates) await collectReplies(String(item.note_id || state.activeNote.note_id), String(item.comment_id || item.id), limit);
      } catch (error) { state.commentError = error.message; }
      finally { state.replyBusy.clear(); render(); }
      return;
    }
    if (action === "clear-tasks") { state.recentTasks = []; state.taskDetails.clear(); state.results.clear(); state.selectedPlatformTask = { xiaohongshu: "", douyin: "" }; saveTasks(); render(); return; }
    if (action === "refresh-tasks") { state.busy = true; try { await Promise.all(state.recentTasks.map((task) => refreshTask(task.id))); setAlert("success", "任务状态已刷新。"); } catch (error) { setAlert("error", error.message); } state.busy = false; render(); return; }
    if (action === "refresh-selected-result") { const platform = event.target.closest("[data-platform]").dataset.platform; await ensurePlatformSelection(platform, state.selectedPlatformTask[platform]); render(); return; }
    if (action === "test-connection") { try { await loadActors(); setAlert("success", `连接成功，可用采集器 ${state.actors.length} 个。`); } catch (error) { setAlert("error", error.message); } render(); return; }
    if (action === "clear-key") { try { state.config = await requestJson("/api/client/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform_api_base: state.config.platform_api_base, platform_api_key: "" }) }); state.actors = []; state.actorsError = "尚未配置 API Key"; setAlert("success", "本地 API Key 已清除。"); } catch (error) { setAlert("error", error.message); } render(); return; }
    const taskButton = event.target.closest("[data-view-task]"); if (taskButton) { try { state.genericTaskId = taskButton.dataset.viewTask; await refreshTask(state.genericTaskId); setAlert("success", "任务结果已更新。"); } catch (error) { setAlert("error", error.message); } render(); return; }
    const download = event.target.closest("[data-download]"); if (download) { downloadResult(download.dataset.taskId, download.dataset.download); return; }
    const detail = event.target.closest("[data-detail-index]"); if (detail) showDetail(detail.dataset.taskId, Number(detail.dataset.detailIndex));
    if (event.target.matches("[data-modal-backdrop]")) { state.activeNote = null; state.commentTaskId = ""; state.commentTaskIds = []; state.replyTaskIds = new Map(); state.replyBusy.clear(); state.commentError = ""; render(); }
  });
  document.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-video-url]"); if (!checkbox) return; if (checkbox.checked) state.selectedVideos.add(checkbox.dataset.videoUrl); else state.selectedVideos.delete(checkbox.dataset.videoUrl); const count = document.querySelector("#selection-count"); if (count) count.textContent = state.selectedVideos.size;
    const button = document.querySelector("[data-use-selected-videos]"); if (button) button.disabled = !state.selectedVideos.size;
  });
  document.addEventListener("input", (event) => { if (event.target.id === "result-filter") { state.resultFilter = event.target.value; applyResultFilter(state.resultFilter); } });
  document.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.target; state.busy = true;
    try {
      if (form.id === "config-form") { const data = formInput(form); state.config = await requestJson("/api/client/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform_api_base: data.platform_api_base, platform_api_key: data.platform_api_key || "", keep_existing_key: !data.platform_api_key }) }); await loadActors(); setAlert("success", `配置已保存，可用采集器 ${state.actors.length} 个。`); }
      else if (form.id === "xhs-form") { const definition = xhsOperations[state.selectedXhsOperation]; const input = formInput(form); if (definition.oneOf && !definition.oneOf.some((key) => input[key])) throw new Error(`${definition.oneOf.join(" 或 ")} 至少填写一项。`); const label = input.keyword || input.note_id || input.user_id || definition.title; const task = await submitTask(state.selectedXhsOperation, input, "xiaohongshu", `${definition.title} · ${label}`); state.xhsPrefill = {}; setAlert("success", `任务 ${task.id} 已提交，正在轮询。`); }
      else if (form.id === "douyin-search-form") { const input = formInput(form); input.keywords = String(input.keywords || "").split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean); if (!input.keywords.length || input.keywords.length > 5) throw new Error("请输入 1 至 5 个搜索关键词。"); const task = await submitTask("douyin_search_videos", input, "douyin", `视频搜索 · ${input.keywords.join("、")}`); setAlert("success", `视频搜索任务 ${task.id} 已提交。`); }
      else if (form.id === "douyin-comments-form") { const input = formInput(form); input.awemeUrls = String(input.awemeUrls || "").split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean); if (!input.awemeUrls.length || input.awemeUrls.length > 20) throw new Error("请输入 1 至 20 个视频链接或 ID。"); input.includeReplies = Boolean(form.elements.includeReplies.checked); if (!input.includeReplies) delete input.maxRepliesPerComment; const task = await submitTask("douyin_fetch_comments", input, "douyin", `评论采集 · ${input.awemeUrls.length} 个视频`); state.douyinPrefillUrls = []; setAlert("success", `评论采集任务 ${task.id} 已提交。`); }
    } catch (error) { setAlert("error", error.message); }
    finally { state.busy = false; render(); }
  });

  function closeMenu() { document.querySelector("#sidebar")?.classList.remove("open"); document.querySelector("#sidebar-scrim")?.classList.remove("open"); }
  document.querySelector("#menu-button")?.addEventListener("click", () => { document.querySelector("#sidebar")?.classList.add("open"); document.querySelector("#sidebar-scrim")?.classList.add("open"); });
  document.querySelector("#sidebar-scrim")?.addEventListener("click", closeMenu);
  addEventListener("popstate", async () => { render(); const path = normalizeRoute(location.pathname); if (path.endsWith("/results")) { await ensurePlatformSelection(path.includes("douyin") ? "douyin" : "xiaohongshu"); render(); } });

  async function init() {
    try { state.config = await requestJson("/api/client/config"); try { await loadActors(); } catch (_) { /* Connection error is rendered. */ } for (const task of state.recentTasks) startPolling(task.id); }
    catch (error) { state.config = { platform_api_base: "", api_key_configured: false, api_key_masked: "", poll_interval_seconds: 2 }; setAlert("error", error.message); }
    render(); const path = normalizeRoute(location.pathname); if (path.endsWith("/results")) { await ensurePlatformSelection(path.includes("douyin") ? "douyin" : "xiaohongshu"); render(); }
  }
  init();
})();
