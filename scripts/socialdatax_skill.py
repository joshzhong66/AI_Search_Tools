#!/usr/bin/env python3
"""旧入口兼容层；实际请求统一交给 platform_skill.py。"""

from __future__ import annotations

import sys

from platform_skill import main


if __name__ == "__main__":
    print(
        "提示：请改用 platform_skill.py；仅支持 Apify 官方 API。",
        file=sys.stderr,
    )
    main()
