const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.AI_SEARCH_TEST_URL || "http://127.0.0.1:8790";
const storageKey = "ai-search-skill:recent-tasks:v1";
const actors = [
  { actor_id: "xhs", platform: "xiaohongshu", title: "小红书采集器", operations: ["search_notes", "search_hot_list", "get_note_detail", "get_user_info", "list_user_notes", "get_note_comments", "get_note_sub_comments"] },
  { actor_id: "dy-search", platform: "douyin", title: "抖音搜索采集器", operations: ["douyin_search_videos"] },
  { actor_id: "dy-comments", platform: "douyin", title: "抖音评论采集器", operations: ["douyin_fetch_comments"] },
  { actor_id: "ks", platform: "kuaishou", title: "快手数据采集器", operations: ["kuaishou_search_videos", "kuaishou_get_video_detail", "kuaishou_get_video_comments", "kuaishou_get_comment_replies", "kuaishou_get_user_info", "kuaishou_list_user_videos"] },
  { actor_id: "weibo", platform: "weibo", title: "微博数据采集器", operations: ["weibo_search_posts", "weibo_search_hot_list", "weibo_get_post_detail", "weibo_get_user_info", "weibo_list_user_posts", "weibo_get_post_comments", "weibo_get_post_comment_replies", "weibo_list_post_likers", "weibo_list_post_reposts"] },
];
const resultByOperation = {
  search_notes: [{ note_id: "note-1", note_url: "https://www.xiaohongshu.com/explore/note-1", cover_image_url: "http://platform.test/api/media/signed/cover", note_type: "image", title: "厦门旅行", summary: "海边和咖啡", author_name: "测试作者", author_red_id: "xhs001", like_count: 120, collect_count: 31, comment_count: 8, publish_time: 1750000000 }],
  search_hot_list: [{ title: "今日热门内容", hot_value: 9988 }],
  get_note_detail: [{ note_id: "note-1", note_type: "image", title: "笔记详情", cover_image_url: "http://platform.test/api/media/signed/refreshed", author_name: "测试作者", like_count: 120, collect_count: 31, comment_count: 8 }],
  get_user_info: [{ user_id: "user-1", name: "测试博主", red_id: "xhs001", follower_count: 3000, following_count: 20, posted_note_count: 88, received_like_count: 9000, received_collect_count: 2100, verified: true, ip_location: "福建" }],
  list_user_notes: [{ note_id: "note-2", note_type: "video", title: "博主笔记", author_name: "测试博主", like_count: 22, comment_count: 3 }],
  get_note_comments: [{ note_id: "note-1", comment_id: "comment-1", content: "很实用的攻略", author_name: "评论用户", like_count: 5, reply_count: 2, publish_time: 1750000000, ip_location: "上海" }],
  get_note_sub_comments: [{ note_id: "note-1", comment_id: "reply-1", parent_comment_id: "comment-1", content: "谢谢分享", author_name: "回复用户", like_count: 1, reply_count: 0 }],
  douyin_search_videos: [
    { id: "123", url: "https://www.douyin.com/video/123", text: "厦门咖啡探店", coverUrl: "https://p3-sign.douyinpic.com/cover-123.webp", authorMeta: { name: "抖音作者", avatarThumb: "https://p3-sign.douyinpic.com/avatar-123.webp" }, statistics: { playCount: 12000, diggCount: 800, commentCount: 23, collectCount: 90, shareCount: 18 }, createDate: "2026-07-20" },
    { id: "456", url: "https://www.douyin.com/video/456", text: "零评论视频", authorMeta: { name: "另一作者" }, statistics: { playCount: 20, diggCount: 2, commentCount: 0, collectCount: 0, shareCount: 0 } },
  ],
  douyin_fetch_comments: [{ awemeId: "123", text: "拍得很好", likeCount: 12, replyCount: 1, region: "福建", createDate: "2026-07-20", user: { nickname: "抖音用户" } }],
  kuaishou_search_videos: [{ video_id: "ks-video-1", video_url: "https://www.kuaishou.com/short-video/ks-video-1", title: "快手露营记录", author_name: "快手作者", like_count: 66, comment_count: 8, publish_time: 1750000000 }],
  kuaishou_get_video_detail: [{ video_id: "ks-video-1", title: "快手视频详情", author_name: "快手作者", like_count: 66, comment_count: 8 }],
  kuaishou_get_video_comments: [{ video_id: "ks-video-1", comment_id: "ks-comment-1", content: "很喜欢这个视频", author_name: "评论用户", like_count: 3, reply_count: 1 }],
  kuaishou_get_comment_replies: [{ video_id: "ks-video-1", comment_id: "ks-reply-1", content: "谢谢支持", author_name: "回复用户", like_count: 1 }],
  kuaishou_get_user_info: [{ user_id: "ks-user-1", author_name: "快手作者", follower_count: 2000, video_count: 50, description: "记录生活" }],
  kuaishou_list_user_videos: [{ video_id: "ks-video-2", title: "博主作品", author_name: "快手作者", like_count: 20, comment_count: 2 }],
  weibo_search_posts: [{ post_id: "wb-post-1", post_url: "https://weibo.com/123/wb-post-1", content: "AI 搜索正在改变内容发现方式", author_name: "微博作者", author_user_id: "wb-user-1", like_count: 88, comment_count: 12, repost_count: 6, publish_time: 1750000000 }],
  weibo_search_hot_list: [{ rank: 1, keyword: "AI 搜索", hot_value: 998800, category: "科技" }],
  weibo_get_post_detail: [{ post_id: "wb-post-1", post_url: "https://weibo.com/123/wb-post-1", content: "微博详情内容", author_name: "微博作者", like_count: 88, comment_count: 12, repost_count: 6 }],
  weibo_get_user_info: [{ user_id: "wb-user-1", screen_name: "微博作者", followers_count: 3200, friends_count: 80, statuses_count: 900, verified: true, verified_reason: "科技博主", description: "关注 AI 与搜索" }],
  weibo_list_user_posts: [{ post_id: "wb-post-2", content: "用户发布的微博", author_name: "微博作者", like_count: 20, comment_count: 3, repost_count: 1 }],
  weibo_get_post_comments: [{ post_id: "wb-post-1", comment_id: "wb-comment-1", content: "这个搜索体验不错", author_name: "评论用户", like_count: 5, reply_count: 2, publish_time: 1750000000, ip_location: "福建" }],
  weibo_get_post_comment_replies: [{ post_id: "wb-post-1", comment_id: "wb-reply-1", parent_comment_id: "wb-comment-1", content: "同意你的看法", author_name: "回复用户", like_count: 1, reply_count: 0 }],
  weibo_list_post_likers: [{ user_id: "wb-liker-1", screen_name: "点赞用户", followers_count: 100, verified: false }],
  weibo_list_post_reposts: [{ post_id: "wb-post-1", id: "wb-repost-1", content: "转发微博", author_name: "转发用户", like_count: 2, publish_time: 1750000000 }],
};

function operationFromTaskPath(requestPath) {
  const id = requestPath.split("/")[4] || "";
  return id.startsWith("task-") ? id.slice(5).replace(/\/results$/, "") : "search_notes";
}

async function mockClientApi(page) {
  const stats = { submissions: 0, requests: [], localMediaRequests: 0 };
  await page.route("http://platform.test/api/media/**", async (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8mpCwAAAABJRU5ErkJggg==", "base64") }));
  await page.route("**/api/client/**", async (route) => {
    const requestPath = new URL(route.request().url()).pathname;
    if (requestPath === "/api/client/media") { stats.localMediaRequests += 1; return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8mpCwAAAABJRU5ErkJggg==", "base64") }); }
    if (requestPath === "/api/client/config") return route.fulfill({ json: { apify_api_base: "https://api.apify.com/v2", apify_token_configured: true, apify_token_masked: "apify_a...test", api_key_configured: true, api_key_masked: "apify_a...test", poll_interval_seconds: 2 } });
    if (requestPath === "/api/client/actors") return route.fulfill({ json: { data: actors } });
    if (requestPath === "/api/client/tasks" && route.request().method() === "POST") {
      stats.submissions += 1;
      const body = route.request().postDataJSON();
      stats.requests.push(body);
      return route.fulfill({ status: 202, json: { id: `task-${body.operation}`, provider: "apify", operation: body.operation, status: "running", item_count: 0 } });
    }
    if (/\/api\/client\/tasks\/[^/]+\/results$/.test(requestPath)) {
      const operation = operationFromTaskPath(requestPath.replace(/\/results$/, ""));
      return route.fulfill({ json: { task: { id: `task-${operation}`, operation, status: "settled", billed_points: 1.25 }, items: resultByOperation[operation] || [] } });
    }
    if (/\/api\/client\/tasks\/[^/]+$/.test(requestPath)) {
      const operation = operationFromTaskPath(requestPath);
      return route.fulfill({ json: { id: `task-${operation}`, operation, status: "settled", item_count: (resultByOperation[operation] || []).length, billed_points: 1.25 } });
    }
    return route.fulfill({ status: 404, json: { detail: "not found" } });
  });
  return stats;
}

function task(operation, platform) {
  return { id: `task-${operation}`, platform, operation, submittedAt: "2026-07-20T10:00:00Z", displayName: `${operation} 测试结果` };
}

async function setTasks(page, tasks) {
  await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [storageKey, tasks]);
}

async function assertLayout(page, viewport, route) {
  await page.goto(`${baseUrl}${route}`);
  await page.locator("#app h1").waitFor();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    mainRight: Math.round(document.querySelector("main").getBoundingClientRect().right),
    sidebar: Math.round(document.querySelector("#sidebar").getBoundingClientRect().width),
  }));
  assert.equal(dimensions.scroll, dimensions.viewport, `${viewport.name} ${route} 页面横向溢出`);
  assert.ok(Math.abs(dimensions.mainRight - dimensions.viewport) <= 1, `${viewport.name} ${route} 未铺满屏幕`);
  if (viewport.width >= 1440) assert.equal(dimensions.sidebar, 228, `${viewport.name} 完整侧栏宽度错误`);
  if (viewport.width >= 1024 && viewport.width < 1440) assert.equal(dimensions.sidebar, 184, `${viewport.name} 紧凑侧栏宽度错误`);
  assert.equal(await page.getByText("登录", { exact: true }).count(), 0, `${route} 不应出现登录入口`);
}

async function checkViewport(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockClientApi(page);
  await page.goto(`${baseUrl}/config`);
  await setTasks(page, [task("search_notes", "xiaohongshu"), task("douyin_search_videos", "douyin"), task("kuaishou_search_videos", "kuaishou"), task("weibo_search_posts", "weibo")]);
  for (const route of ["/config", "/xiaohongshu/search", "/xiaohongshu/results", "/douyin/search", "/douyin/results", "/kuaishou/search", "/kuaishou/results", "/weibo/search", "/weibo/results", "/tasks"]) await assertLayout(page, viewport, route);
  assert.deepEqual(errors, [], `${viewport.name} 存在浏览器脚本错误`);
  await page.goto(`${baseUrl}/xiaohongshu/results`);
  await page.getByText("厦门旅行", { exact: true }).waitFor();
  if (viewport.width === 390) {
    await page.locator(".count-link").click();
    const modal = page.locator(".comment-modal");
    await modal.waitFor();
    const box = await modal.boundingBox();
    assert.ok(box.width <= viewport.width && box.height <= viewport.height, "移动端评论弹窗超出视口");
    await page.screenshot({ path: path.join("outputs", "ui-comment-modal-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "关闭" }).click();
    await page.goto(`${baseUrl}/douyin/results`);
    await page.getByRole("button", { name: "厦门咖啡探店", exact: true }).click();
    const douyinModal = page.locator(".douyin-detail-modal");
    await douyinModal.waitFor();
    const douyinBox = await douyinModal.boundingBox();
    assert.ok(douyinBox.width <= viewport.width && douyinBox.height <= viewport.height, "移动端抖音详情弹窗超出视口");
    await page.screenshot({ path: path.join("outputs", "ui-douyin-detail-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "关闭" }).click();
    await page.goto(`${baseUrl}/xiaohongshu/results`);
    await page.getByText("厦门旅行", { exact: true }).waitFor();
  }
  await page.screenshot({ path: path.join("outputs", `ui-${viewport.name}.png`), fullPage: true });
  if ([1366, 390].includes(viewport.width)) { await page.goto(`${baseUrl}/weibo/results`); await page.getByText("AI 搜索正在改变内容发现方式", { exact: true }).waitFor(); await page.screenshot({ path: path.join("outputs", `ui-weibo-${viewport.name}.png`), fullPage: true }); }
  await page.close();
}

async function checkInteractions(browser) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const stats = await mockClientApi(page);
  await page.goto(`${baseUrl}/xiaohongshu/search`);
  await page.getByRole("heading", { name: "小红书搜索与采集" }).waitFor();
  for (const label of ["笔记搜索", "热榜搜索", "笔记详情", "博主信息", "博主笔记", "笔记评论", "评论回复"]) assert.equal(await page.getByRole("button", { name: label }).count(), 1, `缺少小红书能力：${label}`);

  await page.goto(`${baseUrl}/config`);
  assert.equal(await page.locator('input[type="url"][readonly]').inputValue(), "https://api.apify.com/v2", "Apify 官方地址应固定");
  assert.equal(await page.getByText("AI-Search-Platform", { exact: false }).count(), 0, "页面不应展示网关配置");

  await setTasks(page, [task("search_notes", "xiaohongshu")]);
  await page.goto(`${baseUrl}/xiaohongshu/results`);
  await page.getByText("厦门旅行", { exact: true }).waitFor();
  const noteTitleButton = page.getByRole("button", { name: "厦门旅行", exact: true });
  const beforeTitleOpen = stats.submissions;
  await noteTitleButton.click();
  await page.getByRole("dialog").waitFor();
  await page.waitForFunction(() => { const media = document.querySelector(".xhs-note-image"); return media && media.complete && media.naturalWidth > 0; });
  assert.equal(stats.submissions, beforeTitleOpen, "点击标题打开详情不应自动提交任务");
  assert.match(await page.locator(".xhs-note-image").getAttribute("src"), /^\/api\/client\/media\?url=/, "远程媒体应经本地受限代理加载");
  assert.equal(stats.localMediaRequests > 0, true, "远程媒体应经过本地代理");
  assert.equal(await page.getByRole("dialog").getByRole("link", { name: "打开原文" }).count(), 1, "弹窗只保留一个打开原文入口");
  assert.equal(await page.getByRole("dialog").getByText("赞 120", { exact: true }).count(), 1, "互动数据应显示在标题区");
  await page.evaluate(() => { window.__noteMedia = document.querySelector("#xhs-note-media").firstElementChild; });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__noteMedia === document.querySelector("#xhs-note-media").firstElementChild), true, "恢复历史评论时不应重建媒体节点");
  await page.getByRole("button", { name: "关闭" }).click();
  const beforeComments = stats.submissions;
  await page.locator(".count-link").click();
  await page.getByRole("dialog").waitFor();
  await page.locator(".xhs-comments-title strong").getByText("评论 8", { exact: true }).waitFor();
  assert.equal(stats.submissions, beforeComments, "打开评论弹窗不应自动提交任务");
  await page.locator("#comment-limit").fill("1");
  await page.locator(".collection-action").filter({ hasText: "评论" }).getByRole("button", { name: "采集", exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("ai-search-skill:recent-tasks:v1") || "[]").some((item) => item.operation === "get_note_comments"));
  await page.getByRole("dialog").getByText("很实用的攻略").waitFor();
  assert.equal(stats.submissions, beforeComments + 1, "评论采集只应提交一个任务");
  const commentRequest = stats.requests.find((item) => item.operation === "get_note_comments");
  assert.deepEqual(commentRequest.input, { note_id: "note-1", max_items: 1, auto_paginate: false }, "评论采集参数错误");
  const beforeReply = stats.submissions;
  await page.getByRole("dialog").getByRole("button", { name: "采集回复", exact: true }).click();
  await page.getByRole("dialog").getByText("谢谢分享", { exact: true }).waitFor();
  assert.equal(stats.submissions, beforeReply + 1, "评论回复只应提交一个任务");
  const replyRequest = stats.requests.find((item) => item.operation === "get_note_sub_comments");
  assert.deepEqual(replyRequest.input, { note_id: "note-1", comment_id: "comment-1", max_items: 20, auto_paginate: false }, "评论回复参数错误");
  assert.match(page.url(), /\/xiaohongshu\/results$/, "采集回复不应离开采集结果页");
  assert.equal(await page.getByRole("dialog").count(), 1, "采集回复后评论弹窗应保持打开");
  assert.equal(await page.locator(".modal-reply-list").count(), 1, "回复应嵌套在对应一级评论下");
  await page.screenshot({ path: path.join("outputs", "ui-comment-replies.png"), fullPage: true });
  await page.getByRole("button", { name: "关闭" }).click();

  await setTasks(page, [task("get_note_comments", "xiaohongshu")]);
  await page.goto(`${baseUrl}/xiaohongshu/results`);
  await page.getByText("很实用的攻略", { exact: true }).waitFor();
  await page.locator("[data-open-comment-replies]").click();
  const beforeBatchReplies = stats.submissions;
  await page.locator(".collection-action").filter({ hasText: "回复" }).getByRole("button", { name: "采集", exact: true }).click();
  await page.getByRole("dialog", { name: "批量采集评论回复" }).waitFor();
  assert.equal(stats.submissions, beforeBatchReplies, "批量回复确认前不得创建任务");
  await page.getByRole("dialog", { name: "批量采集评论回复" }).getByRole("button", { name: "确认采集" }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("ai-search-skill:recent-tasks:v1") || "[]").some((item) => item.operation === "get_note_sub_comments"));
  assert.equal(stats.submissions, beforeBatchReplies + 1, "批量回复应为候选评论创建任务");
  assert.equal(await page.locator(".collection-action").filter({ hasText: "回复" }).getByRole("button", { name: "采集", exact: true }).isDisabled(), true, "已采集回复不得重复进入批量任务");
  await page.getByRole("button", { name: "关闭" }).click();

  await setTasks(page, [task("search_notes", "xiaohongshu")]);
  await page.goto(`${baseUrl}/xiaohongshu/results`);
  await page.getByText("厦门旅行", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator(".xhs-note-image").evaluate((node) => node.dispatchEvent(new Event("error")));
  await page.getByText("图片暂时无法加载", { exact: true }).waitFor();
  const beforeDetailRefresh = stats.submissions;
  await page.getByRole("button", { name: "获取完整笔记详情", exact: true }).click();
  await page.getByRole("dialog", { name: "获取完整笔记详情" }).waitFor();
  assert.equal(stats.submissions, beforeDetailRefresh, "详情补采确认前不得创建任务");
  await page.getByRole("dialog", { name: "获取完整笔记详情" }).getByRole("button", { name: "确认获取" }).click();
  await page.waitForFunction(() => document.querySelector(".xhs-note-image")?.getAttribute("src")?.includes("refreshed"));
  assert.equal(stats.submissions, beforeDetailRefresh + 1, "确认后应提交一条详情补采任务");
  await page.getByRole("button", { name: "关闭" }).click();

  await setTasks(page, [task("get_note_comments", "xiaohongshu")]);
  await page.goto(`${baseUrl}/xiaohongshu/results`);
  await page.getByText("很实用的攻略", { exact: true }).waitFor();
  const beforeDirectEntry = stats.submissions;
  await page.locator("[data-open-comment-replies]").click();
  await page.getByRole("dialog").getByText("很实用的攻略", { exact: true }).waitFor();
  assert.equal(stats.submissions, beforeDirectEntry, "从评论任务打开回复弹窗不应自动提交任务");
  await page.getByRole("button", { name: "关闭" }).click();

  await setTasks(page, [task("douyin_search_videos", "douyin")]);
  await page.goto(`${baseUrl}/douyin/results`);
  await page.getByText("厦门咖啡探店").waitFor();
  assert.equal(await page.locator(".douyin-video-card").count(), 0, "抖音搜索结果不应渲染为卡片");
  assert.equal(await page.locator(".result-table [data-result-row]").count(), 2, "抖音搜索结果应按表格行渲染");
  await page.getByRole("button", { name: "厦门咖啡探店", exact: true }).click();
  const douyinDialog = page.getByRole("dialog");
  await douyinDialog.getByRole("heading", { name: "厦门咖啡探店", exact: true }).waitFor();
  await page.screenshot({ path: path.join("outputs", "ui-douyin-detail.png"), fullPage: true });
  const originLink = douyinDialog.getByRole("link", { name: "打开抖音原页" });
  assert.equal(await originLink.getAttribute("target"), "_blank");
  assert.equal(await originLink.getAttribute("rel"), "noopener");
  const detailReplies = douyinDialog.locator('input[name="includeReplies"]');
  assert.equal(await douyinDialog.locator('input[name="maxRepliesPerComment"]').isDisabled(), true);
  await detailReplies.check();
  assert.equal(await douyinDialog.locator('input[name="maxRepliesPerComment"]').isDisabled(), false);
  await douyinDialog.locator('input[name="maxCommentsPerAweme"]').fill("12");
  await douyinDialog.locator('input[name="maxRepliesPerComment"]').fill("7");
  const beforeDetailComment = stats.submissions;
  await douyinDialog.getByRole("button", { name: "采集评论", exact: true }).click();
  assert.equal(stats.submissions, beforeDetailComment + 1, "详情评论采集应只提交一次任务");
  await douyinDialog.getByText("拍得很好", { exact: true }).waitFor();
  assert.equal(await douyinDialog.getByText("评论 1", { exact: true }).count(), 1, "采集的评论应展示在详情弹层内");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-search-skill:recent-tasks:v1") || "[]").some((item) => item.operation === "douyin_fetch_comments" && item.hideFromHistory)), true, "详情内评论任务应保存隐藏索引以便刷新后恢复");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-search-skill:result-cache:v1") || "[]").some(([taskId]) => taskId === "task-douyin_fetch_comments")), true, "评论结果 JSON 应写入本地缓存");
  const detailCommentRequest = stats.requests.at(-1);
  assert.equal(detailCommentRequest.operation, "douyin_fetch_comments");
  assert.deepEqual(detailCommentRequest.input.awemeUrls, ["https://www.douyin.com/video/123"]);
  assert.equal(detailCommentRequest.input.maxCommentsPerAweme, 12);
  assert.equal(detailCommentRequest.input.includeReplies, true);
  assert.equal(detailCommentRequest.input.maxRepliesPerComment, 7);

  await page.reload();
  await page.getByRole("button", { name: "厦门咖啡探店", exact: true }).click();
  await page.getByRole("dialog").getByText("拍得很好", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭" }).click();

  await setTasks(page, [task("douyin_search_videos", "douyin")]);
  await page.goto(`${baseUrl}/douyin/results`);
  await page.getByText("厦门咖啡探店").waitFor();
  const checkboxes = page.locator('[data-video-url]');
  assert.equal(await checkboxes.nth(0).isEnabled(), true);
  assert.equal(await checkboxes.nth(1).isEnabled(), false, "零评论视频必须禁止选择");
  await checkboxes.nth(0).check();
  const beforeVideo = stats.submissions;
  await page.getByRole("button", { name: "带入评论采集" }).click();
  assert.match(await page.locator('textarea[name="awemeUrls"]').inputValue(), /douyin\.com\/video\/123/);
  assert.equal(stats.submissions, beforeVideo, "抖音评论预填不应自动提交任务");

  await page.goto(`${baseUrl}/weibo/search`);
  await page.getByRole("heading", { name: "微博搜索与采集" }).waitFor();
  for (const label of ["微博搜索", "微博热搜", "微博详情", "用户资料", "用户微博", "微博评论", "评论回复", "点赞用户", "转发列表"]) assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 1, `缺少微博能力：${label}`);
  assert.equal(await page.locator('input[name="max_items"]').inputValue(), "5", "微博搜索首次采集应默认 5 条");
  await page.getByText("首次采集必须留空", { exact: false }).waitFor();
  await page.locator('input[name="keyword"]').fill("人工智能");
  await page.locator('input[name="page_token"]').fill("1");
  const beforeInvalidPageToken = stats.submissions;
  await page.getByRole("button", { name: "开始采集", exact: true }).click();
  await page.getByText("分页令牌不能填写页码", { exact: false }).waitFor();
  assert.equal(stats.submissions, beforeInvalidPageToken, "误填页码时不得提交付费任务");
  await page.locator('input[name="page_token"]').fill("");
  await page.locator('input[name="keyword"]').fill("AI 搜索");
  await page.locator('input[name="max_items"]').fill("2");
  const beforeWeiboSearch = stats.submissions;
  await page.getByRole("button", { name: "开始采集", exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("ai-search-skill:recent-tasks:v1") || "[]").some((item) => item.operation === "weibo_search_posts"));
  assert.equal(stats.submissions, beforeWeiboSearch + 1, "微博搜索应提交一个任务");
  const weiboSearchRequest = stats.requests.find((item) => item.operation === "weibo_search_posts");
  assert.deepEqual(weiboSearchRequest.input, { keyword: "AI 搜索", max_items: 2, auto_paginate: true }, "微博搜索参数错误");

  await setTasks(page, [task("weibo_search_posts", "weibo")]);
  await page.goto(`${baseUrl}/weibo/results`);
  await page.getByText("AI 搜索正在改变内容发现方式", { exact: true }).waitFor();
  const beforeWeiboComments = stats.submissions;
  await page.getByRole("button", { name: "采集评论", exact: true }).click();
  assert.equal(await page.locator('input[name="post_id"]').inputValue(), "wb-post-1");
  assert.equal(stats.submissions, beforeWeiboComments, "微博评论带入不应自动提交任务");

  await setTasks(page, [task("weibo_get_post_comments", "weibo")]);
  await page.goto(`${baseUrl}/weibo/results`);
  await page.getByText("这个搜索体验不错", { exact: true }).waitFor();
  const beforeWeiboReplies = stats.submissions;
  await page.getByRole("button", { name: "采集回复", exact: true }).click();
  assert.equal(await page.locator('input[name="post_id"]').inputValue(), "wb-post-1");
  assert.equal(await page.locator('input[name="comment_id"]').inputValue(), "wb-comment-1");
  assert.equal(stats.submissions, beforeWeiboReplies, "微博回复带入不应自动提交任务");

  for (const operation of Object.keys(resultByOperation).filter((value) => value.startsWith("weibo_"))) {
    await setTasks(page, [task(operation, "weibo")]);
    await page.goto(`${baseUrl}/weibo/results`);
    await page.locator(".results-main tbody tr").first().waitFor();
    const rowCount = await page.locator(".results-main [data-result-row]").count();
    assert.equal(rowCount > 0, true, `${operation} 没有渲染业务结果：${await page.locator(".results-main").innerText()}`);
  }

  await setTasks(page, [task("search_notes", "xiaohongshu")]);
  await page.goto(`${baseUrl}/xiaohongshu/results`);
  await page.getByRole("button", { name: "下载 JSON" }).waitFor();
  const [jsonDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "下载 JSON" }).click()]);
  const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "下载 CSV" }).click()]);
  assert.match(jsonDownload.suggestedFilename(), /\.json$/);
  assert.match(csvDownload.suggestedFilename(), /\.csv$/);
  await page.close();
}

(async () => {
  const executablePath = process.env.PLAYWRIGHT_BROWSER_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({ headless: true, executablePath });
  const viewports = [
    { name: "1920x1080", width: 1920, height: 1080 }, { name: "1440x900", width: 1440, height: 900 },
    { name: "1366x768", width: 1366, height: 768 }, { name: "1280x720", width: 1280, height: 720 },
    { name: "1024x768", width: 1024, height: 768 }, { name: "390x844", width: 390, height: 844 },
  ];
  try {
    for (const viewport of viewports) await checkViewport(browser, viewport);
    await checkInteractions(browser);
    console.log("UI 检查通过：四个平台、设置与任务页、六种视口、微博九项能力及评论回复带入。\n");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
