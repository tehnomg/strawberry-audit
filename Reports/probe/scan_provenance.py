# -*- coding: utf-8 -*-
"""Кто и чем писал рабочий архив: адаптер, версия импортёра, версия хэшей.

Только чтение G:\\Strawberry\\chats. Отчёт: StrawberryEdition\\probe\\provenance_report.txt
"""
from __future__ import annotations

import io
import json
from collections import Counter
from pathlib import Path

CHATS = Path(r"G:\Strawberry\chats")
OUT = Path(__file__).resolve().parent / "provenance_report.txt"

log = io.StringIO()


def say(*a):
    log.write(" ".join(str(x) for x in a) + "\n")


def main():
    by_source = Counter()
    by_importer = Counter()
    by_hashver = Counter()
    by_observedver = Counter()
    src_importer = Counter()
    src_hashver = Counter()
    no_hash = []
    pinned = 0
    archived_flag = 0
    extra_keys = Counter()
    total = 0
    known = {"id", "title", "source", "source_kind", "original_id", "model", "messages",
             "created_at", "updated_at", "imported_at", "first_imported_at",
             "source_created_at", "source_updated_at", "time_confidence",
             "source_message_count", "source_content_hash",
             "source_content_hash_version", "source_observed_hash",
             "source_observed_hash_version", "branches", "parse_report",
             "importer_version", "source_file", "source_file_sha256", "pinned",
             "source_url", "source_meta", "archived", "tags", "folders", "starred"}
    for p in sorted(CHATS.glob("*.json")):
        if p.name.startswith("_"):
            continue
        try:
            d = json.loads(p.read_text("utf-8"))
        except Exception as e:
            say(f"читается с ошибкой: {p.name}: {type(e).__name__}")
            continue
        total += 1
        s = str(d.get("source"))
        iv = str(d.get("importer_version"))
        hv = str(d.get("source_content_hash_version"))
        ov = str(d.get("source_observed_hash_version"))
        by_source[s] += 1
        by_importer[iv] += 1
        by_hashver[hv] += 1
        by_observedver[ov] += 1
        src_importer[(s, iv)] += 1
        src_hashver[(s, hv)] += 1
        if d.get("source_content_hash") is None:
            no_hash.append((p.name, s, iv))
        if "pinned" in d:
            pinned += 1
        if "archived" in d:
            archived_flag += 1
        for k in d:
            if k not in known:
                extra_keys[k] += 1

    say(f"всего файлов чатов: {total}")
    say("\nисточник -> сколько чатов:")
    for k, v in by_source.most_common():
        say(f"  {k}: {v}")
    say("\nimporter_version:")
    for k, v in by_importer.most_common():
        say(f"  {k}: {v}")
    say("\nsource_content_hash_version:")
    for k, v in by_hashver.most_common():
        say(f"  {k}: {v}")
    say("source_observed_hash_version:")
    for k, v in by_observedver.most_common():
        say(f"  {k}: {v}")
    say("\nисточник x importer_version:")
    for (s, iv), v in src_importer.most_common():
        say(f"  {s} / {iv}: {v}")
    say("\nисточник x версия хэша содержимого:")
    for (s, hv), v in src_hashver.most_common():
        say(f"  {s} / {hv}: {v}")
    say(f"\nчатов без source_content_hash: {len(no_hash)}")
    for name, s, iv in no_hash[:15]:
        say(f"  {name} (source={s}, importer_version={iv})")
    say(f"\nфлаги: pinned={pinned}, archived={archived_flag}")
    say("\nнеизвестные ключи верхнего уровня (кто и сколько раз):")
    for k, v in extra_keys.most_common(25):
        say(f"  {k}: {v}")
    OUT.write_text(log.getvalue(), encoding="utf-8")
    print("OK:", OUT)


if __name__ == "__main__":
    main()
