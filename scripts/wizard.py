#!/usr/bin/env python3
"""AI 搜索 Skill 交互式启动向导。"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from platform_skill import PlatformError, list_actors, load_config, mask_key, save_local_config


ROOT_DIR = Path(__file__).resolve().parents[1]


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    return input(f"{prompt}{suffix}: ").strip() or default


def main() -> None:
    print("AI 搜索 Skill 上游连接向导")
    print("本地不需要登录，也不会直接连接 Apify。\n")
    config = load_config()
    print(f"当前上游：{config['platform_api_base']}")
    print(f"当前 Key：{mask_key(config['platform_api_key']) or '未配置'}")

    if ask("是否更新连接配置", "n").lower() in {"y", "yes"}:
        api_base = ask("上游平台地址", config["platform_api_base"])
        api_key = ask("平台 API Key（留空保留当前值）") or config["platform_api_key"]
        config = save_local_config(api_base, api_key)
        print("配置已保存到被 Git 忽略的 config.local.json。")

    try:
        actors = list_actors()["data"]
    except PlatformError as exc:
        print(f"连接验证失败（HTTP {exc.status}）：{exc.detail}")
        print("请先准备上游平台 API Key，再重新运行向导。")
        raise SystemExit(1) from exc

    print("\n当前 Key 可用能力：")
    for actor in actors:
        operations = "、".join(actor.get("operations") or [])
        print(f"- {actor.get('title') or actor.get('actor_id')}：{operations}")

    if ask("是否启动本地网页", "y").lower() not in {"n", "no"}:
        print("网页地址：http://127.0.0.1:8790")
        subprocess.run(
            [sys.executable, str(ROOT_DIR / "scripts" / "platform_skill.py"), "serve", "--open-browser"],
            check=False,
        )
    else:
        print(json.dumps({"actors": actors}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
