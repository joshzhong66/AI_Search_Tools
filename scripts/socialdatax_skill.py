#!/usr/bin/env python3
"""旧入口兼容层；实际请求统一交给 platform_skill.py。"""

from __future__ import annotations

import sys

from platform_skill import main


if __name__ == "__main__":
    print(
        "提示：socialdatax_skill.py 已停止直连 Apify，现由 platform_skill.py 通过上游平台执行。",
        file=sys.stderr,
    )
    main()
