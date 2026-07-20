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
DEFAULT_PLATFORM_URL = "http://172.16.30.55:8787"
TERMINAL_STATUSES = {"settled", "refunded"}
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
    "pstatp.com",
}
MAX_MEDIA_BYTES = 15 * 1024 * 1024


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
    api_base = os.getenv("AI_SEARCH_PLATFORM_URL") or merged.get("platform_api_base") or DEFAULT_PLATFORM_URL
    api_key = os.getenv("AI_SEARCH_PLATFORM_API_KEY") or merged.get("platform_api_key") or ""
    return {
        "platform_api_base": validate_platform_url(str(api_base)),
        "platform_api_key": str(api_key).strip(),
        "poll_interval_seconds": _positive_int(merged.get("poll_interval_seconds"), 2, 1),
        "request_timeout_seconds": _positive_int(merged.get("request_timeout_seconds"), 60, 5),
    }


def save_local_config(platform_api_base: str, platform_api_key: str) -> dict[str, Any]:
    current = load_json(LOCAL_CONFIG_PATH)
    current.update(
        {
            "platform_api_base": validate_platform_url(platform_api_base),
            "platform_api_key": platform_api_key.strip(),
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


def call_platform(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> Any:
    config = load_config()
    api_key = config["platform_api_key"]
    if not api_key:
        raise PlatformError(HTTPStatus.UNAUTHORIZED, "尚未配置上游平台 API Key")
    if not path.startswith("/"):
        raise ValueError("上游 API 路径必须以 / 开头")

    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    attempts = 2 if method == "GET" or idempotency_key else 1
    for attempt in range(attempts):
        req = request.Request(
            f"{config['platform_api_base']}{path}", data=data, headers=headers, method=method
        )
        try:
            with request.urlopen(req, timeout=config["request_timeout_seconds"]) as response:
                return _decode_response(response.read(), response.status)
        except error.HTTPError as exc:
            raw = exc.read()
            try:
                payload = _decode_response(raw, exc.code)
                detail = payload.get("detail") if isinstance(payload, dict) else None
                detail = str(detail or f"上游请求失败：HTTP {exc.code}")
            except PlatformError:
                preview = raw.decode("utf-8", errors="replace").strip()[:160]
                detail = preview or f"上游请求失败：HTTP {exc.code}"
            raise PlatformError(exc.code, detail) from exc
        except (error.URLError, TimeoutError) as exc:
            if attempt + 1 < attempts:
                continue
            reason = getattr(exc, "reason", exc)
            raise PlatformError(HTTPStatus.BAD_GATEWAY, f"无法连接上游平台：{reason}") from exc
    raise PlatformError(HTTPStatus.BAD_GATEWAY, "无法连接上游平台")


def list_actors() -> dict[str, Any]:
    payload = call_platform("GET", "/v1/actors")
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise PlatformError(HTTPStatus.BAD_GATEWAY, "上游平台返回了无效的 Actor 列表")
    return payload


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
    payload = call_platform(
        "POST",
        "/v1/tasks",
        body={"actor_id": actor_id.strip(), "operation": operation.strip(), "input": task_input},
        idempotency_key=idempotency_key.strip(),
    )
    if not isinstance(payload, dict) or not payload.get("id"):
        raise PlatformError(HTTPStatus.BAD_GATEWAY, "上游平台未返回有效任务 ID")
    return payload


def _task_id(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 128 or any(char in value for char in "/?#"):
        raise ValueError("任务 ID 格式无效")
    return parse.quote(value, safe="")


def get_task(task_id: str) -> dict[str, Any]:
    payload = call_platform("GET", f"/v1/tasks/{_task_id(task_id)}")
    if not isinstance(payload, dict):
        raise PlatformError(HTTPStatus.BAD_GATEWAY, "上游平台返回了无效任务数据")
    return payload


def get_results(task_id: str) -> dict[str, Any]:
    payload = call_platform("GET", f"/v1/tasks/{_task_id(task_id)}/results")
    if not isinstance(payload, dict):
        raise PlatformError(HTTPStatus.BAD_GATEWAY, "上游平台返回了无效结果数据")
    return payload


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


def wait_for_task(task_id: str) -> dict[str, Any]:
    interval = load_config()["poll_interval_seconds"]
    while True:
        task = get_task(task_id)
        if task.get("status") in TERMINAL_STATUSES:
            return task
        time.sleep(interval)


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
            "/douyin/search", "/douyin/results",
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
                config = load_config()
                json_response(
                    self,
                    HTTPStatus.OK,
                    {
                        "platform_api_base": config["platform_api_base"],
                        "api_key_configured": bool(config["platform_api_key"]),
                        "api_key_masked": mask_key(config["platform_api_key"]),
                        "poll_interval_seconds": config["poll_interval_seconds"],
                    },
                )
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
                key = str(body.get("platform_api_key") or "")
                if not key and body.get("keep_existing_key"):
                    key = str(load_json(LOCAL_CONFIG_PATH).get("platform_api_key") or "")
                config = save_local_config(
                    str(body.get("platform_api_base") or DEFAULT_PLATFORM_URL), key
                )
                json_response(
                    self,
                    HTTPStatus.OK,
                    {
                        "platform_api_base": config["platform_api_base"],
                        "api_key_configured": bool(config["platform_api_key"]),
                        "api_key_masked": mask_key(config["platform_api_key"]),
                        "poll_interval_seconds": config["poll_interval_seconds"],
                    },
                )
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
    parser = argparse.ArgumentParser(description="AI 搜索中转平台客户端 Skill")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("show-config", help="显示上游连接状态（API Key 仅显示掩码）")
    sub.add_parser("list-actors", help="列出当前 API Key 可用的 Actor")
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
        print(json.dumps({"platform_api_base": config["platform_api_base"], "api_key": mask_key(config["platform_api_key"])}, ensure_ascii=False, indent=2))
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
