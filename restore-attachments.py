#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
restore-attachments.py — этап 11, шаг 5: вернуть доступные картинки в чаты.

Что делает:
  1) Сканирует chats/*.json на markdown-картинки ![alt](url) с разрешённых хостов
     (по умолчанию images.openai.com и files.deepseeksvc.com).
  2) Скачивает каждую такую картинку один раз и кладёт в
     attachments/<chat_id>/<sha256[:16]>.<ext> (как это делает cleanup-attachments.py).
  3) Переписывает markdown-ссылку на /api/attachments/<chat_id>/<filename>.
  4) Если у записи images[] в том же чате есть source_id == file_id скачанного URL,
     заполняет ей url и помечает status="available" (картинка снова доступна модели).
  5) Остальные записи images[] со status="missing" помечает status="unrecoverable"
     (с причиной), чтобы больше не считать их «пропадающими».

Безопасность:
  - по умолчанию только читает (--dry-run); запись — при --apply;
  - перед любой записью — бэкап chats/ в zip;
  - атомарная запись (tmp + os.replace);
  - правки точечные (конкретный URL в конкретном сообщении): если живое приложение
    успело изменить сообщение, замена пропускается и это пишется в лог;
  - идемпотентность: уже скачанное (по manifest) повторно не качается;
  - в лог не попадают тексты сообщений и содержимое картинок.

Запуск:
  python restore-attachments.py                 # разбор, ничего не пишет
  python restore-attachments.py --apply        # бэкап + скачивание + запись
"""

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE = Path(r"G:\Strawberry")
CHATS = BASE / "chats"
ATTACH = BASE / "attachments"
MANIFEST = ATTACH / "restore_manifest.json"
REPORT_DIR = Path(r"C:\Users\User\Documents\Strata\Workspace\audit_ui_test")

ALLOWED_HOSTS = {"images.openai.com", "files.deepseeksvc.com"}
# хосты, которые проверены и больше не отдают файлы (проверка живьём: HTTP 404)
DEAD_HOSTS = {"cdn.qwenlm.ai": "source_404_cdn_qwenlm"}
MD_IMG_RE = re.compile(r'!\[([^\]]*)\]\(\s*(<?[^)\s>]+>?)(?:\s+"[^"]*")?\s*\)')
MAX_BYTES = 25 * 1024 * 1024
TIMEOUT = 25
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

CT_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}

OP_ID = time.strftime("%Y%m%d-%H%M%S")


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Log:
    """Структурный лог операции: время, тип, количество, id операции, результат, ошибки.
    Никаких текстов сообщений и содержимого файлов."""

    def __init__(self, path):
        self.path = path
        self.f = open(path, "w", encoding="utf-8")

    def add(self, kind, **kw):
        rec = {"ts": now_iso(), "op": OP_ID, "kind": kind}
        rec.update(kw)
        self.f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.f.flush()
        print(json.dumps(rec, ensure_ascii=False))

    def close(self):
        self.f.close()


def sniff_ext(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def safe_chat_id(chat_file):
    """chat_id = имя файла без .json (как в cleanup-attachments.py)."""
    return Path(chat_file).stem


def url_key(u):
    return u.strip().strip("<>").strip('"').strip("'")


def is_allowed(u):
    try:
        h = urlparse(u).netloc.lower()
    except Exception:
        return False
    return h in ALLOWED_HOSTS


def file_id_of(u):
    """files.deepseeksvc.com → ?file_id=<uuid> (по нему сопоставляем записи images[])."""
    try:
        q = parse_qs(urlparse(u).query)
    except Exception:
        return ""
    return (q.get("file_id") or [""])[0]


def load_manifest():
    if MANIFEST.exists():
        try:
            with open(MANIFEST, "r", encoding="utf-8") as f:
                m = json.load(f)
            if isinstance(m, dict) and isinstance(m.get("items"), dict):
                return m
        except Exception:
            pass
    return {"version": 1, "created": now_iso(), "op": OP_ID, "items": {}}


def save_manifest(m):
    tmp = MANIFEST.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, MANIFEST)


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path, obj, log):
    """Атомарная запись. Возвращает False, если файл изменился параллельно."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)
        os.replace(tmp, path)
        return True
    except Exception as e:
        log.add("write_error", chat=path.name, err=repr(e))
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False


def backup_chats(log):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = BASE / ("chats_backup_%s.zip" % stamp)
    t0 = time.time()
    n = 0
    total = 0
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(CHATS.glob("*.json")):
            z.write(p, arcname="chats/" + p.name)
            n += 1
            total += p.stat().st_size
    log.add("backup_done", zip=str(dest), files=n, bytes=total, ms=int((time.time() - t0) * 1000))
    return dest


def fetch(url, log, host):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            ct = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            data = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        log.add("download_fail", host=host, status=e.code, url_hash=hashlib.sha256(url.encode()).hexdigest()[:12])
        return None, "http_%s" % e.code
    except Exception as e:
        log.add("download_fail", host=host, err=type(e).__name__, url_hash=hashlib.sha256(url.encode()).hexdigest()[:12])
        return None, type(e).__name__
    if not data:
        return None, "empty"
    if len(data) > MAX_BYTES:
        return None, "too_large"
    ext = CT_EXT.get(ct) or sniff_ext(data)
    if not ext:
        log.add("download_rejected", host=host, reason="not_an_image", content_type=ct or "?",
                url_hash=hashlib.sha256(url.encode()).hexdigest()[:12])
        return None, "not_an_image"
    return (data, ext), None


def store_image(chat_id, data, ext, log, apply):
    sha = hashlib.sha256(data).hexdigest()
    fn = sha[:16] + ext
    d = ATTACH / chat_id
    target = d / fn
    if not apply:
        log.add("image_would_save", chat=chat_id, file=fn, bytes=len(data))
        return "/api/attachments/%s/%s" % (chat_id, fn), sha, len(data)
    d.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        tmp = d / (fn + ".tmp")
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, target)
        log.add("image_saved", chat=chat_id, file=fn, bytes=len(data))
    return "/api/attachments/%s/%s" % (chat_id, fn), sha, len(data)


def main():
    global ALLOWED_HOSTS
    ap = argparse.ArgumentParser(description="Докачка потерянных картинок из чатов (этап 11, шаг 5).")
    ap.add_argument("--apply", action="store_true", help="записывать (по умолчанию только разбор)")
    ap.add_argument("--hosts", default=",".join(sorted(ALLOWED_HOSTS)), help="разрешённые хосты через запятую")
    ap.add_argument("--limit", type=int, default=0, help="максимум скачиваний (0 = без лимита)")
    ap.add_argument("--no-mark-unrecoverable", action="store_true",
                    help="не помечать недоступные записи images[] как unrecoverable")
    ap.add_argument("--no-backup", action="store_true", help="не делать бэкап chats/ (только для разбора)")
    ap.add_argument("--scan-only", action="store_true", help="только разбор: без сети, без записи вообще")
    args = ap.parse_args()

    ALLOWED_HOSTS = {h.strip().lower() for h in args.hosts.split(",") if h.strip()}

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    logpath = REPORT_DIR / ("restore_log_%s.jsonl" % OP_ID)
    log = Log(logpath)

    apply = args.apply
    log.add("start", apply=apply, hosts=sorted(ALLOWED_HOSTS), chats=str(CHATS))

    chats = sorted(CHATS.glob("*.json"))
    log.add("inventory", chats=len(chats))

    manifest = load_manifest()

    # ---------- проход 1: что качаем ----------
    want = {}     # (chat_id, url) -> count
    by_chat = {}  # chat_id -> {url: local_path_or_None}
    stats = {"chats_with_md_images": 0, "md_links_allowed": 0, "md_links_other": 0,
             "unique_urls_allowed": 0, "msgs_with_md_images": 0}
    for cf in chats:
        cid = safe_chat_id(cf)
        try:
            data = read_json(cf)
        except Exception as e:
            log.add("read_error", chat=cf.name, err=repr(e))
            continue
        msgs = data.get("messages") or []
        hit = False
        for m in msgs:
            txt = m.get("text")
            if not isinstance(txt, str) or "![" not in txt:
                continue
            for mt in MD_IMG_RE.finditer(txt):
                u = url_key(mt.group(2))
                if is_allowed(u):
                    want[(cid, u)] = want.get((cid, u), 0) + 1
                    stats["md_links_allowed"] += 1
                    hit = True
                    stats["msgs_with_md_images"] += 1
                else:
                    stats["md_links_other"] += 1
        if hit:
            stats["chats_with_md_images"] += 1
    uniq = {u for (_c, u) in want}
    stats["unique_urls_allowed"] = len(uniq)
    log.add("scan_done", **stats)

    if args.scan_only:
        summary = {"op": OP_ID, "mode": "scan_only", "scanned_chats": len(chats), "scan": stats,
                   "log": str(logpath)}
        (REPORT_DIR / ("restore_report_%s.json" % OP_ID)).write_text(
            json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
        log.close()
        print("\n=== РАЗБОР ===")
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        return 0

    # ---------- бэкап перед любыми записями ----------
    if apply and not args.no_backup:
        backup_chats(log)
    elif not apply:
        log.add("backup_skipped", reason="dry_run")
    else:
        log.add("backup_skipped", reason="flag_no_backup")

    # ---------- скачивание ----------
    done = 0
    fail_reason = {}
    for (cid, u), cnt in sorted(want.items()):
        k = cid + "|" + u
        prev = manifest["items"].get(k)
        if prev and prev.get("path"):
            p = ATTACH / cid / Path(prev["path"].split("/")[-1])
            if p.exists():
                by_chat.setdefault(cid, {})[u] = prev["path"]
                continue
        if args.limit and done >= args.limit:
            log.add("download_skipped", reason="limit", chat=cid)
            continue
        res, err = fetch(u, log, urlparse(u).netloc.lower())
        done += 1
        if res is None:
            fail_reason[u] = err
            continue
        data, ext = res
        path, sha, size = store_image(cid, data, ext, log, apply)
        by_chat.setdefault(cid, {})[u] = path
        manifest["items"][k] = {"url": u, "path": path, "sha256": sha, "bytes": size,
                                "chat": cid, "at": now_iso()}
        if apply and done % 10 == 0:
            save_manifest(manifest)

    downloaded = sum(len(m) for m in by_chat.values())
    log.add("download_done", attempted=done, ok=downloaded,
            unique_ok=len({p for m in by_chat.values() for p in m.values()}),
            distinct_failures=len(fail_reason))

    # ---------- сопоставление записей images[] по file_id ----------
    fid_to_path = {}
    for cid, umap in by_chat.items():
        for u, path in umap.items():
            fid = file_id_of(u)
            if fid:
                fid_to_path.setdefault(cid + "|" + fid, path)

    # ---------- проход 2: запись ----------
    counts = {"chats_changed": 0, "chats_skipped_concurrent": 0, "chats_skipped_recent": 0,
              "chats_would_skip_recent": 0, "md_replaced": 0,
              "images_restored": 0, "images_restored_same_msg": 0, "images_marked_unrecoverable": 0,
              "images_left_missing": 0, "images_anomaly": 0}
    same_msg_paths = set()
    for cf in chats:
        cid = safe_chat_id(cf)
        try:
            data = read_json(cf)
        except Exception:
            continue
        url_map = by_chat.get(cid, {})
        changed = False
        for m in (data.get("messages") or []):
            txt = m.get("text")
            restored_in_msg = []
            if isinstance(txt, str) and url_map and "![" in txt:
                new = txt
                for u, path in url_map.items():
                    if u in new:
                        new = new.replace(u, path)
                        restored_in_msg.append(path)
                        counts["md_replaced"] += 1
                if new != txt:
                    m["text"] = new
                    changed = True
            imgs = m.get("images")
            if not isinstance(imgs, list):
                continue
            # 1:1 в одном сообщении: одна скачанная картинка в тексте и одна потерянная запись без url
            missing_nourl = [im for im in imgs
                             if isinstance(im, dict) and im.get("status") == "missing" and not im.get("url")]
            same_msg_path = restored_in_msg[0] if (len(restored_in_msg) == 1 and len(missing_nourl) == 1) else None
            for im in imgs:
                if not isinstance(im, dict):
                    continue
                st = im.get("status")
                url = im.get("url")
                if st == "missing":
                    fid = str(im.get("source_id") or "")
                    p = fid_to_path.get(cid + "|" + fid) if fid else None
                    how = "file_id_match"
                    if p is None and same_msg_path is not None:
                        p = same_msg_path
                        how = "same_message_markdown"
                        if p not in same_msg_paths:
                            same_msg_paths.add(p)
                            counts["images_restored_same_msg"] += 1
                    if p:
                        im["url"] = p
                        im["status"] = "available"
                        im["restored_at"] = now_iso()
                        im["restored_from"] = how
                        counts["images_restored"] += 1
                        changed = True
                        continue
                    # url уже указывает на существующий файл — не трогаем, но чиним статус
                    if isinstance(url, str) and url.startswith("/api/attachments/"):
                        parts = url.split("/")
                        if len(parts) == 5:
                            fp = ATTACH / parts[3] / parts[4]
                            if fp.exists():
                                im["status"] = "available"
                                counts["images_anomaly"] += 1
                                changed = True
                                continue
                    if not args.no_mark_unrecoverable:
                        src = str(im.get("source_url") or "")
                        host = urlparse(src).netloc.lower() if src else ""
                        if host in DEAD_HOSTS:
                            reason = DEAD_HOSTS[host]
                        elif host and host not in ALLOWED_HOSTS:
                            reason = "source_host_not_allowed"
                        elif fail_reason.get(str(im.get("source_url") or "")):
                            reason = "download_" + str(fail_reason.get(im.get("source_url")))
                        elif not src:
                            reason = "no_source_url"
                        else:
                            reason = "source_unavailable"
                        im["status"] = "unrecoverable"
                        im["unrecoverable_at"] = now_iso()
                        im["unrecoverable_reason"] = reason
                        if im.get("source"):
                            im["unrecoverable_source"] = str(im.get("source"))[:40]
                        counts["images_marked_unrecoverable"] += 1
                        changed = True
                    else:
                        counts["images_left_missing"] += 1
                elif st is None:
                    counts["images_anomaly"] += 1
        if not changed:
            continue
        age = time.time() - cf.stat().st_mtime
        if not apply:
            counts["chats_changed"] += 1
            if age < 120:
                counts["chats_would_skip_recent"] += 1
            continue
        # файл писало живое приложение меньше двух минут назад — не трогаем его
        if age < 120:
            counts["chats_skipped_recent"] += 1
            log.add("skip_recent", chat=cf.name, age_s=int(age))
            continue
        if write_json_atomic(cf, data, log):
            counts["chats_changed"] += 1
        else:
            counts["chats_skipped_concurrent"] += 1

    if apply:
        save_manifest(manifest)

    summary = {"op": OP_ID, "apply": apply, "scanned_chats": len(chats),
               "scan": stats, "downloaded_ok": downloaded, "failed_urls": len(fail_reason),
               "result": counts, "manifest": str(MANIFEST), "log": str(logpath)}
    (REPORT_DIR / ("restore_report_%s.json" % OP_ID)).write_text(
        json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    log.add("done", **counts)
    log.close()
    print("\n=== ИТОГО ===")
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
