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
        self.config_path.write_text(json.dumps({"apify_api_token": "base-apify"}), encoding="utf-8")
        self.path_patch = mock.patch.multiple(skill, CONFIG_PATH=self.config_path, LOCAL_CONFIG_PATH=self.local_path, RESULT_CACHE_DIR=Path(self.temp.name) / "task-results")
        self.path_patch.start()
        self.env_patch = mock.patch.dict(os.environ, {}, clear=False)
        self.env_patch.start()
        os.environ.pop("APIFY_API_TOKEN", None)
        os.environ.pop("APIFY_API_BASE", None)

    def tearDown(self) -> None:
        self.env_patch.stop()
        self.path_patch.stop()
        self.temp.cleanup()

    def test_config_priority_environment_local_base(self) -> None:
        self.local_path.write_text(json.dumps({"apify_api_token": "local-apify"}), encoding="utf-8")
        self.assertEqual(skill.load_config()["apify_api_token"], "local-apify")
        os.environ["APIFY_API_TOKEN"] = "env-apify"
        config = skill.load_config()
        self.assertEqual(config["apify_api_token"], "env-apify")

    def test_mask_key_never_returns_full_key(self) -> None:
        self.assertEqual(skill.mask_key(""), "")
        self.assertEqual(skill.mask_key("short"), "*****")
        self.assertEqual(skill.mask_key("gateway_abcdefghijkl"), "gateway_...ijkl")

    def test_url_validation(self) -> None:
        self.assertEqual(skill.validate_platform_url("https://example.com/"), "https://example.com")
        for value in ("file:///tmp/a", "example.com", "https://user:pass@example.com", "https://example.com?a=1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                skill.validate_platform_url(value)

    def test_missing_key_is_401(self) -> None:
        skill.CONFIG_PATH.write_text(json.dumps({"apify_api_token": ""}), encoding="utf-8")
        with self.assertRaises(skill.PlatformError) as context:
            skill.list_actors()
        self.assertEqual(context.exception.status, 401)

    def test_invalid_task_id_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            skill.get_task("../../secret")

    def test_official_actor_catalog_and_token_validation(self) -> None:
        with mock.patch.object(skill, "call_apify", return_value={"data": {"id": "user"}}) as call:
            payload = skill.list_apify_actors()
        self.assertEqual(call.call_args.args, ("GET", "/users/me"))
        self.assertEqual(payload["provider"], "apify")
        platforms = {item["platform"] for item in payload["data"]}
        self.assertEqual(platforms, {"xiaohongshu", "douyin", "kuaishou", "weibo"})

    def test_official_input_mapping_is_shared_by_business_operations(self) -> None:
        self.assertEqual(skill._apify_input("weibo_search_posts", {"keyword": "AI"})["operation"], "search_posts")
        self.assertEqual(skill._apify_input("kuaishou_get_video_comments", {"video_id": "1"})["operation"], "get_video_comments")
        self.assertEqual(skill._apify_input("get_note_comments", {"note_id": "n"})["operation"], "get_note_comments")
        douyin = skill._apify_input("douyin_search_videos", {"keywords": ["AI"]})
        self.assertFalse(douyin["shouldDownloadVideos"])
        self.assertTrue(douyin["shouldDownloadCovers"])
        self.assertEqual(douyin["keywords"], ["AI"])

    def test_apify_status_and_dataset_are_normalized(self) -> None:
        responses = [
            {"data": {"id": "RunOfficial123", "actId": "sUXx8U35FLlaweCWO", "status": "SUCCEEDED", "defaultDatasetId": "dataset123", "usageTotalUsd": 0.0123}},
            [{"title": "结果"}],
        ]
        with mock.patch.object(skill, "call_apify", side_effect=responses):
            payload = skill.get_results("RunOfficial123", "apify")
        self.assertEqual(payload["task"]["status"], "settled")
        self.assertEqual(payload["task"]["cost_usd"], 0.0123)
        self.assertEqual(payload["items"][0]["title"], "结果")
        cached = skill.RESULT_CACHE_DIR / "RunOfficial123.json"
        self.assertTrue(cached.exists())
        self.assertEqual(json.loads(cached.read_text(encoding="utf-8"))["result"]["items"][0]["title"], "结果")

    def test_submit_task_uses_official_actor_only(self) -> None:
        expected = {"id": "official-task", "provider": "apify"}
        with mock.patch.object(skill, "submit_apify_task", return_value=expected) as submit:
            result = skill.submit_task("sUXx8U35FLlaweCWO", "search_notes", {"keyword": "AI"}, "key")
        self.assertEqual(result, expected)
        submit.assert_called_once()

    def test_media_proxy_only_allows_known_cdn_hosts(self) -> None:
        self.assertEqual(
            skill.validate_media_url("https://sns-webpic-qc.xhscdn.com/example.webp"),
            "https://sns-webpic-qc.xhscdn.com/example.webp",
        )
        self.assertEqual(skill.validate_media_url("https://wx1.sinaimg.cn/example.jpg"), "https://wx1.sinaimg.cn/example.jpg")
        self.assertEqual(skill.validate_media_url("https://p3-sign.douyinpic.com/example.webp"), "https://p3-sign.douyinpic.com/example.webp")
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
        config_path.write_text(json.dumps({"apify_api_token": "official-test", "request_timeout_seconds": 5}), encoding="utf-8")
        self.patch = mock.patch.multiple(skill, CONFIG_PATH=config_path, LOCAL_CONFIG_PATH=local_path)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp.cleanup()

    def test_actor_catalog_uses_official_provider(self) -> None:
        with mock.patch.object(skill, "call_apify", return_value={"data": {"id": "user"}}):
            self.assertEqual(skill.list_actors()["provider"], "apify")

    def test_hyphenated_task_ids_remain_official(self) -> None:
        self.assertEqual(skill.infer_provider("run-with-hyphens"), "apify")

    def test_non_json_upstream_response_is_502(self) -> None:
        with self.assertRaises(skill.PlatformError) as context:
            skill._decode_response(b"Internal Server Error", 200)
        self.assertEqual(context.exception.status, 502)

    def test_missing_official_token_is_401(self) -> None:
        skill.CONFIG_PATH.write_text(json.dumps({"apify_api_token": ""}), encoding="utf-8")
        with self.assertRaises(skill.PlatformError) as context:
            skill.list_actors()
        self.assertEqual(context.exception.status, 401)


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
                "/kuaishou/search",
                "/kuaishou/results",
                "/weibo/search",
                "/weibo/results",
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
            config_path.write_text(json.dumps({"apify_api_token": "official-secret-value"}), encoding="utf-8")
            with mock.patch.multiple(skill, CONFIG_PATH=config_path, LOCAL_CONFIG_PATH=local_path):
                server = ThreadingHTTPServer(("127.0.0.1", 0), skill.ClientHandler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    with request.urlopen(f"http://127.0.0.1:{server.server_port}/api/client/config") as response:
                        payload = json.load(response)
                    self.assertTrue(payload["apify_token_configured"])
                    self.assertNotIn("apify_api_token", payload)
                    self.assertNotEqual(payload["apify_token_masked"], "official-secret-value")
                finally:
                    server.shutdown()
                    server.server_close()


if __name__ == "__main__":
    unittest.main()
