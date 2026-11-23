"""Считает по реальным чатам: кто именно импортировал вложения и какие типы реально лежат в хранилище."""
import json, collections
from pathlib import Path
import sys

CHATS = Path(r"G:\Strawberry\chats")
by_source = collections.Counter()
by_source_status = collections.Counter()
nonimage_available = collections.Counter()
adapter_of_chat_with_atts = collections.Counter()
out = []

for p in CHATS.glob("*.json"):
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        continue
    adapters = set()
    rep = doc.get("parse_report") or {}
    if isinstance(rep, dict) and rep.get("adapter"):
        adapters.add(str(rep["adapter"]))
    has = False
    for m in doc.get("messages") or []:
        if not isinstance(m, dict):
            continue
        for b in ("images", "files"):
            for a in m.get(b) or []:
                if not isinstance(a, dict):
                    continue
                has = True
                src = str(a.get("source"))
                by_source[src] += 1
                by_source_status[(src, str(a.get("status")))] += 1
                if a.get("status") == "available" and a.get("url"):
                    ext = "." + a["url"].rsplit(".", 1)[-1].lower()
                    mime = str(a.get("mime") or "")
                    if not mime.startswith("image/"):
                        nonimage_available[ext] += 1
    if has:
        for ad in (adapters or {"<нет parse_report.adapter>"}):
            adapter_of_chat_with_atts[ad] += 1

print("=== вложения по источнику (кто импортировал) ===")
for k, c in by_source.most_common():
    print(f"  {c:6d}  {k}")
print("\n=== источник x статус ===")
for (s, st), c in sorted(by_source_status.items()):
    print(f"  {c:6d}  {s:12s} {st}")
print("\n=== доступные (available) НЕ-картинки в хранилище, по расширению ===")
for k, c in nonimage_available.most_common():
    print(f"  {c:6d}  {k}")
print("\n=== адаптеры чатов, где есть вложения ===")
for k, c in adapter_of_chat_with_atts.most_common():
    print(f"  {c:6d}  {k}")
