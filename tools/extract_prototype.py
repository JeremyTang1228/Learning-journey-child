#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Claude 原型 HTML 中提取：可见文案结构 + CSS 设计变量，便于工程化对齐。"""
import re, sys, os

SRC = "/Users/jeremy/Desktop/小学知识成长地图应用/03_UI_Prototype"


def strip_html(path):
    raw = open(path, encoding="utf-8").read()
    # 去掉 style / script
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", raw, flags=re.S | re.I)
    # 块级标签 -> 换行
    body = re.sub(r"<(br|/tr|/div|/p|/h[1-6]|/li|/button|/section|/header|/nav|/span)\s*/?>",
                  "\n", body, flags=re.I)
    body = re.sub(r"<[^>]+>", " ", body)
    body = re.sub(r"&nbsp;?", " ", body)
    body = re.sub(r"[ \t]+", " ", body)
    lines = [l.strip() for l in body.split("\n")]
    out, prev = [], None
    for l in lines:
        if l and l != prev:
            out.append(l)
            prev = l
    return raw, out


target = sys.argv[1] if len(sys.argv) > 1 else None
files = [target] if target else sorted(f for f in os.listdir(SRC) if f.endswith(".html"))

for f in files:
    raw, lines = strip_html(os.path.join(SRC, f))
    print("\n" + "#" * 78)
    print(f"# FILE: {f}   ({len(raw)} bytes)")
    print("#" * 78)
    # CSS 变量
    cssvars = re.findall(r"(--[\w-]+\s*:\s*[^;]+;)", raw)
    if cssvars:
        seen = []
        for v in cssvars:
            if v not in seen:
                seen.append(v)
        print(f"[CSS 变量 共{len(seen)}]")
        for v in seen[:60]:
            print("   ", v.strip())
        print()
    print(f"[可见文案/结构]")
    for l in lines:
        print("  ", l)
