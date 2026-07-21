from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib import error, parse, request


ROOT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / "frontend"
CONFIG_PATH = ROOT_DIR / "config.json"
LOCAL_CONFIG_PATH = ROOT_DIR / "config.local.json"
RESULT_CACHE_DIR = ROOT_DIR / "outputs" / "task-results"
DEFAULT_APIFY_API_BASE = "https://api.apify.com/v2"
TERMINAL_STATUSES = {"settled", "failed", "refunded"}
APIFY_TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
MEDIA_HOSTS = {
    "xhscdn.com",
    "xiaohongshu.com",
    "xiaohongshu.net",
    "douyinpic.com",
    "douyinvod.com",
    "byteimg.com",
    "bytecdn.cn",
    "ibytedtos.com",
    "kuaishou.com",
    "kwai.com",
    "kwimgs.com",
    "gifshow.com",
    "pstatp.com",
    "sinaimg.cn",
    "sinaimg.com",
    "weibocdn.com",
    "weibo.com",
}
MAX_MEDIA_BYTES = 15 * 1024 * 1024

XIAOHONGSHU_OPERATIONS = (
    "search_notes", "search_hot_list", "get_note_detail", "get_user_info",
    "list_user_notes", "get_note_comments", "get_note_sub_comments",
)
DOUYIN_SEARCH_OPERATIONS = ("douyin_search_videos",)
DOUYIN_COMMENT_OPERATIONS = ("douyin_fetch_comments",)
KUAISHOU_OPERATIONS = (
    "kuaishou_search_videos", "kuaishou_get_video_detail", "kuaishou_get_video_comments",
    "kuaishou_get_comment_replies", "kuaishou_get_user_info", "kuaishou_list_user_videos",
)
WEIBO_OPERATIONS = (
    "weibo_search_posts", "weibo_search_hot_list", "weibo_get_post_detail",
    "weibo_get_user_info", "weibo_list_user_posts", "weibo_get_post_comments",
    "weibo_get_post_comment_replies", "weibo_list_post_likers", "weibo_list_post_reposts",
)
APIFY_ACTORS = (
    {"actor_id": "sUXx8U35FLlaweCWO", "platform": "xiaohongshu", "title": "SocialDataX 小红书数据 API", "operations": list(XIAOHONGSHU_OPERATIONS)},
    {"actor_id": "3TJaaOJDU1AMiOoJM", "platform": "douyin", "title": "抖音视频搜索", "operations": list(DOUYIN_SEARCH_OPERATIONS)},
    {"actor_id": "KmxOUB02ZqH7jxj07", "platform": "douyin", "title": "抖音评论采集", "operations": list(DOUYIN_COMMENT_OPERATIONS)},
    {"actor_id": "W0cFcwuH7hhObmnwT", "platform": "kuaishou", "title": "SocialDataX 快手数据 API", "operations": list(KUAISHOU_OPERATIONS)},
    {"actor_id": "2LERepIog9VIQCmN6", "platform": "weibo", "title": "SocialDataX 微博数据 API", "operations": list(WEIBO_OPERATIONS)},
)
APIFY_OPERATIONS = {operation: actor for actor in APIFY_ACTORS for operation in actor["operations"]}
_APIFY_TASK_CONTEXT: dict[str, dict[str, str]] = {}


class PlatformError(RuntimeError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = int(status)
        self.detail = detail


def configure_stdio() -> None:
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"无法读取配置文件 {path.name}：{exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"配置文件 {path.name} 必须是 JSON 对象")
    return payload


def validate_platform_url(value: str) -> str:
    normalized = value.strip().rstrip("/")
    parsed = parse.urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("上游地址必须是有效的 http:// 或 https:// 地址")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("上游地址不能包含账号、密码、查询参数或片段")
    return normalized


def _positive_int(value: Any, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(value if value is not None else default))
    except (TypeError, ValueError):
        return default


def load_config() -> dict[str, Any]:
    base = load_json(CONFIG_PATH)
    local = load_json(LOCAL_CONFIG_PATH)
    merged = {**base, **local}
    apify_api_base = os.getenv("APIFY_API_BASE") or merged.get("apify_api_base") or DEFAULT_APIFY_API_BASE
    apify_api_token = os.getenv("APIFY_API_TOKEN") or merged.get("apify_api_token") or ""
    return {
        "apify_api_base": validate_platform_url(str(apify_api_base)),
        "apify_api_token": str(apify_api_token).strip(),
        "poll_interval_seconds": _positive_int(merged.get("poll_interval_seconds"), 2, 1),
        "request_timeout_seconds": _positive_int(merged.get("request_timeout_seconds"), 60, 5),
    }


def save_local_config(apify_api_token: str) -> dict[str, Any]:
    current = load_json(LOCAL_CONFIG_PATH)
    for key in ("gateway_fallback_enabled", "platform_api_base", "platform_api_key"):
        current.pop(key, None)
    current.update(
        {
            "apify_api_base": DEFAULT_APIFY_API_BASE,
            "apify_api_token": apify_api_token.strip(),
        }
    )
    LOCAL_CONFIG_PATH.write_text(
        json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return load_config()


def mask_key(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 12:
        return "*" * len(value)
    return f"{value[:8]}...{value[-4:]}"


def _decode_response(raw: bytes, status: int) -> Any:
    if not raw:
        return None
    text = raw.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        preview = text.strip()[:160]
        raise PlatformError(
            HTTPStatus.BAD_GATEWAY,
            f"上游返回了非 JSON 响应（HTTP {status}）{f'：{preview}' if preview else ''}",
        ) from exc


def _call_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    body: dict[str, Any] | None = None,
    timeout: int,
    retry_get: bool = True,
) -> Any:
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    attempts = 2 if method == "GET" and retry_get else 1
    for attempt in range(attempts):
        req = request.Request(url, data=data, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=timeout) as response:
                return _decode_response(response.read(), response.status)
        except error.HTTPError as exc:
            raw = exc.read()
            try:
                payload = _decode_response(raw, exc.code)
                detail = payload.get("detail") if isinstance(payload, dict) else None
                if not detail and isinstance(payload, dict) and isinstance(payload.get("error"), dict):
                    detail = payload["error"].get("message")
                detail = str(detail or f"上游请求失败：HTTP {exc.code}")
            except PlatformError:
                preview = raw.decode("utf-8", errors="replace").strip()[:160]
                detail = preview or f"上游请求失败：HTTP {exc.code}"
            raise PlatformError(exc.code, detail) from exc
        except (error.URLError, TimeoutError) as exc:
            if attempt + 1 < attempts:
                continue
            reason = getattr(exc, "reason", exc)
            raise PlatformError(HTTPStatus.BAD_GATEWAY, f"无法连接上游：{reason}") from exc
    raise PlatformError(HTTPStatus.BAD_GATEWAY, "无法连接上游")


def call_apify(method: str, path: str, *, body: dict[str, Any] | None = None) -> Any:
    config = load_config()
    token = config["apify_api_token"]
    if not token:
        raise PlatformError(HTTPStatus.UNAUTHORIZED, "尚未配置 Apify 官方 API Token")
    if not path.startswith("/"):
        raise ValueError("Apify API 路径必须以 / 开头")
    return _call_json(
        method,
        f"{config['apify_api_base']}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        body=body,
        timeout=config["request_timeout_seconds"],
        retry_get=True,
    )


def list_apify_actors() -> dict[str, Any]:
    payload = call_apify("GET", "/users/me")
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise PlatformError(HTTPStatus.BAD_GATEWAY, "Apify 官方返回了无效的账户信息")
    return {"data": [dict(actor) for actor in APIFY_ACTORS], "provider": "apify"}


def list_actors() -> dict[str, Any]:
    return list_apify_actors()


def _apify_input(operation: str, task_input: dict[str, Any]) -> dict[str, Any]:
    if operation not in APIFY_OPERATIONS:
        raise ValueError(f"Apify 官方模式不支持 operation：{operation}")
    payload = {key: value for key, value in task_input.items() if value not in (None, "")}
    if operation in XIAOHONGSHU_OPERATIONS:
        return {"operation": operation, **payload}
    if operation == "douyin_search_videos":
        return {
            "keywords": payload.get("keywords") or [],
            "maxResultsPerQuery": payload.get("maxResultsPerQuery", 5),
            "sort": payload.get("sort", "general"),
            "publishTime": payload.get("publishTime", "unlimited"),
            "duration": payload.get("duration", "unlimited"),
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": True,
            "shouldDownloadSlideshowImages": False,
        }
    if operation == "douyin_fetch_comments":
        output = {
            "awemeUrls": payload.get("awemeUrls") or [],
            "maxCommentsPerAweme": payload.get("maxCommentsPerAweme", 5),
            "includeReplies": bool(payload.get("includeReplies", False)),
        }
        if output["includeReplies"]:
            output["maxRepliesPerComment"] = payload.get("maxRepliesPerComment", 20)
        return output
    prefix = "weibo_" if operation in WEIBO_OPERATIONS else "kuaishou_"
    return {"operation": operation.removeprefix(prefix), **payload}


def _apify_status(value: Any) -> str:
    status = str(value or "").upper()
    if status in {"READY", "RUNNING"}:
        return "running"
    if status == "SUCCEEDED":
        return "settled"
    if status in {"FAILED", "ABORTED", "TIMED-OUT"}:
        return "failed"
    return "running"


def _apify_task(payload: Any, context: dict[str, str] | None = None) -> dict[str, Any]:
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or not data.get("id"):
        raise PlatformError(HTTPStatus.BAD_GATEWAY, "Apify 官方未返回有效 Run ID")
    run_id = str(data["id"])
    saved = {**_APIFY_TASK_CONTEXT.get(run_id, {}), **(context or {})}
    if saved:
        _APIFY_TASK_CONTEXT[run_id] = saved
    usage = data.get("usageTotalUsd")
    if usage is None and isinstance(data.get("stats"), dict):
        usage = data["stats"].get("computeUnits")
    output = {
        "id": run_id,
        "provider": "apify",
        "status": _apify_status(data.get("status")),
        "actor_id": str(data.get("actId") or saved.get("actor_id") or ""),
        "operation": saved.get("operation") or "",
        "dataset_id": str(data.get("defaultDatasetId") or ""),
        "cost_usd": usage,
        "started_at": data.get("startedAt"),
        "finished_at": data.get("finishedAt"),
    }
    status_message = data.get("statusMessage")
    if output["status"] == "failed" and status_message:
        output["error_message"] = str(status_message)
    return output


def submit_apify_task(actor_id: str, operation: str, task_input: dict[str, Any]) -> dict[str, Any]:
    actor = APIFY_OPERATIONS.get(operation)
    if not actor or actor_id != actor["actor_id"]:
        raise ValueError("operation 与 Apify Actor 不匹配")
    payload = call_apify(
        "POST",
        f"/acts/{parse.quote(actor_id, safe='')}/runs",
        body=_apify_input(operation, task_input),
    )
    return _apify_task(payload, {"actor_id": actor_id, "operation": operation})


def submit_task(
    actor_id: str,
    operation: str,
    task_input: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    if not actor_id.strip() or not operation.strip():
        raise ValueError("actor_id 和 operation 不能为空")
    if not idempotency_key.strip() or len(idempotency_key) > 128:
        raise ValueError("idempotency_key 不能为空且不能超过 128 个字符")
    return submit_apify_task(actor_id.strip(), operation.strip(), task_input)


def _task_id(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 128 or any(char in value for char in "/?#"):
        raise ValueError("任务 ID 格式无效")
    return parse.quote(value, safe="")


def save_result_cache(task_id: str, payload: dict[str, Any]) -> None:
    filename = f"{_task_id(task_id)}.json"
    target = RESULT_CACHE_DIR / filename
    temporary = target.with_suffix(".tmp")
    try:
        RESULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        temporary.write_text(
            json.dumps(
                {"task_id": task_id, "saved_at": int(time.time()), "result": payload},
                ensure_ascii=False,
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )
        temporary.replace(target)
    except OSError as exc:
        raise PlatformError(HTTPStatus.INTERNAL_SERVER_ERROR, f"无法保存本地结果 JSON：{exc}") from exc


def infer_provider(task_id: str, provider: str | None = None) -> str:
    return "apify"


def get_task(task_id: str, provider: str | None = None) -> dict[str, Any]:
    return _apify_task(call_apify("GET", f"/actor-runs/{_task_id(task_id)}"))


def get_results(task_id: str, provider: str | None = None) -> dict[str, Any]:
    task = get_task(task_id, "apify")
    if task["status"] != "settled":
        raise PlatformError(HTTPStatus.CONFLICT, "Apify Run 尚未成功完成，暂时不能读取结果")
    dataset_id = task.get("dataset_id")
    if not dataset_id:
        raise PlatformError(HTTPStatus.BAD_GATEWAY, "Apify Run 未返回默认 Dataset ID")
    items = call_apify("GET", f"/datasets/{_task_id(str(dataset_id))}/items?clean=true&format=json")
    if not isinstance(items, list):
        raise PlatformError(HTTPStatus.BAD_GATEWAY, "Apify Dataset 返回了无效结果")
    task["item_count"] = len(items)
    output = {"task": task, "items": items, "provider": "apify"}
    save_result_cache(task_id, output)
    return output


def validate_media_url(value: str) -> str:
    if not value or len(value) > 4096:
        raise ValueError("媒体地址为空或过长")
    parsed = parse.urlparse(value)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password:
        raise ValueError("媒体地址格式无效")
    if not any(hostname == domain or hostname.endswith(f".{domain}") for domain in MEDIA_HOSTS):
        raise ValueError("该媒体域名不允许通过本地代理访问")
    return value


def proxy_media(handler: SimpleHTTPRequestHandler, value: str) -> None:
    media_url = validate_media_url(value)
    req = request.Request(
        media_url,
        headers={
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Referer": "https://www.xiaohongshu.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        },
    )
    try:
        with request.urlopen(req, timeout=20) as response:
            validate_media_url(response.geturl())
            content_type = str(response.headers.get_content_type() or "")
            if not content_type.startswith("image/"):
                raise PlatformError(HTTPStatus.BAD_GATEWAY, "远端地址没有返回图片")
            data = response.read(MAX_MEDIA_BYTES + 1)
    except error.HTTPError as exc:
        raise PlatformError(HTTPStatus.BAD_GATEWAY, f"图片源返回 HTTP {exc.code}") from exc
    except (error.URLError, TimeoutError) as exc:
        raise PlatformError(HTTPStatus.BAD_GATEWAY, f"无法读取远端图片：{getattr(exc, 'reason', exc)}") from exc
    if len(data) > MAX_MEDIA_BYTES:
        raise PlatformError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "图片超过 15 MB 限制")
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "public, max-age=3600")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.end_headers()
    handler.wfile.write(data)


def wait_for_task(task_id: str, provider: str | None = None) -> dict[str, Any]:
    interval = load_config()["poll_interval_seconds"]
    while True:
        task = get_task(task_id, provider)
        if task.get("status") in TERMINAL_STATUSES:
            return task
        time.sleep(interval)


def public_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or load_config()
    apify_ready = bool(config["apify_api_token"])
    return {
        "apify_api_base": config["apify_api_base"],
        "apify_token_configured": apify_ready,
        "apify_token_masked": mask_key(config["apify_api_token"]),
        "api_key_configured": apify_ready,
        "api_key_masked": mask_key(config["apify_api_token"]),
        "poll_interval_seconds": config["poll_interval_seconds"],
    }


def json_response(handler: SimpleHTTPRequestHandler, status: int, payload: Any) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(int(status))
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.end_headers()
    handler.wfile.write(data)


def parse_body(handler: SimpleHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or 0)
    if length > 1_000_000:
        raise ValueError("请求体不能超过 1 MB")
    raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("请求体必须是 JSON 对象")
    return payload


class ClientHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        parsed = parse.urlparse(self.path)
        if parsed.path == "/api/client/media":
            try:
                media_url = parse.parse_qs(parsed.query).get("url", [""])[0]
                proxy_media(self, media_url)
            except PlatformError as exc:
                json_response(self, exc.status, {"detail": exc.detail})
            except ValueError as exc:
                json_response(self, HTTPStatus.BAD_REQUEST, {"detail": str(exc)})
            except Exception:
                json_response(self, HTTPStatus.BAD_GATEWAY, {"detail": "本地媒体代理读取失败"})
            return
        if parsed.path.startswith("/api/client/"):
            self.handle_api_get(parsed.path)
            return
        if parsed.path in {
            "/", "/config", "/tasks", "/xiaohongshu", "/douyin",
            "/xiaohongshu/search", "/xiaohongshu/results",
            "/douyin/search", "/douyin/results", "/kuaishou/search", "/kuaishou/results",
            "/weibo", "/weibo/search", "/weibo/results",
        }:
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        path = parse.urlparse(self.path).path
        if path.startswith("/api/client/"):
            self.handle_api_post(path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_api_get(self, path: str) -> None:
        try:
            if path == "/api/client/config":
                json_response(self, HTTPStatus.OK, public_config())
                return
            if path == "/api/client/actors":
                json_response(self, HTTPStatus.OK, list_actors())
                return
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[:3] == ["api", "client", "tasks"]:
                json_response(self, HTTPStatus.OK, get_task(parts[3]))
                return
            if len(parts) == 5 and parts[:3] == ["api", "client", "tasks"] and parts[4] == "results":
                json_response(self, HTTPStatus.OK, get_results(parts[3]))
                return
            json_response(self, HTTPStatus.NOT_FOUND, {"detail": "接口不存在"})
        except PlatformError as exc:
            json_response(self, exc.status, {"detail": exc.detail})
        except ValueError as exc:
            json_response(self, HTTPStatus.BAD_REQUEST, {"detail": str(exc)})
        except Exception:
            json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": "本地代理处理请求失败"})

    def handle_api_post(self, path: str) -> None:
        try:
            body = parse_body(self)
            if path == "/api/client/config":
                current = load_json(LOCAL_CONFIG_PATH)
                apify_token = str(body.get("apify_api_token") or "")
                if not apify_token and body.get("keep_existing_apify_token"):
                    apify_token = str(current.get("apify_api_token") or "")
                config = save_local_config(apify_token)
                json_response(self, HTTPStatus.OK, public_config(config))
                return
            if path == "/api/client/tasks":
                task = submit_task(
                    str(body.get("actor_id") or ""),
                    str(body.get("operation") or ""),
                    body.get("input") if isinstance(body.get("input"), dict) else {},
                    str(body.get("idempotency_key") or secrets.token_hex(16)),
                )
                json_response(self, HTTPStatus.ACCEPTED, task)
                return
            json_response(self, HTTPStatus.NOT_FOUND, {"detail": "接口不存在"})
        except PlatformError as exc:
            json_response(self, exc.status, {"detail": exc.detail})
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            json_response(self, HTTPStatus.BAD_REQUEST, {"detail": str(exc)})
        except Exception:
            json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": "本地代理处理请求失败"})


def cmd_serve(args: argparse.Namespace) -> None:
    if args.host not in LOCAL_HOSTS:
        raise SystemExit("为保护 API Key，本地代理只允许绑定 127.0.0.1、localhost 或 ::1")
    server = ThreadingHTTPServer((args.host, args.port), ClientHandler)
    url = f"http://{args.host}:{args.port}"
    print(f"AI Search Skill 前端已启动：{url}")
    if args.open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止本地服务。")
    finally:
        server.server_close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apify 官方优先、AI-Search-Platform 网关备份的 AI 搜索 Skill")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("show-config", help="显示官方与网关备份状态（凭据仅显示掩码）")
    sub.add_parser("list-actors", help="列出当前凭据可用的 Actor")
    run = sub.add_parser("run", help="提交上游任务")
    run.add_argument("--actor-id", required=True)
    run.add_argument("--operation", required=True)
    run.add_argument("--input-file", required=True, help="任务 input JSON 文件")
    run.add_argument("--idempotency-key", help="重试时复用同一个幂等键")
    run.add_argument("--wait", action="store_true")
    status = sub.add_parser("status", help="查询任务状态")
    status.add_argument("task_id")
    results = sub.add_parser("results", help="读取任务结果")
    results.add_argument("task_id")
    serve = sub.add_parser("serve", help="启动无登录本地前端")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8790)
    serve.add_argument("--open-browser", action="store_true")
    return parser


def main() -> None:
    configure_stdio()
    args = build_parser().parse_args()
    if args.command == "show-config":
        config = load_config()
        print(json.dumps({"provider": "apify", "api_base": config["apify_api_base"], "token": mask_key(config["apify_api_token"])}, ensure_ascii=False, indent=2))
    elif args.command == "list-actors":
        print(json.dumps(list_actors(), ensure_ascii=False, indent=2))
    elif args.command == "run":
        task_input = load_json(Path(args.input_file))
        task = submit_task(args.actor_id, args.operation, task_input, args.idempotency_key or secrets.token_hex(16))
        if args.wait:
            task = wait_for_task(str(task["id"]))
        print(json.dumps(task, ensure_ascii=False, indent=2))
    elif args.command == "status":
        print(json.dumps(get_task(args.task_id), ensure_ascii=False, indent=2))
    elif args.command == "results":
        print(json.dumps(get_results(args.task_id), ensure_ascii=False, indent=2))
    elif args.command == "serve":
        cmd_serve(args)


if __name__ == "__main__":
    main()
