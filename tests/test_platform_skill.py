from __future__ import annotations

import json
import io
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib import request


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import platform_skill as skill  # noqa: E402


class MockPlatformHandler(BaseHTTPRequestHandler):
    requests: list[dict] = []
    tasks: dict[str, dict] = {}

    def log_message(self, format: str, *args: object) -> None:
        return

    def send_json(self, status: int, payload: object) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self) -> bool:
        return self.headers.get("Authorization") == "Bearer sf_test_key"

    def do_GET(self) -> None:
        if not self.authorized():
            self.send_json(401, {"detail": "API key is missing or invalid"})
            return
        if self.path == "/v1/actors":
            self.send_json(200, {"data": [{"actor_id": "xhs", "platform": "xiaohongshu", "operations": ["search_notes"]}]})
            return
        if self.path.endswith("/results"):
            task_id = self.path.split("/")[3]
            self.send_json(200, {"task": self.tasks[task_id], "items": [{"title": "结果"}]})
            return
        if self.path.startswith("/v1/tasks/"):
            task_id = self.path.split("/")[3]
            self.send_json(200, self.tasks[task_id])
            return
        if self.path == "/non-json":
            data = b"Internal Server Error"
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_json(404, {"detail": "not found"})

    def do_POST(self) -> None:
        if not self.authorized():
            self.send_json(401, {"detail": "invalid"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length))
        idempotency = self.headers.get("Idempotency-Key")
        existing = next((item for item in self.requests if item["idempotency"] == idempotency), None)
        if existing:
            task_id = existing["task_id"]
        else:
            task_id = f"task-{len(self.requests) + 1}"
            self.requests.append({"idempotency": idempotency, "task_id": task_id, "payload": payload})
            self.tasks[task_id] = {"id": task_id, "status": "settled", "operation": payload["operation"], "billed_points": 1.25}
        self.send_json(202, self.tasks[task_id])


class PlatformSkillTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.config_path = Path(self.temp.name) / "config.json"
        self.local_path = Path(self.temp.name) / "config.local.json"
        self.config_path.write_text(json.dumps({"platform_api_base": "http://base.test", "platform_api_key": "base-key"}), encoding="utf-8")
        self.path_patch = mock.patch.multiple(skill, CONFIG_PATH=self.config_path, LOCAL_CONFIG_PATH=self.local_path)
        self.path_patch.start()
        self.env_patch = mock.patch.dict(os.environ, {}, clear=False)
        self.env_patch.start()
        os.environ.pop("AI_SEARCH_PLATFORM_URL", None)
        os.environ.pop("AI_SEARCH_PLATFORM_API_KEY", None)

    def tearDown(self) -> None:
        self.env_patch.stop()
        self.path_patch.stop()
        self.temp.cleanup()

    def test_config_priority_environment_local_base(self) -> None:
        self.local_path.write_text(json.dumps({"platform_api_base": "http://local.test", "platform_api_key": "local-key"}), encoding="utf-8")
        self.assertEqual(skill.load_config()["platform_api_base"], "http://local.test")
        os.environ["AI_SEARCH_PLATFORM_URL"] = "https://env.test/"
        os.environ["AI_SEARCH_PLATFORM_API_KEY"] = "env-key"
        config = skill.load_config()
        self.assertEqual(config["platform_api_base"], "https://env.test")
        self.assertEqual(config["platform_api_key"], "env-key")

    def test_mask_key_never_returns_full_key(self) -> None:
        self.assertEqual(skill.mask_key(""), "")
        self.assertEqual(skill.mask_key("short"), "*****")
        self.assertEqual(skill.mask_key("sf_live_abcdefghijkl"), "sf_live_...ijkl")

    def test_url_validation(self) -> None:
        self.assertEqual(skill.validate_platform_url("https://example.com/"), "https://example.com")
        for value in ("file:///tmp/a", "example.com", "https://user:pass@example.com", "https://example.com?a=1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                skill.validate_platform_url(value)

    def test_missing_key_is_401(self) -> None:
        self.config_path.write_text(json.dumps({"platform_api_base": "http://base.test", "platform_api_key": ""}), encoding="utf-8")
        with self.assertRaises(skill.PlatformError) as context:
            skill.list_actors()
        self.assertEqual(context.exception.status, 401)

    def test_invalid_task_id_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            skill.get_task("../../secret")

    def test_media_proxy_only_allows_known_cdn_hosts(self) -> None:
        self.assertEqual(
            skill.validate_media_url("https://sns-webpic-qc.xhscdn.com/example.webp"),
            "https://sns-webpic-qc.xhscdn.com/example.webp",
        )
        for value in ("http://127.0.0.1/private", "file:///tmp/a", "https://example.com/a.jpg"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                skill.validate_media_url(value)

    def test_media_proxy_streams_image_with_safe_headers(self) -> None:
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def geturl(self) -> str:
                return "https://sns-webpic-qc.xhscdn.com/example.webp"

            @property
            def headers(self):
                return self

            def get_content_type(self) -> str:
                return "image/webp"

            def read(self, _: int) -> bytes:
                return b"image-bytes"

        class FakeHandler:
            def __init__(self) -> None:
                self.status = None
                self.headers = {}
                self.wfile = io.BytesIO()

            def send_response(self, status: int) -> None:
                self.status = status

            def send_header(self, name: str, value: str) -> None:
                self.headers[name] = value

            def end_headers(self) -> None:
                return None

        handler = FakeHandler()
        with mock.patch.object(skill.request, "urlopen", return_value=FakeResponse()):
            skill.proxy_media(handler, "https://sns-webpic-qc.xhscdn.com/example.webp")
        self.assertEqual(handler.status, 200)
        self.assertEqual(handler.headers["Content-Type"], "image/webp")
        self.assertEqual(handler.wfile.getvalue(), b"image-bytes")


class PlatformIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        MockPlatformHandler.requests = []
        MockPlatformHandler.tasks = {}
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), MockPlatformHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        config_path = Path(self.temp.name) / "config.json"
        local_path = Path(self.temp.name) / "config.local.json"
        config_path.write_text(json.dumps({"platform_api_base": self.base_url, "platform_api_key": "sf_test_key", "request_timeout_seconds": 5}), encoding="utf-8")
        self.patch = mock.patch.multiple(skill, CONFIG_PATH=config_path, LOCAL_CONFIG_PATH=local_path)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp.cleanup()

    def test_actor_task_status_and_results_flow(self) -> None:
        self.assertEqual(skill.list_actors()["data"][0]["actor_id"], "xhs")
        task = skill.submit_task("xhs", "search_notes", {"keyword": "厦门"}, "same-key-flow")
        self.assertEqual(skill.get_task(task["id"])["status"], "settled")
        self.assertEqual(skill.get_results(task["id"])["items"][0]["title"], "结果")

    def test_same_idempotency_key_does_not_duplicate_task(self) -> None:
        before = len(MockPlatformHandler.requests)
        first = skill.submit_task("xhs", "search_notes", {"keyword": "A"}, "same-key-idempotency")
        second = skill.submit_task("xhs", "search_notes", {"keyword": "A"}, "same-key-idempotency")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(MockPlatformHandler.requests), before + 1)

    def test_non_json_upstream_response_is_502(self) -> None:
        with self.assertRaises(skill.PlatformError) as context:
            skill.call_platform("GET", "/non-json")
        self.assertEqual(context.exception.status, 502)

    def test_http_error_detail_is_preserved(self) -> None:
        config = skill.load_config()
        config_path = skill.CONFIG_PATH
        config_path.write_text(json.dumps({**config, "platform_api_key": "wrong"}), encoding="utf-8")
        with self.assertRaises(skill.PlatformError) as context:
            skill.list_actors()
        self.assertEqual(context.exception.status, 401)
        self.assertIn("invalid", context.exception.detail)


class ClientProxyTests(unittest.TestCase):
    def test_all_spa_routes_return_frontend(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), skill.ClientHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for route in (
                "/xiaohongshu/search",
                "/xiaohongshu/results",
                "/douyin/search",
                "/douyin/results",
                "/tasks",
                "/config",
            ):
                with self.subTest(route=route):
                    with request.urlopen(f"http://127.0.0.1:{server.server_port}{route}") as response:
                        content = response.read().decode("utf-8")
                    self.assertIn("AI 搜索 Skill", content)
        finally:
            server.shutdown()
            server.server_close()

    def test_config_endpoint_returns_mask_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "config.json"
            local_path = Path(directory) / "config.local.json"
            config_path.write_text(json.dumps({"platform_api_base": "http://example.test", "platform_api_key": "sf_live_secret_value"}), encoding="utf-8")
            with mock.patch.multiple(skill, CONFIG_PATH=config_path, LOCAL_CONFIG_PATH=local_path):
                server = ThreadingHTTPServer(("127.0.0.1", 0), skill.ClientHandler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    with request.urlopen(f"http://127.0.0.1:{server.server_port}/api/client/config") as response:
                        payload = json.load(response)
                    self.assertTrue(payload["api_key_configured"])
                    self.assertNotIn("platform_api_key", payload)
                    self.assertNotEqual(payload["api_key_masked"], "sf_live_secret_value")
                finally:
                    server.shutdown()
                    server.server_close()


if __name__ == "__main__":
    unittest.main()
