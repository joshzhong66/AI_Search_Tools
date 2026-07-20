const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.AI_SEARCH_TEST_URL || "http://127.0.0.1:8790";
const storageKey = "ai-search-skill:recent-tasks:v1";
const actors = [
  { actor_id: "xhs", platform: "xiaohongshu", title: "小红书采集器", operations: ["search_notes", "search_hot_list", "get_note_detail", "get_user_info", "list_user_notes", "get_note_comments", "get_note_sub_comments"] },
  { actor_id: "dy-search", platform: "douyin", title: "抖音搜索采集器", operations: ["douyin_search_videos"] },
  { actor_id: "dy-comments", platform: "douyin", title: "抖音评论采集器", operations: ["douyin_fetch_comments"] },
];
const resultByOperation = {
  search_notes: [{ note_id: "note-1", note_url: "https://www.xiaohongshu.com/explore/note-1", cover_image_url: "https://sns-webpic-qc.xhscdn.com/mock.png", note_type: "image", title: "厦门旅行", summary: "海边和咖啡", author_name: "测试作者", author_red_id: "xhs001", like_count: 120, collect_count: 31, comment_count: 8, publish_time: 1750000000 }],
  search_hot_list: [{ title: "今日热门内容", hot_value: 9988 }],
  get_note_detail: [{ note_id: "note-1", note_type: "image", title: "笔记详情", author_name: "测试作者", like_count: 120, comment_count: 8 }],
  get_user_info: [{ user_id: "user-1", name: "测试博主", red_id: "xhs001", follower_count: 3000, following_count: 20, posted_note_count: 88, received_like_count: 9000, received_collect_count: 2100, verified: true, ip_location: "福建" }],
  list_user_notes: [{ note_id: "note-2", note_type: "video", title: "博主笔记", author_name: "测试博主", like_count: 22, comment_count: 3 }],
  get_note_comments: [{ note_id: "note-1", comment_id: "comment-1", content: "很实用的攻略", author_name: "评论用户", like_count: 5, reply_count: 2, publish_time: 1750000000, ip_location: "上海" }],
  get_note_sub_comments: [{ note_id: "note-1", comment_id: "reply-1", parent_comment_id: "comment-1", content: "谢谢分享", author_name: "回复用户", like_count: 1, reply_count: 0 }],
  douyin_search_videos: [
    { id: "123", url: "https://www.douyin.com/video/123", text: "厦门咖啡探店", authorMeta: { name: "抖音作者" }, statistics: { playCount: 12000, diggCount: 800, commentCount: 23, collectCount: 90, shareCount: 18 }, createDate: "2026-07-20" },
    { id: "456", url: "https://www.douyin.com/video/456", text: "零评论视频", authorMeta: { name: "另一作者" }, statistics: { playCount: 20, diggCount: 2, commentCount: 0, collectCount: 0, shareCount: 0 } },
  ],
  douyin_fetch_comments: [{ awemeId: "123", text: "拍得很好", likeCount: 12, replyCount: 1, region: "福建", createDate: "2026-07-20", user: { nickname: "抖音用户" } }],
};

function operationFromTaskPath(requestPath) {
  const id = requestPath.split("/")[4] || "";
  return id.startsWith("task-") ? id.slice(5).replace(/\/results$/, "") : "search_notes";
}

async function mockClientApi(page) {
  const stats = { submissions: 0, requests: [] };
  await page.route("**/api/client/**", async (route) => {
    const requestPath = new URL(route.request().url()).pathname;
    if (requestPath === "/api/client/media") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8mpCwAAAABJRU5ErkJggg==", "base64") });
    if (requestPath === "/api/client/config") return route.fulfill({ json: { platform_api_base: "http://platform.test", api_key_configured: true, api_key_masked: "sf_live_...test", poll_interval_seconds: 2 } });
    if (requestPath === "/api/client/actors") return route.fulfill({ json: { data: actors } });
    if (requestPath === "/api/client/tasks" && route.request().method() === "POST") {
      stats.submissions += 1;
      const body = route.request().postDataJSON();
      stats.requests.push(body);
      return route.fulfill({ status: 202, json: { id: `task-${body.operation}`, operation: body.operation, status: "running", item_count: 0 } });
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
  await setTasks(page, [task("search_notes", "xiaohongshu"), task("douyin_search_videos", "douyin")]);
  for (const route of ["/config", "/xiaohongshu/search", "/xiaohongshu/results", "/douyin/search", "/douyin/results", "/tasks"]) await assertLayout(page, viewport, route);
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
  }
  await page.screenshot({ path: path.join("outputs", `ui-${viewport.name}.png`), fullPage: true });
  await page.close();
}

async function checkInteractions(browser) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const stats = await mockClientApi(page);
  await page.goto(`${baseUrl}/xiaohongshu/search`);
  await page.getByRole("heading", { name: "小红书搜索与采集" }).waitFor();
  for (const label of ["笔记搜索", "热榜搜索", "笔记详情", "博主信息", "博主笔记", "笔记评论", "评论回复"]) assert.equal(await page.getByRole("button", { name: label }).count(), 1, `缺少小红书能力：${label}`);

  await setTasks(page, [task("search_notes", "xiaohongshu")]);
  await page.goto(`${baseUrl}/xiaohongshu/results`);
  await page.getByText("厦门旅行", { exact: true }).waitFor();
  const noteTitleButton = page.getByRole("button", { name: "厦门旅行", exact: true });
  const beforeTitleOpen = stats.submissions;
  await noteTitleButton.click();
  await page.getByRole("dialog").waitFor();
  await page.waitForFunction(() => { const media = document.querySelector(".xhs-note-image"); return media && media.complete && media.naturalWidth > 0; });
  assert.equal(stats.submissions, beforeTitleOpen, "点击标题打开详情不应自动提交任务");
  await page.getByRole("button", { name: "关闭" }).click();
  const beforeComments = stats.submissions;
  await page.locator(".count-link").click();
  await page.getByRole("dialog").waitFor();
  await page.getByText("共 8 条评论").waitFor();
  assert.equal(stats.submissions, beforeComments, "打开评论弹窗不应自动提交任务");
  await page.locator("#comment-limit").fill("1");
  await page.getByRole("button", { name: "采集评论", exact: true }).click();
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
  const beforeDirectEntry = stats.submissions;
  await page.locator("[data-open-comment-replies]").click();
  await page.getByRole("dialog").getByText("很实用的攻略", { exact: true }).waitFor();
  assert.equal(stats.submissions, beforeDirectEntry, "从评论任务打开回复弹窗不应自动提交任务");
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
    console.log("UI 检查通过：六个页面、六种视口、标题/评论弹窗、媒体代理、回复嵌套和下载。\n");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
