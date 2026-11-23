"""Read-only scan of the real Strawberry store: what the storage model actually holds.

Запускается без аргументов против G:\\Strawberry\\chats. Ничего не пишет и не меняет.
Считает: по каким ключам реально встречаются вложения, какие mime/kind/ext,
сколько записей без mime, есть ли не-image медиа, есть ли произвольные файлы.
"""
import json
import sys
import collections
from pathlib import Path

CHATS = Path(sys.argv[1] if len(sys.argv) > 1 else r"G:\Strawberry\chats")

keys = collections.Counter()          # ключи словаря вложения
kind = collections.Counter()
mime = collections.Counter()
status = collections.Counter()
bucket = collections.Counter()        # images / files
ext_from_url = collections.Counter()
no_mime_with_url = collections.Counter()   # ext записей, у которых нет mime, но файл лежит
missing_mime_ext = collections.Counter()
samples = {}
nchats = nmsgs = natt = 0
chats_with_files = 0
nonimage_in_images = []

for p in CHATS.glob("*.json"):
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[skip] {p.name}: {e}")
        continue
    nchats += 1
    has_files = False
    for m in doc.get("messages") or []:
        if not isinstance(m, dict):
            continue
        nmsgs += 1
        for bk in ("images", "files"):
            for a in m.get(bk) or []:
                if not isinstance(a, dict):
                    keys[f"{bk}:<не словарь>"] += 1
                    continue
                natt += 1
                bucket[bk] += 1
                if bk == "files":
                    has_files = True
                for k, v in a.items():
                    keys[f"{bk}.{k}" if False else k] += 1
                kind[str(a.get("kind"))] += 1
                mm = a.get("mime")
                mime[str(mm)] += 1
                status[str(a.get("status"))] += 1
                url = a.get("url") or ""
                ex = ""
                if "/" in url:
                    fn = url.rsplit("/", 1)[-1]
                    ex = "." + fn.rsplit(".", 1)[-1].lower() if "." in fn else "(без расширения)"
                if ex:
                    ext_from_url[ex] += 1
                if not mm and url:
                    no_mime_with_url[ex or "(нет url)"] += 1
                if not mm:
                    missing_mime_ext[str(ex or a.get("format_hint"))] += 1
                key = f"{bk}.{ex or '(нет url)'}"
                if key not in samples and (ex not in (".jpg", ".jpeg", ".png", ".webp", ".gif") or bk == "files"):
                    samples[key] = {"chat": p.name, "att": {k: (v[:120] + "…" if isinstance(v, str) and len(v) > 120 else v)
                                                             for k, v in a.items()}}
                if bk == "images" and mm and not str(mm).startswith("image/"):
                    nonimage_in_images.append({"chat": p.name, "kind": a.get("kind"),
                                               "mime": mm, "url": url, "name": a.get("name")})
    if has_files:
        chats_with_files += 1

print(f"=== реальные чаты: {CHATS}")
print(f"чатов: {nchats}  сообщений: {nmsgs}  записей вложений: {natt}  чатов с files: {chats_with_files}")
print("\n-- ключи вложений (сколько записей содержит ключ) --")
for k, c in keys.most_common():
    print(f"  {c:6d}  {k}")
print("\n-- kind --")
for k, c in kind.most_common():
    print(f"  {c:6d}  {k}")
print("\n-- bucket --")
for k, c in bucket.most_common():
    print(f"  {c:6d}  {k}")
print("\n-- mime --")
for k, c in mime.most_common():
    print(f"  {c:6d}  {k}")
print("\n-- status --")
for k, c in status.most_common():
    print(f"  {c:6d}  {k}")
print("\n-- расширение из url --")
for k, c in ext_from_url.most_common():
    print(f"  {c:6d}  {k}")
print("\n-- записи БЕЗ mime (по расширению файла в хранилище) --")
for k, c in no_mime_with_url.most_common():
    print(f"  {c:6d}  {k}")
print("\n-- в images, но mime не image/ (неправильная корзина) --")
for s in nonimage_in_images[:10]:
    print("  ", s)
print(f"  всего таких: {len(nonimage_in_images)}")
print("\n-- образцы нестандартных вложений --")
for k, v in list(samples.items())[:25]:
    print(f"  {k}: {json.dumps(v, ensure_ascii=False)}")
